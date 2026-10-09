'use strict';

/**
 * Default / model-only DeepSeek Harness LLM access.
 *
 * Obtains the shared Cordis Context from `src/runtime/` (composition root).
 * Does NOT create its own Context. Plugin rows live in composition.mjs.
 *
 * Reference checkout (not vendored into this repo):
 *   /workspace/deepseek-harness  (= github.com/deepseek-ai/deepseek-harness)
 */

/** @type {Promise<{ ctx: any, BlockAssembler: any, createSystemMessage: Function, createUserMessage: Function }> | null} */
let helpersPromise = null;

async function boot() {
  if (helpersPromise) return helpersPromise;
  helpersPromise = (async () => {
    const { getRuntime } = await import('../runtime/boot.mjs');
    const { ctx } = await getRuntime();
    const llmMod = await import('@deepseek-ai/dsh-llm');
    const { BlockAssembler, createSystemMessage, createUserMessage } = llmMod;
    return { ctx, BlockAssembler, createSystemMessage, createUserMessage };
  })();
  try {
    return await helpersPromise;
  } catch (err) {
    helpersPromise = null;
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
