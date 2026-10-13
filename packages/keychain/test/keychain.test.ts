import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kvd-keychain-'));
process.env.HOME = home;
process.env.APPDATA = path.join(home, 'AppData');
delete process.env.DEEPSEEK_API_KEY;
const kc = await import('../src/index.js');

test('key round-trips through the key file and never enters process.env', () => {
  const fake = 'sk-test-' + 'x'.repeat(8);
  assert.equal(kc.hasApiKey(null), false);
  assert.equal(kc.saveApiKey(fake, null).ok, true);
  assert.ok(kc.keyFile().startsWith(home));
  assert.equal(kc.loadApiKey(null).key, fake);
  assert.equal(process.env.DEEPSEEK_API_KEY, undefined);
  kc.clearApiKey();
  assert.equal(kc.hasApiKey(null), false);
});

test('safeStorage mode stores ciphertext only', () => {
  const ss = {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from([...s].reverse().join('')),
    decryptString: (b: Buffer) => [...b.toString()].reverse().join(''),
  };
  const fake = 'sk-enc-' + 'y'.repeat(8);
  const saved = kc.saveApiKey(fake, ss);
  assert.equal(saved.ok && saved.mode, 'safeStorage');
  assert.ok(!fs.readFileSync(kc.keyFile(), 'utf8').includes(fake));
  assert.equal(kc.loadApiKey(ss).key, fake);
  kc.clearApiKey();
});
