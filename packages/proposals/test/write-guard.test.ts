/**
 * Spec "全局暂停写入 + Agent 不能接受自己的提案" (AC-P1..AC-P4) at the service level.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Context, Service } from '@deepseek-ai/cordis';
import IpcBridge from '@kvd/ipc-bridge';
import ProposalsService, { LOCAL_UI_ORIGIN, createWritePause } from '../src/index.js';
import type { ApplyRejection } from '../src/index.js';

/** Minimal `vault` service (the real one also needs kvd-prefs; only getRoot matters here). */
class StubVault extends Service {
  static root: string | null = null;
  constructor(ctx: Context) {
    super(ctx, 'vault');
  }
  getRoot(): string | null {
    return StubVault.root;
  }
}

function memPrefs() {
  let prefs: Record<string, unknown> = {};
  return {
    readPrefs: () => prefs,
    writePrefs: (p: Record<string, unknown>) => (prefs = { ...prefs, ...p }),
    dump: () => prefs,
  };
}

async function setup() {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'kvd-guard-'));
  fs.mkdirSync(path.join(vault, '10-卡片盒'), { recursive: true });
  fs.writeFileSync(path.join(vault, '10-卡片盒', 'n.md'), 'v1\n', 'utf8');
  const ctx = new Context();
  ctx.plugin(IpcBridge);
  StubVault.root = vault;
  ctx.plugin(StubVault);
  ctx.plugin(ProposalsService);
  await new Promise((r) => setTimeout(r, 0));
  const proposals = ctx.get('proposals')!;
  const prefs = memPrefs();
  const pause = createWritePause(prefs);
  proposals.attachWritePause(pause);
  const rejected: ApplyRejection[] = [];
  proposals.onApplyRejected((r) => rejected.push(r));
  return { vault, ctx, proposals, pause, prefs, rejected };
}

function tree(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else out[path.relative(root, abs)] = fs.readFileSync(abs, 'base64');
    }
  };
  walk(root);
  return out;
}

test('AC-P1: Apply from engine / tool layer / remote (non-renderer) origin is refused, disk byte-identical, reason logged', async () => {
  const { vault, proposals, rejected } = await setup();
  const c = proposals.create('10-卡片盒/new.md', '# new\n', 'agent card');
  const e = proposals.edit('10-卡片盒/n.md', 'v2\n', 'agent edit');
  assert.ok(c.ok && e.ok);
  const before = tree(vault);
  const origins = [
    undefined,
    null,
    { kind: 'agent', channel: 'dsh-agent' },
    { kind: 'tool', channel: 'vault_propose_change' },
    { kind: 'remote', channel: 'feishu' },
  ];
  for (const o of origins) {
    for (const id of [c.ok ? c.proposal.id : '', e.ok ? e.proposal.id : '']) {
      const res = proposals.apply(id, o);
      assert.equal(res.ok, false);
      if (!res.ok) assert.equal(res.code, 'APPLY_FORBIDDEN');
    }
  }
  assert.deepEqual(tree(vault), before, 'disk unchanged byte-for-byte');
  assert.equal(proposals.size(), 2, 'proposals stay pending for the human');
  assert.equal(rejected.length, origins.length * 2, 'every refusal reaches the log listener');
  assert.ok(rejected.every((r) => r.code === 'APPLY_FORBIDDEN' && r.reason.length > 0));
  assert.ok(rejected.some((r) => r.origin === 'remote:feishu'));
  // A forged origin-like string does not count either.
  assert.equal(proposals.apply(c.ok ? c.proposal.id : '', { kind: 'LOCAL-RENDERER' }).ok, false);
  // Only the local renderer click applies.
  assert.equal(proposals.apply(c.ok ? c.proposal.id : '', LOCAL_UI_ORIGIN).ok, true);
  assert.equal(fs.readFileSync(path.join(vault, '10-卡片盒', 'new.md'), 'utf8'), '# new\n');
});

test('AC-P1: agent may still Discard its own proposal (only reduces)', async () => {
  const { proposals } = await setup();
  const c = proposals.create('10-卡片盒/d.md', 'x', 'd');
  assert.ok(c.ok);
  assert.equal(proposals.discard(c.ok ? c.proposal.id : '').ok, true);
  assert.equal(proposals.size(), 0);
});

test('AC-P3: paused → no new proposals; existing Apply refused, Discard works; reads unaffected', async () => {
  const { vault, proposals, pause, rejected } = await setup();
  const pending = proposals.edit('10-卡片盒/n.md', 'v2\n', 'queued before pause');
  assert.ok(pending.ok);
  assert.equal(pause.pause({ kind: 'agent' }).ok, true, 'any origin may pause');
  assert.equal(proposals.isWritePaused(), true);

  for (const res of [
    proposals.create('10-卡片盒/p.md', 'x'),
    proposals.edit('10-卡片盒/n.md', 'v3\n'),
    proposals.move('10-卡片盒/n.md', '10-卡片盒/m.md'),
  ]) {
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.code, 'WRITE_PAUSED');
      assert.match(res.error, /写入已暂停/);
    }
  }
  proposals.stash({ id: 'skill_1', kind: 'create', path: '10-卡片盒/s.md', content: 's', summary: 's' });
  assert.deepEqual(proposals.stashMany([{ id: 'skill_2', kind: 'create', path: '10-卡片盒/s2.md', summary: 's' }]), []);
  assert.equal(proposals.size(), 1, 'only the pre-pause proposal is queued');

  const id = pending.ok ? pending.proposal.id : '';
  const applied = proposals.apply(id, LOCAL_UI_ORIGIN);
  assert.equal(applied.ok, false, 'Apply disabled even for the local UI while paused');
  if (!applied.ok) assert.equal(applied.code, 'WRITE_PAUSED');
  assert.equal(rejected.at(-1)?.code, 'WRITE_PAUSED');
  assert.equal(fs.readFileSync(path.join(vault, '10-卡片盒', 'n.md'), 'utf8'), 'v1\n');
  // Reading the vault is untouched by the pause (A1 answers still work).
  assert.equal(fs.readFileSync(path.join(vault, '10-卡片盒', 'n.md'), 'utf8'), 'v1\n');
  assert.equal(proposals.discard(id).ok, true, 'Discard stays available');
  assert.equal(proposals.size(), 0);
});

test('AC-P4: agent / remote cannot lift the pause; local manual resume is immediate', async () => {
  const { vault, proposals, pause, prefs } = await setup();
  pause.pause({ kind: 'remote', channel: 'wecom' });
  assert.equal(prefs.dump().writePaused, true, 'stored in app config prefs, not in the vault');
  assert.equal(fs.existsSync(path.join(vault, '.kvd-write-pause')), false);
  const events: string[] = [];
  pause.onChange((_st, reason, origin) => events.push(`${reason}@${origin}`));
  for (const o of [undefined, { kind: 'agent' }, { kind: 'tool', channel: 'bash' }, { kind: 'remote', channel: 'feishu' }]) {
    const r = pause.resume(o);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, 'REMOTE_FORBIDDEN');
    assert.equal(proposals.isWritePaused(), true);
  }
  assert.ok(events.every((e) => e.startsWith('resume-rejected@')), 'rejections are observable for the log');
  const r = pause.resume(LOCAL_UI_ORIGIN);
  assert.equal(r.ok, true);
  assert.equal(proposals.isWritePaused(), false, 'effective immediately, no restart');
  assert.ok(events.includes('resumed@local-renderer'));
  const c = proposals.create('10-卡片盒/after.md', 'ok\n');
  assert.ok(c.ok);
  assert.equal(proposals.apply(c.ok ? c.proposal.id : '', LOCAL_UI_ORIGIN).ok, true);
});
