/**
 * kvd-llm-mock — register a deterministic offline llm adapter via registerAdapter.
 * Not a parallel engine tree: skills call ctx.llm.stream({ provider: 'kvd-mock' }).
 * Privacy gate exempts kvd-mock (no network / no note exfiltration).
 */
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import z from '@deepseek-ai/schemastery';
import { pickParaDest } from './kvd-skills.mjs';

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
 * Yield a successful text stream for dsh-llm consumers.
 * @param {string} text
 */
export async function* yieldTextStream(text) {
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

export const name = 'kvd-llm-mock';
export const inject = ['llm'];

export const Config = z.object({
  /** Provider route id registered on ctx.llm */
  provider: z.string().default('kvd-mock'),
});

class KvdMockAdapter extends LlmAdapter {
  providerInfo(provider) {
    return { id: provider, name: 'KVD Offline Mock' };
  }

  listModels() {
    return Promise.resolve([{ id: 'mock', name: 'mock' }]);
  }

  resolveModel(provider, model) {
    return Promise.resolve({ provider, id: model || 'mock', name: model || 'mock' });
  }

  async *stream(options) {
    const systemText = extractMessagesText(
      (options.messages || []).filter((m) => m && m.role === 'system'),
    );
    const userText = extractMessagesText(
      (options.messages || []).filter((m) => m && m.role !== 'system'),
    );

    let text;
    if (isSortPrompt(systemText)) {
      text = mockSortAnswer(userText, pickParaDest);
    } else if (isAskPrompt(systemText, userText)) {
      text = mockAskAnswer(userText);
    } else {
      text = mockAskAnswer(userText) || '（模拟）ok';
    }
    yield* yieldTextStream(text);
  }
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {z.infer<typeof Config>} config
 */
export function apply(ctx, config = {}) {
  const provider = (config && config.provider) || 'kvd-mock';
  const adapter = new KvdMockAdapter();
  // Disposed with this fiber (registerAdapter uses ctx.effect).
  ctx.llm.registerAdapter([provider], adapter);
}

export default { name, inject, Config, apply };
