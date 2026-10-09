'use strict';

const fs = require('fs');
const path = require('path');
const { resolveVaultPath, assertInsideVault } = require('./paths');

let _seq = 0;
function nextId() {
  _seq += 1;
  return `chg_${Date.now()}_${_seq}`;
}

/**
 * @typedef {{ id: string, kind: 'create'|'edit'|'move', path?: string, from?: string, to?: string, content?: string, before?: string, summary: string }} Proposal
 */

function proposeCreate(vaultRoot, relPath, content, summary) {
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

function proposeEdit(vaultRoot, relPath, content, summary) {
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

function proposeMove(vaultRoot, fromRel, toRel, summary) {
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
function applyProposal(vaultRoot, proposal) {
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

function discardProposal(proposal) {
  return { ok: true, discarded: proposal && proposal.id };
}

module.exports = {
  proposeCreate,
  proposeEdit,
  proposeMove,
  applyProposal,
  discardProposal,
};
