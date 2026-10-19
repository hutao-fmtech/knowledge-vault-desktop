export function sanitizeClipTitle(raw: unknown, maxLen?: number): string;
export function localDateStamp(date?: Date): string;
export function clipFilenameBase(pageTitle: unknown, date?: Date): string;
export function allocateUniqueClipFilename(
  pageTitle: unknown,
  existingNames: ReadonlySet<string> | readonly string[],
  date?: Date,
): string;
