/**
 * AL-6: daily report rebuilt purely from JSONL — deterministic, no wikilinks,
 * empty → null. AL-8: paths stay `/`; day keys use UTC+8.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildDailyReport,
  reportAbsPath,
  reportRelPath,
  writeDailyReport,
  yesterdayKey,
  REPORT_DIR_REL,
  REPORT_KIND,
} from '../src/report.js';
import type { AgentLogRecord } from '../src/index.js';
import { dayKey } from '../src/index.js';

const CST = 480;

function rec(partial: Partial<AgentLogRecord> & Pick<AgentLogRecord, 'ev' | 'ts'>): AgentLogRecord {
  return { v: 1, ...partial };
}

test('AL-6: empty events → null (do not write)', () => {
  assert.equal(buildDailyReport('2026-10-22', []), null);
  assert.equal(buildDailyReport('not-a-day', [rec({ ev: 'pause.on', ts: '2026-10-22T09:00:00.000+08:00' })]), null);
});

test('AL-6: same input twice → byte-identical; no [[wikilinks]]; paths use /', () => {
  const events: AgentLogRecord[] = [
    rec({
      ev: 'proposal.applied',
      ts: '2026-10-22T10:00:00.000+08:00',
      id: 'chg_2',
      kind: 'edit',
      path: '03-领域/财务规划/a.md',
      origin: 'skill:makeCard',
      actor: 'user',
      initiator: 'agent',
    }),
    rec({
      ev: 'proposal.created',
      ts: '2026-10-22T09:00:00.000+08:00',
      id: 'chg_1',
      kind: 'create',
      path: '01-收件箱/待处理/x.md',
      origin: 'skill:sortInbox',
      actor: 'agent',
      initiator: 'agent',
    }),
    rec({
      ev: 'proposal.created',
      ts: '2026-10-22T09:30:00.000+08:00',
      id: 'chg_2',
      kind: 'edit',
      path: '03-领域/财务规划/a.md',
      origin: 'skill:makeCard',
      actor: 'agent',
      initiator: 'agent',
    }),
    rec({
      ev: 'proposal.apply_failed',
      ts: '2026-10-22T10:05:00.000+08:00',
      id: 'chg_3',
      kind: 'edit',
      path: 'notes\\win\\path.md',
      origin: 'agent-advanced:vault_propose_change',
      actor: 'user',
      error: 'stale',
      stale: true,
    }),
    rec({
      ev: 'proposal.rejected',
      ts: '2026-10-22T11:00:00.000+08:00',
      id: 'chg_4',
      kind: 'move',
      from: '01-收件箱/a.md',
      to: '02-项目/a.md',
      origin: 'skill:sortInbox',
      actor: 'user',
    }),
    rec({
      ev: 'proposal.expired',
      ts: '2026-10-22T12:00:00.000+08:00',
      id: 'chg_5',
      kind: 'create',
      path: '10-卡片盒/gone.md',
      origin: 'skill:makeCard',
      actor: 'system',
    }),
    rec({
      ev: 'apply.verify_failed',
      ts: '2026-10-22T10:06:00.000+08:00',
      id: 'chg_6',
      kind: 'create',
      path: '10-卡片盒/v.md',
      origin: 'skill:makeCard',
      actor: 'user',
      error: 'verify_failed',
    }),
    rec({ ev: 'pause.on', ts: '2026-10-22T08:00:00.000+08:00', origin: 'desktop', actor: 'user' }),
    rec({ ev: 'pause.off', ts: '2026-10-22T08:05:00.000+08:00', origin: 'desktop', actor: 'user' }),
  ];
  // Shuffle to prove sort is deterministic
  const shuffled = [...events].reverse();
  const a = buildDailyReport('2026-10-22', shuffled);
  const b = buildDailyReport('2026-10-22', events);
  assert.ok(a && b);
  assert.equal(a, b, 'byte-identical across input order');
  assert.ok(!a.includes('[['), 'no wikilinks');
  assert.ok(!a.includes(']]'), 'no wikilinks');
  assert.match(a, /^---\nkvd: agent-report\ndate: 2026-10-22\n---\n/);
  assert.equal(REPORT_KIND, 'agent-report');
  assert.match(a, /\| `skill:makeCard` \| 1 \| 1 \| 0 \| 1 \| 1 \|/);
  assert.match(a, /\| `skill:sortInbox` \| 1 \| 0 \| 1 \| 0 \| 0 \|/);
  assert.match(a, /\| `agent-advanced:vault_propose_change` \| 0 \| 0 \| 0 \| 0 \| 1 \|/);
  assert.match(a, /`notes\/win\/path\.md`/, 'backslash normalised to /');
  assert.ok(!a.includes('notes\\win'), 'no raw backslash paths');
  assert.match(a, /`01-收件箱\/a\.md` → `02-项目\/a\.md`/);
  assert.match(a, /\| 08:00:00 \| `desktop` \| 暂停写入 \| — \|/);
  assert.match(a, /\| 09:00:00 \| `skill:sortInbox` \| 提出 \|/);
  // Chronological: pause.on first
  assert.ok(a.indexOf('08:00:00') < a.indexOf('09:00:00'));
  assert.equal(reportRelPath('2026-10-22'), '00-系统/agent-日报/2026-10-22.md');
  assert.equal(REPORT_DIR_REL, '00-系统/agent-日报');
});

test('AL-6: writeDailyReport atomic; empty build skips write', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kvd-report-'));
  assert.equal(buildDailyReport('2026-10-22', []), null);
  const md = buildDailyReport('2026-10-22', [
    rec({ ev: 'pause.on', ts: '2026-10-22T09:00:00.000+08:00', origin: 'desktop', actor: 'user' }),
  ]);
  assert.ok(md);
  const w = writeDailyReport(root, '2026-10-22', md!);
  assert.equal(w.ok, true);
  assert.ok(w.ok && fs.readFileSync(w.abs, 'utf8') === md);
  assert.equal(reportAbsPath(root, '2026-10-22'), path.join(root, '00-系统', 'agent-日报', '2026-10-22.md'));
  // overwrite is idempotent (same bytes)
  assert.equal(writeDailyReport(root, '2026-10-22', md!).ok, true);
  assert.equal(fs.readFileSync(path.join(root, '00-系统', 'agent-日报', '2026-10-22.md'), 'utf8'), md);
});

test('AL-8: yesterdayKey / dayKey use UTC+8 across midnight', () => {
  // 2026-10-21 23:30 +08:00 = 2026-10-21T15:30:00Z → yesterday of "now" at 00:30+08 on Oct 22
  const now = new Date('2026-10-21T16:30:00.000Z'); // 2026-10-22 00:30 +08
  assert.equal(dayKey(now, CST), '2026-10-22');
  assert.equal(yesterdayKey(now, CST), '2026-10-21');
  // Just before +08 midnight
  assert.equal(dayKey(new Date('2026-10-21T15:59:59.000Z'), CST), '2026-10-21');
  assert.equal(dayKey(new Date('2026-10-21T16:00:00.000Z'), CST), '2026-10-22');
});
