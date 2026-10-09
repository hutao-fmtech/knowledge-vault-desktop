'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createVault, sanitizeVaultName } = require('../src/vault');

const templateRoot = path.join(__dirname, '..', 'resources', 'template');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kvd-smoke-'));

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const bad = sanitizeVaultName('你好 world!!!');
assert(sanitizeVaultName('你好 world!!!').ok && sanitizeVaultName('你好 world!!!').name === '_world', 'sanitize strips non-ascii');

const s = sanitizeVaultName('My Notes');
assert(s.ok && s.name === 'My_Notes', 'space → _');

const res = createVault({
  parentDir: tmp,
  rawName: 'Smoke_Vault',
  templateRoot,
});
assert(res.ok, res.error || 'create failed');
assert(fs.existsSync(path.join(res.vaultPath, '00-系统')), 'missing 00-系统');
assert(fs.existsSync(path.join(res.vaultPath, '.obsidian')), 'missing .obsidian');

const clash = createVault({
  parentDir: tmp,
  rawName: 'Smoke_Vault',
  templateRoot,
});
assert(!clash.ok, 'should refuse non-empty conflict');

console.log('SMOKE_OK', res.vaultPath);
console.log('LABELS', res.labels.join(','));
