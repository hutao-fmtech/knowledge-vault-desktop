'use strict';

const fs = require('fs');
const path = require('path');
const { isReadableRel } = require('./paths');

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
      if (top === '00-系统' || top === '90-附件') continue;
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

/**
 * Keyword search over vault Markdown (excludes 00-系统 / 90-附件).
 * A file matches when at least one token hits (path or body); ranked by hit count.
 */
function searchVault(vaultRoot, query, limit = 8) {
  const terms = tokenize(query);
  if (!terms.length || !vaultRoot || !fs.existsSync(vaultRoot)) {
    return { ok: true, hits: [] };
  }
  const files = [];
  walkMd(vaultRoot, vaultRoot, files);
  const scored = [];
  for (const f of files) {
    let text;
    try {
      text = fs.readFileSync(f.abs, 'utf8');
    } catch {
      continue;
    }
    const hay = `${f.rel}\n${text}`.toLowerCase();
    let score = 0;
    let firstIdx = -1;
    for (const t of terms) {
      const idx = hay.indexOf(t);
      if (idx >= 0) {
        score += t.length >= 4 ? 3 : 1;
        if (firstIdx < 0) firstIdx = idx;
      }
    }
    if (score === 0) continue;
    const start = Math.max(0, Math.max(0, firstIdx) - 80);
    const snippet = text.slice(start, start + 220).replace(/\s+/g, ' ').trim();
    scored.push({ path: f.rel, snippet, score });
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

module.exports = { searchVault, listInboxNotes, tokenize };
