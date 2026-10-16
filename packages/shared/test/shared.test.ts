import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WECHAT_OA, WECHAT_OA_REQUIRED_RELS, isWechatOaPipelineRel } from '../src/wechat-oa.js';

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

test('wechat OA paths are vault-relative and cover §2 roles', () => {
  assert.ok(WECHAT_OA.briefs.startsWith('10-卡片盒/公众号/'));
  assert.ok(WECHAT_OA.drafts.startsWith('10-卡片盒/公众号/'));
  assert.equal(WECHAT_OA.analytics, '04-资源/公众号/analytics');
  assert.ok(WECHAT_OA_REQUIRED_RELS.includes(WECHAT_OA.voice));
  assert.equal(isWechatOaPipelineRel('10-卡片盒/公众号/briefs/x.md'), true);
  assert.equal(isWechatOaPipelineRel('01-收件箱/待处理/x.md'), false);
  assert.ok(!JSON.stringify(WECHAT_OA).includes('content-team'));
});
