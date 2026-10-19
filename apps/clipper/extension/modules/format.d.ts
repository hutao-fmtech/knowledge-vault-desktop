export function yamlDoubleQuoted(value: unknown): string;
export function yamlLiteralBlock(value: unknown, indent?: number): string;
export function formatClipMarkdown(clip: {
  sourceUrl: string;
  pageTitle: string;
  clippedAt: string;
  quote: string;
  annotation: string;
}): string;
export function formatClippedAt(date?: Date): string;
