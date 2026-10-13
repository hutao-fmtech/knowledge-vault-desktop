import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { templateRoot } from '../src/index.js';

test('template root contains the PARA skeleton and .obsidian config', () => {
  for (const d of ['00-系统', '01-收件箱', '10-卡片盒', '.obsidian']) {
    assert.ok(fs.existsSync(path.join(templateRoot, d)), d);
  }
});
