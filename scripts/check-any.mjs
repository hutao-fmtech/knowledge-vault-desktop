#!/usr/bin/env node
/**
 * RS-9 `any` gate: every explicit `any` type (AnyKeyword anywhere in a type —
 * `: any`, `as any`, `<any>`, `any[]`, `Record<string, any>`, ...) and every
 * `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck` in apps/* and packages/*
 * TypeScript (src/ and test/) must carry an inline justification:
 *
 *   const x = y as any; // any: <reason>
 *   // any: <reason>            (on the line directly above also counts)
 *   // @ts-expect-error any: <reason>
 *
 * Exits 1 on any unjustified occurrence. Prints `ANY_CHECK_OK <n> justified`.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const TS_EXT = /\.(?:c|m)?ts$/;
const REASON = /(?:\/\/|@ts-[\w-]+)\s*any:\s*\S/;
const DIRECTIVE = /@ts-(?:ignore|expect-error|nocheck)\b/;

function files(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return ['node_modules', 'lib'].includes(e.name) ? [] : files(p);
    return TS_EXT.test(e.name) ? [p] : [];
  });
}

function justified(lines, i) {
  return REASON.test(lines[i] ?? '') || REASON.test(lines[i - 1] ?? '');
}

/** @returns {{ line: number, kind: string, ok: boolean, text: string }[]} */
export function scanSource(text, filename = 'x.ts') {
  const lines = text.split('\n');
  const out = [];
  const sf = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true);
  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      const i = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
      out.push({ line: i + 1, kind: 'any', ok: justified(lines, i), text: (lines[i] ?? '').trim() });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  lines.forEach((l, i) => {
    if (DIRECTIVE.test(l)) out.push({ line: i + 1, kind: l.match(DIRECTIVE)[0], ok: justified(lines, i), text: l.trim() });
  });
  return out.sort((a, b) => a.line - b.line);
}

export function checkAny(root) {
  const hits = [];
  for (const group of ['apps', 'packages']) {
    const g = path.join(root, group);
    if (!existsSync(g)) continue;
    for (const pkg of readdirSync(g)) {
      for (const sub of ['src', 'test']) {
        for (const f of files(path.join(g, pkg, sub))) {
          for (const h of scanSource(readFileSync(f, 'utf8'), f)) hits.push({ file: path.relative(root, f), ...h });
        }
      }
    }
  }
  return hits;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const hits = checkAny(root);
  const bad = hits.filter((h) => !h.ok);
  for (const h of hits) console.log(`${h.ok ? 'justified' : 'UNJUSTIFIED'} ${h.kind} ${h.file}:${h.line}  ${h.text}`);
  if (bad.length) {
    console.error(`ANY_CHECK_FAIL ${bad.length} unjustified any/ts-directive(s); add an inline \`// any: <reason>\``);
    process.exitCode = 1;
  } else {
    console.log(`ANY_CHECK_OK ${hits.length} justified`);
  }
}
