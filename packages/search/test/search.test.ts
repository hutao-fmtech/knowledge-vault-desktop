import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { searchVault, tokenize, SEARCH_EXCLUDED_TOP, toWellFormed } from '../src/index.js';

test('search excludes system / attachments / .obsidian and finds notes', () => {
  assert.deepEqual(SEARCH_EXCLUDED_TOP, ['00-系统', '90-附件', '.obsidian']);
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'kvd-search-'));
  fs.mkdirSync(path.join(vault, '03-领域'), { recursive: true });
  fs.mkdirSync(path.join(vault, '00-系统'), { recursive: true });
  fs.writeFileSync(path.join(vault, '03-领域', 'n.md'), '# 标题\nzettelqwerty here\n');
  fs.writeFileSync(path.join(vault, '00-系统', 's.md'), 'zettelqwerty secret\n');
  const r = searchVault(vault, 'zettelqwerty');
  const hits = r.hits || r;
  assert.equal(hits.length, 1);
  assert.ok(hits[0]?.path.startsWith('03-领域/'));
});

test('tokenize + toWellFormed', () => {
  assert.ok(tokenize('hello world').length >= 1);
  assert.equal(toWellFormed('a\uD83D'), 'a\uFFFD');
});
