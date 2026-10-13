import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { findEscalation, isEscalationRequest } from '../src/approval-bridge.mjs';
import { createAdvancedHost } from '../src/host.mjs';

const require = createRequire(import.meta.url);
const { createAdvancedController } = require('../src/controller.js');
const { classifyIpcOrigin, RENDERER_URL } = require('../src/origin.js');
const { createToolLog } = require('../src/tool-log.js');

test('sandbox escalation is always detected', () => {
  assert.equal(findEscalation({ sandbox_permissions: 'workspace-write' }), 'workspace-write');
  assert.equal(findEscalation({ command: 'ls' }), null);
  assert.equal(findEscalation({ sandbox_permissions: 'read-only' }), null);
});

test('remote IPC origins are rejected (cannot enable advanced mode)', () => {
  const wc = { id: 1 };
  const win = { webContents: wc };
  assert.equal(classifyIpcOrigin({ sender: wc, senderFrame: { url: RENDERER_URL, parent: null } }, win).kind, 'local-renderer');
  assert.equal(classifyIpcOrigin({ sender: wc, senderFrame: { url: 'https://evil.example/' } }, win).kind, 'remote');
  assert.equal(typeof isEscalationRequest, 'function');
});

test('controller defaults to off; tool log redacts secrets', () => {
  let prefs = {};
  const ctl = createAdvancedController({ readPrefs: () => prefs, writePrefs: (p) => (prefs = { ...prefs, ...p }) });
  assert.equal(ctl.getState().enabled, false);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kvd-adv-'));
  const secret = 'sk-' + 'z'.repeat(20);
  const log = createToolLog({ dir, getSecrets: () => [secret] });
  log.append({ event: 'tool-result', output: `token=${secret}` });
  assert.ok(!fs.readFileSync(log.file, 'utf8').includes(secret));
});

test('host requires an injected composition-root handle (no app import)', () => {
  assert.throws(() => createAdvancedHost({}), /deps\.runtime/);
});
