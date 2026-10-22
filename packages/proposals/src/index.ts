/**
 * kvd-proposals — pending proposal store + create/edit/move/apply/discard.
 * Listens to `kvd/vault-changed` and clears pending (fixes G4).
 * Registers apply/discard IPC on the bridge when `ipc` is available.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Context, Service } from '@deepseek-ai/cordis';
import type {} from '@kvd/ipc-bridge';
import z from '@deepseek-ai/schemastery';
import { resolveVaultPath, assertInsideVault } from '@kvd/vault';
import { LOCAL_UI_ORIGIN, WRITE_PAUSED_MSG, describeOrigin, isLocalUiOrigin } from './write-pause.js';
import type { ActionOrigin, WritePause } from './write-pause.js';

export * from './write-pause.js';

// ---- pure proposal helpers (folded from src/agent/proposals.js) ----
let _seq = 0;
/** sha256 hex of file bytes (or a utf8 string). Used by the Apply stale-guard. */
export function sha256Hex(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/** User-facing message when the target changed between propose and Apply (AL-0 / PR-0). */
export function staleProposalError(rel: string, detail: string): string {
  return `文件已被改动，请重新生成建议（${detail}：${rel}）。为避免覆盖，已拒绝 Apply，磁盘未改动。`;
}

/** Failure code for a stale proposal (agent-log will record it as `error: stale`). */
export const STALE = 'STALE';

function nextId(): string {
  _seq += 1;
  return `chg_${Date.now()}_${_seq}`;
}

export interface Proposal {
  id: string;
  kind: 'create' | 'edit' | 'move';
  path?: string;
  from?: string;
  to?: string;
  content?: string;
  before?: string;
  /** edit only: sha256 (hex) of the target file bytes when the proposal was generated. */
  beforeSha256?: string;
  summary: string;
}

export type Failure = { ok: false; error: string; code?: string };

/** Why an Apply was refused (R1 / R2); recorded via onApplyRejected listeners. */
export interface ApplyRejection {
  id: string;
  code: 'APPLY_FORBIDDEN' | 'WRITE_PAUSED';
  origin: string;
  reason: string;
}
export type ApplyRejectedListener = (rejection: ApplyRejection) => void;
export type ProposeResult = { ok: true; proposal: Proposal } | Failure;
export type ApplyResult = { ok: true; applied: Proposal } | Failure;

declare module '@deepseek-ai/cordis' {
  interface Context {
    proposals: ProposalsService;
  }
}


/** One line of a unified-style review diff (pure; no I/O). */
export type DiffLine = { op: 'equal' | 'insert' | 'delete'; text: string };

function splitLines(s: string): string[] {
  if (s === '') return [];
  const parts = s.split('\n');
  // Drop trailing empty from a final newline so "a\n" and "a" compare as one line.
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

/**
 * Line-level LCS diff for proposal review UI ("可审 diff").
 * Pure: works from proposal.before / proposal.content already on the payload.
 */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = splitLines(before);
  const b = splitLines(after);
  const n = a.length;
  const m = b.length;
  // Flat (n+1)*(m+1) DP table avoids nested noUncheckedIndexedAccess noise.
  const dp = new Array<number>((n + 1) * (m + 1)).fill(0);
  const at = (i: number, j: number): number => dp[i * (m + 1) + j]!;
  const set = (i: number, j: number, v: number): void => {
    dp[i * (m + 1) + j] = v;
  };
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      set(i, j, a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1)));
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: 'equal', text: a[i]! });
      i += 1;
      j += 1;
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      out.push({ op: 'delete', text: a[i]! });
      i += 1;
    } else {
      out.push({ op: 'insert', text: b[j]! });
      j += 1;
    }
  }
  while (i < n) {
    out.push({ op: 'delete', text: a[i]! });
    i += 1;
  }
  while (j < m) {
    out.push({ op: 'insert', text: b[j]! });
    j += 1;
  }
  return out;
}

/** Minimal shape needed to format a review pane (Proposal or IPC payload). */
export type ProposalReviewInput = {
  kind: 'create' | 'edit' | 'move' | string;
  path?: string;
  from?: string;
  to?: string;
  content?: string;
  before?: string;
};

/**
 * Human-readable review body for the Approve/Apply gate.
 * Edit → unified line diff; create → full proposed body; move → from → to.
 */
export function formatProposalReview(p: ProposalReviewInput | null | undefined): string {
  if (!p || !p.kind) return '';
  if (p.kind === 'move') return `移动 ${p.from ?? ''} → ${p.to ?? ''}`;
  if (p.kind === 'create') {
    const body = p.content ?? '';
    return `创建 ${p.path ?? ''}\n\n${body}`;
  }
  if (p.kind === 'edit') {
    const lines = lineDiff(p.before ?? '', p.content ?? '');
    const body = lines
      .map((l) => {
        const prefix = l.op === 'equal' ? ' ' : l.op === 'insert' ? '+' : '-';
        return `${prefix}${l.text}`;
      })
      .join('\n');
    return `编辑 ${p.path ?? ''}\n\n${body}`;
  }
  return String(p.kind);
}

export function proposeCreate(vaultRoot: string, relPath: unknown, content: unknown, summary?: string): ProposeResult {
  const resolved = resolveVaultPath(vaultRoot, relPath);
  if (!resolved.ok) return resolved;
  if (fs.existsSync(resolved.abs)) {
    return { ok: false, error: `目标已存在，拒绝覆盖：${resolved.rel}` };
  }
  const proposal: Proposal = {
    id: nextId(),
    kind: 'create',
    path: resolved.rel,
    content: content == null ? '' : String(content),
    summary: summary || `创建 ${resolved.rel}`,
  };
  return { ok: true, proposal };
}

export function proposeEdit(vaultRoot: string, relPath: unknown, content: unknown, summary?: string): ProposeResult {
  const resolved = resolveVaultPath(vaultRoot, relPath);
  if (!resolved.ok) return resolved;
  if (!fs.existsSync(resolved.abs)) {
    return { ok: false, error: `文件不存在：${resolved.rel}` };
  }
  const bytes = fs.readFileSync(resolved.abs);
  const before = bytes.toString('utf8');
  const proposal: Proposal = {
    id: nextId(),
    kind: 'edit',
    path: resolved.rel,
    before,
    beforeSha256: sha256Hex(bytes),
    content: String(content),
    summary: summary || `编辑 ${resolved.rel}`,
  };
  return { ok: true, proposal };
}

export function proposeMove(vaultRoot: string, fromRel: unknown, toRel: unknown, summary?: string): ProposeResult {
  const from = resolveVaultPath(vaultRoot, fromRel);
  if (!from.ok) return from;
  const to = resolveVaultPath(vaultRoot, toRel);
  if (!to.ok) return to;
  if (!fs.existsSync(from.abs)) {
    return { ok: false, error: `源文件不存在：${from.rel}` };
  }
  if (fs.existsSync(to.abs)) {
    return { ok: false, error: `目标已存在，拒绝覆盖：${to.rel}` };
  }
  const proposal: Proposal = {
    id: nextId(),
    kind: 'move',
    from: from.rel,
    to: to.rel,
    summary: summary || `移动 ${from.rel} → ${to.rel}`,
  };
  return { ok: true, proposal };
}

function atomicWrite(absPath: string, content: string): void {
  const dir = path.dirname(absPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(absPath)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, absPath);
}

/**
 * Apply one proposal. Disk unchanged on failure.
 */
export function applyProposal(vaultRoot: string, proposal: Proposal | null | undefined): ApplyResult {
  if (!proposal || !proposal.kind) {
    return { ok: false, error: '无效的拟改动' };
  }
  try {
    if (proposal.kind === 'create') {
      const resolved = resolveVaultPath(vaultRoot, proposal.path);
      if (!resolved.ok) return resolved;
      if (fs.existsSync(resolved.abs)) {
        return { ok: false, code: STALE, error: staleProposalError(resolved.rel, '目标已存在') };
      }
      atomicWrite(resolved.abs, proposal.content || '');
      return { ok: true, applied: proposal };
    }
    if (proposal.kind === 'edit') {
      const resolved = resolveVaultPath(vaultRoot, proposal.path);
      if (!resolved.ok) return resolved;
      if (!fs.existsSync(resolved.abs)) {
        return { ok: false, code: STALE, error: staleProposalError(resolved.rel, '文件已不存在') };
      }
      // Stale guard: the file must still be byte-identical to what was reviewed.
      // Fall back to hashing `before` for proposals built without beforeSha256;
      // with neither, fail closed (cannot prove it is safe to overwrite).
      const expected =
        proposal.beforeSha256 ?? (proposal.before != null ? sha256Hex(Buffer.from(proposal.before, 'utf8')) : null);
      if (!expected || sha256Hex(fs.readFileSync(resolved.abs)) !== expected) {
        return { ok: false, code: STALE, error: staleProposalError(resolved.rel, '文件已被修改') };
      }
      atomicWrite(resolved.abs, proposal.content || '');
      return { ok: true, applied: proposal };
    }
    if (proposal.kind === 'move') {
      const from = resolveVaultPath(vaultRoot, proposal.from);
      if (!from.ok) return from;
      const to = resolveVaultPath(vaultRoot, proposal.to);
      if (!to.ok) return to;
      if (!fs.existsSync(from.abs)) {
        return { ok: false, error: `源文件不存在：${from.rel}` };
      }
      if (fs.existsSync(to.abs)) {
        return { ok: false, error: `目标已存在：${to.rel}` };
      }
      const guard = assertInsideVault(vaultRoot, from.abs);
      if (!guard.ok) return guard;
      fs.mkdirSync(path.dirname(to.abs), { recursive: true });
      fs.renameSync(from.abs, to.abs);
      return { ok: true, applied: proposal };
    }
    return { ok: false, error: `未知改动类型：${String((proposal as { kind: unknown }).kind)}` };
  } catch (err) {
    return { ok: false, error: `落盘失败：${(err as Error).message}` };
  }
}

export function discardProposal(proposal: Proposal | null | undefined): { ok: true; discarded: string | undefined } {
  return { ok: true, discarded: proposal?.id };
}

export const name = 'kvd-proposals';
export const inject = ['vault', 'ipc'];

export const Config = z.object({});

export class ProposalsService extends Service {
  static Config = Config;
  static inject = ['vault', 'ipc'];

  private readonly _pending = new Map<string, Proposal>();
  private _writePause: WritePause | null = null;
  private readonly _rejectListeners = new Set<ApplyRejectedListener>();

  constructor(ctx: Context, _config: unknown = {}) {
    super(ctx, 'proposals');

    ctx.on('kvd/vault-changed', () => {
      this._pending.clear();
    });

    // IPC routes live on this fiber; dispose unregisters them (kvd-ipc-bridge).
    const ipc = ctx.get('ipc');
    if (ipc && typeof ipc.handle === 'function') {
      // R1: the bridge only invokes this for our own main window (REMOTE_FORBIDDEN
      // otherwise), i.e. a user click in the desktop renderer.
      ipc.handle('agent-apply', (e, id) =>
        this.apply(String(id), ipc.isLocalSender(e) ? LOCAL_UI_ORIGIN : { kind: 'remote', channel: 'ipc' }),
      );
      ipc.handle('agent-discard', (_e, id) => this.discard(String(id)));
    }
  }

  /** R2: attach the app-config write pause (main process owns prefs.json). */
  attachWritePause(writePause: WritePause | null): void {
    this._writePause = writePause;
  }

  isWritePaused(): boolean {
    return !!this._writePause && this._writePause.isPaused();
  }

  /** Subscribe to refused Apply attempts (the shell writes them to the local log). */
  onApplyRejected(fn: ApplyRejectedListener): () => boolean {
    this._rejectListeners.add(fn);
    return () => this._rejectListeners.delete(fn);
  }

  private _pausedFailure(): Failure {
    return { ok: false, code: 'WRITE_PAUSED', error: `${WRITE_PAUSED_MSG}：不生成新的拟改动，已有拟改动暂不能 Apply（可 Discard）` };
  }

  private _rejectApply(id: string, code: ApplyRejection['code'], origin: ActionOrigin | null | undefined, error: string): Failure {
    const rejection: ApplyRejection = { id, code, origin: describeOrigin(origin), reason: error };
    for (const fn of this._rejectListeners) {
      try { fn(rejection); } catch { /* logging never changes the outcome */ }
    }
    return { ok: false, code, error };
  }

  root(): string | null {
    return this.ctx.vault.getRoot();
  }

  stash(proposal: Proposal | null | undefined): void {
    if (!proposal || !proposal.id || this.isWritePaused()) return;
    this._pending.set(proposal.id, proposal);
  }

  stashMany(proposals: readonly Proposal[] | null | undefined): string[] {
    const ids: string[] = [];
    if (this.isWritePaused()) return ids;
    for (const p of proposals || []) {
      if (!p || !p.id) continue;
      this._pending.set(p.id, p);
      ids.push(p.id);
    }
    return ids;
  }

  get(id: string): Proposal | undefined {
    return this._pending.get(id);
  }

  list(): Proposal[] {
    return [...this._pending.values()];
  }

  size(): number {
    return this._pending.size;
  }

  clear(): void {
    this._pending.clear();
  }

  create(relPath: unknown, content: unknown, summary?: string): ProposeResult {
    if (this.isWritePaused()) return this._pausedFailure();
    const root = this.root();
    if (!root) return { ok: false, error: '未打开 vault' };
    const res = proposeCreate(root, relPath, content, summary);
    if (res.ok) this.stash(res.proposal);
    return res;
  }

  edit(relPath: unknown, content: unknown, summary?: string): ProposeResult {
    if (this.isWritePaused()) return this._pausedFailure();
    const root = this.root();
    if (!root) return { ok: false, error: '未打开 vault' };
    const res = proposeEdit(root, relPath, content, summary);
    if (res.ok) this.stash(res.proposal);
    return res;
  }

  move(fromRel: unknown, toRel: unknown, summary?: string): ProposeResult {
    if (this.isWritePaused()) return this._pausedFailure();
    const root = this.root();
    if (!root) return { ok: false, error: '未打开 vault' };
    const res = proposeMove(root, fromRel, toRel, summary);
    if (res.ok) this.stash(res.proposal);
    return res;
  }

  /**
   * Apply a pending proposal. R1: only a human click in the desktop renderer
   * (`origin.kind === 'local-renderer'`) may Apply; the agent engine, tool layer,
   * skills and remote channels have no Apply entry, whatever the tool policy
   * ("log-only" included). R2: refused while writes are paused. Disk unchanged
   * and the proposal stays pending (Discard still works) on refusal.
   */
  apply(id: string, origin?: ActionOrigin | null): ApplyResult {
    if (!isLocalUiOrigin(origin)) {
      return this._rejectApply(id, 'APPLY_FORBIDDEN', origin, 'Apply 只能由用户在本机桌面界面手动点击，已拒绝（未写入）');
    }
    if (this.isWritePaused()) return this._rejectApply(id, 'WRITE_PAUSED', origin, this._pausedFailure().error);
    const root = this.root();
    if (!root) return { ok: false, error: '未打开 vault' };
    const proposal = this._pending.get(id);
    if (!proposal) return { ok: false, error: '找不到拟改动（可能已处理）' };
    const result = applyProposal(root, proposal);
    if (result.ok) this._pending.delete(id);
    return result;
  }

  discard(id: string): ReturnType<typeof discardProposal> | Failure {
    const proposal = this._pending.get(id);
    if (!proposal) return { ok: false, error: '找不到拟改动' };
    this._pending.delete(id);
    return discardProposal(proposal);
  }

  /**
   * Push a proposal to the renderer via ipc bridge (agent-proposal channel).
   */
  pushToUi(proposal: Proposal): void {
    const ipc = this.ctx.get('ipc');
    if (ipc && typeof ipc.push === 'function') {
      ipc.push('agent-proposal', proposal);
    }
  }
}

export default ProposalsService;
