'use strict';

/**
 * In-process DeepSeek Harness LLM runtime (default / model-only mode).
 *
 * Boots Cordis with:
 *   - @deepseek-ai/dsh-llm
 *   - @deepseek-ai/dsh-llm-deepseek-api-key
 *
 * This is the supported path for a single model call (`ctx.llm.stream`).
 * It does NOT mount agent-loop, sessions, or any tool packages (bash / fs / web).
 * Those belong to advanced mode via `dsh --profile …` + SDK client / sandbox.
 *
 * Reference checkout (not vendored into this repo):
 *   /workspace/deepseek-harness  (= github.com/deepseek-ai/deepseek-harness)
 */

/** @type {Promise<{ ctx: any, BlockAssembler: any, createSystemMessage: Function, createUserMessage: Function }> | null} */
let bootPromise = null;

async function boot() {
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    const { Context } = await import('@deepseek-ai/cordis');
    const llmMod = await import('@deepseek-ai/dsh-llm');
    const DeepSeekApiKey = await import('@deepseek-ai/dsh-llm-deepseek-api-key');
    const LlmRuntime = llmMod.default;
    const { BlockAssembler, createSystemMessage, createUserMessage } = llmMod;

    const ctx = new Context();
    await ctx.plugin(LlmRuntime);
    await ctx.plugin(DeepSeekApiKey, { apiKeyEnv: 'DEEPSEEK_API_KEY' });

    const providers = ctx.llm.listProviders().map((p) => p.id);
    if (!providers.includes('deepseek-official')) {
      throw new Error(`dsh-llm mount failed: expected deepseek-official, got ${providers.join(',')}`);
    }

    return { ctx, BlockAssembler, createSystemMessage, createUserMessage };
  })();
  try {
    return await bootPromise;
  } catch (err) {
    bootPromise = null;
    throw err;
  }
}

/**
 * Stream one model-only completion through dsh-llm.
 * @returns {Promise<{ ok: true, text: string, provider: string, model: string } | { ok: false, error: string, code?: string }>}
 */
async function streamText({ apiKey, system, user, model = 'deepseek-flash' }) {
  if (!apiKey || !String(apiKey).trim()) {
    return { ok: false, error: '未配置 API key', needKey: true };
  }

  const { ctx, BlockAssembler, createSystemMessage, createUserMessage } = await boot();
  const prev = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = String(apiKey).trim();

  try {
    const messages = [
      createSystemMessage(String(system || '')),
      createUserMessage({ content: [{ type: 'text', text: String(user || '') }] }),
    ];
    const assembler = new BlockAssembler();
    for await (const chunk of ctx.llm.stream({
      provider: 'deepseek-official',
      model,
      messages,
    })) {
      assembler.push(chunk);
    }

    const finish = assembler.finish;
    if (finish && finish.kind === 'error') {
      const failure = finish.failure || {};
      return {
        ok: false,
        error: failure.message || '模型调用失败',
        code: failure.code,
      };
    }
    if (finish && finish.kind === 'aborted') {
      return { ok: false, error: '模型调用已取消', code: 'ABORTED' };
    }

    const msg = assembler.message();
    const parts = (msg && msg.content) || assembler.blocks() || [];
    const text = parts
      .filter((b) => b && b.type === 'text' && b.text)
      .map((b) => b.text)
      .join('');

    if (!text.trim()) {
      return { ok: false, error: '模型返回空内容', code: 'EMPTY_RESPONSE' };
    }

    return { ok: true, text, provider: 'deepseek-official', model };
  } catch (err) {
    return { ok: false, error: err.message || String(err), code: err.code };
  } finally {
    if (prev === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = prev;
  }
}

/** Offline check used by smoke: mount succeeds and lists the official route. */
async function smokeMount() {
  const { ctx } = await boot();
  return {
    ok: true,
    providers: ctx.llm.listProviders().map((p) => p.id),
  };
}

module.exports = { streamText, smokeMount, boot };
