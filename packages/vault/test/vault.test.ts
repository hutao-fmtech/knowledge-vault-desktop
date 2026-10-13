import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveVaultPath, isReadableRel, FORBIDDEN_PREFIXES } from '../src/index.js';

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

test('never touches .obsidian/ or 00-系统/', () => {
  assert.deepEqual(FORBIDDEN_PREFIXES, ['00-系统', '.obsidian']);
  assert.equal(isReadableRel('.obsidian/x'), false);
  assert.equal(isReadableRel('00-系统/x'), false);
  assert.equal(isReadableRel('03-领域/x.md'), true);
});

test('sanitizeVaultName strips path separators', () => {
  const r = sanitizeVaultName('a/b');
  const name = r.ok ? r.name : '';
  assert.ok(!String(name).includes('/'));
});
