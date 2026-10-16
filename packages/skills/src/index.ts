/**
 * kvd-skills — default-mode A1/A2/A3 (ask / sortInbox / makeCard) as a Cordis service.
 * Uses vault / vaultSearch / proposals + llm (live deepseek-official or kvd-mock adapter).
 */
import fs from 'node:fs';
import path from 'node:path';
import { Context, Service } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-credentials';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import z from '@deepseek-ai/schemastery';
import { DEFAULT_MODEL } from '@kvd/shared/models';
import { isWechatOaPipelineRel } from '@kvd/shared/wechat-oa';
import { proposeCreate, proposeMove } from '@kvd/proposals';
import type { Proposal, ProposeResult } from '@kvd/proposals';
import type { PathResult } from '@kvd/vault';
import type { SearchHit } from '@kvd/search';
import { SYSTEM, pickParaDest, cardType, slugify, mockAskAnswer } from '@kvd/skills-core';

// ---- A1/A2/A3 flows (folded from src/agent/skills-logic.js) ----
/**
 * Default-mode A1/A2/A3 flows (ask / sortInbox / makeCard).
 * One implementation; Cordis kvd-skills and the thin engine facades both call this.
 */


export { SYSTEM, pickParaDest, cardType, slugify };

export interface StreamTextOptions {
  system: string;
  user: string;
  provider?: string;
  model?: string;
}

export type StreamTextResult =
  | { ok: true; text: string; provider?: string; model?: string }
  | { ok: false; error: string; code?: string; needKey?: boolean; needPrivacy?: boolean };

export interface SkillDeps {
  style?: 'mock' | 'live';
  hasKey?: boolean | (() => boolean);
  backend?: string;
  provider?: string;
  preferMockStream?: boolean;
  search: (vaultRoot: string, query: string, limit: number) => { ok: boolean; hits?: SearchHit[]; error?: string };
  resolve: (vaultRoot: string, rel: string) => PathResult;
  proposeMove: (vaultRoot: string, from: string, to: string, summary?: string) => ProposeResult;
  proposeCreate: (vaultRoot: string, rel: string, content: string, summary?: string) => ProposeResult;
  streamText?: (opts: StreamTextOptions) => Promise<StreamTextResult>;
}

/** Result of one A1/A2/A3 run (success or failure, always tagged viaSkills/skill). */
export interface SkillResult {
  ok: boolean;
  error?: string;
  code?: string;
  needKey?: boolean;
  needPrivacy?: boolean;
  answer?: string;
  citations?: string[];
  proposals?: Proposal[];
  backend?: string;
  model?: string;
  viaSkills: true;
  skill: 'ask' | 'sortInbox' | 'makeCard';
  [extra: string]: unknown;
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    kvdSkills: KvdSkillsService;
  }
}

function isPrivacyFailure(r: StreamTextResult): boolean {
  return !r.ok && (r.code === 'PRIVACY_REQUIRED' || !!r.needPrivacy || /隐私/.test(String(r.error || '')));
}

function resolveHasKey(deps: SkillDeps): boolean {
  if (typeof deps.hasKey === 'function') return !!deps.hasKey();
  return !!deps.hasKey;
}

function isMockStyle(deps: SkillDeps): boolean {
  return deps.style === 'mock' || (!resolveHasKey(deps) && deps.style !== 'live');
}

/**
 * A1 — ask vault with citations.
 */
export async function runAsk(
  deps: SkillDeps,
  { vaultRoot, question }: { vaultRoot: string; question: string },
): Promise<SkillResult> {
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
    if (isPrivacyFailure(streamed)) {
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
export async function runSortInbox(
  deps: SkillDeps,
  { vaultRoot, noteRel }: { vaultRoot: string; noteRel: string },
): Promise<SkillResult> {
  const hasKey = resolveHasKey(deps);
  const mockStyle = isMockStyle(deps);
  const resolved = deps.resolve(vaultRoot, noteRel);
  if (!resolved.ok) return { ...resolved, viaSkills: true, skill: 'sortInbox' };
  if (!fs.existsSync(resolved.abs)) {
    return { ok: false, error: `笔记不存在：${noteRel}`, viaSkills: true, skill: 'sortInbox' };
  }
  if (isWechatOaPipelineRel(resolved.rel)) {
    return {
      ok: false,
      error: `公众号流水线笔记不走收件箱归类：${resolved.rel}`,
      viaSkills: true,
      skill: 'sortInbox',
    };
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
    } else if (isPrivacyFailure(streamed)) {
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
export async function runMakeCard(
  deps: SkillDeps,
  { vaultRoot, noteRel }: { vaultRoot: string; noteRel: string },
): Promise<SkillResult> {
  const hasKey = resolveHasKey(deps);
  const mockStyle = isMockStyle(deps);
  const resolved = deps.resolve(vaultRoot, noteRel);
  if (!resolved.ok) return { ...resolved, viaSkills: true, skill: 'makeCard' };
  if (!fs.existsSync(resolved.abs)) {
    return { ok: false, error: `笔记不存在：${noteRel}`, viaSkills: true, skill: 'makeCard' };
  }
  if (isWechatOaPipelineRel(resolved.rel)) {
    return {
      ok: false,
      error: `公众号流水线笔记不走生成卡片：${resolved.rel}`,
      viaSkills: true,
      skill: 'makeCard',
    };
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

export function createSkillsEngine(deps: SkillDeps, meta: { id: string; backend: string }) {
  return {
    id: meta.id,
    backend: meta.backend,
    viaSkills: true as const,
    ask: (opts: { vaultRoot: string; question: string }) => runAsk(deps, opts),
    sortInbox: (opts: { vaultRoot: string; noteRel: string }) => runSortInbox(deps, opts),
    makeCard: (opts: { vaultRoot: string; noteRel: string }) => runMakeCard(deps, opts),
  };
}

export const name = 'kvd-skills';
export const inject = ['llm', 'vault', 'vaultSearch', 'proposals'];

export const Config = z.object({});

export class KvdSkillsService extends Service {
  static Config = Config;
  static inject = ['llm', 'vault', 'vaultSearch', 'proposals'];

  constructor(ctx: Context, _config: unknown = {}) {
    super(ctx, 'kvdSkills');
  }

  root(): string | null {
    return this.ctx.vault.getRoot();
  }

  /**
   * Whether a DeepSeek API key is available via credentials (never process.env).
   * @returns {Promise<boolean>}
   */
  async hasApiKey(): Promise<boolean> {
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
  async streamText(opts: StreamTextOptions): Promise<StreamTextResult> {
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
          createUserMessage({ content: [{ type: 'text', text: String(opts.user || '') }], source: { kind: 'user' } }),
        ],
      })) {
        assembler.push(chunk);
      }
      const finish = assembler.finish;
      if (finish && finish.kind === 'error') {
        const failure: { message?: string; code?: string } = finish.failure || {};
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
      // blocks() is exactly the assembled message content.
      const parts: ContentBlock[] = assembler.blocks() || [];
      const text = parts
        .map((b) => (b && b.type === 'text' && b.text ? b.text : ''))
        .join('');
      if (!text.trim()) {
        return { ok: false, error: '模型返回空内容', code: 'EMPTY_RESPONSE' };
      }
      return { ok: true, text, provider, model };
    } catch (err) {
      const e = err as Error & { code?: string };
      return { ok: false, error: e.message || String(err), code: e.code };
    }
  }

  /**
   * Build deps for the A1/A2/A3 flows against the active vault.
   * @param {{ forceMock?: boolean }} [opts]
   */
  async buildDeps(opts: { forceMock?: boolean } = {}): Promise<SkillDeps> {
    const hasKey = opts.forceMock ? false : await this.hasApiKey();
    const mockStyle = !hasKey || !!opts.forceMock;
    const self = this;
    return {
      style: mockStyle ? ('mock' as const) : ('live' as const),
      hasKey,
      backend: mockStyle ? 'kvd-mock' : 'dsh-llm',
      provider: mockStyle ? 'kvd-mock' : 'deepseek-official',
      preferMockStream: mockStyle,
      search: (_vaultRoot, query, limit) => {
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

  requireRoot(vaultRoot: string | null | undefined): { ok: true; root: string } | { ok: false; error: string } {
    const root = vaultRoot || this.root();
    if (!root) return { ok: false, error: '未打开 vault' };
    return { ok: true, root };
  }

  /**
   * A1
   * @param {{ question: string, vaultRoot?: string, forceMock?: boolean }} opts
   */
  async ask(opts: { question: string; vaultRoot?: string; forceMock?: boolean }): Promise<SkillResult> {
    const gate = this.requireRoot(opts && opts.vaultRoot);
    if (!gate.ok) return { ...gate, viaSkills: true, skill: 'ask' };
    const deps = await this.buildDeps(opts);
    return runAsk(deps, { vaultRoot: gate.root, question: opts.question });
  }

  /**
   * A2
   * @param {{ noteRel: string, vaultRoot?: string, forceMock?: boolean }} opts
   */
  async sortInbox(opts: { noteRel: string; vaultRoot?: string; forceMock?: boolean }): Promise<SkillResult> {
    const gate = this.requireRoot(opts && opts.vaultRoot);
    if (!gate.ok) return { ...gate, viaSkills: true, skill: 'sortInbox' };
    const deps = await this.buildDeps(opts);
    return runSortInbox(deps, { vaultRoot: gate.root, noteRel: opts.noteRel });
  }

  /**
   * A3
   * @param {{ noteRel: string, vaultRoot?: string, forceMock?: boolean }} opts
   */
  async makeCard(opts: { noteRel: string; vaultRoot?: string; forceMock?: boolean }): Promise<SkillResult> {
    const gate = this.requireRoot(opts && opts.vaultRoot);
    if (!gate.ok) return { ...gate, viaSkills: true, skill: 'makeCard' };
    const deps = await this.buildDeps(opts);
    return runMakeCard(deps, { vaultRoot: gate.root, noteRel: opts.noteRel });
  }
}

export default KvdSkillsService;
