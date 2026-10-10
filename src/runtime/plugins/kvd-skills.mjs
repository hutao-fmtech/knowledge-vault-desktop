/**
 * kvd-skills — default-mode A1/A2/A3 (ask / sortInbox / makeCard) as a Cordis service.
 * Uses vault / vaultSearch / proposals + llm (live deepseek-official or kvd-mock adapter).
 */
import { createRequire } from 'node:module';
import { Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';

const require = createRequire(import.meta.url);
const {
  SYSTEM,
  runAsk,
  runSortInbox,
  runMakeCard,
} = require('../../agent/skills-logic.js');
const { proposeCreate, proposeMove } = require('../../agent/proposals.js');

export const name = 'kvd-skills';
export const inject = ['llm', 'vault', 'vaultSearch', 'proposals'];

export const Config = z.object({});

export class KvdSkillsService extends Service {
  static Config = Config;
  static inject = ['llm', 'vault', 'vaultSearch', 'proposals'];

  /** @param {import('@deepseek-ai/cordis').Context} ctx */
  constructor(ctx, _config = {}) {
    super(ctx, 'kvdSkills');
  }

  /** @returns {string | null} */
  root() {
    return this.ctx.vault.getRoot();
  }

  /**
   * Whether a DeepSeek API key is available via credentials (never process.env).
   * @returns {Promise<boolean>}
   */
  async hasApiKey() {
    try {
      const { credentialRef } = await import('@deepseek-ai/dsh-credentials');
      const credentials = this.ctx.get('credentials');
      if (!credentials) return false;
      const hit = await credentials.resolve(credentialRef('DEEPSEEK_API_KEY'));
      return !!(hit && hit.value && String(hit.value).trim());
    } catch {
      return false;
    }
  }

  /**
   * Stream one completion through ctx.llm (privacy gate + adapter registry).
   * @param {{ system: string, user: string, provider?: string, model?: string }} opts
   */
  async streamText(opts) {
    const llmMod = await import('@deepseek-ai/dsh-llm');
    const { BlockAssembler, createSystemMessage, createUserMessage } = llmMod;
    const provider = opts.provider || 'deepseek-official';
    const model = opts.model || (provider === 'kvd-mock' ? 'mock' : 'deepseek-flash');

    // Ensure credential exists for live provider (keychain), never env inject.
    if (provider === 'deepseek-official') {
      const { credentialRef } = await import('@deepseek-ai/dsh-credentials');
      const credentials = this.ctx.get('credentials');
      if (!credentials) {
        return { ok: false, error: 'credentials service missing', code: 'NO_CREDENTIALS' };
      }
      const hit = await credentials.resolve(credentialRef('DEEPSEEK_API_KEY'));
      if (!hit || !hit.value) {
        return { ok: false, error: '未配置 API key', needKey: true };
      }
    }

    try {
      const assembler = new BlockAssembler();
      for await (const chunk of this.ctx.llm.stream({
        provider,
        model,
        messages: [
          createSystemMessage(String(opts.system || SYSTEM)),
          createUserMessage({ content: [{ type: 'text', text: String(opts.user || '') }] }),
        ],
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
          needPrivacy: failure.code === 'PRIVACY_REQUIRED',
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
      return { ok: true, text, provider, model };
    } catch (err) {
      return { ok: false, error: err.message || String(err), code: err.code };
    }
  }

  /**
   * Build deps for skills-logic against the active vault.
   * @param {{ forceMock?: boolean }} [opts]
   */
  async buildDeps(opts = {}) {
    const hasKey = opts.forceMock ? false : await this.hasApiKey();
    const mockStyle = !hasKey || !!opts.forceMock;
    const self = this;
    return {
      style: mockStyle ? 'mock' : 'live',
      hasKey,
      backend: mockStyle ? 'kvd-mock' : 'dsh-llm',
      provider: mockStyle ? 'kvd-mock' : 'deepseek-official',
      preferMockStream: mockStyle,
      search: (vaultRoot, query, limit) => {
        // Prefer vaultSearch (exclusions + resolve); fall back only if root mismatch.
        const vs = self.ctx.vaultSearch.search(query, limit);
        if (vs.ok) return vs;
        return { ok: false, hits: [], error: vs.error };
      },
      resolve: (vaultRoot, rel) => self.ctx.vault.resolveAgainst(vaultRoot, rel),
      proposeMove: (vaultRoot, from, to, summary) => {
        // Use pure helper so we don't double-stash; caller / main stashes via proposals service.
        return proposeMove(vaultRoot, from, to, summary);
      },
      proposeCreate: (vaultRoot, rel, content, summary) => {
        return proposeCreate(vaultRoot, rel, content, summary);
      },
      streamText: (streamOpts) => self.streamText(streamOpts),
    };
  }

  requireRoot(vaultRoot) {
    const root = vaultRoot || this.root();
    if (!root) return { ok: false, error: '未打开 vault' };
    return { ok: true, root };
  }

  /**
   * A1
   * @param {{ question: string, vaultRoot?: string, forceMock?: boolean }} opts
   */
  async ask(opts) {
    const gate = this.requireRoot(opts && opts.vaultRoot);
    if (!gate.ok) return { ...gate, viaSkills: true, skill: 'ask' };
    const deps = await this.buildDeps(opts);
    return runAsk(deps, { vaultRoot: gate.root, question: opts.question });
  }

  /**
   * A2
   * @param {{ noteRel: string, vaultRoot?: string, forceMock?: boolean }} opts
   */
  async sortInbox(opts) {
    const gate = this.requireRoot(opts && opts.vaultRoot);
    if (!gate.ok) return { ...gate, viaSkills: true, skill: 'sortInbox' };
    const deps = await this.buildDeps(opts);
    return runSortInbox(deps, { vaultRoot: gate.root, noteRel: opts.noteRel });
  }

  /**
   * A3
   * @param {{ noteRel: string, vaultRoot?: string, forceMock?: boolean }} opts
   */
  async makeCard(opts) {
    const gate = this.requireRoot(opts && opts.vaultRoot);
    if (!gate.ok) return { ...gate, viaSkills: true, skill: 'makeCard' };
    const deps = await this.buildDeps(opts);
    return runMakeCard(deps, { vaultRoot: gate.root, noteRel: opts.noteRel });
  }
}

export default KvdSkillsService;
