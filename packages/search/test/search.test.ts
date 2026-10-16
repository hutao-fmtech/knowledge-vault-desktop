import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  searchVault,
  tokenize,
  SEARCH_EXCLUDED_TOP,
  toWellFormed,
  listWechatOaNotes,
  listInboxNotes,
} from '../src/index.js';

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

test('listWechatOaNotes lists briefs/drafts; listInboxNotes skips 公众号线索', () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'kvd-search-oa-'));
  const briefDir = path.join(vault, '10-卡片盒', '公众号', 'briefs');
  const draftDir = path.join(vault, '10-卡片盒', '公众号', 'drafts');
  const intelDir = path.join(vault, '01-收件箱', '公众号线索');
  const pending = path.join(vault, '01-收件箱', '待处理');
  fs.mkdirSync(briefDir, { recursive: true });
  fs.mkdirSync(draftDir, { recursive: true });
  fs.mkdirSync(intelDir, { recursive: true });
  fs.mkdirSync(pending, { recursive: true });
  fs.writeFileSync(path.join(briefDir, 'b.md'), '# b\n');
  fs.writeFileSync(path.join(draftDir, 'd.md'), '# d\n');
  fs.writeFileSync(path.join(briefDir, 'README.md'), '# ignore\n');
  fs.writeFileSync(path.join(intelDir, 'intel.md'), '# i\n');
  fs.writeFileSync(path.join(pending, 'p.md'), '# p\n');
  const oa = listWechatOaNotes(vault);
  assert.deepEqual(oa, ['10-卡片盒/公众号/briefs/b.md', '10-卡片盒/公众号/drafts/d.md']);
  const inbox = listInboxNotes(vault);
  assert.deepEqual(inbox, ['01-收件箱/待处理/p.md']);
});
