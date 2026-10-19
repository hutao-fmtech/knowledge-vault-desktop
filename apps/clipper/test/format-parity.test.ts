import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as pkg from '@kvd/clipper';
import {
  allocateUniqueClipFilename,
  clipFilenameBase,
  sanitizeClipTitle,
} from '../extension/modules/filename.js';
import { formatClipMarkdown, formatClippedAt } from '../extension/modules/format.js';
import { CLIP_INBOX_DIR } from '../extension/modules/constants.js';

test('extension modules stay in parity with @kvd/clipper format/filename', () => {
  assert.equal(CLIP_INBOX_DIR, pkg.CLIP_INBOX_DIR);
  const d = new Date('2026-10-19T12:00:00+08:00');
  assert.equal(sanitizeClipTitle('Hello / World'), pkg.sanitizeClipTitle('Hello / World'));
  assert.equal(clipFilenameBase('Demo', d), pkg.clipFilenameBase('Demo', d));
  assert.equal(
    allocateUniqueClipFilename('Demo', ['2026-10-19-Demo.md'], d),
    pkg.allocateUniqueClipFilename('Demo', ['2026-10-19-Demo.md'], d),
  );
  const payload = {
    sourceUrl: 'https://ex.test/a?q="1"',
    pageTitle: 'T "x"',
    clippedAt: '2026-10-19T12:00:00+08:00',
    quote: 'a\nb',
    annotation: 'note',
  };
  assert.equal(formatClipMarkdown(payload), pkg.formatClipMarkdown(payload));
  // Same clock → same offset formatting rules
  const now = new Date('2026-10-19T04:00:00.000Z');
  assert.equal(formatClippedAt(now), pkg.formatClippedAt(now));
});
