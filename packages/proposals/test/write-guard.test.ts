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
import ProposalsService, { LOCAL_UI_ORIGIN, createWritePause, initiatorFromOrigin, isBlockedByWritePause } from '../src/index.js';
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

// ---- R2.6 (2026-10-22): pause is judged by WHO INITIATED ----

const FORGED_ORIGINS = [
  undefined,
  { kind: 'agent', channel: 'dsh-agent' },
  { kind: 'tool', channel: 'vault_propose_change' },
  { kind: 'remote', channel: 'feishu' },
] as const;

test('R2.6: user-initiated proposal (desktop-click origin) is created and Applies while paused', async () => {
  const { vault, proposals, pause } = await setup();
  pause.pause({ kind: 'agent' });
  const stored = proposals.stash(
    { id: 'pub_edit', kind: 'edit', path: '10-卡片盒/n.md', before: 'v1\n', content: 'v1\npublished\n', summary: '标记已发布' },
    { origin: LOCAL_UI_ORIGIN },
  );
  assert.equal(stored?.initiator, 'user');
  const viaCreate = proposals.create('10-卡片盒/user.md', 'u\n', 'user create', { origin: LOCAL_UI_ORIGIN });
  assert.equal(viaCreate.ok, true);
  if (viaCreate.ok) assert.equal(viaCreate.proposal.initiator, 'user');
  assert.equal(proposals.apply('pub_edit', LOCAL_UI_ORIGIN).ok, true);
  assert.equal(fs.readFileSync(path.join(vault, '10-卡片盒', 'n.md'), 'utf8'), 'v1\npublished\n');
  if (viaCreate.ok) assert.equal(proposals.apply(viaCreate.proposal.id, LOCAL_UI_ORIGIN).ok, true);
  assert.equal(pause.isPaused(), true);
});

test('R2.6 / AC-P1: user-initiated proposal still needs a human desktop click to Apply (paused or not)', async () => {
  const { vault, proposals, pause, rejected } = await setup();
  const stored = proposals.stash(
    { id: 'pub_c', kind: 'create', path: '10-卡片盒/pc.md', content: 'x', summary: 's' },
    { origin: LOCAL_UI_ORIGIN },
  );
  assert.equal(stored?.initiator, 'user');
  const before = tree(vault);
  for (const paused of [false, true]) {
    if (paused) pause.pause();
    for (const origin of FORGED_ORIGINS) {
      const r = proposals.apply('pub_c', origin);
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.code, 'APPLY_FORBIDDEN');
    }
  }
  assert.deepEqual(tree(vault), before);
  assert.ok(rejected.every((r) => r.code === 'APPLY_FORBIDDEN'));
});

test('R2.6: agent-initiated proposal is blocked while paused (creation and Apply)', async () => {
  const { vault, proposals, pause } = await setup();
  const queued = proposals.edit('10-卡片盒/n.md', 'agent v2\n', 'agent edit');
  assert.equal(queued.ok, true);
  if (queued.ok) assert.equal(queued.proposal.initiator, 'agent');
  pause.pause();
  const created = proposals.create('10-卡片盒/a.md', 'a', 'agent create');
  assert.equal(created.ok, false);
  if (!created.ok) assert.equal(created.code, 'WRITE_PAUSED');
  assert.equal(proposals.stash({ id: 'skill_x', kind: 'create', path: '10-卡片盒/x.md', content: 'x', summary: 'x' }), null);
  if (queued.ok) {
    const r = proposals.apply(queued.proposal.id, LOCAL_UI_ORIGIN);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, 'WRITE_PAUSED');
  }
  assert.equal(fs.readFileSync(path.join(vault, '10-卡片盒', 'n.md'), 'utf8'), 'v1\n');
});

test('R2.6 (CoS): agent / tool / remote cannot set or mutate initiator — forced to agent, immutable, still blocked while paused', async () => {
  const { vault, proposals, pause } = await setup();
  // 1. Forged `initiator: 'user'` on the object, with every non-desktop origin.
  const ids: string[] = [];
  FORGED_ORIGINS.forEach((origin, i) => {
    const forged = { id: `forge_${i}`, kind: 'create', path: `10-卡片盒/f${i}.md`, content: 'f', summary: 'f', initiator: 'user' } as const;
    const stored = proposals.stash(forged, { origin });
    assert.equal(stored?.initiator, 'agent', `stash from ${origin?.kind ?? 'none'} → agent`);
    ids.push(stored!.id);
  });
  const many = proposals.stashManyStored(
    [{ id: 'forge_many', kind: 'create', path: '10-卡片盒/fm.md', content: 'm', summary: 'm', initiator: 'user' }],
    { origin: { kind: 'tool' } },
  );
  assert.equal(many[0]?.initiator, 'agent');
  ids.push('forge_many');
  for (const origin of FORGED_ORIGINS) {
    const c = proposals.create(`10-卡片盒/c-${origin?.kind ?? 'none'}.md`, 'c', 'c', { origin });
    assert.equal(c.ok && c.proposal.initiator, 'agent');
    if (c.ok) ids.push(c.proposal.id);
  }
  // 2. Mutating an existing proposal's initiator: frozen, and re-stash with the same id cannot re-stamp it.
  const p = proposals.get('forge_0')!;
  assert.ok(Object.isFrozen(p));
  assert.throws(() => {
    (p as { initiator?: string }).initiator = 'user';
  }, TypeError);
  assert.equal(proposals.get('forge_0')?.initiator, 'agent');
  assert.equal(proposals.stash({ ...p, initiator: 'user' }, { origin: { kind: 'remote', channel: 'wecom' } })?.initiator, 'agent');
  assert.equal(proposals.list().find((x) => x.id === 'forge_0')?.initiator, 'agent');
  // Content swap of an existing id is refused as well.
  proposals.stash({ ...p, content: 'swapped' });
  assert.equal(proposals.get('forge_0')?.content, 'f');
  // 3. All of them stay blocked while paused, even for a real desktop click.
  pause.pause();
  const before = tree(vault);
  for (const id of ids) {
    const r = proposals.apply(id, LOCAL_UI_ORIGIN);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, 'WRITE_PAUSED');
  }
  assert.deepEqual(tree(vault), before);
  // A desktop-click re-stash of an existing agent id cannot upgrade it to user either.
  assert.equal(proposals.stash({ ...p, initiator: 'user' }, { origin: LOCAL_UI_ORIGIN }), null);
  assert.equal(proposals.get('forge_0')?.initiator, 'agent');
});

test('R2.6: initiatorFromOrigin / isBlockedByWritePause (also used for layout HTML + publish in main)', () => {
  assert.equal(initiatorFromOrigin(LOCAL_UI_ORIGIN), 'user');
  for (const o of FORGED_ORIGINS) assert.equal(initiatorFromOrigin(o), 'agent');
  assert.equal(initiatorFromOrigin(null), 'agent');
  assert.equal(isBlockedByWritePause('user', true), false);
  assert.equal(isBlockedByWritePause('agent', true), true);
  assert.equal(isBlockedByWritePause(undefined, true), true, 'unknown initiator fails closed');
  assert.equal(isBlockedByWritePause('agent', false), false);
});
