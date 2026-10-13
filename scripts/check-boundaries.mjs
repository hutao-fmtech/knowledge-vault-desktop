#!/usr/bin/env node
/**
 * Workspace dependency boundaries (mirrors dsh-orb scripts/check-boundaries.mjs, JS edition).
 *
 * For apps/* and packages/* (each a workspace package with its own package.json):
 *  1. every bare import specifier in src/ and test/ (static import/export-from,
 *     dynamic import('x'), require('x'), createRequire(...)('x')) must name a
 *     package declared in THAT package's own package.json
 *     (dependencies / peerDependencies / optionalDependencies; test/ may also use
 *     devDependencies). Node builtins are exempt. @kvd/* is NOT exempt.
 *  2. @kvd/* deps must use the workspace: protocol and target a real public
 *     export (package.json "exports") of the target package.
 *  3. relative imports must stay inside the owning package directory (no
 *     ../../packages/x/src reach-ins, no app <-> package relative crossings);
 *     absolute / file: specifiers are forbidden.
 *  4. the @kvd/* dependency graph is acyclic.
 *  5. every `name` in apps/desktop/cordis.yml is a declared dependency of apps/desktop.
 * Exits 1 on any violation (CI gate).
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';
import yaml from 'js-yaml';

const SOURCE_EXT = /\.(?:c|m)?js$/;

export function packageNameOf(specifier) {
  return specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
}

/** Collect string-literal module specifiers from JS source (comments/JSDoc ignored). */
export function sourceImports(text, filename) {
  const sourceType = filename.endsWith('.cjs') || (filename.endsWith('.js') && !/^\s*(import|export)\s/m.test(text))
    ? 'script' : 'module';
  const ast = acorn.parse(text, { ecmaVersion: 'latest', sourceType, locations: true, allowHashBang: true, allowReturnOutsideFunction: true });
  const out = [];
  const lit = (n) => (n && n.type === 'Literal' && typeof n.value === 'string' ? n : null);
  const push = (n) => { if (n) out.push({ specifier: n.value, line: n.loc.start.line }); };
  (function visit(node) {
    if (!node || typeof node.type !== 'string') return;
    switch (node.type) {
      case 'ImportDeclaration':
      case 'ExportAllDeclaration':
      case 'ExportNamedDeclaration':
        push(lit(node.source));
        break;
      case 'ImportExpression':
        push(lit(node.source));
        break;
      case 'CallExpression': {
        const c = node.callee;
        const isRequire = (c.type === 'Identifier' && c.name === 'require')
          || (c.type === 'CallExpression' && c.callee.type === 'Identifier' && c.callee.name === 'createRequire');
        if (isRequire) push(lit(node.arguments[0]));
        break;
      }
      default:
    }
    for (const key of Object.keys(node)) {
      if (key === 'loc') continue;
      const v = node[key];
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v.type === 'string') visit(v);
    }
  })(ast);
  return out;
}

function sourceFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : sourceFiles(p);
    return SOURCE_EXT.test(e.name) ? [p] : [];
  });
}

export function workspacePackages(root) {
  return ['apps', 'packages'].flatMap((group) => {
    const g = path.join(root, group);
    if (!existsSync(g)) return [];
    return readdirSync(g, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(path.join(g, e.name, 'package.json')))
      .map((e) => {
        const directory = path.join(g, e.name);
        return { directory, manifest: JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8')) };
      });
  });
}

/**
 * @returns {string|undefined} error for one import, or undefined if allowed
 */
export function checkImport({ specifier, filename, packageDir, deps, devDeps, isTest, manifests }) {
  if (specifier.startsWith('.')) {
    const target = path.resolve(path.dirname(filename), specifier);
    const rel = path.relative(packageDir, target);
    if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
      return `relative import crosses the package boundary: ${specifier}`;
    }
    return undefined;
  }
  if (path.isAbsolute(specifier) || specifier.startsWith('file:')) return `absolute source import: ${specifier}`;
  if (isBuiltin(specifier)) return undefined;
  const name = packageNameOf(specifier);
  // electron is provided by the Electron runtime; electron-builder requires it in devDependencies.
  const declared = Object.hasOwn(deps, name) || (isTest && Object.hasOwn(devDeps, name))
    || (name === 'electron' && Object.hasOwn(devDeps, name));
  if (!declared) return `undeclared dependency: ${name} (add it to this package's package.json)`;
  if (name.startsWith('@kvd/')) {
    const target = manifests.get(name);
    if (!target) return `unknown workspace package: ${name}`;
    const sub = specifier === name ? '.' : `.${specifier.slice(name.length)}`;
    if (!Object.hasOwn(target.exports ?? {}, sub)) return `not a public export of ${name}: ${specifier}`;
  }
  return undefined;
}

export function checkBoundaries(root) {
  const pkgs = workspacePackages(root);
  const manifests = new Map(pkgs.map((p) => [p.manifest.name, p.manifest]));
  const errors = [];
  const graph = new Map();
  for (const { directory, manifest } of pkgs) {
    const owner = manifest.name;
    const rel = path.relative(root, directory);
    const deps = { ...manifest.dependencies, ...manifest.peerDependencies, ...manifest.optionalDependencies };
    const devDeps = { ...manifest.devDependencies };
    graph.set(owner, Object.keys(deps).filter((n) => n.startsWith('@kvd/')));
    for (const [n, v] of Object.entries({ ...deps, ...devDeps })) {
      if (n.startsWith('@kvd/') && !String(v).startsWith('workspace:')) errors.push(`${rel}/package.json: ${n} must use the workspace: protocol (got ${v})`);
      if (n.startsWith('@kvd/') && !manifests.has(n)) errors.push(`${rel}/package.json: ${n} is not a workspace package`);
    }
    if (rel.startsWith('packages')) {
      for (const must of ['src', 'test', 'README.md']) {
        if (!existsSync(path.join(directory, must))) errors.push(`${rel}: missing ${must}`);
      }
    }
    for (const sub of ['src', 'test']) {
      for (const filename of sourceFiles(path.join(directory, sub))) {
        let imports;
        try {
          imports = sourceImports(readFileSync(filename, 'utf8'), filename);
        } catch (err) {
          errors.push(`${path.relative(root, filename)}: parse error: ${err.message}`);
          continue;
        }
        for (const { specifier, line } of imports) {
          const error = checkImport({ specifier, filename, packageDir: directory, deps, devDeps, isTest: sub === 'test', manifests });
          if (error) errors.push(`${path.relative(root, filename)}:${line}: ${error}`);
        }
      }
    }
    const cordis = path.join(directory, 'cordis.yml');
    if (existsSync(cordis) && statSync(cordis).isFile()) {
      const rows = yaml.load(readFileSync(cordis, 'utf8'), { schema: yaml.CORE_SCHEMA }) || [];
      const walk = (list) => list.forEach((row) => {
        if (Array.isArray(row.children)) walk(row.children);
        else if (!Object.hasOwn(deps, packageNameOf(row.name))) errors.push(`${rel}/cordis.yml: row ${row.id} -> ${row.name}: undeclared dependency`);
        else {
          const target = manifests.get(packageNameOf(row.name));
          const sub = row.name === packageNameOf(row.name) ? '.' : `.${row.name.slice(packageNameOf(row.name).length)}`;
          if (target && !Object.hasOwn(target.exports ?? {}, sub)) errors.push(`${rel}/cordis.yml: row ${row.id} -> ${row.name}: not a public export`);
        }
      });
      walk(rows);
    }
  }
  // acyclic @kvd graph
  const state = new Map();
  const visit = (n, stack) => {
    if (state.get(n) === 2) return;
    if (state.get(n) === 1) {
      errors.push(`dependency cycle: ${[...stack.slice(stack.indexOf(n)), n].join(' -> ')}`);
      return;
    }
    state.set(n, 1);
    for (const d of graph.get(n) || []) visit(d, [...stack, n]);
    state.set(n, 2);
  };
  for (const n of graph.keys()) visit(n, []);
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const errors = checkBoundaries(root);
  if (errors.length) {
    console.error(errors.join('\n'));
    console.error(`BOUNDARIES_FAIL ${errors.length} violation(s)`);
    process.exitCode = 1;
  } else {
    console.log(`BOUNDARIES_OK ${workspacePackages(root).length} workspace packages`);
  }
}
