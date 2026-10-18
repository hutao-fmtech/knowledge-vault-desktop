import { approvalCommandHeading, commandLanguageOf } from '../src/approval-bridge.js';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findEscalation, isEscalationRequest } from '../src/approval-bridge.js';
import { createAdvancedHost } from '../src/host.js';
import type { HostDeps } from '../src/host.js';

import { createAdvancedController } from '../src/controller.js';
import { classifyIpcOrigin, RENDERER_URL } from '../src/origin.js';
import { createToolLog } from '../src/tool-log.js';

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
  assert.throws(() => createAdvancedHost({} as unknown as HostDeps) /* deliberately invalid deps */, /deps\.runtime/);
});

test('approval dialog labels pwsh as PowerShell and bash as bash', () => {
  assert.equal(commandLanguageOf('pwsh'), 'PowerShell');
  assert.equal(commandLanguageOf('bash'), 'bash');
  assert.equal(commandLanguageOf('vault_propose_change'), null);
  assert.equal(approvalCommandHeading('PowerShell'), 'PowerShell 命令');
  assert.equal(approvalCommandHeading('bash'), 'bash 命令');
  assert.equal(approvalCommandHeading(null), '命令');
});
