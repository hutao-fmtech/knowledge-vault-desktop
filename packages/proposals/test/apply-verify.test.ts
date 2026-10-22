/**
 * AL-12: after Apply writes, the file is read back and its sha256 compared with
 * what was reviewed; mismatch → VERIFY_FAILED, `apply.verify_failed` logged,
 * proposal not marked applied. Replaying an Apply that already ran returns the
 * prior result without writing or logging again. Apply operation ids are minted
 * by ProposalsService (main process) only.
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
import ProposalsService, {
  LOCAL_UI_ORIGIN,
  VERIFY_FAILED,
  applyProposal,
  proposeCreate,
  proposeEdit,
  proposeMove,
  sha256Hex,
} from '../src/index.js';

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

function tmpVault(): string {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'kvd-al12-'));
  fs.mkdirSync(path.join(vault, '10-卡片盒'), { recursive: true });
  fs.writeFileSync(path.join(vault, '10-卡片盒', 'n.md'), 'v1\n', 'utf8');
  return vault;
}

async function setup() {
  const vault = tmpVault();
  const ctx = new Context();
  ctx.plugin(IpcBridge);
  ctx.plugin(StubVault);
  ctx.plugin(AgentLogService, { deviceIdFile: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kvd-al12c-')), 'id'), utcOffsetMinutes: 480 });
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
  return { vault, proposals, all };
}

const corrupt = (abs: string): Buffer => Buffer.concat([fs.readFileSync(abs), Buffer.from('X')]);

test('AL-12 pure: create / edit / move verify the read-back hash', () => {
  const vault = tmpVault();
  const c = proposeCreate(vault, '10-卡片盒/c.md', 'hello\n');
  const e = proposeEdit(vault, '10-卡片盒/n.md', 'v2\n');
  assert.ok(c.ok && e.ok);
  assert.equal(applyProposal(vault, c.ok ? c.proposal : null).ok, true);
  assert.equal(applyProposal(vault, e.ok ? e.proposal : null).ok, true);
  const m = proposeMove(vault, '10-卡片盒/c.md', '02-项目/c.md');
  assert.ok(m.ok);
  assert.equal(applyProposal(vault, m.ok ? m.proposal : null).ok, true);
  assert.equal(fs.readFileSync(path.join(vault, '02-项目', 'c.md'), 'utf8'), 'hello\n');

  for (const build of [
    () => proposeCreate(vault, '10-卡片盒/bad.md', 'x\n'),
    () => proposeEdit(vault, '10-卡片盒/n.md', 'v3\n'),
    () => proposeMove(vault, '02-项目/c.md', '03-领域/c.md'),
  ]) {
    const p = build();
    assert.ok(p.ok);
    const r = applyProposal(vault, p.ok ? p.proposal : null, { readBack: corrupt });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.code, VERIFY_FAILED);
    assert.match(!r.ok ? r.error : '', /写入校验失败.*未标记为已应用/);
  }
  // Move whose destination vanished after the rename → verify fails too.
  const m2 = proposeMove(vault, '03-领域/c.md', '04-资源/c.md');
  assert.ok(m2.ok);
  const r2 = applyProposal(vault, m2.ok ? m2.proposal : null, {
    readBack: () => {
      throw new Error('ENOENT');
    },
  });
  assert.equal(!r2.ok && r2.code, VERIFY_FAILED);
});

test('AL-12 service: mismatch → apply.verify_failed, still pending, no applied event; replay is idempotent', async () => {
  const { vault, proposals, all } = await setup();
  let reads = 0;
  proposals.setReadBackForTests((abs) => {
    reads += 1;
    return corrupt(abs);
  });
  const p = proposals.create('10-卡片盒/v.md', 'content\n', 'summary', { source: 'skill:makeCard' });
  assert.ok(p.ok);
  const id = p.ok ? p.proposal.id : '';
  const r1 = proposals.apply(id, LOCAL_UI_ORIGIN);
  assert.equal(!r1.ok && r1.code, VERIFY_FAILED);
  assert.match(String(r1.applyOpId), /^apply_[0-9a-f-]{36}$/, 'main mints the apply operation id');
  assert.ok(proposals.get(id), 'not marked applied: still pending (Discard works)');
  const r2 = proposals.apply(id, LOCAL_UI_ORIGIN);
  assert.deepEqual(r2, r1, 'replay returns the prior result');
  assert.equal(reads, 1, 'replay did not write / read back again');
  const recs = all();
  const vf = recs.filter((r) => r.ev === 'apply.verify_failed');
  assert.equal(vf.length, 1, 'no duplicate verify_failed event');
  assert.equal(vf[0]!.error, 'verify_failed');
  assert.equal(vf[0]!.afterSha256, sha256Hex('content\n'), 'expected hash logged; no content');
  assert.equal(vf[0]!.origin, 'skill:makeCard');
  assert.ok(!recs.some((r) => r.ev === 'proposal.applied'));
  assert.ok(!fs.readFileSync(path.join(vault, '.vault', 'agent-log', fs.readdirSync(path.join(vault, '.vault', 'agent-log'))[0]!), 'utf8').includes('content'), 'no content in the log');
  assert.equal(proposals.discard(id, LOCAL_UI_ORIGIN).ok, true);
});

test('AL-12 service: successful Apply replayed → same result, one write, one applied event, no not_found', async () => {
  const { vault, proposals, all } = await setup();
  const p = proposals.create('10-卡片盒/ok.md', 'ok\n', 's', { source: 'skill:makeCard' });
  const id = p.ok ? p.proposal.id : '';
  const r1 = proposals.apply(id, LOCAL_UI_ORIGIN);
  assert.equal(r1.ok, true);
  fs.writeFileSync(path.join(vault, '10-卡片盒', 'ok.md'), 'user edited after apply\n');
  const r2 = proposals.apply(id, LOCAL_UI_ORIGIN);
  assert.deepEqual(r2, r1);
  assert.equal(fs.readFileSync(path.join(vault, '10-卡片盒', 'ok.md'), 'utf8'), 'user edited after apply\n', 'no second write');
  const recs = all();
  assert.equal(recs.filter((r) => r.ev === 'proposal.applied').length, 1);
  assert.ok(!recs.some((r) => r.ev === 'proposal.apply_failed'));
  // A second, distinct proposal gets its own operation id.
  const q = proposals.create('10-卡片盒/ok2.md', 'ok2\n', 's');
  const r3 = proposals.apply(q.ok ? q.proposal.id : '', LOCAL_UI_ORIGIN);
  assert.ok(r3.ok && r3.applyOpId && r3.applyOpId !== r1.applyOpId);
  // R1 still first: a non-local origin replaying an applied id is refused, not served from cache.
  assert.equal(proposals.apply(id, { kind: 'agent' }).ok, false);
});

test('AL-12: refusals before any write (stale) stay retryable — not cached', async () => {
  const { vault, proposals } = await setup();
  const e = proposals.edit('10-卡片盒/n.md', 'v2\n', 's');
  const id = e.ok ? e.proposal.id : '';
  fs.writeFileSync(path.join(vault, '10-卡片盒', 'n.md'), 'changed\n');
  const r1 = proposals.apply(id, LOCAL_UI_ORIGIN);
  assert.equal(!r1.ok && r1.code, 'STALE');
  fs.writeFileSync(path.join(vault, '10-卡片盒', 'n.md'), 'v1\n'); // restored → same bytes as reviewed
  assert.equal(proposals.apply(id, LOCAL_UI_ORIGIN).ok, true);
});
