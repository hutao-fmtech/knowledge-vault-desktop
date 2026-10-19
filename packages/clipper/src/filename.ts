/**
 * Sanitize a page title for use in a clip filename (cross-platform safe).
 * Keeps CJK; strips path separators and reserved punctuation; spaces → `-`.
 */
export function sanitizeClipTitle(raw: unknown, maxLen = 60): string {
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

/** Local calendar date YYYY-MM-DD from a Date. */
export function localDateStamp(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Base filename (no uniqueness suffix): `{YYYY-MM-DD}-{sanitized-title}.md`
 */
export function clipFilenameBase(pageTitle: unknown, date: Date = new Date()): string {
  return `${localDateStamp(date)}-${sanitizeClipTitle(pageTitle)}.md`;
}

/**
 * Pick a filename that does not collide with `existingNames` (case-sensitive).
 * First try base; then `stem-2.md`, `stem-3.md`, …
 */
export function allocateUniqueClipFilename(
  pageTitle: unknown,
  existingNames: ReadonlySet<string> | readonly string[],
  date: Date = new Date(),
): string {
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
