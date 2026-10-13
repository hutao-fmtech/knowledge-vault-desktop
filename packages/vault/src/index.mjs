/**
 * kvd-vault — current vault root + path resolution (with realpath).
 * All read/write path resolution goes through vault.resolve() / resolveAgainst().
 * Emits `kvd/vault-changed` when the vault is set or cleared (G4 listener hook).
 *
 * Pure path helpers (resolveVaultPath / assertInsideVault / isReadableRel) are
 * exported from this module; kvd-search / kvd-proposals import them from here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';

// ---- pure path helpers (folded from src/agent/paths.js) ----
/** Top-level path segments that must never be written (or resolved for write). */
export const FORBIDDEN_PREFIXES = ['00-系统', '.obsidian'];

/**
 * Resolve a vault-relative path and ensure it stays inside the vault.
 * Rejects absolute paths, `..`, symlinks that escape, `.obsidian/`, and `00-系统/`.
 * Always runs realpath on the vault root and on every existing path component.
 * @returns {{ ok: true, abs: string, rel: string } | { ok: false, error: string }}
 */
export function resolveVaultPath(vaultRoot, relPath) {
  if (relPath == null || typeof relPath !== 'string' || !relPath.trim()) {
    return { ok: false, error: '路径为空' };
  }
  if (vaultRoot == null || typeof vaultRoot !== 'string' || !String(vaultRoot).trim()) {
    return { ok: false, error: '未打开 vault' };
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
  const realGuard = assertInsideVault(root, abs);
  if (!realGuard.ok) return realGuard;
  return { ok: true, abs, rel: relToRoot.split(path.sep).join('/') };
}

export function isReadableRel(relPath) {
  const top = String(relPath || '').replace(/\\/g, '/').split('/').filter(Boolean)[0];
  return top !== '00-系统' && top !== '90-附件' && top !== '.obsidian';
}

/**
 * Ensure absPath (and its realpath, and every existing ancestor) stays inside vaultRoot.
 * Used by resolveVaultPath and by move Apply.
 */
export function assertInsideVault(vaultRoot, absPath) {
  const root = path.resolve(vaultRoot);
  const abs = path.resolve(absPath);
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return { ok: false, error: '路径超出 vault 根目录' };
  }
  try {
    let realRoot;
    try {
      realRoot = fs.realpathSync(root);
    } catch (err) {
      return { ok: false, error: `vault 根目录不可用：${err.message}` };
    }

    // Walk from abs up to root; realpath every existing node so a symlink
    // anywhere in the chain cannot escape the vault.
    let cursor = abs;
    const seen = new Set();
    while (true) {
      if (seen.has(cursor)) break;
      seen.add(cursor);
      if (fs.existsSync(cursor)) {
        const realAbs = fs.realpathSync(cursor);
        const realRel = path.relative(realRoot, realAbs);
        if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
          return { ok: false, error: '符号链接指向 vault 之外' };
        }
      }
      const parent = path.dirname(cursor);
      if (parent === cursor) break;
      // Stop once we reach (or pass) the vault root lexicographically.
      const relToRoot = path.relative(root, parent);
      if (relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) break;
      if (path.resolve(parent) === root) {
        // Still realpath the root itself (already done); done.
        break;
      }
      cursor = parent;
    }
  } catch (err) {
    return { ok: false, error: `路径校验失败：${err.message}` };
  }
  return { ok: true, abs, rel: rel.split(path.sep).join('/') };
}

export const name = 'kvd-vault';
export const inject = ['kvdPrefs'];

export const Config = z.object({});

export class VaultService extends Service {
  static Config = Config;
  static inject = ['kvdPrefs'];

  /** @param {import('@deepseek-ai/cordis').Context} ctx */
  constructor(ctx, _config = {}) {
    super(ctx, 'vault');
    /** @type {string | null} */
    this._root = null;
  }

  /** @returns {string | null} */
  getRoot() {
    return this._root;
  }

  /**
   * Set the active vault root. Emits `kvd/vault-changed`.
   * @param {string} vaultPath
   * @returns {{ ok: true, vaultPath: string } | { ok: false, error: string }}
   */
  setRoot(vaultPath) {
    if (!vaultPath || typeof vaultPath !== 'string') {
      return { ok: false, error: '无效的 vault 路径' };
    }
    const resolved = path.resolve(vaultPath);
    if (!fs.existsSync(resolved)) {
      return { ok: false, error: '无效的 vault 路径' };
    }
    let st;
    try {
      st = fs.statSync(resolved);
    } catch (err) {
      return { ok: false, error: `无效的 vault 路径：${err.message}` };
    }
    if (!st.isDirectory()) {
      return { ok: false, error: '无效的 vault 路径' };
    }
    const previous = this._root;
    this._root = resolved;
    this.ctx.emit('kvd/vault-changed', { root: this._root, previous });
    return { ok: true, vaultPath: this._root };
  }

  /**
   * Clear the active vault. Emits `kvd/vault-changed`.
   */
  clear() {
    const previous = this._root;
    if (previous === null) return;
    this._root = null;
    this.ctx.emit('kvd/vault-changed', { root: null, previous });
  }

  /**
   * Resolve a vault-relative path against the active root (realpath + guards).
   * @param {string} relPath
   * @returns {{ ok: true, abs: string, rel: string } | { ok: false, error: string }}
   */
  resolve(relPath) {
    if (!this._root) return { ok: false, error: '未打开 vault' };
    return resolveVaultPath(this._root, relPath);
  }

  /**
   * Resolve against an explicit root (engine / proposals that pass vaultRoot).
   * Same guards as resolve(); does not require an active root.
   * @param {string} vaultRoot
   * @param {string} relPath
   */
  resolveAgainst(vaultRoot, relPath) {
    return resolveVaultPath(vaultRoot, relPath);
  }

  /** @param {string} relPath */
  isReadableRel(relPath) {
    return isReadableRel(relPath);
  }

  /**
   * @param {string} absPath
   * @returns {{ ok: true, abs: string, rel: string } | { ok: false, error: string }}
   */
  assertInside(absPath) {
    if (!this._root) return { ok: false, error: '未打开 vault' };
    return assertInsideVault(this._root, absPath);
  }

  /** Forbidden write prefixes (00-系统, .obsidian). */
  get forbiddenPrefixes() {
    return FORBIDDEN_PREFIXES.slice();
  }
}

export default VaultService;
