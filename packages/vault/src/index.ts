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
import { Context, Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';

// ---- pure path helpers (folded from src/agent/paths.js) ----
/**
 * Top-level path segments that must never be written (or resolved for write).
 * `.vault` holds app-owned data (agent-log): agents may neither write nor read it.
 */
export const FORBIDDEN_PREFIXES: readonly string[] = ['00-系统', '90-附件', '.obsidian', '.vault', '.git', '.trash'];

/**
 * The forbidden top-level segment a vault-relative path falls under, or null.
 * Matching ignores case (`.GIT/`, `.Trash/` on case-insensitive disks), `\\`
 * separators, empty / `.` segments (`./.git/x`, `//.git`), inner `..` (`notes/../.git/x`)
 * and the trailing dots / spaces Windows strips (`.git./x`). resolveVaultPath also
 * refuses any `..` segment outright.
 */
export function forbiddenTop(relPath: unknown): string | null {
  // Collapse `a/../.git/x` to `.git/x` first so traversal cannot hide the top segment.
  const norm0 = path.posix.normalize(String(relPath ?? '').replace(/\\/g, '/')).replace(/^\/+/, '');
  const top = norm0.split('/').filter((s) => s && s !== '.')[0];
  if (top === undefined || top === '..') return null;
  const norm = top.replace(/[. ]+$/, '').toLowerCase();
  return FORBIDDEN_PREFIXES.find((f) => f.toLowerCase() === norm) ?? null;
}

export type PathResult = { ok: true; abs: string; rel: string } | { ok: false; error: string };

/**
 * Resolve a vault-relative path and ensure it stays inside the vault.
 * Rejects absolute paths, `..`, symlinks that escape, and every FORBIDDEN_PREFIXES top
 * segment (`00-系统/`, `90-附件/`, `.obsidian/`, `.vault/`, `.git/`, `.trash/`; case-insensitive).
 * Always runs realpath on the vault root and on every existing path component.
 * @returns {{ ok: true, abs: string, rel: string } | { ok: false, error: string }}
 */
export function resolveVaultPath(vaultRoot: unknown, relPath: unknown): PathResult {
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
  const top = forbiddenTop(raw);
  if (top !== null) {
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

export function isReadableRel(relPath: unknown): boolean {
  if (String(relPath ?? '').replace(/\\/g, '/').split('/').some((seg) => seg === '..')) return false;
  return forbiddenTop(relPath) === null;
}

/**
 * Ensure absPath (and its realpath, and every existing ancestor) stays inside vaultRoot.
 * Used by resolveVaultPath and by move Apply.
 */
export function assertInsideVault(vaultRoot: string, absPath: string): PathResult {
  const root = path.resolve(vaultRoot);
  const abs = path.resolve(absPath);
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return { ok: false, error: '路径超出 vault 根目录' };
  }
  try {
    let realRoot: string;
    try {
      realRoot = fs.realpathSync(root);
    } catch (err) {
      return { ok: false, error: `vault 根目录不可用：${(err as Error).message}` };
    }

    // Walk from abs up to root; realpath every existing node so a symlink
    // anywhere in the chain cannot escape the vault.
    let cursor = abs;
    const seen = new Set<string>();
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
    return { ok: false, error: `路径校验失败：${(err as Error).message}` };
  }
  return { ok: true, abs, rel: rel.split(path.sep).join('/') };
}

export const name = 'kvd-vault';
export const inject = ['kvdPrefs'];

export const Config = z.object({});

export interface VaultChangedEvent {
  root: string | null;
  previous: string | null;
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    vault: VaultService;
  }
  interface Events {
    'kvd/vault-changed'(event: VaultChangedEvent): void;
  }
}

export class VaultService extends Service {
  static Config = Config;
  static inject = ['kvdPrefs'];

  private _root: string | null = null;

  constructor(ctx: Context, _config: unknown = {}) {
    super(ctx, 'vault');
  }

  getRoot(): string | null {
    return this._root;
  }

  /**
   * Set the active vault root. Emits `kvd/vault-changed`.
   * @param {string} vaultPath
   * @returns {{ ok: true, vaultPath: string } | { ok: false, error: string }}
   */
  setRoot(vaultPath: unknown): { ok: true; vaultPath: string } | { ok: false; error: string } {
    if (!vaultPath || typeof vaultPath !== 'string') {
      return { ok: false, error: '无效的 vault 路径' };
    }
    const resolved = path.resolve(vaultPath);
    if (!fs.existsSync(resolved)) {
      return { ok: false, error: '无效的 vault 路径' };
    }
    let st: fs.Stats;
    try {
      st = fs.statSync(resolved);
    } catch (err) {
      return { ok: false, error: `无效的 vault 路径：${(err as Error).message}` };
    }
    if (!st.isDirectory()) {
      return { ok: false, error: '无效的 vault 路径' };
    }
    const previous = this._root;
    this._root = resolved;
    this.ctx.emit('kvd/vault-changed', { root: resolved, previous });
    return { ok: true, vaultPath: resolved };
  }

  /**
   * Clear the active vault. Emits `kvd/vault-changed`.
   */
  clear(): void {
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
  resolve(relPath: string): PathResult {
    if (!this._root) return { ok: false, error: '未打开 vault' };
    return resolveVaultPath(this._root, relPath);
  }

  /**
   * Resolve against an explicit root (engine / proposals that pass vaultRoot).
   * Same guards as resolve(); does not require an active root.
   * @param {string} vaultRoot
   * @param {string} relPath
   */
  resolveAgainst(vaultRoot: string, relPath: string): PathResult {
    return resolveVaultPath(vaultRoot, relPath);
  }

  /** @param {string} relPath */
  isReadableRel(relPath: string): boolean {
    return isReadableRel(relPath);
  }

  /**
   * @param {string} absPath
   * @returns {{ ok: true, abs: string, rel: string } | { ok: false, error: string }}
   */
  assertInside(absPath: string): PathResult {
    if (!this._root) return { ok: false, error: '未打开 vault' };
    return assertInsideVault(this._root, absPath);
  }

  /** Forbidden write prefixes (00-系统, 90-附件, .obsidian). */
  get forbiddenPrefixes(): string[] {
    return FORBIDDEN_PREFIXES.slice();
  }
}

export default VaultService;

// ---- WeChat OA layout write (desktop local tool; not for model propose) ----
/** Must stay in sync with `@kvd/shared/wechat-oa` WECHAT_OA.layout. */
export const WECHAT_LAYOUT_PREFIX = '90-附件/公众号/layout';

/**
 * Resolve a path for writing WeChat layout HTML under `90-附件/公众号/layout/` only.
 * Unlike resolveVaultPath, this allows that attachment subtree (desktop local tool).
 * Still rejects absolute paths, `..`, and anything outside the layout prefix.
 */
export function resolveLayoutWritePath(vaultRoot: unknown, relPath: unknown): PathResult {
  if (relPath == null || typeof relPath !== 'string' || !relPath.trim()) {
    return { ok: false, error: '路径为空' };
  }
  if (vaultRoot == null || typeof vaultRoot !== 'string' || !String(vaultRoot).trim()) {
    return { ok: false, error: '未打开 vault' };
  }
  const raw = relPath.replace(/\\/g, '/').trim().replace(/^\/+/, '');
  if (path.isAbsolute(raw) || /^[A-Za-z]:/.test(raw)) {
    return { ok: false, error: '禁止绝对路径' };
  }
  if (raw.split('/').some((p) => p === '..')) {
    return { ok: false, error: '禁止 .. 穿越' };
  }
  if (raw !== WECHAT_LAYOUT_PREFIX && !raw.startsWith(WECHAT_LAYOUT_PREFIX + '/')) {
    return { ok: false, error: `布局写入仅允许 ${WECHAT_LAYOUT_PREFIX}/` };
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

export type LayoutWriteResult =
  | { ok: true; path: string; abs: string }
  | { ok: false; error: string };

/**
 * Desktop local tool: write layout HTML into `90-附件/公众号/layout/…`.
 * Does not go through proposals; models must not call this via proposeCreate.
 */
export function writeWechatLayoutHtml(
  vaultRoot: string,
  relPath: unknown,
  html: unknown,
): LayoutWriteResult {
  const resolved = resolveLayoutWritePath(vaultRoot, relPath);
  if (!resolved.ok) return resolved;
  const body = html == null ? '' : String(html);
  try {
    const dir = path.dirname(resolved.abs);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `.${path.basename(resolved.abs)}.${process.pid}.tmp`);
    fs.writeFileSync(tmp, body, 'utf8');
    fs.renameSync(tmp, resolved.abs);
    return { ok: true, path: resolved.rel, abs: resolved.abs };
  } catch (err) {
    return { ok: false, error: `布局写入失败：${(err as Error).message}` };
  }
}

export type LayoutReadResult =
  | { ok: true; path: string; abs: string; html: string }
  | { ok: false; error: string };

/**
 * Desktop local tool: read layout HTML under `90-附件/公众号/layout/…`.
 * Uses the same path guard as writeWechatLayoutHtml (not resolveVaultPath).
 */
export function readWechatLayoutHtml(vaultRoot: string, relPath: unknown): LayoutReadResult {
  const resolved = resolveLayoutWritePath(vaultRoot, relPath);
  if (!resolved.ok) return resolved;
  try {
    if (!fs.existsSync(resolved.abs)) {
      return { ok: false, error: `布局文件不存在：${resolved.rel}` };
    }
    const html = fs.readFileSync(resolved.abs, 'utf8');
    return { ok: true, path: resolved.rel, abs: resolved.abs, html };
  } catch (err) {
    return { ok: false, error: `布局读取失败：${(err as Error).message}` };
  }
}
