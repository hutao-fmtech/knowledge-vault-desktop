import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as core from '../src/index.js';

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

test('wechat mock draft has no pending marker and layout html has copy button', () => {
  const draft = core.mockDraftFromBrief('# Brief 主题\n\n写一篇关于 Agent 流水线的短文。\n');
  assert.equal(core.hasPendingMarker(draft), false);
  assert.match(draft, /10-卡片盒\/公众号/);
  const titles = core.mockTitlesFromDraft(draft);
  assert.match(titles, /标题候选/);
  const html = core.renderWechatLayoutHtml({ title: '测试标题', markdown: draft });
  assert.match(html, /复制到公众号/);
  assert.match(html, /max-width:677px/);
  assert.equal(core.layoutRelForSlug('测试标题').startsWith('90-附件/公众号/layout/'), true);
  assert.equal(core.draftRelForSlug('测试标题').startsWith('10-卡片盒/公众号/drafts/'), true);
});

test('W3 published mark + pasteable html extract', () => {
  const marked = core.withPublishedMark('# Hello\n\nbody', '2026-10-17');
  assert.match(marked, /wechat_status: published/);
  assert.match(marked, /published_at: 2026-10-17/);
  assert.match(marked, /# Hello/);
  const again = core.withPublishedMark(marked, '2026-10-18');
  assert.match(again, /published_at: 2026-10-18/);
  assert.equal(core.publishedRelForSlug('Hello').startsWith('05-归档/公众号/'), true);
  const html = core.renderWechatLayoutHtml({ title: 'T', markdown: '# T\n\npara' });
  const paste = core.extractPasteableHtml(html);
  assert.match(paste, /<section/);
  assert.ok(!paste.includes('copyBtn'));
  assert.match(core.htmlToPlainText(paste), /para/);
});
