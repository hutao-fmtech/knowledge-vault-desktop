import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import plugin, { yieldTextStream } from '../src/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

test('plugin shape + stream protocol', async () => {
  assert.equal(plugin.name, 'kvd-llm-mock');
  assert.deepEqual(plugin.inject, ['llm']);
  const events = [];
  for await (const e of yieldTextStream('hi')) events.push(e.type);
  assert.deepEqual(events, ['block-start', 'text-delta', 'block-end', 'finish']);
});

test('depends one-way on @kvd/skills-core, never on @kvd/skills', () => {
  const src = fs.readFileSync(path.join(HERE, '..', 'src', 'index.mjs'), 'utf8');
  assert.ok(/@kvd\/skills-core/.test(src));
  assert.ok(!/from '@kvd\/skills'|kvd-skills\.mjs/.test(src));
});

test('apply registers the kvd-mock adapter', () => {
  const calls = [];
  plugin.apply({ llm: { registerAdapter: (ids, a) => calls.push([ids, a]) } }, {});
  assert.deepEqual(calls[0][0], ['kvd-mock']);
});
