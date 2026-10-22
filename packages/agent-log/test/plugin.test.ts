import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import AgentLogService from '../src/plugin.js';

function tmp(p: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), p));
}

async function mount(cfg: Record<string, unknown> = {}) {
  const ctx = new Context();
  const deviceIdFile = path.join(tmp('kvd-alcfg-'), 'agent-log-device-id');
  ctx.plugin(AgentLogService, { deviceIdFile, utcOffsetMinutes: 480, ...cfg });
  await new Promise((r) => setTimeout(r, 0));
  return { ctx, svc: ctx.get('agentLog')!, deviceIdFile };
}

test('AL-1/AL-9: kvd/agent-log events land in <root>/.vault/agent-log/<day>.<deviceId>.jsonl; device id kept outside the vault', async () => {
  const vault = tmp('kvd-alv-');
  const { ctx, svc, deviceIdFile } = await mount();
  svc.setAppVersion('0.3.1');
  ctx.emit('kvd/agent-log', { root: vault, record: { ev: 'pause.on', origin: 'local-renderer', actor: 'user' } });
  ctx.emit('kvd/agent-log', { root: null, record: { ev: 'pause.off' } });
  assert.equal(fs.readFileSync(deviceIdFile, 'utf8'), svc.deviceId, 'device id persisted in the config dir');
  assert.ok(!deviceIdFile.startsWith(vault));
  const files = fs.readdirSync(path.join(vault, '.vault', 'agent-log'));
  assert.equal(files.length, 1);
  assert.match(files[0]!, new RegExp(`^\\d{4}-\\d{2}-\\d{2}\\.${svc.deviceId}\\.jsonl$`));
  const day = files[0]!.slice(0, 10);
  const recs = svc.readDay(vault, day);
  assert.equal(recs.length, 1);
  assert.equal(recs[0]?.ev, 'pause.on');
  assert.equal(recs[0]?.app, '0.3.1');
  assert.match(recs[0]!.ts, /\+08:00$/);
});

test('AL-7: retention cleanup runs when a vault is opened (startup / open), once per vault', async () => {
  const vault = tmp('kvd-alv-');
  const dir = path.join(vault, '.vault', 'agent-log');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '2020-01-01.old.jsonl'), '');
  fs.writeFileSync(path.join(dir, '2999-01-01.future.jsonl'), '');
  const { ctx } = await mount();
  ctx.emit('kvd/vault-changed', { root: vault, previous: null });
  assert.deepEqual(fs.readdirSync(dir), ['2999-01-01.future.jsonl']);
});

test('AL-5: a broken log location never throws into the emitter', async () => {
  const vault = tmp('kvd-alv-');
  fs.writeFileSync(path.join(vault, '.vault'), 'file, not a dir');
  const { ctx, svc } = await mount();
  assert.doesNotThrow(() => ctx.emit('kvd/agent-log', { root: vault, record: { ev: 'proposal.applied', id: 'chg_1' } }));
  assert.equal(svc.append(vault, { ev: 'proposal.applied' }), null);
  assert.deepEqual(svc.readDay(vault, '2026-10-22'), []);
  // no config dir for the device id → in-memory id, still works
  const ctx2 = new Context();
  ctx2.plugin(AgentLogService, { deviceIdFile: path.join(vault, '.vault', 'nested', 'id') });
  await new Promise((r) => setTimeout(r, 0));
  assert.match(ctx2.get('agentLog')!.deviceId, /^[0-9a-f]{12}$/);
});
