/**
 * AL-6 catch-up + generateToday via the Cordis plugin (writes into 00-系统/,
 * never throws; agent still cannot resolve those paths).
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import AgentLogService from '../src/plugin.js';
import { resolveVaultPath, isReadableRel } from '@kvd/vault';
import { reportAbsPath } from '../src/report.js';

async function setup(now: Date) {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'kvd-rpt-'));
  const ctx = new Context();
  const deviceIdFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kvd-rptc-')), 'id');
  ctx.plugin(AgentLogService, { deviceIdFile, utcOffsetMinutes: 480 });
  await new Promise((r) => setTimeout(r, 0));
  const agentLog = ctx.get('agentLog')!;
  agentLog.setNowForTests(() => now);
  return { vault, ctx, agentLog };
}

test('AL-6: generateToday writes report; empty day does not; overwrite idempotent', async () => {
  const now = new Date('2026-10-22T04:00:00.000Z'); // 12:00 +08
  const { vault, agentLog } = await setup(now);
  const empty = agentLog.generateToday(vault);
  assert.equal(empty.ok && empty.empty, true);
  assert.ok(!fs.existsSync(reportAbsPath(vault, '2026-10-22')));

  agentLog.append(vault, {
    ev: 'proposal.created',
    id: 'chg_1',
    kind: 'create',
    path: '01-收件箱/a.md',
    origin: 'skill:makeCard',
    actor: 'agent',
    initiator: 'agent',
  });
  const a = agentLog.generateToday(vault);
  assert.ok(a.ok && !a.empty && a.rel === '00-系统/agent-日报/2026-10-22.md');
  const body = fs.readFileSync(a.abs!, 'utf8');
  assert.match(body, /kvd: agent-report/);
  assert.ok(!body.includes('[['));
  const b = agentLog.generateToday(vault);
  assert.equal(b.ok && !b.empty && fs.readFileSync(b.abs!, 'utf8'), body);

  // Agent cannot read/write the report path (AL-4 still holds).
  assert.equal(isReadableRel('00-系统/agent-日报/2026-10-22.md'), false);
  assert.equal(resolveVaultPath(vault, '00-系统/agent-日报/2026-10-22.md').ok, false);
});

test('AL-6: catchUpYesterday writes missing yesterday report on vault open; skips if present or empty', async () => {
  // "now" = 2026-10-22 01:00 +08 → yesterday = 2026-10-21
  const now = new Date('2026-10-21T17:00:00.000Z');
  const { vault, ctx, agentLog } = await setup(now);

  // Seed yesterday's JSONL by temporarily freezing "now" to yesterday afternoon.
  agentLog.setNowForTests(() => new Date('2026-10-21T06:00:00.000Z')); // 14:00 +08 on Oct 21
  agentLog.append(vault, {
    ev: 'proposal.applied',
    id: 'chg_y',
    kind: 'edit',
    path: '10-卡片盒/y.md',
    origin: 'skill:makeCard',
    actor: 'user',
    initiator: 'agent',
  });
  agentLog.setNowForTests(() => now);

  assert.ok(!fs.existsSync(reportAbsPath(vault, '2026-10-21')));
  // Emulate vault open.
  ctx.emit('kvd/vault-changed', { root: vault, previous: null });
  assert.ok(fs.existsSync(reportAbsPath(vault, '2026-10-21')), 'catch-up wrote yesterday');
  const first = fs.readFileSync(reportAbsPath(vault, '2026-10-21'), 'utf8');

  // Second open must not rewrite (file already exists) — even if we couldn't tell from bytes,
  // catchUp returns wrote:false.
  const again = agentLog.catchUpYesterday(vault);
  assert.equal(again.wrote, false);
  assert.equal(fs.readFileSync(reportAbsPath(vault, '2026-10-21'), 'utf8'), first);

  // Empty yesterday (different vault) → no file.
  const { vault: v2, agentLog: log2 } = await setup(now);
  assert.equal(log2.catchUpYesterday(v2).empty, true);
  assert.ok(!fs.existsSync(reportAbsPath(v2, '2026-10-21')));
});
