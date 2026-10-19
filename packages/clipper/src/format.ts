import { CLIP_TAG } from './constants.js';

export interface ClipPayload {
  sourceUrl: string;
  pageTitle: string;
  clippedAt: string;
  quote: string;
  annotation: string;
}

/** Escape a YAML double-quoted scalar (single-line fields). */
export function yamlDoubleQuoted(value: unknown): string {
  const s = value == null ? '' : String(value);
  return `"${s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r\n/g, '\n')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\n')}"`;
}

/**
 * Emit indented lines for a YAML literal block scalar (|), without the `|` marker.
 * Always ends with a newline so the next frontmatter key starts on its own line.
 */
export function yamlLiteralBlock(value: unknown, indent = 2): string {
  const pad = ' '.repeat(indent);
  const raw = value == null ? '' : String(value);
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.length ? normalized.split('\n') : [''];
  return `${lines.map((line) => `${pad}${line}`).join('\n')}\n`;
}

/**
 * Build Obsidian-friendly Markdown: YAML frontmatter + blockquote body + annotation.
 *
 * Frontmatter keys (locked by AC): source_url, page_title, clipped_at, quote, annotation, tags: [clip]
 */
export function formatClipMarkdown(clip: ClipPayload): string {
  const quote = clip.quote == null ? '' : String(clip.quote);
  const annotation = clip.annotation == null ? '' : String(clip.annotation);

  const fm =
    '---\n' +
    `source_url: ${yamlDoubleQuoted(clip.sourceUrl)}\n` +
    `page_title: ${yamlDoubleQuoted(clip.pageTitle)}\n` +
    `clipped_at: ${yamlDoubleQuoted(clip.clippedAt)}\n` +
    'quote: |\n' +
    yamlLiteralBlock(quote) +
    'annotation: |\n' +
    yamlLiteralBlock(annotation) +
    `tags: [${CLIP_TAG}]\n` +
    '---\n\n';

  const quoteLines = quote.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const blockquote = quoteLines.map((line) => `> ${line}`).join('\n');
  let body = blockquote;
  const ann = annotation.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (ann.trim()) {
    body += `\n\n${ann}`;
  }
  return `${fm}${body}\n`;
}

/**
 * Format clipped_at with numeric timezone offset (e.g. 2026-10-19T09:14:58+08:00).
 */
export function formatClippedAt(date: Date = new Date()): string {
  const pad = (n: number, w = 2) => String(Math.trunc(Math.abs(n))).padStart(w, '0');
  const y = date.getFullYear();
  const mo = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const mi = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const oh = pad(Math.floor(Math.abs(offsetMin) / 60));
  const om = pad(Math.abs(offsetMin) % 60);
  return `${y}-${mo}-${d}T${h}:${mi}:${s}${sign}${oh}:${om}`;
}
