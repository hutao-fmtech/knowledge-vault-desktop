'use strict';

const path = require('path');
const fs = require('fs');

const FORBIDDEN_PREFIXES = ['00-系统', '.obsidian'];

/**
 * Resolve a vault-relative path and ensure it stays inside the vault.
 * Rejects absolute paths, `..`, symlinks that escape, `.obsidian/`, and `00-系统/`.
 * @returns {{ ok: true, abs: string, rel: string } | { ok: false, error: string }}
 */
function resolveVaultPath(vaultRoot, relPath) {
  if (relPath == null || typeof relPath !== 'string' || !relPath.trim()) {
    return { ok: false, error: '路径为空' };
  }
  const raw = relPath.replace(/\\/g, '/').trim();
  if (path.isAbsolute(raw) || /^[A-Za-z]:/.test(raw)) {
    return { ok: false, error: '禁止绝对路径' };
  }
  if (raw.split('/').some((p) => p === '..')) {
    return { ok: false, error: '禁止 .. 穿越' };
  }
  const top = raw.split('/').filter(Boolean)[0];
  if (FORBIDDEN_PREFIXES.includes(top)) {
    return { ok: false, error: `禁止写入 ${top}/` };
  }
  const root = path.resolve(vaultRoot);
  const abs = path.resolve(root, raw);
  const relToRoot = path.relative(root, abs);
  if (relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) {
    return { ok: false, error: '路径超出 vault 根目录' };
  }
  return { ok: true, abs, rel: relToRoot.split(path.sep).join('/') };
}

function isReadableRel(relPath) {
  const top = String(relPath || '').replace(/\\/g, '/').split('/').filter(Boolean)[0];
  return top !== '00-系统' && top !== '90-附件' && top !== '.obsidian';
}

function assertInsideVault(vaultRoot, absPath) {
  const root = path.resolve(vaultRoot);
  const abs = path.resolve(absPath);
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return { ok: false, error: '路径超出 vault 根目录' };
  }
  try {
    if (fs.existsSync(abs)) {
      const realRoot = fs.realpathSync(root);
      const realAbs = fs.realpathSync(abs);
      const realRel = path.relative(realRoot, realAbs);
      if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
        return { ok: false, error: '符号链接指向 vault 之外' };
      }
    }
  } catch (err) {
    return { ok: false, error: `路径校验失败：${err.message}` };
  }
  return { ok: true, abs, rel: rel.split(path.sep).join('/') };
}

module.exports = {
  resolveVaultPath,
  isReadableRel,
  assertInsideVault,
  FORBIDDEN_PREFIXES,
};
