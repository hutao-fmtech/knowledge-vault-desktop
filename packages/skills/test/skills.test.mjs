import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as skills from '../src/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

test('skills re-exports the core helpers and is a Cordis service', () => {
  assert.equal(skills.name, 'kvd-skills');
  assert.deepEqual(skills.inject, ['llm', 'vault', 'vaultSearch', 'proposals']);
  assert.equal(typeof skills.pickParaDest, 'function');
  assert.equal(typeof skills.createSkillsEngine, 'function');
});

test('no import cycle: skills does not import @kvd/llm-mock', () => {
  const src = fs.readFileSync(path.join(HERE, '..', 'src', 'index.mjs'), 'utf8');
  assert.ok(!/(from|import\()\s*'(@kvd\/llm-mock|\.\/kvd-llm-mock\.mjs)'/.test(src));
  const pkg = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'package.json'), 'utf8'));
  assert.ok(!pkg.dependencies['@kvd/llm-mock']);
});

test('never assigns DEEPSEEK_API_KEY into process.env', () => {
  const src = fs.readFileSync(path.join(HERE, '..', 'src', 'index.mjs'), 'utf8');
  assert.ok(!/process\.env\.DEEPSEEK_API_KEY\s*=/.test(src));
});
