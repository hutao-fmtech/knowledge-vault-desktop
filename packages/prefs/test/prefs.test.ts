import { test } from 'vitest';
import assert from 'node:assert/strict';
import { name, PrefsSchema, KvdPrefs } from '../src/index.js';

test('prefs service shape + schema defaults', () => {
  assert.equal(name, 'kvd-prefs');
  assert.equal(typeof KvdPrefs, 'function');
  const parsed = PrefsSchema({});
  assert.equal(typeof parsed, 'object');
});
