import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { proposeCreate, applyProposal } from '../src/index.mjs';

test('writes happen only on Apply; protected dirs rejected', () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'kvd-prop-'));
  const p = proposeCreate(vault, '10-卡片盒/a.md', '# a\n', 'add a');
  assert.equal(p.ok, true);
  assert.equal(fs.existsSync(path.join(vault, '10-卡片盒', 'a.md')), false, 'no write before apply');
  const applied = applyProposal(vault, p.proposal);
  assert.equal(applied.ok, true);
  assert.equal(fs.readFileSync(path.join(vault, '10-卡片盒', 'a.md'), 'utf8'), '# a\n');
  assert.equal(proposeCreate(vault, '00-系统/x.md', 'x', 'bad').ok, false);
  assert.equal(proposeCreate(vault, '.obsidian/x.json', 'x', 'bad').ok, false);
  assert.equal(proposeCreate(vault, '10-卡片盒/a.md', 'again', 'overwrite').ok, false, 'never overwrite');
});
