import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  proposeCreate,
  proposeEdit,
  applyProposal,
  lineDiff,
  formatProposalReview,
} from '../src/index.js';

test('writes happen only on Apply; protected dirs rejected', () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'kvd-prop-'));
  const p = proposeCreate(vault, '10-卡片盒/a.md', '# a\n', 'add a');
  assert.equal(p.ok, true);
  assert.equal(fs.existsSync(path.join(vault, '10-卡片盒', 'a.md')), false, 'no write before apply');
  const applied = applyProposal(vault, p.proposal);
  assert.equal(applied.ok, true);
  assert.equal(fs.readFileSync(path.join(vault, '10-卡片盒', 'a.md'), 'utf8'), '# a\n');
  assert.equal(proposeCreate(vault, '00-系统/x.md', 'x', 'bad').ok, false);
  assert.equal(proposeCreate(vault, '90-附件/公众号/layout/x.html', 'x', 'bad').ok, false);
  assert.equal(proposeCreate(vault, '.obsidian/x.json', 'x', 'bad').ok, false);
  assert.equal(proposeCreate(vault, '10-卡片盒/a.md', 'again', 'overwrite').ok, false, 'never overwrite');
});

test('lineDiff marks inserts and deletes for edit review', () => {
  const lines = lineDiff('alpha\nbeta\ngamma\n', 'alpha\nBETA\ngamma\n');
  assert.deepEqual(
    lines.map((l) => `${l.op}:${l.text}`),
    ['equal:alpha', 'delete:beta', 'insert:BETA', 'equal:gamma'],
  );
});

test('formatProposalReview: edit shows path + unified diff; create/move stay reviewable', () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'kvd-prop-diff-'));
  fs.mkdirSync(path.join(vault, '10-卡片盒'), { recursive: true });
  fs.writeFileSync(path.join(vault, '10-卡片盒', 'note.md'), 'line1\nold\nline3\n', 'utf8');
  const edit = proposeEdit(vault, '10-卡片盒/note.md', 'line1\nnew\nline3\n', 'tweak');
  assert.equal(edit.ok, true);
  const review = formatProposalReview(edit.proposal);
  assert.match(review, /^编辑 10-卡片盒\/note\.md/);
  assert.match(review, /^-old$/m);
  assert.match(review, /^\+new$/m);
  assert.match(review, /^ line1$/m);

  const create = proposeCreate(vault, '10-卡片盒/b.md', '# hello\n', 'add b');
  assert.equal(create.ok, true);
  const createReview = formatProposalReview(create.proposal);
  assert.match(createReview, /^创建 10-卡片盒\/b\.md/);
  assert.match(createReview, /# hello/);

  const moveReview = formatProposalReview({
    kind: 'move',
    from: '01-收件箱/a.md',
    to: '10-卡片盒/a.md',
  });
  assert.equal(moveReview, '移动 01-收件箱/a.md → 10-卡片盒/a.md');
});
