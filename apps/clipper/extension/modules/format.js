import { CLIP_TAG } from './constants.js';

/** @param {unknown} value */
export function yamlDoubleQuoted(value) {
  const s = value == null ? '' : String(value);
  return `"${s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r\n/g, '\n')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\n')}"`;
}

/** @param {unknown} value @param {number} [indent] */
export function yamlLiteralBlock(value, indent = 2) {
  const pad = ' '.repeat(indent);
  const raw = value == null ? '' : String(value);
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.length ? normalized.split('\n') : [''];
  return `${lines.map((line) => `${pad}${line}`).join('\n')}\n`;
}

/**
 * @param {{ sourceUrl: string, pageTitle: string, clippedAt: string, quote: string, annotation: string }} clip
 */
export function formatClipMarkdown(clip) {
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

/** @param {Date} [date] */
export function formatClippedAt(date = new Date()) {
  const pad = (n, w = 2) => String(Math.trunc(Math.abs(n))).padStart(w, '0');
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
