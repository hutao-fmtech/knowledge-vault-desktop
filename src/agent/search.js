'use strict';

const fs = require('fs');
const path = require('path');
const { isReadableRel, resolveVaultPath } = require('./paths');

/** Directories excluded from search (top-level). */
const SEARCH_EXCLUDED_TOP = ['00-系统', '90-附件', '.obsidian'];

function walkMd(dir, vaultRoot, out) {
  let entries;
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
      const top = rel.split('/')[0];
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
function tokenize(query) {
  const q = String(query || '').toLowerCase().trim();
  if (!q) return [];
  const tokens = new Set();
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
function toWellFormed(str) {
  const s = String(str);
  if (typeof s.toWellFormed === 'function') return s.toWellFormed();
  return s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD');
}

/**
 * Build a snippet around a body match, sliced by code points (never splits a
 * surrogate pair such as an emoji). `idx` is a UTF-16 index into `textLower`
 * (body only); -1 means the match was in the path, so start at the top.
 */
function makeSnippet(text, textLower, idx) {
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
function searchVault(vaultRoot, query, limit = 8, opts = {}) {
  const terms = tokenize(query);
  if (!terms.length || !vaultRoot || !fs.existsSync(vaultRoot)) {
    return { ok: true, hits: [] };
  }
  const resolve =
    typeof opts.resolve === 'function'
      ? opts.resolve
      : (root, rel) => resolveVaultPath(root, rel);

  const files = [];
  walkMd(vaultRoot, vaultRoot, files);
  const scored = [];
  for (const f of files) {
    const resolved = resolve(vaultRoot, f.rel);
    if (!resolved || !resolved.ok) continue;
    let text;
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

function listInboxNotes(vaultRoot) {
  const inbox = path.join(vaultRoot, '01-收件箱');
  const out = [];
  if (!fs.existsSync(inbox)) return out;
  function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (
        e.isFile() &&
        /\.md$/i.test(e.name) &&
        e.name !== 'README.md' &&
        !e.name.endsWith('-README.md')
      ) {
        out.push(path.relative(vaultRoot, abs).split(path.sep).join('/'));
      }
    }
  }
  walk(inbox);
  return out.sort();
}

module.exports = { searchVault, listInboxNotes, tokenize, makeSnippet, toWellFormed, SEARCH_EXCLUDED_TOP };
