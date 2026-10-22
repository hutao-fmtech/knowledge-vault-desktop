import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  EVENTS,
  LOG_DIR_REL,
  createAgentLog,
  dayKey,
  isoWithOffset,
  loadOrCreateDeviceId,
  sanitizeRecord,
  sha256Hex,
} from '../src/index.js';
import type { AgentLogOptions } from '../src/index.js';

const CST = 480; // UTC+8
const FAKE_KEY = 'sk-' + 'f'.repeat(32);

function vault(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kvd-agentlog-'));
}

function mk(root: string, extra: Partial<AgentLogOptions> = {}) {
  const warns: string[] = [];
  const log = createAgentLog({
    getVaultRoot: () => root,
    deviceId: 'dev01',
    app: '0.3.1',
    utcOffsetMinutes: CST,
    now: () => new Date('2026-10-22T01:30:00Z'),
    onWarn: (m) => warns.push(m),
    ...extra,
  });
  return { log, warns };
}

test('AL-1: one JSON line per event at <vault>/.vault/agent-log/YYYY-MM-DD.<deviceId>.jsonl with the v1 schema', () => {
  const root = vault();
  const { log } = mk(root);
  const h = sha256Hex('# a\n');
  const rec = log.append({ ev: 'proposal.created', id: 'chg_1_1', kind: 'edit', path: '10-卡片盒\\a.md', origin: 'skill:makeCard', actor: 'agent', beforeSha256: h, bytes: 4 });
  assert.ok(rec);
  const file = path.join(root, '.vault', 'agent-log', '2026-10-22.dev01.jsonl');
  assert.equal(LOG_DIR_REL, '.vault/agent-log');
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]!);
  assert.deepEqual(parsed, {
    v: 1,
    ts: '2026-10-22T09:30:00.000+08:00',
    ev: 'proposal.created',
    id: 'chg_1_1',
    kind: 'edit',
    path: '10-卡片盒/a.md',
    origin: 'skill:makeCard',
    actor: 'agent',
    beforeSha256: h,
    bytes: 4,
    app: '0.3.1',
  });
  log.append({ ev: 'proposal.applied', id: 'chg_1_1', kind: 'edit', path: '10-卡片盒/a.md', actor: 'user', origin: 'local-renderer', afterSha256: h });
  assert.deepEqual(log.readDay('2026-10-22').map((r) => r.ev), ['proposal.created', 'proposal.applied']);
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('AL-1: every event (incl. pause.on/off, apply_failed with error code) is accepted; unknown events dropped', () => {
  assert.deepEqual([...EVENTS], [
    'proposal.created', 'proposal.applied', 'proposal.apply_failed', 'proposal.rejected', 'proposal.expired', 'pause.on', 'pause.off',
  ]);
  const root = vault();
  const { log, warns } = mk(root);
  for (const ev of EVENTS) assert.ok(log.append({ ev, id: 'chg_x', origin: 'local-renderer' }), ev);
  const failed = log.append({ ev: 'proposal.apply_failed', id: 'chg_x', kind: 'edit', path: 'a.md', stale: true, error: 'STALE' });
  assert.equal(failed?.error, 'stale');
  assert.equal(failed?.stale, true);
  assert.equal(log.append({ ev: 'proposal.apply_failed', error: '文件已被改动，请重新生成建议' })?.error, 'other', 'free text never stored as error');
  assert.equal(log.append({ ev: 'note.read', path: 'a.md' }), null);
  assert.ok(warns.some((w) => w.includes('unknown event')));
  assert.equal(log.readDay('2026-10-22').length, EVENTS.length + 2);
});

test('AL-2: no note content / summary / prompt / key ever reaches the log (allowlist + grep)', () => {
  const root = vault();
  const MARK = 'ZZ_SECRET_NOTE_MARKER_7f3a';
  const noteRel = '10-卡片盒/marker.md';
  fs.mkdirSync(path.join(root, '10-卡片盒'), { recursive: true });
  const body = `# 私密\n${MARK}\n`;
  fs.writeFileSync(path.join(root, noteRel), body);
  const { log } = mk(root);
  const hostile = {
    id: 'chg_9',
    kind: 'edit',
    path: noteRel,
    actor: 'agent',
    origin: 'agent-advanced',
    beforeSha256: sha256Hex(body),
    content: body,
    before: body,
    summary: `模型摘要 ${MARK}`,
    prompt: `用户提问 ${MARK}`,
    apiKey: FAKE_KEY,
    DEEPSEEK_API_KEY: FAKE_KEY,
    headers: { authorization: `Bearer ${FAKE_KEY}` },
  } as const;
  for (const ev of EVENTS) log.append({ ...hostile, ev });
  log.append({ ev: 'proposal.apply_failed', ...hostile, error: `${MARK} ${FAKE_KEY}` });
  log.append({ ev: 'proposal.created', id: FAKE_KEY, origin: `skill:${FAKE_KEY}`, path: `a/${FAKE_KEY}.md`, app: FAKE_KEY });
  const text = fs.readdirSync(path.join(root, '.vault', 'agent-log'))
    .map((f) => fs.readFileSync(path.join(root, '.vault', 'agent-log', f), 'utf8'))
    .join('');
  assert.ok(text.length > 0);
  for (const needle of [MARK, FAKE_KEY, 'sk-', '私密', '模型摘要', '用户提问', 'Bearer', 'content', 'summary', 'prompt', 'apiKey', 'DEEPSEEK']) {
    assert.equal(text.includes(needle), false, `log must not contain ${needle}`);
  }
  const allowed = new Set(['v', 'ts', 'ev', 'id', 'kind', 'path', 'from', 'to', 'origin', 'actor', 'beforeSha256', 'afterSha256', 'bytes', 'stale', 'error', 'app']);
  for (const line of text.trim().split('\n')) {
    for (const k of Object.keys(JSON.parse(line))) assert.ok(allowed.has(k), `unexpected field ${k}`);
  }
});

test('AL-2: path validator rejects absolute / traversal / control chars', () => {
  const ts = '2026-10-22T09:00:00.000+08:00';
  for (const bad of ['/etc/passwd', 'C:/x.md', '../x.md', 'a/../../b', 'a\u0000b', '']) {
    assert.equal(sanitizeRecord({ ev: 'proposal.created', path: bad }, ts)?.path, undefined, JSON.stringify(bad));
  }
  assert.equal(sanitizeRecord({ ev: 'proposal.created', from: '01-收件箱\\x.md', to: './05-归档//x.md' }, ts)?.to, '05-归档/x.md');
});

test('AL-5: logging failure never throws into the caller (read-only dir, file locked, bad vault, throwing warn)', () => {
  const root = vault();
  // .vault is a FILE → mkdir/append fail
  fs.writeFileSync(path.join(root, '.vault'), 'not a dir');
  const { log, warns } = mk(root);
  assert.doesNotThrow(() => assert.equal(log.append({ ev: 'proposal.applied', id: 'chg_1' }), null));
  assert.ok(warns.some((w) => w.includes('append failed')));
  assert.deepEqual(log.readDay('2026-10-22'), []);
  assert.equal(log.prune(), 0);
  // log file path occupied by a directory (stand-in for an AV lock)
  const root2 = vault();
  fs.mkdirSync(path.join(root2, '.vault', 'agent-log', '2026-10-22.dev01.jsonl'), { recursive: true });
  const two = mk(root2);
  assert.equal(two.log.append({ ev: 'proposal.applied' }), null);
  // vault getter throws, warn sink throws, no vault at all
  const bad = createAgentLog({ getVaultRoot: () => { throw new Error('boom'); }, deviceId: 'd', onWarn: () => { throw new Error('x'); } });
  assert.doesNotThrow(() => bad.append({ ev: 'proposal.applied' }));
  const none = createAgentLog({ getVaultRoot: () => null, deviceId: 'd' });
  assert.equal(none.append({ ev: 'proposal.applied' }), null);
  assert.equal(none.dir(), null);
});

test('readDay skips half-written / foreign lines and merges devices', () => {
  const root = vault();
  const a = mk(root).log;
  a.append({ ev: 'proposal.created', id: 'chg_a' });
  const dir = path.join(root, '.vault', 'agent-log');
  fs.appendFileSync(path.join(dir, '2026-10-22.dev01.jsonl'), '{"v":1,"ts":"2026-10-22T09:31');
  fs.writeFileSync(path.join(dir, '2026-10-22.dev02.jsonl'), '{"v":1,"ts":"2026-10-22T08:00:00.000+08:00","ev":"proposal.rejected","id":"chg_b","content":"leak"}\n');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'ignored');
  const recs = a.readDay('2026-10-22');
  assert.deepEqual(recs.map((r) => r.id), ['chg_b', 'chg_a']);
  assert.equal(JSON.stringify(recs).includes('leak'), false);
  assert.deepEqual(a.listDays(), ['2026-10-22']);
  assert.deepEqual(a.readDay('../../etc'), []);
});

test('AL-7: retention prune deletes day files older than 90 days (default) and keeps the rest', () => {
  const root = vault();
  const { log } = mk(root);
  const dir = path.join(root, '.vault', 'agent-log');
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ['2026-07-24.dev01.jsonl', '2026-07-25.dev02.jsonl', '2026-07-23.dev01.jsonl', '2025-01-01.old.jsonl', 'README.md']) {
    fs.writeFileSync(path.join(dir, f), '');
  }
  assert.equal(log.prune(), 2);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['2026-07-24.dev01.jsonl', '2026-07-25.dev02.jsonl', 'README.md']);
  const short = mk(root, { retentionDays: 7 }).log;
  assert.equal(short.prune(), 2);
});

test('AL-8: ts carries +08:00 and day files roll over at local (UTC+8) midnight; paths stored with /', () => {
  assert.equal(isoWithOffset(new Date('2026-10-21T15:59:59.000Z'), CST), '2026-10-21T23:59:59.000+08:00');
  assert.equal(dayKey(new Date('2026-10-21T15:59:59.000Z'), CST), '2026-10-21');
  assert.equal(dayKey(new Date('2026-10-21T16:00:00.000Z'), CST), '2026-10-22');
  const root = vault();
  let t = new Date('2026-10-21T15:59:59.000Z');
  const { log } = mk(root, { now: () => t });
  log.append({ ev: 'proposal.created', path: '01-收件箱\\子目录\\x.md' });
  t = new Date('2026-10-21T16:00:01.000Z');
  log.append({ ev: 'proposal.applied', path: '01-收件箱\\子目录\\x.md' });
  assert.deepEqual(log.listDays(), ['2026-10-21', '2026-10-22']);
  assert.equal(log.readDay('2026-10-21')[0]?.path, '01-收件箱/子目录/x.md');
  assert.equal(log.readDay('2026-10-22')[0]?.ts, '2026-10-22T00:00:01.000+08:00');
});

test('device id is stable, file-backed (outside the vault) and validated', () => {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'kvd-cfg-'));
  const f = path.join(cfg, 'device-id');
  const id = loadOrCreateDeviceId(f);
  assert.match(id, /^[0-9a-f]{12}$/);
  assert.equal(loadOrCreateDeviceId(f), id);
  assert.throws(() => createAgentLog({ getVaultRoot: () => null, deviceId: '../x' }));
});
