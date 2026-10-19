import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CLIP_INBOX_DIR,
  allocateUniqueClipFilename,
  assertClipInboxRel,
  clipFilenameBase,
  formatClipMarkdown,
  formatClippedAt,
  sanitizeClipTitle,
  writeClipToInbox,
} from '../src/index.js';

test('sanitizeClipTitle strips path chars and keeps CJK', () => {
  assert.equal(sanitizeClipTitle('Hello / World: "x"'), 'Hello-World-x');
  assert.equal(sanitizeClipTitle('  知识库 笔记  '), '知识库-笔记');
  assert.equal(sanitizeClipTitle(''), 'untitled');
  assert.equal(sanitizeClipTitle('a'.repeat(100)).length <= 60, true);
});

test('allocateUniqueClipFilename never reuses an existing name', () => {
  const d = new Date('2026-10-19T12:00:00+08:00');
  const base = clipFilenameBase('Demo Title', d);
  assert.equal(base, '2026-10-19-Demo-Title.md');
  assert.equal(allocateUniqueClipFilename('Demo Title', [], d), base);
  assert.equal(
    allocateUniqueClipFilename('Demo Title', new Set([base]), d),
    '2026-10-19-Demo-Title-2.md',
  );
  assert.equal(
    allocateUniqueClipFilename('Demo Title', new Set([base, '2026-10-19-Demo-Title-2.md']), d),
    '2026-10-19-Demo-Title-3.md',
  );
});

test('formatClipMarkdown frontmatter + body contract', () => {
  const md = formatClipMarkdown({
    sourceUrl: 'https://example.com/a?q="x"',
    pageTitle: 'Title with "quotes"',
    clippedAt: '2026-10-19T09:14:58+08:00',
    quote: 'line1\nline2',
    annotation: 'my note',
  });
  assert.match(md, /^---\n/);
  assert.match(md, /source_url: "https:\/\/example\.com\/a\?q=\\"x\\""/);
  assert.match(md, /page_title: "Title with \\"quotes\\""/);
  assert.match(md, /clipped_at: "2026-10-19T09:14:58\+08:00"/);
  assert.match(md, /quote: \|\n {2}line1\n {2}line2\n/);
  assert.match(md, /annotation: \|\n {2}my note\n/);
  assert.match(md, /tags: \[clip\]\n---\n/);
  assert.match(md, /> line1\n> line2\n\nmy note\n$/);
});

test('formatClippedAt includes numeric timezone offset', () => {
  const s = formatClippedAt(new Date('2026-10-19T01:14:58.000Z'));
  assert.match(s, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
});

test('assertClipInboxRel only allows 01-收件箱', () => {
  assert.equal(assertClipInboxRel('01-收件箱/x.md').ok, true);
  assert.equal(assertClipInboxRel('02-项目/x.md').ok, false);
  assert.equal(assertClipInboxRel('01-收件箱/../02-项目/x.md').ok, false);
});

test('writeClipToInbox writes only under 01-收件箱 with frontmatter; no overwrite', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kvd-clip-'));
  try {
    fs.mkdirSync(path.join(root, CLIP_INBOX_DIR), { recursive: true });
    fs.mkdirSync(path.join(root, '02-项目'), { recursive: true });
    const now = new Date('2026-10-19T12:00:00+08:00');
    const r1 = writeClipToInbox(root, {
      sourceUrl: 'https://example.com/post',
      pageTitle: 'Example Post',
      quote: 'selected text',
      annotation: 'anno',
      clippedAt: '2026-10-19T12:00:00+08:00',
      now,
    });
    assert.equal(r1.ok, true);
    if (!r1.ok) return;
    assert.equal(r1.path, '01-收件箱/2026-10-19-Example-Post.md');
    assert.equal(r1.abs.startsWith(path.join(root, CLIP_INBOX_DIR)), true);
    const text = fs.readFileSync(r1.abs, 'utf8');
    assert.match(text, /source_url: "https:\/\/example\.com\/post"/);
    assert.match(text, /page_title: "Example Post"/);
    assert.match(text, /clipped_at: "2026-10-19T12:00:00\+08:00"/);
    assert.match(text, /tags: \[clip\]/);
    assert.match(text, /> selected text/);
    assert.match(text, /anno/);

    // Second clip with same title → unique suffix, no overwrite
    const r2 = writeClipToInbox(root, {
      sourceUrl: 'https://example.com/post',
      pageTitle: 'Example Post',
      quote: 'other',
      now,
    });
    assert.equal(r2.ok, true);
    if (!r2.ok) return;
    assert.equal(r2.filename, '2026-10-19-Example-Post-2.md');
    assert.equal(fs.readFileSync(r1.abs, 'utf8'), text);

    // Nothing written outside inbox
    const projectFiles = fs.readdirSync(path.join(root, '02-项目'));
    assert.deepEqual(projectFiles, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
