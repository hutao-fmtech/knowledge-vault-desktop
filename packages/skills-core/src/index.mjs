/**
 * @kvd/skills-core — pure, dependency-free helpers shared by @kvd/skills and
 * @kvd/llm-mock (PARA heuristics, card typing, prompt shape detection, canned
 * offline answers). Exists to break the former skills <-> llm-mock import cycle:
 * both depend one-way on this package; neither imports the other.
 */

export const SYSTEM = `你是 Knowledge Vault 的助手。只根据提供的笔记片段回答。
回答时用相对路径引用出处，例如 \`01-收件箱/foo.md\`。
不要输出工具调用，不要要求执行命令。若信息不足就直说。`;

export function pickParaDest(text) {
  const t = (text || '').toLowerCase();
  if (/归档|archive|done|完成|过去/.test(t)) return '05-归档';
  if (/项目|project|deadline|里程碑/.test(t)) return '02-项目/个人项目';
  if (/资源|书|链接|参考|教程/.test(t)) return '04-资源';
  return '03-领域';
}

export function cardType(text) {
  if (/方法|how|流程|步骤/.test(text || '')) return '方法卡片';
  if (/观点|认为|主张/.test(text || '')) return '观点卡片';
  if (/索引|目录|moc/.test(text || '')) return '索引卡片';
  return '概念卡片';
}

export function slugify(title) {
  return (
    String(title || 'card')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^\w\u4e00-\u9fff-]+/g, '')
      .slice(0, 40) || 'card'
  );
}

// ---- deterministic mock completions (folded from src/agent/mock-responses.js) ----
/**
 * Deterministic offline mock completions shared by:
 * - kvd-llm-mock (ctx.llm.registerAdapter)
 * - kvd-skills flows (runAsk fallback) when running without a live provider
 *
 * Keep answers aligned with the former createMockEngine() wording so
 * user-visible default-mode behavior stays the same.
 */

export function extractMessagesText(messages) {
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
export function mockAskAnswer(userText) {
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
export function mockSortAnswer(noteText, pickParaDest) {
  const dest = pickParaDest(noteText);
  const top = dest.startsWith('02-项目') ? '02-项目' : dest;
  return `${top}\n基于关键词启发式`;
}

/**
 * Decide whether an options payload looks like an ask skill prompt.
 * @param {string} systemText
 * @param {string} userText
 */
export function isAskPrompt(systemText, userText) {
  return /笔记片段/.test(userText) || /只根据提供的笔记片段/.test(systemText);
}

/**
 * Decide whether an options payload looks like a sort skill prompt.
 * @param {string} systemText
 */
export function isSortPrompt(systemText) {
  return /PARA/.test(systemText) || /02-项目/.test(systemText);
}

