import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkAny, scanSource } from '../check-any.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('the real repository has no unjustified any', () => {
  assert.deepEqual(checkAny(ROOT).filter((h) => !h.ok), []);
});

test('unjustified any forms are caught', () => {
  const src = [
    'let a: any;',
    'const b = x as any;',
    'const c = <any>x;',
    'let d: any[] = [];',
    'let e: Record<string, any> = {};',
    '// @ts-ignore',
    'f();',
    '// @ts-expect-error',
    'g();',
  ].join('\n');
  const hits = scanSource(src);
  assert.equal(hits.filter((h) => !h.ok).length, 7);
});

test('inline or preceding `// any: reason` justifies; empty reason does not', () => {
  const src = [
    'let a: any; // any: third-party callback is untyped',
    '// any: JSON from disk, validated below',
    'const b = JSON.parse(s) as any;',
    '// @ts-expect-error any: upstream d.ts is wrong (issue #1)',
    'h();',
    'let c: any; // any:',
    'const s = "any string"; // the word any in a string is not a type',
  ].join('\n');
  const hits = scanSource(src);
  assert.deepEqual(hits.map((h) => h.ok), [true, true, true, false]);
});
