/**
 * W2 WeChat OA writing flows: Brief → draft → titles → layout HTML.
 * Notes (drafts/titles) go through proposeCreate → Apply.
 * Layout HTML is written only via deps.writeLayout (desktop local tool).
 */
import fs from 'node:fs';
import path from 'node:path';
import { WECHAT_OA } from '@kvd/shared/wechat-oa';
import { proposeCreate } from '@kvd/proposals';
import type { Proposal } from '@kvd/proposals';
import {
  WECHAT_ARTICLE_SYSTEM,
  WECHAT_TITLES_SYSTEM,
  PENDING_MARKER,
  hasPendingMarker,
  extractNoteTitle,
  mockDraftFromBrief,
  mockTitlesFromDraft,
  renderWechatLayoutHtml,
  draftRelForSlug,
  titlesRelForSlug,
  layoutRelForSlug,
  slugify,
} from '@kvd/skills-core';
import type { PathResult } from '@kvd/vault';
import type { SearchHit } from '@kvd/search';
import type { ProposeResult } from '@kvd/proposals';

export type StreamTextResult =
  | { ok: true; text: string; provider?: string; model?: string }
  | { ok: false; error: string; code?: string; needKey?: boolean; needPrivacy?: boolean };

/** Minimal deps shared with A1/A2/A3 + layout local tool. */
export interface WechatBaseDeps {
  style?: 'mock' | 'live';
  hasKey?: boolean | (() => boolean);
  backend?: string;
  provider?: string;
  preferMockStream?: boolean;
  search: (vaultRoot: string, query: string, limit: number) => { ok: boolean; hits?: SearchHit[]; error?: string };
  resolve: (vaultRoot: string, rel: string) => PathResult;
  proposeMove: (vaultRoot: string, from: string, to: string, summary?: string) => ProposeResult;
  proposeCreate: (vaultRoot: string, rel: string, content: string, summary?: string) => ProposeResult;
  streamText?: (opts: { system: string; user: string; provider?: string; model?: string }) => Promise<StreamTextResult>;
}

export type WechatSkillName = 'wechatDraft' | 'wechatTitles' | 'wechatLayout';

export interface WechatSkillResult {
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
  skill: WechatSkillName;
  /** Layout HTML vault-relative path when written by local tool. */
  layoutPath?: string;
  [extra: string]: unknown;
}

export interface WechatSkillDeps extends WechatBaseDeps {
  /** Desktop local tool — writes under 90-附件/公众号/layout/ only. */
  writeLayout?: (
    vaultRoot: string,
    relPath: string,
    html: string,
  ) => { ok: true; path: string } | { ok: false; error: string };
}

function isPrivacyFailure(r: StreamTextResult): boolean {
  return !r.ok && (r.code === 'PRIVACY_REQUIRED' || !!r.needPrivacy || /隐私/.test(String(r.error || '')));
}

function resolveHasKey(deps: WechatBaseDeps): boolean {
  if (typeof deps.hasKey === 'function') return !!deps.hasKey();
  return !!deps.hasKey;
}

function isMockStyle(deps: WechatBaseDeps): boolean {
  return deps.style === 'mock' || (!resolveHasKey(deps) && deps.style !== 'live');
}

function readNote(
  deps: WechatBaseDeps,
  vaultRoot: string,
  noteRel: string,
): { ok: true; rel: string; text: string } | { ok: false; error: string } {
  const resolved = deps.resolve(vaultRoot, noteRel);
  if (!resolved.ok) return resolved;
  if (!fs.existsSync(resolved.abs)) {
    return { ok: false, error: `笔记不存在：${noteRel}` };
  }
  return { ok: true, rel: resolved.rel, text: fs.readFileSync(resolved.abs, 'utf8') };
}

function underDir(rel: string, dir: string): boolean {
  const r = rel.replace(/\\/g, '/');
  return r === dir || r.startsWith(dir + '/');
}

/**
 * From a Brief under briefs/ → propose create draft under drafts/ (no 【待补】).
 */
export async function runWechatDraft(
  deps: WechatSkillDeps,
  { vaultRoot, briefRel }: { vaultRoot: string; briefRel: string },
): Promise<WechatSkillResult> {
  const hasKey = resolveHasKey(deps);
  const mockStyle = isMockStyle(deps);
  const note = readNote(deps, vaultRoot, briefRel);
  if (!note.ok) return { ...note, viaSkills: true, skill: 'wechatDraft' };
  if (!underDir(note.rel, WECHAT_OA.briefs)) {
    return {
      ok: false,
      error: `请选择 Brief（${WECHAT_OA.briefs}/）：${note.rel}`,
      viaSkills: true,
      skill: 'wechatDraft',
    };
  }

  let draftBody = '';
  let backend = mockStyle ? deps.backend || 'mock' : 'dsh-llm';

  if (hasKey && typeof deps.streamText === 'function' && !mockStyle) {
    const streamed = await deps.streamText({
      system: WECHAT_ARTICLE_SYSTEM,
      user: `请根据下列 Brief 写成一篇完整公众号正文（Markdown）。禁止输出 ${PENDING_MARKER}。\n\nBrief 路径：${note.rel}\n\n---\n${note.text.slice(0, 8000)}`,
      provider: deps.provider || 'deepseek-official',
    });
    if (!streamed.ok) {
      if (isPrivacyFailure(streamed)) return { ...streamed, viaSkills: true, skill: 'wechatDraft' };
      // fall through to mock body so offline CI still works if live fails
      draftBody = mockDraftFromBrief(note.text);
      backend = 'heuristic';
    } else {
      draftBody = streamed.text;
      backend = 'dsh-llm';
    }
  } else {
    draftBody = mockDraftFromBrief(note.text);
  }

  if (hasPendingMarker(draftBody)) {
    // harden: never land a pending marker in the proposed note
    draftBody = mockDraftFromBrief(note.text);
    backend = mockStyle ? deps.backend || 'mock' : 'heuristic';
  }
  if (hasPendingMarker(draftBody)) {
    draftBody = draftBody.split(PENDING_MARKER).join('');
  }

  const title = extractNoteTitle(draftBody, extractNoteTitle(note.text, 'draft'));
  const rel = draftRelForSlug(title);
  const created = deps.proposeCreate
    ? deps.proposeCreate(vaultRoot, rel, draftBody, `公众号成稿 ${rel}`)
    : proposeCreate(vaultRoot, rel, draftBody, `公众号成稿 ${rel}`);
  if (!created.ok) return { ...created, viaSkills: true, skill: 'wechatDraft' };

  return {
    ok: true,
    answer: mockStyle
      ? `（模拟）将根据 Brief \`${note.rel}\` 在 \`${rel}\` 新建成稿。确认 Apply 后才会落盘。成品不含 ${PENDING_MARKER}。`
      : `将在 \`${rel}\` 新建成稿（来自 \`${note.rel}\`）。确认 Apply 后才会落盘。`,
    citations: [note.rel],
    proposals: [created.proposal],
    viaSkills: true,
    skill: 'wechatDraft',
    backend,
  };
}

/**
 * From a draft under drafts/ → propose titles note under review/.
 */
export async function runWechatTitles(
  deps: WechatSkillDeps,
  { vaultRoot, draftRel }: { vaultRoot: string; draftRel: string },
): Promise<WechatSkillResult> {
  const hasKey = resolveHasKey(deps);
  const mockStyle = isMockStyle(deps);
  const note = readNote(deps, vaultRoot, draftRel);
  if (!note.ok) return { ...note, viaSkills: true, skill: 'wechatTitles' };
  if (!underDir(note.rel, WECHAT_OA.drafts)) {
    return {
      ok: false,
      error: `请选择成稿（${WECHAT_OA.drafts}/）：${note.rel}`,
      viaSkills: true,
      skill: 'wechatTitles',
    };
  }

  let titlesBody = '';
  let backend = mockStyle ? deps.backend || 'mock' : 'dsh-llm';

  if (hasKey && typeof deps.streamText === 'function' && !mockStyle) {
    const streamed = await deps.streamText({
      system: WECHAT_TITLES_SYSTEM,
      user: `请为下列成稿起标题候选表。\n\n成稿路径：${note.rel}\n\n---\n${note.text.slice(0, 8000)}`,
      provider: deps.provider || 'deepseek-official',
    });
    if (!streamed.ok) {
      if (isPrivacyFailure(streamed)) return { ...streamed, viaSkills: true, skill: 'wechatTitles' };
      titlesBody = mockTitlesFromDraft(note.text);
      backend = 'heuristic';
    } else {
      titlesBody = streamed.text;
    }
  } else {
    titlesBody = mockTitlesFromDraft(note.text);
  }

  const title = extractNoteTitle(note.text, path.basename(note.rel, '.md'));
  const rel = titlesRelForSlug(title);
  const created = deps.proposeCreate
    ? deps.proposeCreate(vaultRoot, rel, titlesBody, `公众号标题 ${rel}`)
    : proposeCreate(vaultRoot, rel, titlesBody, `公众号标题 ${rel}`);
  if (!created.ok) return { ...created, viaSkills: true, skill: 'wechatTitles' };

  return {
    ok: true,
    answer: mockStyle
      ? `（模拟）将在 \`${rel}\` 新建标题候选。确认 Apply 后才会落盘。`
      : `将在 \`${rel}\` 新建标题候选（来自 \`${note.rel}\`）。确认 Apply 后才会落盘。`,
    citations: [note.rel],
    proposals: [created.proposal],
    viaSkills: true,
    skill: 'wechatTitles',
    backend,
  };
}

/**
 * From a draft → write layout HTML via desktop local tool (not propose into 90-附件).
 */
export async function runWechatLayout(
  deps: WechatSkillDeps,
  { vaultRoot, draftRel, title }: { vaultRoot: string; draftRel: string; title?: string },
): Promise<WechatSkillResult> {
  const note = readNote(deps, vaultRoot, draftRel);
  if (!note.ok) return { ...note, viaSkills: true, skill: 'wechatLayout' };
  if (!underDir(note.rel, WECHAT_OA.drafts)) {
    return {
      ok: false,
      error: `请选择成稿（${WECHAT_OA.drafts}/）：${note.rel}`,
      viaSkills: true,
      skill: 'wechatLayout',
    };
  }
  if (typeof deps.writeLayout !== 'function') {
    return {
      ok: false,
      error: '布局本地工具不可用（writeLayout）',
      viaSkills: true,
      skill: 'wechatLayout',
    };
  }

  const heading = (title && String(title).trim()) || extractNoteTitle(note.text, path.basename(note.rel, '.md'));
  const html = renderWechatLayoutHtml({ title: heading, markdown: note.text, style: 'OpenAI' });
  const rel = layoutRelForSlug(slugify(heading) || path.basename(note.rel, '.md'));
  const written = deps.writeLayout(vaultRoot, rel, html);
  if (!written.ok) return { ...written, viaSkills: true, skill: 'wechatLayout' };

  return {
    ok: true,
    answer:
      `已由桌面本地工具写入排版预览 \`${written.path}\`（非拟改动、非模型直写 90-附件）。`
      + `用浏览器打开后点「复制到公众号」。不含自动发布。`,
    citations: [note.rel],
    proposals: [],
    viaSkills: true,
    skill: 'wechatLayout',
    layoutPath: written.path,
    backend: 'local-tool',
  };
}
