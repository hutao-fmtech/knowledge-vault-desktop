'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createVault, sanitizeVaultName } = require('../packages/vault/lib/create.js');

// Version / release-tag guard (always: valid semver; with tag env: must match).
(function assertPackageVersion() {
  const pkg = require('../apps/desktop/package.json');
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

const templateRoot = require('../packages/template/lib/index.js').templateRoot;
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

// W1 §4: 公众号 subtree present after create-vault
const oaRequired = [
  '00-系统/公众号/voice.md',
  '01-收件箱/公众号线索',
  '10-卡片盒/公众号/briefs',
  '10-卡片盒/公众号/drafts',
  '10-卡片盒/公众号/review',
  '90-附件/公众号/layout',
  '05-归档/公众号',
  '04-资源/公众号/analytics',
];
for (const rel of oaRequired) {
  assert(fs.existsSync(path.join(res.vaultPath, ...rel.split('/'))), 'missing OA path ' + rel);
}

const clash = createVault({
  parentDir: tmp,
  rawName: 'Smoke_Vault',
  templateRoot,
});
assert(!clash.ok, 'should refuse non-empty conflict');

console.log('SMOKE_OK', res.vaultPath);
console.log('LABELS', res.labels.join(','));
