'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { templateRoot } = require('../src/index.js');

test('template root contains the PARA skeleton and .obsidian config', () => {
  for (const d of ['00-系统', '01-收件箱', '10-卡片盒', '.obsidian']) {
    assert.ok(fs.existsSync(path.join(templateRoot, d)), d);
  }
});
