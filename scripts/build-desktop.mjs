#!/usr/bin/env node
/**
 * Build the Electron app from the pnpm workspace.
 *
 * electron-builder 25 refuses workspace packages that are symlinks pointing
 * outside the app dir (".../packages/x/package.json must be under apps/desktop/"),
 * so we first stage a self-contained copy of apps/desktop with
 * `pnpm deploy --prod` (workspace:* deps become real directories, hoisted
 * layout per .npmrc), then run electron-builder in that stage. Output lands in
 * apps/desktop/dist as before (installer names unchanged).
 *
 *   node scripts/build-desktop.mjs --dir --linux
 *   node scripts/build-desktop.mjs --win --publish never
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'apps', 'desktop');
const STAGE = path.join(ROOT, '.stage', 'desktop');
const OUT = path.join(APP, 'dist');
const require = createRequire(path.join(ROOT, 'package.json'));
const builderCli = require.resolve('electron-builder/cli.js');
const isWin = process.platform === 'win32';

fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(path.dirname(STAGE), { recursive: true });
execFileSync(isWin ? 'pnpm.cmd' : 'pnpm', ['--filter', 'knowledge-vault-desktop', '--prod', 'deploy', STAGE], {
  cwd: ROOT,
  stdio: 'inherit',
  shell: isWin,
});
// Never ship a stale local build or tests from the stage.
for (const junk of ['dist', 'test']) fs.rmSync(path.join(STAGE, junk), { recursive: true, force: true });
// pnpm deploy leaves `workspace:*` specs in the staged manifests; electron-builder's
// dependency walker does not understand them and silently drops transitive
// workspace deps (e.g. @kvd/skills-core via @kvd/llm-mock). Pin them to the
// staged package versions so the walker follows them.
const kvdDir = path.join(STAGE, 'node_modules', '@kvd');
const kvdVersions = Object.fromEntries(
  fs.readdirSync(kvdDir).map((d) => {
    const m = JSON.parse(fs.readFileSync(path.join(kvdDir, d, 'package.json'), 'utf8'));
    return [m.name, m.version];
  }),
);
for (const file of [path.join(STAGE, 'package.json'), ...fs.readdirSync(kvdDir).map((d) => path.join(kvdDir, d, 'package.json'))]) {
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [name, spec] of Object.entries(m[field] || {})) {
      if (String(spec).startsWith('workspace:')) {
        if (!kvdVersions[name]) throw new Error(`${file}: ${name} not staged`);
        m[field][name] = kvdVersions[name];
      }
    }
  }
  if (file === path.join(STAGE, 'package.json')) {
    // electron-builder 25's dependency walker (app-builder node-dep-tree) does not
    // follow workspace packages transitively, so the STAGED app manifest lists the
    // whole @kvd closure. The repo manifest stays exact (check-boundaries).
    for (const [name, version] of Object.entries(kvdVersions)) m.dependencies[name] = version;
  }
  // pnpm deploy may HARD-LINK staged files to the workspace sources: unlink first
  // so rewriting the staged manifest never touches packages/*/package.json.
  fs.rmSync(file);
  fs.writeFileSync(file, `${JSON.stringify(m, null, 2)}\n`);
}
for (const dir of fs.readdirSync(path.join(STAGE, 'node_modules', '@kvd'))) {
  if (fs.lstatSync(path.join(STAGE, 'node_modules', '@kvd', dir)).isSymbolicLink()) {
    throw new Error(`stage @kvd/${dir} is a symlink; electron-builder cannot pack it`);
  }
}

execFileSync(process.execPath, [builderCli, ...process.argv.slice(2).filter((a) => a !== '--'), `-c.directories.output=${OUT}`], {
  cwd: STAGE,
  stdio: 'inherit',
});
console.log(`BUILD_DESKTOP_OK ${path.relative(ROOT, OUT)}`);
