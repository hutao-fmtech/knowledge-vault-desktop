import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  resolveVaultPath,
  isReadableRel,
  FORBIDDEN_PREFIXES,
  resolveLayoutWritePath,
  writeWechatLayoutHtml,
  WECHAT_LAYOUT_PREFIX,
} from '../src/index.js';

import { sanitizeVaultName } from '../src/sanitize.js';

const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'kvd-vault-'));

test('resolveVaultPath keeps paths inside the vault', () => {
  const ok = resolveVaultPath(vault, '01-收件箱/a.md');
  assert.equal(ok.ok, true);
  assert.equal(ok.rel, '01-收件箱/a.md');
  for (const bad of ['../x.md', '/etc/passwd', '.obsidian/app.json', '00-系统/HOME.md', '']) {
    assert.equal(resolveVaultPath(vault, bad).ok, false, bad);
  }
});

test('never touches .obsidian/ or 00-系统/ or 90-附件/', () => {
  assert.deepEqual(FORBIDDEN_PREFIXES, ['00-系统', '90-附件', '.obsidian']);
  assert.equal(isReadableRel('.obsidian/x'), false);
  assert.equal(isReadableRel('00-系统/x'), false);
  assert.equal(isReadableRel('90-附件/x'), false);
  assert.equal(isReadableRel('03-领域/x.md'), true);
  assert.equal(resolveVaultPath(vault, '90-附件/公众号/layout/x.html').ok, false);
});

test('sanitizeVaultName strips path separators', () => {
  const r = sanitizeVaultName('a/b');
  const name = r.ok ? r.name : '';
  assert.ok(!String(name).includes('/'));
});

test('resolveLayoutWritePath allows only 90-附件/公众号/layout/', () => {
  assert.equal(WECHAT_LAYOUT_PREFIX, '90-附件/公众号/layout');
  const ok = resolveLayoutWritePath(vault, '90-附件/公众号/layout/demo/index.html');
  assert.equal(ok.ok, true);
  assert.equal(resolveLayoutWritePath(vault, '90-附件/other/x.html').ok, false);
  assert.equal(resolveLayoutWritePath(vault, '10-卡片盒/公众号/drafts/x.md').ok, false);
  assert.equal(resolveVaultPath(vault, '90-附件/公众号/layout/x.html').ok, false, 'propose path still forbidden');
});

test('writeWechatLayoutHtml writes under layout prefix', () => {
  const rel = '90-附件/公众号/layout/unit-test/index.html';
  const w = writeWechatLayoutHtml(vault, rel, '<html>ok</html>');
  assert.equal(w.ok, true);
  if (w.ok) {
    assert.equal(w.path, rel);
    assert.equal(fs.readFileSync(w.abs, 'utf8'), '<html>ok</html>');
  }
});
