/**
 * kvd-proposals — pending proposal store + create/edit/move/apply/discard.
 * Listens to `kvd/vault-changed` and clears pending (fixes G4).
 * Registers apply/discard IPC on the bridge when `ipc` is available.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Context, Service } from '@deepseek-ai/cordis';
import type {} from '@kvd/ipc-bridge';
import z from '@deepseek-ai/schemastery';
import { resolveVaultPath, assertInsideVault } from '@kvd/vault';

// ---- pure proposal helpers (folded from src/agent/proposals.js) ----
let _seq = 0;
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
  summary: string;
}

export type Failure = { ok: false; error: string };
export type ProposeResult = { ok: true; proposal: Proposal } | Failure;
export type ApplyResult = { ok: true; applied: Proposal } | Failure;

declare module '@deepseek-ai/cordis' {
  interface Context {
    proposals: ProposalsService;
  }
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
  const before = fs.readFileSync(resolved.abs, 'utf8');
  const proposal: Proposal = {
    id: nextId(),
    kind: 'edit',
    path: resolved.rel,
    before,
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
        return { ok: false, error: `目标已存在：${resolved.rel}` };
      }
      atomicWrite(resolved.abs, proposal.content || '');
      return { ok: true, applied: proposal };
    }
    if (proposal.kind === 'edit') {
      const resolved = resolveVaultPath(vaultRoot, proposal.path);
      if (!resolved.ok) return resolved;
      if (!fs.existsSync(resolved.abs)) {
        return { ok: false, error: `文件不存在：${resolved.rel}` };
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

  constructor(ctx: Context, _config: unknown = {}) {
    super(ctx, 'proposals');

    ctx.on('kvd/vault-changed', () => {
      this._pending.clear();
    });

    // IPC routes live on this fiber; dispose unregisters them (kvd-ipc-bridge).
    const ipc = ctx.get('ipc');
    if (ipc && typeof ipc.handle === 'function') {
      ipc.handle('agent-apply', (_e, id) => this.apply(String(id)));
      ipc.handle('agent-discard', (_e, id) => this.discard(String(id)));
    }
  }

  root(): string | null {
    return this.ctx.vault.getRoot();
  }

  stash(proposal: Proposal | null | undefined): void {
    if (!proposal || !proposal.id) return;
    this._pending.set(proposal.id, proposal);
  }

  stashMany(proposals: readonly Proposal[] | null | undefined): string[] {
    const ids: string[] = [];
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
    const root = this.root();
    if (!root) return { ok: false, error: '未打开 vault' };
    const res = proposeCreate(root, relPath, content, summary);
    if (res.ok) this.stash(res.proposal);
    return res;
  }

  edit(relPath: unknown, content: unknown, summary?: string): ProposeResult {
    const root = this.root();
    if (!root) return { ok: false, error: '未打开 vault' };
    const res = proposeEdit(root, relPath, content, summary);
    if (res.ok) this.stash(res.proposal);
    return res;
  }

  move(fromRel: unknown, toRel: unknown, summary?: string): ProposeResult {
    const root = this.root();
    if (!root) return { ok: false, error: '未打开 vault' };
    const res = proposeMove(root, fromRel, toRel, summary);
    if (res.ok) this.stash(res.proposal);
    return res;
  }

  apply(id: string): ApplyResult {
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
