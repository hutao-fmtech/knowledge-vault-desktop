/**
 * Agent-log PR-2: kvd-proposals emits the proposal lifecycle into kvd-agent-log
 * (AL-1 / AL-2 / AL-3 / AL-5), with initiator + source, paths and hashes only.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Context, Service } from '@deepseek-ai/cordis';
import IpcBridge from '@kvd/ipc-bridge';
import AgentLogService from '@kvd/agent-log/plugin';
import type { AgentLogRecord } from '@kvd/agent-log';
import ProposalsService, { LOCAL_UI_ORIGIN, createWritePause, sha256Hex } from '../src/index.js';

class StubVault extends Service {
  root: string | null = null;
  constructor(ctx: Context) {
    super(ctx, 'vault');
  }
  getRoot(): string | null {
    return this.root;
  }
  setRoot(root: string | null): void {
    const previous = this.root;
    this.root = root;
    this.ctx.emit('kvd/vault-changed', { root, previous });
  }
}

const MARK = 'ZZ_AGENTLOG_WIRE_MARKER_91c';
const FAKE_KEY = 'sk-' + 'w'.repeat(32);

async function setup() {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'kvd-alw-'));
  fs.mkdirSync(path.join(vault, '10-卡片盒'), { recursive: true });
  fs.writeFileSync(path.join(vault, '10-卡片盒', 'n.md'), `v1 ${MARK}\n`, 'utf8');
  const ctx = new Context();
  ctx.plugin(IpcBridge);
  ctx.plugin(StubVault);
  ctx.plugin(AgentLogService, { deviceIdFile: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kvd-alc-')), 'id'), utcOffsetMinutes: 480 });
  ctx.plugin(ProposalsService);
  await new Promise((r) => setTimeout(r, 0));
  (ctx.get('vault') as unknown as StubVault).setRoot(vault);
  const proposals = ctx.get('proposals')!;
  const all = (): AgentLogRecord[] => {
    const dir = path.join(vault, '.vault', 'agent-log');
    if (!fs.existsSync(dir)) return [];
    const days = [...new Set(fs.readdirSync(dir).map((f) => f.slice(0, 10)))];
    return days.flatMap((d) => ctx.get('agentLog')!.readDay(vault, d));
  };
  const raw = (): string => {
    const dir = path.join(vault, '.vault', 'agent-log');
    return fs.existsSync(dir) ? fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('') : '';
  };
  return { vault, ctx, proposals, all, raw, stub: ctx.get('vault') as unknown as StubVault };
}

test('AL-1/AL-3: created / applied / apply_failed(stale) / rejected / expired with initiator + source + hashes', async () => {
  const { vault, proposals, all, stub } = await setup();
  const card = proposals.create('10-卡片盒/card.md', `# card ${MARK}\n`, `summary ${MARK}`, { source: 'skill:makeCard' });
  const edit = proposals.edit('10-卡片盒/n.md', `v2 ${MARK}\n`, 's', { source: 'agent-advanced:vault_propose_change' });
  assert.ok(card.ok && edit.ok);
  assert.equal(card.ok && card.proposal.source, 'skill:makeCard');
  assert.equal(proposals.apply(card.ok ? card.proposal.id : '', LOCAL_UI_ORIGIN).ok, true);
  fs.writeFileSync(path.join(vault, '10-卡片盒', 'n.md'), 'changed outside\n');
  const stale = proposals.apply(edit.ok ? edit.proposal.id : '', LOCAL_UI_ORIGIN);
  assert.equal(stale.ok, false);
  const pub = proposals.create('10-卡片盒/pub.md', 'p', 'publish', { origin: LOCAL_UI_ORIGIN, source: 'skill:wechatPublish' });
  const gone = proposals.create('10-卡片盒/gone.md', 'g', 'g', { source: 'skill:sortInbox' });
  assert.ok(pub.ok && gone.ok);
  assert.equal(proposals.discard(pub.ok ? pub.proposal.id : '', LOCAL_UI_ORIGIN).ok, true);
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'kvd-alw2-'));
  stub.setRoot(other); // gone + the stale edit expire in the vault being left

  const recs = all();
  const evs = recs.map((r) => `${r.ev}:${r.origin}:${r.initiator}`);
  assert.deepEqual(evs, [
    'proposal.created:skill:makeCard:agent',
    'proposal.created:agent-advanced:vault_propose_change:agent',
    'proposal.applied:skill:makeCard:agent',
    'proposal.apply_failed:agent-advanced:vault_propose_change:agent',
    'proposal.created:skill:wechatPublish:user',
    'proposal.created:skill:sortInbox:agent',
    'proposal.rejected:skill:wechatPublish:user',
    'proposal.expired:agent-advanced:vault_propose_change:agent',
    'proposal.expired:skill:sortInbox:agent',
  ]);
  const applied = recs.find((r) => r.ev === 'proposal.applied')!;
  assert.equal(applied.actor, 'user');
  assert.equal(applied.path, '10-卡片盒/card.md');
  assert.equal(applied.afterSha256, sha256Hex(`# card ${MARK}\n`));
  const failed = recs.find((r) => r.ev === 'proposal.apply_failed')!;
  assert.equal(failed.error, 'stale');
  assert.equal(failed.stale, true);
  assert.equal(failed.beforeSha256, sha256Hex(`v1 ${MARK}\n`));
  assert.equal(recs.find((r) => r.ev === 'proposal.rejected')?.actor, 'user');
  assert.ok(recs.filter((r) => r.ev === 'proposal.expired').every((r) => r.actor === 'system'));
  assert.equal(fs.existsSync(path.join(other, '.vault')), false, 'expired events go to the vault that was closed');
});

test('AL-1: no-self-accept and write-pause rejections are apply_failed with an error code', async () => {
  const { proposals, all } = await setup();
  const c = proposals.create('10-卡片盒/x.md', 'x', 'x', { source: 'skill:makeCard' });
  const id = c.ok ? c.proposal.id : '';
  assert.equal(proposals.apply(id, { kind: 'remote', channel: 'feishu' }).ok, false);
  let prefs: Record<string, unknown> = {};
  const pause = createWritePause({ readPrefs: () => prefs, writePrefs: (p) => (prefs = { ...prefs, ...p }) });
  proposals.attachWritePause(pause);
  pause.pause();
  assert.equal(proposals.apply(id, LOCAL_UI_ORIGIN).ok, false);
  assert.equal(proposals.apply('chg_missing', LOCAL_UI_ORIGIN).ok, false);
  const failed = all().filter((r) => r.ev === 'proposal.apply_failed');
  assert.deepEqual(failed.map((r) => `${r.error}:${r.actor}`), ['apply_forbidden:agent', 'write_paused:user', 'not_found:user']);
  assert.equal(failed[0]?.origin, 'skill:makeCard');
});

test('AL-2: the log never contains note content, summary, prompt or keys (marker grep)', async () => {
  const { proposals, raw } = await setup();
  const c = proposals.create(`10-卡片盒/${MARK}.md`.replace(MARK, 'safe'), `# ${MARK}\n${FAKE_KEY}\n`, `summary ${MARK} ${FAKE_KEY}`, { source: 'skill:ask' });
  const e = proposals.edit('10-卡片盒/n.md', `prompt-ish ${MARK} ${FAKE_KEY}\n`, `${MARK}`, { source: 'skill:makeCard' });
  proposals.apply(c.ok ? c.proposal.id : '', LOCAL_UI_ORIGIN);
  proposals.apply(e.ok ? e.proposal.id : '', LOCAL_UI_ORIGIN);
  const text = raw();
  assert.ok(text.includes('proposal.applied'));
  for (const needle of [MARK, FAKE_KEY, 'sk-', 'summary', 'content', 'before"', 'v1 ']) assert.equal(text.includes(needle), false, needle);
});

test('AL-5: a failing logger (broken .vault, throwing listener) never changes the Apply result', async () => {
  const { vault, ctx, proposals } = await setup();
  fs.writeFileSync(path.join(vault, '.vault'), 'not a dir');
  ctx.on('kvd/agent-log', () => {
    throw new Error('listener boom');
  });
  const c = proposals.create('10-卡片盒/ok.md', 'ok\n', 'ok', { source: 'skill:makeCard' });
  assert.ok(c.ok);
  const res = proposals.apply(c.ok ? c.proposal.id : '', LOCAL_UI_ORIGIN);
  assert.equal(res.ok, true);
  assert.equal(fs.readFileSync(path.join(vault, '10-卡片盒', 'ok.md'), 'utf8'), 'ok\n');
  assert.equal(proposals.discard('nope').ok, false);
});

test('source is validated; forged source on the object is ignored', async () => {
  const { proposals } = await setup();
  const stored = proposals.stash({ id: 'chg_f', kind: 'create', path: '10-卡片盒/f.md', content: 'f', summary: 'f', source: 'skill:forged' }, { source: `bad source ${MARK}` });
  assert.equal(stored?.source, 'agent');
  assert.equal(Object.isFrozen(stored), true);
});
