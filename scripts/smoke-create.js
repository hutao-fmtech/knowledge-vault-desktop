'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createVault, sanitizeVaultName } = require('../src/vault');

// Version / release-tag guard (always: valid semver; with tag env: must match).
(function assertPackageVersion() {
  const pkg = require('../package.json');
  const version = pkg.version;
  const semverRe = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
  if (!semverRe.test(version)) {
    throw new Error(`package.json version is not valid semver: ${JSON.stringify(version)}`);
  }
  let tag = process.env.RELEASE_TAG || '';
  if (!tag && process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME) {
    tag = process.env.GITHUB_REF_NAME;
  }
  if (tag) {
    const tagVersion = tag.startsWith('v') ? tag.slice(1) : tag;
    if (tagVersion !== version) {
      throw new Error(`release tag ${JSON.stringify(tag)} does not match package.json version ${JSON.stringify(version)}`);
    }
  }
})();

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
