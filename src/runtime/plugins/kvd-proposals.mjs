/**
 * kvd-proposals — pending proposal store + create/edit/move/apply/discard.
 * Listens to `kvd/vault-changed` and clears pending (fixes G4).
 * Registers apply/discard IPC on the bridge when `ipc` is available.
 */
import { createRequire } from 'node:module';
import { Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';

const require = createRequire(import.meta.url);
const {
  proposeCreate,
  proposeEdit,
  proposeMove,
  applyProposal,
  discardProposal,
} = require('../../agent/proposals.js');

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
