/**
 * kvd-search — keyword search over the active vault (Chinese bigram + Latin tokens).
 * Excludes `00-系统/` and `90-附件/` (and `.obsidian`). File reads go through
 * `vault.resolveAgainst()` so path guards / realpath apply (depends on kvd-vault).
 *
 * Pure helpers (searchVault / makeSnippet / tokenize / listInboxNotes / listWechatOaNotes) are exported
 * from this module; the service is the Cordis-facing API (`ctx.vaultSearch`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { Context, Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { isReadableRel, resolveVaultPath } from '@kvd/vault';
import type { PathResult } from '@kvd/vault';

export interface SearchHit {
  path: string;
  snippet: string;
}
export type SearchResult = { ok: true; hits: SearchHit[] } | { ok: false; error: string };
export type PathResolver = (root: string, rel: string) => PathResult;

declare module '@deepseek-ai/cordis' {
  interface Context {
    vaultSearch: VaultSearchService;
  }
}

// ---- pure search helpers (folded from src/agent/search.js) ----
/** Directories excluded from search (top-level). */
export const SEARCH_EXCLUDED_TOP: readonly string[] = ['00-系统', '90-附件', '.obsidian'];

function walkMd(dir: string, vaultRoot: string, out: { abs: string; rel: string }[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name === '.git' || e.name === '.obsidian') continue;
    const abs = path.join(dir, e.name);
    const rel = path.relative(vaultRoot, abs).split(path.sep).join('/');
    if (e.isDirectory()) {
      const top = rel.split('/')[0] ?? '';
      if (SEARCH_EXCLUDED_TOP.includes(top)) continue;
      walkMd(abs, vaultRoot, out);
    } else if (e.isFile() && /\.md$/i.test(e.name) && isReadableRel(rel)) {
      out.push({ abs, rel });
    }
  }
}

/**
 * Tokenize for mixed Chinese/English queries.
 * Long CJK runs without spaces are broken into overlapping bigrams so
 * "Vault Agent 默认档写盘前要做什么" still matches notes containing "写盘".
 */
export function tokenize(query: unknown): string[] {
  const q = String(query || '').toLowerCase().trim();
  if (!q) return [];
  const tokens = new Set<string>();
  for (const t of q.split(/[\s,，。？?！!、；;：:\n/\\|()\[\]{}]+/).filter(Boolean)) {
    if (t.length >= 2) tokens.add(t);
  }
  for (const m of q.match(/[a-z0-9_-]{2,}/g) || []) tokens.add(m);
  for (const run of q.match(/[\u4e00-\u9fff]+/g) || []) {
    if (run.length <= 4) {
      if (run.length >= 2) tokens.add(run);
      continue;
    }
    for (let i = 0; i < run.length - 1; i++) {
      tokens.add(run.slice(i, i + 2));
    }
  }
  return [...tokens];
}

const SNIPPET_BEFORE = 80;
const SNIPPET_LEN = 220;

/** Replace lone surrogates so the result is always well-formed UTF-16 (JSON-safe). */
export function toWellFormed(str: unknown): string {
  const s = String(str) as string & { toWellFormed?: () => string };
  if (typeof s.toWellFormed === 'function') return s.toWellFormed();
  return s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD');
}

/**
 * Build a snippet around a body match, sliced by code points (never splits a
 * surrogate pair such as an emoji). `idx` is a UTF-16 index into `textLower`
 * (body only); -1 means the match was in the path, so start at the top.
 */
export function makeSnippet(text: string, textLower: string, idx: number): string {
  const cps = Array.from(text);
  let cpIdx = 0;
  if (idx > 0) {
    // Lowercasing can (rarely) change length; map via the lowered prefix, clamp.
    cpIdx = Math.min(cps.length, Array.from(textLower.slice(0, idx)).length);
  }
  const start = Math.max(0, cpIdx - SNIPPET_BEFORE);
  const out = cps.slice(start, start + SNIPPET_LEN).join('');
  return toWellFormed(out.replace(/\s+/g, ' ').trim());
}

/**
 * Keyword search over vault Markdown (excludes 00-系统 / 90-附件 / .obsidian).
 * A file matches when at least one token hits (path or body); ranked by hit count.
 *
 * @param {string} vaultRoot
 * @param {string} query
 * @param {number} [limit=8]
 * @param {{ resolve?: (root: string, rel: string) => { ok: boolean, abs?: string, rel?: string, error?: string } }} [opts]
 *        Optional path resolver (defaults to resolveVaultPath). kvd-search passes vault.resolveAgainst.
 */
export function searchVault(
  vaultRoot: string,
  query: unknown,
  limit = 8,
  opts: { resolve?: PathResolver } = {},
): { ok: true; hits: SearchHit[] } {
  const terms = tokenize(query);
  if (!terms.length || !vaultRoot || !fs.existsSync(vaultRoot)) {
    return { ok: true, hits: [] };
  }
  const resolve: PathResolver =
    typeof opts.resolve === 'function'
      ? opts.resolve
      : (root, rel) => resolveVaultPath(root, rel);

  const files: { abs: string; rel: string }[] = [];
  walkMd(vaultRoot, vaultRoot, files);
  const scored: (SearchHit & { score: number })[] = [];
  for (const f of files) {
    const resolved = resolve(vaultRoot, f.rel);
    if (!resolved || !resolved.ok) continue;
    let text: string;
    try {
      text = fs.readFileSync(resolved.abs, 'utf8');
    } catch {
      continue;
    }
    const relLower = String(resolved.rel || f.rel).toLowerCase();
    const textLower = text.toLowerCase();
    let score = 0;
    let firstIdx = -1; // index into textLower (body only), -1 = path-only hit
    for (const t of terms) {
      const bodyIdx = textLower.indexOf(t);
      if (bodyIdx >= 0 || relLower.includes(t)) {
        score += t.length >= 4 ? 3 : 1;
        if (firstIdx < 0 && bodyIdx >= 0) firstIdx = bodyIdx;
      }
    }
    if (score === 0) continue;
    const snippet = makeSnippet(text, textLower, firstIdx);
    scored.push({ path: resolved.rel || f.rel, snippet, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return { ok: true, hits: scored.slice(0, limit).map(({ path: p, snippet }) => ({ path: p, snippet })) };
}

/** Inbox subdir reserved for WeChat OA intel — not listed in generic inbox. */
const WECHAT_INTEL_DIR = '公众号线索';

/** Briefs + drafts under the OA zettel subtree (sidebar list/open). */
const WECHAT_SIDEBAR_DIRS: readonly string[] = [
  '10-卡片盒/公众号/briefs',
  '10-卡片盒/公众号/drafts',
];

function isMdNote(name: string): boolean {
  return /\.md$/i.test(name) && name !== 'README.md' && !name.endsWith('-README.md');
}

export function listInboxNotes(vaultRoot: string): string[] {
  const inbox = path.join(vaultRoot, '01-收件箱');
  const out: string[] = [];
  if (!fs.existsSync(inbox)) return out;
  function walk(dir: string): void {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        // Keep 公众号线索 out of generic inbox sort/card (W1: do not damage OA tree).
        if (e.name === WECHAT_INTEL_DIR && path.dirname(abs) === inbox) continue;
        walk(abs);
      } else if (e.isFile() && isMdNote(e.name)) {
        out.push(path.relative(vaultRoot, abs).split(path.sep).join('/'));
      }
    }
  }
  walk(inbox);
  return out.sort();
}

/**
 * List markdown notes under 公众号 briefs/ and drafts/ (excludes README).
 */
export function listWechatOaNotes(vaultRoot: string): string[] {
  const out: string[] = [];
  for (const relDir of WECHAT_SIDEBAR_DIRS) {
    const dir = path.join(vaultRoot, ...relDir.split('/'));
    if (!fs.existsSync(dir)) continue;
    function walk(d: string): void {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const abs = path.join(d, e.name);
        if (e.isDirectory()) walk(abs);
        else if (e.isFile() && isMdNote(e.name)) {
          out.push(path.relative(vaultRoot, abs).split(path.sep).join('/'));
        }
      }
    }
    walk(dir);
  }
  return out.sort();
}

export const name = 'kvd-search';
export const inject = ['vault'];

export const Config = z.object({});

export class VaultSearchService extends Service {
  static Config = Config;
  static inject = ['vault'];

  constructor(ctx: Context, _config: unknown = {}) {
    super(ctx, 'vaultSearch');
  }

  /**
   * Keyword search against the active vault.
   * @param {string} query
   * @param {number} [limit=8]
   * @returns {{ ok: true, hits: { path: string, snippet: string }[] } | { ok: false, error: string }}
   */
  search(query: string, limit = 8): SearchResult {
    const root = this.ctx.vault.getRoot();
    if (!root) return { ok: false, error: '未打开 vault' };
    return searchVault(root, query, limit, {
      resolve: (vaultRoot, rel) => this.ctx.vault.resolveAgainst(vaultRoot, rel),
    });
  }

  /**
   * List inbox note relative paths (excludes README).
   * @returns {{ ok: true, notes: string[] } | { ok: false, error: string }}
   */
  listInbox(): { ok: true; notes: string[] } | { ok: false; error: string } {
    const root = this.ctx.vault.getRoot();
    if (!root) return { ok: false, error: '未打开 vault' };
    return { ok: true, notes: listInboxNotes(root) };
  }

  /**
   * List 公众号 briefs/drafts note paths for the Agent sidebar.
   */
  listWechatOa(): { ok: true; notes: string[] } | { ok: false; error: string } {
    const root = this.ctx.vault.getRoot();
    if (!root) return { ok: false, error: '未打开 vault' };
    return { ok: true, notes: listWechatOaNotes(root) };
  }

  /**
   * Read a vault-relative note for sidebar open (respects readable-path policy).
   */
  readNote(relPath: string): { ok: true; path: string; content: string } | { ok: false; error: string } {
    const root = this.ctx.vault.getRoot();
    if (!root) return { ok: false, error: '未打开 vault' };
    const resolved = this.ctx.vault.resolveAgainst(root, relPath);
    if (!resolved.ok) return resolved;
    if (!isReadableRel(resolved.rel)) {
      return { ok: false, error: `不可读取：${resolved.rel}` };
    }
    if (!fs.existsSync(resolved.abs) || !fs.statSync(resolved.abs).isFile()) {
      return { ok: false, error: `笔记不存在：${resolved.rel}` };
    }
    try {
      const content = fs.readFileSync(resolved.abs, 'utf8');
      return { ok: true, path: resolved.rel, content };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  /** Expose tokenizer for smoke / debugging. */
  tokenize(query: string): string[] {
    return tokenize(query);
  }
}

export default VaultSearchService;
