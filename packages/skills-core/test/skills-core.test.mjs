import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/index.mjs';

test('PARA heuristics', () => {
  assert.equal(core.pickParaDest('项目 deadline'), '02-项目/个人项目');
  assert.equal(core.pickParaDest('已完成 归档'), '05-归档');
  assert.equal(core.pickParaDest('随便'), '03-领域');
  assert.equal(core.cardType('方法 步骤'), '方法卡片');
  assert.equal(core.slugify('  a b  '), 'a-b');
});

test('prompt detection + canned answers', () => {
  assert.ok(core.isAskPrompt(core.SYSTEM, ''));
  assert.ok(core.isSortPrompt('PARA'));
  assert.match(core.mockAskAnswer('问题：x\n\n笔记片段：\n(无命中片段)'), /没有找到/);
  assert.match(core.mockAskAnswer('### 03-领域/n.md\n内容一行'), /03-领域\/n\.md/);
  assert.equal(core.mockSortAnswer('项目', core.pickParaDest), '02-项目\n基于关键词启发式');
  assert.equal(core.extractMessagesText([{ content: 'a' }, { content: [{ type: 'text', text: 'b' }] }]), 'a\nb');
});
