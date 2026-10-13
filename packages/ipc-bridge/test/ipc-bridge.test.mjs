import test from 'node:test';
import assert from 'node:assert/strict';
import IpcBridge, { name } from '../src/index.mjs';

test('ipc-bridge is a Cordis service class', () => {
  assert.equal(name, 'kvd-ipc-bridge');
  assert.equal(typeof IpcBridge, 'function');
});
