import { test } from 'vitest';
import assert from 'node:assert/strict';
import IpcBridge, { name } from '../src/index.js';

test('ipc-bridge is a Cordis service class', () => {
  assert.equal(name, 'kvd-ipc-bridge');
  assert.equal(typeof IpcBridge, 'function');
});
