import test from 'node:test';
import assert from 'node:assert/strict';
import plugin from '../src/index.mjs';

test('privacy plugin shape', () => {
  assert.equal(plugin.name, 'kvd-privacy');
  assert.deepEqual(plugin.inject, ['llm', 'kvdPrefs']);
  assert.equal(typeof plugin.apply, 'function');
});
