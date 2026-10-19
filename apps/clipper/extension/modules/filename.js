/** @param {unknown} raw @param {number} [maxLen] */
export function sanitizeClipTitle(raw, maxLen = 60) {
  let s = raw == null ? '' : String(raw);
  s = s.normalize('NFKC').trim();
  s = s.replace(/[\u0000-\u001f\u007f]/g, '');
  s = s.replace(/[\\/:*?"<>|]/g, '');
  s = s.replace(/\s+/g, '-');
  s = s.replace(/-+/g, '-');
  s = s.replace(/^[-.]+|[-.]+$/g, '');
  if (!s) s = 'untitled';
  if (s.length > maxLen) s = s.slice(0, maxLen).replace(/[-.]+$/g, '') || 'untitled';
  return s;
}

/** @param {Date} [date] */
export function localDateStamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** @param {unknown} pageTitle @param {Date} [date] */
export function clipFilenameBase(pageTitle, date = new Date()) {
  return `${localDateStamp(date)}-${sanitizeClipTitle(pageTitle)}.md`;
}

/**
 * @param {unknown} pageTitle
 * @param {ReadonlySet<string>|string[]} existingNames
 * @param {Date} [date]
 */
export function allocateUniqueClipFilename(pageTitle, existingNames, date = new Date()) {
  const existing = existingNames instanceof Set ? existingNames : new Set(existingNames);
  const base = clipFilenameBase(pageTitle, date);
  if (!existing.has(base)) return base;
  const stem = base.replace(/\.md$/i, '');
  for (let i = 2; i < 10_000; i += 1) {
    const candidate = `${stem}-${i}.md`;
    if (!existing.has(candidate)) return candidate;
  }
  return `${stem}-${Date.now()}.md`;
}
