/**
 * kvd-skills — default-mode A1/A2/A3 (ask / sortInbox / makeCard) as a Cordis service.
 * Uses vault / vaultSearch / proposals + llm (live deepseek-official or kvd-mock adapter).
 */
import fs from 'node:fs';
import path from 'node:path';
import { Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { DEFAULT_MODEL } from '../shared/models.mjs';
import { proposeCreate, proposeMove } from './kvd-proposals.mjs';
import { mockAskAnswer } from './kvd-llm-mock.mjs';

// ---- A1/A2/A3 flows (folded from src/agent/skills-logic.js) ----
/**
 * Default-mode A1/A2/A3 flows (ask / sortInbox / makeCard).
 * One implementation; Cordis kvd-skills and the thin engine facades both call this.
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

function resolveHasKey(deps) {
  if (typeof deps.hasKey === 'function') return !!deps.hasKey();
  return !!deps.hasKey;
}

function isMockStyle(deps) {
  return deps.style === 'mock' || (!resolveHasKey(deps) && deps.style !== 'live');
}

/**
 * A1 — ask vault with citations.
 */
export async function runAsk(deps, { vaultRoot, question }) {
  const hasKey = resolveHasKey(deps);
  const mockStyle = isMockStyle(deps);
  const searched = deps.search(vaultRoot, question, hasKey ? 6 : 5);
  const hits = searched && searched.ok && Array.isArray(searched.hits) ? searched.hits : [];
  const citations = hits.map((h) => h.path);
  const context =
    hits.map((h) => `### ${h.path}\n${h.snippet}`).join('\n\n') || '(无命中片段)';

  // Live model path
  if (hasKey && typeof deps.streamText === 'function' && !mockStyle) {
    const streamed = await deps.streamText({
      system: SYSTEM,
      user: `问题：${question}\n\n笔记片段：\n${context}\n\n请回答并列出出处路径。`,
      provider: deps.provider || 'deepseek-official',
      model: DEFAULT_MODEL,
    });
    if (!streamed.ok) return { ...streamed, viaSkills: true, skill: 'ask' };
    return {
      ok: true,
      answer: streamed.text,
      citations,
      proposals: [],
      backend: 'dsh-llm',
      model: streamed.model,
      viaSkills: true,
      skill: 'ask',
    };
  }

  // Offline / mock: prefer llm adapter stream when provided (kvd-llm-mock).
  if (typeof deps.streamText === 'function' && deps.preferMockStream) {
    const streamed = await deps.streamText({
      system: SYSTEM,
      user: `问题：${question}\n\n笔记片段：\n${context}\n\n请回答并列出出处路径。`,
      provider: deps.provider || 'kvd-mock',
      model: 'mock',
    });
    if (streamed.ok) {
      return {
        ok: true,
        answer: streamed.text,
        citations,
        proposals: [],
        viaSkills: true,
        skill: 'ask',
        backend: deps.backend || 'kvd-mock',
        model: streamed.model,
      };
    }
    if (
      streamed.code === 'PRIVACY_REQUIRED' ||
      streamed.needPrivacy ||
      /隐私/.test(String(streamed.error || ''))
    ) {
      return { ...streamed, viaSkills: true, skill: 'ask' };
    }
  }

  if (!hits.length) {
    return {
      ok: true,
      answer: '（模拟）库里没有找到相关笔记。',
      citations: [],
      proposals: [],
      viaSkills: true,
      skill: 'ask',
      backend: deps.backend || 'mock',
    };
  }

  return {
    ok: true,
    answer: mockAskAnswer(`问题：${question}\n\n笔记片段：\n${context}`),
    citations,
    proposals: [],
    viaSkills: true,
    skill: 'ask',
    backend: deps.backend || 'mock',
  };
}

/**
 * A2 — propose PARA sort for an inbox note.
 */
export async function runSortInbox(deps, { vaultRoot, noteRel }) {
  const hasKey = resolveHasKey(deps);
  const mockStyle = isMockStyle(deps);
  const resolved = deps.resolve(vaultRoot, noteRel);
  if (!resolved.ok) return { ...resolved, viaSkills: true, skill: 'sortInbox' };
  if (!fs.existsSync(resolved.abs)) {
    return { ok: false, error: `笔记不存在：${noteRel}`, viaSkills: true, skill: 'sortInbox' };
  }
  const text = fs.readFileSync(resolved.abs, 'utf8');
  let destDir = pickParaDest(text);
  let reason = '基于关键词启发式';
  let backend = hasKey && !mockStyle ? 'dsh-llm' : mockStyle ? deps.backend || 'mock' : 'heuristic';

  if (hasKey && typeof deps.streamText === 'function' && !mockStyle) {
    const streamed = await deps.streamText({
      system:
        '从 PARA 中选一个目录：02-项目、03-领域、04-资源、05-归档。只输出目录名与一行理由。不要调用工具。',
      user: text.slice(0, 3000),
      provider: deps.provider || 'deepseek-official',
      model: DEFAULT_MODEL,
    });
    if (streamed.ok) {
      const m = streamed.text.match(/0[2-5]-[\u4e00-\u9fffA-Za-z]+/);
      if (m) destDir = m[0];
      reason = streamed.text.slice(0, 200);
      backend = 'dsh-llm';
    } else if (
      streamed.code === 'PRIVACY_REQUIRED' ||
      streamed.needPrivacy ||
      /隐私/.test(String(streamed.error || ''))
    ) {
      return { ...streamed, viaSkills: true, skill: 'sortInbox' };
    } else {
      backend = 'heuristic';
    }
  }

  if (destDir === '02-项目') destDir = '02-项目/个人项目';
  const to = `${destDir}/${path.basename(noteRel)}`;
  const moved = deps.proposeMove(vaultRoot, noteRel, to, `归类到 ${destDir}`);
  if (!moved.ok) return { ...moved, viaSkills: true, skill: 'sortInbox' };

  if (mockStyle) {
    return {
      ok: true,
      answer: `（模拟）建议将 \`${noteRel}\` 移到 \`${to}\`。确认 Apply 后才会落盘。`,
      citations: [noteRel],
      proposals: [moved.proposal],
      viaSkills: true,
      skill: 'sortInbox',
      backend,
    };
  }

  return {
    ok: true,
    answer: `建议移动到 \`${to}\`。${reason}\n确认 Apply 后才会落盘。`,
    citations: [noteRel],
    proposals: [moved.proposal],
    needKey: !hasKey,
    backend: hasKey ? backend : 'heuristic',
    viaSkills: true,
    skill: 'sortInbox',
  };
}

/**
 * A3 — propose a zettel card from a note.
 */
export async function runMakeCard(deps, { vaultRoot, noteRel }) {
  const hasKey = resolveHasKey(deps);
  const mockStyle = isMockStyle(deps);
  const resolved = deps.resolve(vaultRoot, noteRel);
  if (!resolved.ok) return { ...resolved, viaSkills: true, skill: 'makeCard' };
  if (!fs.existsSync(resolved.abs)) {
    return { ok: false, error: `笔记不存在：${noteRel}`, viaSkills: true, skill: 'makeCard' };
  }
  const text = fs.readFileSync(resolved.abs, 'utf8');
  const title =
    text
      .split('\n')
      .find((l) => l.trim())
      ?.replace(/^#\s*/, '')
      .trim() || path.basename(noteRel, '.md');
  const type = cardType(text);
  const rel = `10-卡片盒/${type}/${slugify(title)}.md`;
  const slice = mockStyle ? 1200 : 2000;
  const body = `---\nsource: ${noteRel}\n---\n\n# ${title}\n\n${text.trim().slice(0, slice)}\n`;
  const created = deps.proposeCreate(vaultRoot, rel, body, `生成卡片 ${rel}`);
  if (!created.ok) return { ...created, viaSkills: true, skill: 'makeCard' };

  if (mockStyle) {
    return {
      ok: true,
      answer: `（模拟）将在 \`${rel}\` 新建卡片。确认 Apply 后才会落盘。`,
      citations: [noteRel],
      proposals: [created.proposal],
      viaSkills: true,
      skill: 'makeCard',
      backend: deps.backend || 'mock',
    };
  }

  return {
    ok: true,
    answer: `将新建卡片 \`${rel}\`。确认 Apply 后才会落盘。`,
    citations: [noteRel],
    proposals: [created.proposal],
    viaSkills: true,
    skill: 'makeCard',
    backend: 'dsh-llm',
  };
}

export function createSkillsEngine(deps, meta) {
  return {
    id: meta.id,
    backend: meta.backend,
    viaSkills: true,
    ask: (opts) => runAsk(deps, opts),
    sortInbox: (opts) => runSortInbox(deps, opts),
    makeCard: (opts) => runMakeCard(deps, opts),
  };
}

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
    const model = opts.model || (provider === 'kvd-mock' ? 'mock' : DEFAULT_MODEL);

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
   * Build deps for the A1/A2/A3 flows against the active vault.
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
