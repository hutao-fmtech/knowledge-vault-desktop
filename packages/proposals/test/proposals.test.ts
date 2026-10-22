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
  sha256Hex,
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

// ---- Apply stale-guard: target must still match what the proposal was generated from ----
function staleVault(): { vault: string; abs: string } {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'kvd-prop-stale-'));
  fs.mkdirSync(path.join(vault, '10-卡片盒'), { recursive: true });
  const abs = path.join(vault, '10-卡片盒', 'n.md');
  fs.writeFileSync(abs, 'v1\n', 'utf8');
  return { vault, abs };
}

test('stale-guard: edit proposal records sha256 and applies when file is unchanged', () => {
  const { vault, abs } = staleVault();
  const p = proposeEdit(vault, '10-卡片盒/n.md', 'v2\n');
  assert.equal(p.ok, true);
  if (!p.ok) return;
  assert.equal(p.proposal.beforeSha256, sha256Hex(Buffer.from('v1\n', 'utf8')));
  assert.equal(applyProposal(vault, p.proposal).ok, true);
  assert.equal(fs.readFileSync(abs, 'utf8'), 'v2\n');
});

test('stale-guard: edit rejected when file was modified after propose; disk untouched', () => {
  const { vault, abs } = staleVault();
  const p = proposeEdit(vault, '10-卡片盒/n.md', 'v2\n');
  assert.equal(p.ok, true);
  fs.writeFileSync(abs, 'v1 + user change\n', 'utf8');
  const res = applyProposal(vault, p.ok ? p.proposal : null);
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.code, 'STALE');
    assert.match(res.error, /^文件已被改动，请重新生成建议（文件已被修改/);
  }
  assert.equal(fs.readFileSync(abs, 'utf8'), 'v1 + user change\n');
});

test('stale-guard: edit rejected when file was deleted after propose; nothing recreated', () => {
  const { vault, abs } = staleVault();
  const p = proposeEdit(vault, '10-卡片盒/n.md', 'v2\n');
  assert.equal(p.ok, true);
  fs.unlinkSync(abs);
  const res = applyProposal(vault, p.ok ? p.proposal : null);
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.code, 'STALE');
    assert.match(res.error, /^文件已被改动，请重新生成建议（文件已不存在/);
  }
  assert.equal(fs.existsSync(abs), false);
});

test('stale-guard: create rejected when target appeared after propose; existing file kept', () => {
  const { vault } = staleVault();
  const target = path.join(vault, '10-卡片盒', 'new.md');
  const p = proposeCreate(vault, '10-卡片盒/new.md', 'agent\n');
  assert.equal(p.ok, true);
  fs.writeFileSync(target, 'user wrote this first\n', 'utf8');
  const res = applyProposal(vault, p.ok ? p.proposal : null);
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.code, 'STALE');
    assert.match(res.error, /^文件已被改动，请重新生成建议（目标已存在/);
  }
  assert.equal(fs.readFileSync(target, 'utf8'), 'user wrote this first\n');
});

test('stale-guard: edit without any recorded baseline fails closed', () => {
  const { vault, abs } = staleVault();
  const res = applyProposal(vault, { id: 'x', kind: 'edit', path: '10-卡片盒/n.md', content: 'v2\n', summary: 's' });
  assert.equal(res.ok, false);
  assert.equal(fs.readFileSync(abs, 'utf8'), 'v1\n');
});
