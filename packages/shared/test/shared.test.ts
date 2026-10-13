import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('models: default model is a listed deepseek-official model', async () => {
  const m = await import('../src/models.js');
  assert.equal(m.LIVE_PROVIDER, 'deepseek-official');
  assert.ok(m.APP_MODELS.includes(m.DEFAULT_MODEL));
  assert.equal(m.DEFAULT_MODEL, 'deepseek-flash');
  assert.ok(Object.isFrozen(m.APP_MODELS));
});

test('configDir: lives under HOME (outside any vault) and is created', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kvd-shared-'));
  const prev = { HOME: process.env.HOME, APPDATA: process.env.APPDATA };
  process.env.HOME = home;
  process.env.APPDATA = path.join(home, 'AppData');
  try {
    const { configDir } = await import('../src/config-dir.js');
    const dir = configDir();
    assert.ok(fs.existsSync(dir));
    assert.ok(/knowledge-vault|KnowledgeVault/.test(dir));
  } finally {
    Object.assign(process.env, prev);
  }
});
