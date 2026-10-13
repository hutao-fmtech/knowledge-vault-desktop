import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkBoundaries, sourceImports } from '../check-boundaries.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kvd-bound-'));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), typeof body === 'string' ? body : JSON.stringify(body));
  }
  return root;
}
const pkg = (name, extra = {}) => ({ name, version: '0.0.0', exports: { '.': './src/index.mjs' }, ...extra });
const base = {
  'packages/a/README.md': '#',
  'packages/a/test/a.test.mjs': '',
  'packages/b/README.md': '#',
  'packages/b/test/b.test.mjs': '',
  'packages/b/package.json': pkg('@kvd/b'),
  'packages/b/src/index.mjs': 'export const b = 1;',
};

test('the real repository passes', () => {
  assert.deepEqual(checkBoundaries(ROOT), []);
});

test('undeclared @kvd/* import fails', () => {
  const root = fixture({ ...base, 'packages/a/package.json': pkg('@kvd/a'), 'packages/a/src/index.mjs': "import { b } from '@kvd/b';" });
  assert.match(checkBoundaries(root).join('\n'), /undeclared dependency: @kvd\/b/);
});

test('undeclared third-party import (require + dynamic import) fails; JSDoc import() ignored', () => {
  const root = fixture({
    ...base,
    'packages/a/package.json': pkg('@kvd/a'),
    'packages/a/src/index.mjs': "/** @type {import('nope-types')} */\nconst x = await import('left-pad');\nexport default x;",
    'packages/a/src/c.js': "const y = require('lodash');\nmodule.exports = y;",
  });
  const errs = checkBoundaries(root).join('\n');
  assert.match(errs, /left-pad/);
  assert.match(errs, /lodash/);
  assert.doesNotMatch(errs, /nope-types/);
});

test('relative import crossing package dirs fails', () => {
  const root = fixture({ ...base, 'packages/a/package.json': pkg('@kvd/a'), 'packages/a/src/index.mjs': "import { b } from '../../b/src/index.mjs';" });
  assert.match(checkBoundaries(root).join('\n'), /crosses the package boundary/);
});

test('non-workspace protocol, private subpath and cycles fail', () => {
  const root = fixture({
    ...base,
    'packages/a/package.json': pkg('@kvd/a', { dependencies: { '@kvd/b': '0.0.0' } }),
    'packages/a/src/index.mjs': "import x from '@kvd/b/src/secret.mjs';",
    'packages/b/package.json': pkg('@kvd/b', { dependencies: { '@kvd/a': 'workspace:*' } }),
  });
  const errs = checkBoundaries(root).join('\n');
  assert.match(errs, /workspace: protocol/);
  assert.match(errs, /not a public export/);
  assert.match(errs, /dependency cycle/);
});

test('sourceImports sees static, export-from, dynamic, require and createRequire', () => {
  const found = sourceImports(
    "import a from 'a';\nexport * from 'b';\nawait import('c');\nconst r = createRequire(import.meta.url);\nr('d');\ncreateRequire(import.meta.url)('e');\n// require('f')",
    'x.mjs',
  ).map((i) => i.specifier);
  assert.deepEqual(found, ['a', 'b', 'c', 'e']);
});
