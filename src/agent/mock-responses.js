'use strict';

/**
 * Deterministic offline mock completions shared by:
 * - kvd-llm-mock (ctx.llm.registerAdapter)
 * - skills-logic when running without a live provider
 *
 * Keep answers aligned with the former createMockEngine() wording so
 * user-visible default-mode behavior stays the same.
 */

function extractMessagesText(messages) {
  const parts = [];
  for (const msg of messages || []) {
    const content = msg && msg.content;
    if (typeof content === 'string') {
      parts.push(content);
      continue;
    }
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block && block.type === 'text' && block.text) parts.push(block.text);
    }
  }
  return parts.join('\n');
}

/**
 * Build a mock ask answer from the skill's user prompt (search context embedded).
 * @param {string} userText
 * @returns {string}
 */
function mockAskAnswer(userText) {
  const text = String(userText || '');
  if (!text.includes('### ') || /笔记片段：\s*\(无命中片段\)/.test(text)) {
    return '（模拟）库里没有找到相关笔记。';
  }
  const heading = text.match(/###\s+([^\n]+)/);
  const path = heading ? heading[1].trim() : '';
  const after = heading ? text.slice(heading.index + heading[0].length) : '';
  const snippetLine = after
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('###') && !l.startsWith('问题：') && !l.startsWith('请回答'));
  const snippet = (snippetLine || '').slice(0, 200);
  const citations = [];
  const re = /###\s+([^\n]+)/g;
  let m;
  while ((m = re.exec(text))) {
    const p = m[1].trim();
    if (p && !citations.includes(p)) citations.push(p);
  }
  if (!path) {
    return '（模拟）库里没有找到相关笔记。';
  }
  return `（模拟）根据 ${path}：「${snippet}」\n\n出处：${citations
    .map((c) => '`' + c + '`')
    .join(', ')}`;
}

/**
 * Build a mock PARA classification reply (directory + one-line reason).
 * @param {string} noteText
 * @param {(t: string) => string} pickParaDest
 * @returns {string}
 */
function mockSortAnswer(noteText, pickParaDest) {
  const dest = pickParaDest(noteText);
  const top = dest.startsWith('02-项目') ? '02-项目' : dest;
  return `${top}\n基于关键词启发式`;
}

/**
 * Yield a successful text stream for dsh-llm consumers.
 * @param {string} text
 */
async function* yieldTextStream(text) {
  const body = String(text || '');
  yield { type: 'block-start', index: 0, blockType: 'text' };
  yield { type: 'text-delta', index: 0, text: body };
  yield { type: 'block-end', index: 0, block: { type: 'text', text: body } };
  yield { type: 'finish', reason: { kind: 'stop' } };
}

/**
 * Decide whether an options payload looks like an ask skill prompt.
 * @param {string} systemText
 * @param {string} userText
 */
function isAskPrompt(systemText, userText) {
  return /笔记片段/.test(userText) || /只根据提供的笔记片段/.test(systemText);
}

/**
 * Decide whether an options payload looks like a sort skill prompt.
 * @param {string} systemText
 */
function isSortPrompt(systemText) {
  return /PARA/.test(systemText) || /02-项目/.test(systemText);
}

module.exports = {
  extractMessagesText,
  mockAskAnswer,
  mockSortAnswer,
  yieldTextStream,
  isAskPrompt,
  isSortPrompt,
};
