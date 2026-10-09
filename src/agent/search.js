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
 * Simple keyword search over vault Markdown (excludes 00-系统 / 90-附件).
 */
function searchVault(vaultRoot, query, limit = 8) {
  const q = String(query || '').trim().toLowerCase();
  if (!q || !vaultRoot || !fs.existsSync(vaultRoot)) {
    return { ok: true, hits: [] };
  }
  const files = [];
  walkMd(vaultRoot, vaultRoot, files);
  const terms = q.split(/\s+/).filter(Boolean);
  const hits = [];
  for (const f of files) {
    let text;
    try {
      text = fs.readFileSync(f.abs, 'utf8');
    } catch {
      continue;
    }
    const lower = text.toLowerCase();
    if (!terms.every((t) => lower.includes(t) || f.rel.toLowerCase().includes(t))) continue;
    const idx = lower.indexOf(terms[0]);
    const start = Math.max(0, idx - 80);
    const snippet = text.slice(start, start + 220).replace(/\s+/g, ' ').trim();
    hits.push({ path: f.rel, snippet });
    if (hits.length >= limit) break;
  }
  return { ok: true, hits };
}

function listInboxNotes(vaultRoot) {
  const inbox = path.join(vaultRoot, '01-收件箱');
  const out = [];
  if (!fs.existsSync(inbox)) return out;
  function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile() && /\.md$/i.test(e.name) && e.name !== 'README.md' && !e.name.endsWith('-README.md')) {
        out.push(path.relative(vaultRoot, abs).split(path.sep).join('/'));
      }
    }
  }
  walk(inbox);
  return out.sort();
}

module.exports = { searchVault, listInboxNotes };
