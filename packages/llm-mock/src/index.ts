/**
 * kvd-llm-mock — register a deterministic offline llm adapter via registerAdapter.
 * Not a parallel engine tree: skills call ctx.llm.stream({ provider: 'kvd-mock' }).
 * Privacy gate exempts kvd-mock (no network / no note exfiltration).
 */
import type { Context } from '@deepseek-ai/cordis';
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm';
import z from '@deepseek-ai/schemastery';
import {
  pickParaDest,
  extractMessagesText,
  mockAskAnswer,
  mockSortAnswer,
  isAskPrompt,
  isSortPrompt,
} from '@kvd/skills-core';

export { extractMessagesText, mockAskAnswer, mockSortAnswer, isAskPrompt, isSortPrompt };


/**
 * Yield a successful text stream for dsh-llm consumers.
 * @param {string} text
 */
export async function* yieldTextStream(text: unknown): AsyncGenerator<StreamChunk> {
  const body = String(text || '');
  yield { type: 'block-start', index: 0, blockType: 'text' };
  yield { type: 'text-delta', index: 0, text: body };
  yield { type: 'block-end', index: 0, block: { type: 'text', text: body } };
  yield { type: 'finish', reason: { kind: 'stop' } };
}

export const name = 'kvd-llm-mock';
export const inject = ['llm'];

export const Config = z.object({
  /** Provider route id registered on ctx.llm */
  provider: z.string().default('kvd-mock'),
});

class KvdMockAdapter extends LlmAdapter {
  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: 'KVD Offline Mock' };
  }

  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve([{ provider, id: 'mock', name: 'mock' }]);
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model || 'mock', name: model || 'mock' });
  }

  async *stream(options: GenerateOptions): AsyncGenerator<StreamChunk> {
    const systemText = extractMessagesText(
      (options.messages || []).filter((m) => m && m.role === 'system'),
    );
    const userText = extractMessagesText(
      (options.messages || []).filter((m) => m && m.role !== 'system'),
    );

    let text: string;
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

export function apply(ctx: Context, config: { provider?: string } = {}): void {
  const provider = (config && config.provider) || 'kvd-mock';
  const adapter = new KvdMockAdapter();
  // Disposed with this fiber (registerAdapter uses ctx.effect).
  ctx.llm.registerAdapter([provider], adapter);
}

export default { name, inject, Config, apply };
