/**
 * kvd-vault — current vault root + path resolution (with realpath).
 * All read/write path resolution goes through vault.resolve() / resolveAgainst().
 * Emits `kvd/vault-changed` when the vault is set or cleared (G4 listener hook).
 *
 * Pure path helpers live in src/agent/paths.js so CJS callers (proposals, engine)
 * stay in sync; this service is the Cordis-facing ownership of the active root.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';

const require = createRequire(import.meta.url);
const {
  resolveVaultPath,
  isReadableRel,
  assertInsideVault,
  FORBIDDEN_PREFIXES,
} = require('../../agent/paths.js');

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
