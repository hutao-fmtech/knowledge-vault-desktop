/**
 * kvd-llm-mock — register a deterministic offline llm adapter via registerAdapter.
 * Not a parallel engine tree: skills call ctx.llm.stream({ provider: 'kvd-mock' }).
 * Privacy gate exempts kvd-mock (no network / no note exfiltration).
 */
import { createRequire } from 'node:module';
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import z from '@deepseek-ai/schemastery';

const require = createRequire(import.meta.url);
const {
  extractMessagesText,
  mockAskAnswer,
  mockSortAnswer,
  yieldTextStream,
  isAskPrompt,
  isSortPrompt,
} = require('../../agent/mock-responses.js');
const { pickParaDest } = require('../../agent/skills-logic.js');

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
