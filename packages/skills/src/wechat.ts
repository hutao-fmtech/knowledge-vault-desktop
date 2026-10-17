/**
 * W2/W3 WeChat OA flows: Brief → draft → titles → layout HTML → copy / publish-archive.
 * Notes (drafts/titles/archive) go through proposal → Apply.
 * Layout HTML is written/read only via desktop local tools (90-附件).
 * Copy uses clipboard in the desktop main process (no WeChat login).
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
  publishedRelForSlug,
  withPublishedMark,
  extractPasteableHtml,
  htmlToPlainText,
  slugify,
} from '@kvd/skills-core';
import { readWechatLayoutHtml } from '@kvd/vault';
import { proposeEdit } from '@kvd/proposals';
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
  proposeEdit?: (vaultRoot: string, rel: string, content: string, summary?: string) => ProposeResult;
  streamText?: (opts: { system: string; user: string; provider?: string; model?: string }) => Promise<StreamTextResult>;
}

export type WechatSkillName = 'wechatDraft' | 'wechatTitles' | 'wechatLayout' | 'wechatCopyHtml' | 'wechatPublish' | 'wechatPreview';

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
  /** Layout HTML vault-relative path when written/read by local tool. */
  layoutPath?: string;
  /** Absolute path for opening local preview. */
  layoutAbs?: string;
  /** Pasteable HTML for clipboard (desktop copies; smoke asserts content). */
  html?: string;
  /** Plain-text clipboard companion. */
  text?: string;
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


function layoutRelFromDraft(
  deps: WechatBaseDeps,
  vaultRoot: string,
  draftRel: string,
): { ok: true; draftRel: string; layoutRel: string; title: string } | { ok: false; error: string } {
  const note = readNote(deps, vaultRoot, draftRel);
  if (!note.ok) return note;
  if (!underDir(note.rel, WECHAT_OA.drafts)) {
    return { ok: false, error: `请选择成稿（${WECHAT_OA.drafts}/）：${note.rel}` };
  }
  const title = extractNoteTitle(note.text, path.basename(note.rel, '.md'));
  const layoutRel = layoutRelForSlug(slugify(title) || path.basename(note.rel, '.md'));
  return { ok: true, draftRel: note.rel, layoutRel, title };
}

/**
 * W3 — resolve layout HTML for one-click clipboard copy (desktop writes clipboard).
 * Smoke/unit tests assert html/path; clipboard is Electron-only.
 */
export async function runWechatCopyHtml(
  deps: WechatSkillDeps,
  {
    vaultRoot,
    draftRel,
    layoutRel,
  }: { vaultRoot: string; draftRel?: string; layoutRel?: string },
): Promise<WechatSkillResult> {
  let rel = layoutRel ? String(layoutRel).replace(/\\/g, '/') : '';
  const citations: string[] = [];
  if (!rel) {
    if (!draftRel) {
      return {
        ok: false,
        error: '请提供成稿路径或布局路径',
        viaSkills: true,
        skill: 'wechatCopyHtml',
      };
    }
    const derived = layoutRelFromDraft(deps, vaultRoot, draftRel);
    if (!derived.ok) return { ...derived, viaSkills: true, skill: 'wechatCopyHtml' };
    rel = derived.layoutRel;
    citations.push(derived.draftRel);
  }
  const read = readWechatLayoutHtml(vaultRoot, rel);
  if (!read.ok) return { ...read, viaSkills: true, skill: 'wechatCopyHtml' };
  const paste = extractPasteableHtml(read.html);
  const text = htmlToPlainText(paste);
  return {
    ok: true,
    answer: `已准备排版 HTML（\`${read.path}\`），可粘贴到微信公众号编辑器。不含自动发布、不登录微信。`,
    citations,
    proposals: [],
    viaSkills: true,
    skill: 'wechatCopyHtml',
    layoutPath: read.path,
    layoutAbs: read.abs,
    html: paste,
    text,
    backend: 'local-tool',
  };
}

/**
 * W3 — mark published (frontmatter) + archive to 05-归档/公众号/ via proposal → Apply.
 * Emits edit then move; Apply both in order. No silent fs move.
 */
export async function runWechatPublish(
  deps: WechatSkillDeps,
  { vaultRoot, draftRel, publishedAt }: { vaultRoot: string; draftRel: string; publishedAt?: string },
): Promise<WechatSkillResult> {
  const note = readNote(deps, vaultRoot, draftRel);
  if (!note.ok) return { ...note, viaSkills: true, skill: 'wechatPublish' };
  if (!underDir(note.rel, WECHAT_OA.drafts)) {
    return {
      ok: false,
      error: `请选择成稿（${WECHAT_OA.drafts}/）：${note.rel}`,
      viaSkills: true,
      skill: 'wechatPublish',
    };
  }

  const marked = withPublishedMark(note.text, publishedAt);
  const title = extractNoteTitle(note.text, path.basename(note.rel, '.md'));
  const destRel = publishedRelForSlug(slugify(title) || path.basename(note.rel, '.md'));

  const editFn = deps.proposeEdit || proposeEdit;
  const edited = editFn(vaultRoot, note.rel, marked, `标记已发布 ${note.rel}`);
  if (!edited.ok) return { ...edited, viaSkills: true, skill: 'wechatPublish' };

  const moved = deps.proposeMove(vaultRoot, note.rel, destRel, `归档到 ${WECHAT_OA.published}/`);
  if (!moved.ok) return { ...moved, viaSkills: true, skill: 'wechatPublish' };

  return {
    ok: true,
    answer:
      `将标记 \`${note.rel}\` 为已发布并归档到 \`${destRel}\`（拟改动：编辑 frontmatter → 移动）。` +
      `确认 Apply 后才会落盘。不登录微信、不自动群发。`,
    citations: [note.rel],
    proposals: [edited.proposal, moved.proposal],
    viaSkills: true,
    skill: 'wechatPublish',
    backend: 'local-tool',
  };
}

/**
 * W3 — optional local preview: resolve layout abs path for shell.openPath.
 */
export async function runWechatPreview(
  deps: WechatSkillDeps,
  { vaultRoot, draftRel, layoutRel }: { vaultRoot: string; draftRel?: string; layoutRel?: string },
): Promise<WechatSkillResult> {
  let rel = layoutRel ? String(layoutRel).replace(/\\/g, '/') : '';
  const citations: string[] = [];
  if (!rel) {
    if (!draftRel) {
      return {
        ok: false,
        error: '请提供成稿路径或布局路径',
        viaSkills: true,
        skill: 'wechatPreview',
      };
    }
    const derived = layoutRelFromDraft(deps, vaultRoot, draftRel);
    if (!derived.ok) return { ...derived, viaSkills: true, skill: 'wechatPreview' };
    rel = derived.layoutRel;
    citations.push(derived.draftRel);
  }
  const read = readWechatLayoutHtml(vaultRoot, rel);
  if (!read.ok) return { ...read, viaSkills: true, skill: 'wechatPreview' };
  return {
    ok: true,
    answer: `本地预览：\`${read.path}\`（用系统浏览器打开）。不含自动发布。`,
    citations,
    proposals: [],
    viaSkills: true,
    skill: 'wechatPreview',
    layoutPath: read.path,
    layoutAbs: read.abs,
    backend: 'local-tool',
  };
}
