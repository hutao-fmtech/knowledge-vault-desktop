/**
 * kvd-proposals — pending proposal store + create/edit/move/apply/discard.
 * Listens to `kvd/vault-changed` and clears pending (fixes G4).
 * Registers apply/discard IPC on the bridge when `ipc` is available.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { resolveVaultPath, assertInsideVault } from '@kvd/vault';

// ---- pure proposal helpers (folded from src/agent/proposals.js) ----
let _seq = 0;
function nextId() {
  _seq += 1;
  return `chg_${Date.now()}_${_seq}`;
}

/**
 * @typedef {{ id: string, kind: 'create'|'edit'|'move', path?: string, from?: string, to?: string, content?: string, before?: string, summary: string }} Proposal
 */

export function proposeCreate(vaultRoot, relPath, content, summary) {
  const resolved = resolveVaultPath(vaultRoot, relPath);
  if (!resolved.ok) return resolved;
  if (fs.existsSync(resolved.abs)) {
    return { ok: false, error: `目标已存在，拒绝覆盖：${resolved.rel}` };
  }
  /** @type {Proposal} */
  const proposal = {
    id: nextId(),
    kind: 'create',
    path: resolved.rel,
    content: content == null ? '' : String(content),
    summary: summary || `创建 ${resolved.rel}`,
  };
  return { ok: true, proposal };
}

export function proposeEdit(vaultRoot, relPath, content, summary) {
  const resolved = resolveVaultPath(vaultRoot, relPath);
  if (!resolved.ok) return resolved;
  if (!fs.existsSync(resolved.abs)) {
    return { ok: false, error: `文件不存在：${resolved.rel}` };
  }
  const before = fs.readFileSync(resolved.abs, 'utf8');
  /** @type {Proposal} */
  const proposal = {
    id: nextId(),
    kind: 'edit',
    path: resolved.rel,
    before,
    content: String(content),
    summary: summary || `编辑 ${resolved.rel}`,
  };
  return { ok: true, proposal };
}

export function proposeMove(vaultRoot, fromRel, toRel, summary) {
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
  /** @type {Proposal} */
  const proposal = {
    id: nextId(),
    kind: 'move',
    from: from.rel,
    to: to.rel,
    summary: summary || `移动 ${from.rel} → ${to.rel}`,
  };
  return { ok: true, proposal };
}

function atomicWrite(absPath, content) {
  const dir = path.dirname(absPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(absPath)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, absPath);
}

/**
 * Apply one proposal. Disk unchanged on failure.
 */
export function applyProposal(vaultRoot, proposal) {
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
    return { ok: false, error: `未知改动类型：${proposal.kind}` };
  } catch (err) {
    return { ok: false, error: `落盘失败：${err.message}` };
  }
}

export function discardProposal(proposal) {
  return { ok: true, discarded: proposal && proposal.id };
}

export const name = 'kvd-proposals';
export const inject = ['vault', 'ipc'];

export const Config = z.object({});

export class ProposalsService extends Service {
  static Config = Config;
  static inject = ['vault', 'ipc'];

  /** @param {import('@deepseek-ai/cordis').Context} ctx */
  constructor(ctx, _config = {}) {
    super(ctx, 'proposals');
    /** @type {Map<string, object>} */
    this._pending = new Map();

    ctx.on('kvd/vault-changed', () => {
      this._pending.clear();
    });

    // IPC routes live on this fiber; dispose unregisters them (kvd-ipc-bridge).
    const ipc = ctx.get('ipc');
    if (ipc && typeof ipc.handle === 'function') {
      ipc.handle('agent-apply', (_e, id) => this.apply(id));
      ipc.handle('agent-discard', (_e, id) => this.discard(id));
    }
  }

  /** @returns {string | null} */
  root() {
    return this.ctx.vault.getRoot();
  }

  /**
   * @param {object} proposal
   */
  stash(proposal) {
    if (!proposal || !proposal.id) return;
    this._pending.set(proposal.id, proposal);
  }

  /**
   * @param {object[]} proposals
   * @returns {string[]}
   */
  stashMany(proposals) {
    const ids = [];
    for (const p of proposals || []) {
      if (!p || !p.id) continue;
      this._pending.set(p.id, p);
      ids.push(p.id);
    }
    return ids;
  }

  get(id) {
    return this._pending.get(id);
  }

  list() {
    return [...this._pending.values()];
  }

  size() {
    return this._pending.size;
  }

  clear() {
    this._pending.clear();
  }

  create(relPath, content, summary) {
    const root = this.root();
    if (!root) return { ok: false, error: '未打开 vault' };
    const res = proposeCreate(root, relPath, content, summary);
    if (res.ok) this.stash(res.proposal);
    return res;
  }

  edit(relPath, content, summary) {
    const root = this.root();
    if (!root) return { ok: false, error: '未打开 vault' };
    const res = proposeEdit(root, relPath, content, summary);
    if (res.ok) this.stash(res.proposal);
    return res;
  }

  move(fromRel, toRel, summary) {
    const root = this.root();
    if (!root) return { ok: false, error: '未打开 vault' };
    const res = proposeMove(root, fromRel, toRel, summary);
    if (res.ok) this.stash(res.proposal);
    return res;
  }

  /**
   * @param {string} id
   */
  apply(id) {
    const root = this.root();
    if (!root) return { ok: false, error: '未打开 vault' };
    const proposal = this._pending.get(id);
    if (!proposal) return { ok: false, error: '找不到拟改动（可能已处理）' };
    const result = applyProposal(root, proposal);
    if (result.ok) this._pending.delete(id);
    return result;
  }

  /**
   * @param {string} id
   */
  discard(id) {
    const proposal = this._pending.get(id);
    if (!proposal) return { ok: false, error: '找不到拟改动' };
    this._pending.delete(id);
    return discardProposal(proposal);
  }

  /**
   * Push a proposal to the renderer via ipc bridge (agent-proposal channel).
   * @param {object} proposal
   */
  pushToUi(proposal) {
    const ipc = this.ctx.get('ipc');
    if (ipc && typeof ipc.push === 'function') {
      ipc.push('agent-proposal', proposal);
    }
  }
}

export default ProposalsService;
