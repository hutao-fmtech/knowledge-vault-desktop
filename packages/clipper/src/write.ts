import fs from 'node:fs';
import path from 'node:path';
import { resolveVaultPath } from '@kvd/vault';
import { CLIP_INBOX_DIR } from './constants.js';
import { allocateUniqueClipFilename } from './filename.js';
import { formatClipMarkdown, formatClippedAt, type ClipPayload } from './format.js';

export interface WriteClipInput {
  sourceUrl: string;
  pageTitle: string;
  quote: string;
  annotation?: string;
  /** Override clipped_at (tests); default = now with local TZ offset. */
  clippedAt?: string;
  /** Override clock for filename date (tests). */
  now?: Date;
}

export type WriteClipResult =
  | { ok: true; path: string; abs: string; filename: string; markdown: string }
  | { ok: false; error: string };

/**
 * Ensure rel stays under `01-收件箱/` (no nested escape to other vault tops).
 */
export function assertClipInboxRel(rel: string): { ok: true } | { ok: false; error: string } {
  const norm = rel.replace(/\\/g, '/').replace(/^\/+/, '');
  if (norm !== CLIP_INBOX_DIR && !norm.startsWith(`${CLIP_INBOX_DIR}/`)) {
    return { ok: false, error: `clip 仅允许写入 ${CLIP_INBOX_DIR}/` };
  }
  if (norm.split('/').some((p) => p === '..')) {
    return { ok: false, error: '禁止 .. 穿越' };
  }
  return { ok: true };
}

/**
 * Write one clip Markdown file into `{vault}/01-收件箱/`. Never overwrites.
 * Uses `@kvd/vault` resolveVaultPath so absolute/`..`/forbidden tops are rejected.
 */
export function writeClipToInbox(vaultRoot: string, input: WriteClipInput): WriteClipResult {
  if (!vaultRoot || typeof vaultRoot !== 'string') {
    return { ok: false, error: '未打开 vault' };
  }
  const now = input.now ?? new Date();
  const inboxAbs = path.join(path.resolve(vaultRoot), CLIP_INBOX_DIR);
  try {
    fs.mkdirSync(inboxAbs, { recursive: true });
  } catch (err) {
    return { ok: false, error: `无法创建收件箱：${(err as Error).message}` };
  }

  let existing: string[];
  try {
    existing = fs.readdirSync(inboxAbs);
  } catch (err) {
    return { ok: false, error: `无法读取收件箱：${(err as Error).message}` };
  }

  const filename = allocateUniqueClipFilename(input.pageTitle, existing, now);
  const rel = `${CLIP_INBOX_DIR}/${filename}`;
  const inboxGuard = assertClipInboxRel(rel);
  if (!inboxGuard.ok) return inboxGuard;

  const resolved = resolveVaultPath(vaultRoot, rel);
  if (!resolved.ok) return resolved;

  // Belt-and-suspenders: resolved path must still be under inbox on disk.
  const relPosix = resolved.rel.replace(/\\/g, '/');
  const stillInbox = assertClipInboxRel(relPosix);
  if (!stillInbox.ok) return stillInbox;

  if (fs.existsSync(resolved.abs)) {
    return { ok: false, error: `目标已存在，拒绝覆盖：${resolved.rel}` };
  }

  const payload: ClipPayload = {
    sourceUrl: input.sourceUrl == null ? '' : String(input.sourceUrl),
    pageTitle: input.pageTitle == null ? '' : String(input.pageTitle),
    clippedAt: input.clippedAt ?? formatClippedAt(now),
    quote: input.quote == null ? '' : String(input.quote),
    annotation: input.annotation == null ? '' : String(input.annotation),
  };
  const markdown = formatClipMarkdown(payload);

  try {
    const dir = path.dirname(resolved.abs);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `.${path.basename(resolved.abs)}.${process.pid}.tmp`);
    fs.writeFileSync(tmp, markdown, 'utf8');
    fs.renameSync(tmp, resolved.abs);
    return { ok: true, path: resolved.rel, abs: resolved.abs, filename, markdown };
  } catch (err) {
    return { ok: false, error: `写入失败：${(err as Error).message}` };
  }
}
