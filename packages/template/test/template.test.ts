import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { templateRoot } from '../src/index.js';

/** W1 §4 / scope §2 adapted to this vault's PARA numbers. */
const WECHAT_OA_REQUIRED = [
  '00-系统/公众号/voice.md',
  '01-收件箱/公众号线索',
  '10-卡片盒/公众号/briefs',
  '10-卡片盒/公众号/drafts',
  '10-卡片盒/公众号/review',
  '90-附件/公众号/layout',
  '05-归档/公众号',
  '04-资源/公众号/analytics',
] as const;

test('template root contains the PARA skeleton and .obsidian config', () => {
  for (const d of ['00-系统', '01-收件箱', '10-卡片盒', '.obsidian']) {
    assert.ok(fs.existsSync(path.join(templateRoot, d)), d);
  }
});

test('W1 WeChat OA subtree is present (scope §2 adapted to PARA)', () => {
  for (const rel of WECHAT_OA_REQUIRED) {
    assert.ok(fs.existsSync(path.join(templateRoot, rel)), rel);
  }
  const voice = fs.readFileSync(path.join(templateRoot, '00-系统/公众号/voice.md'), 'utf8');
  assert.ok(/账号定位/.test(voice));
  assert.ok(!voice.includes('/workspace/content-team'));
});
