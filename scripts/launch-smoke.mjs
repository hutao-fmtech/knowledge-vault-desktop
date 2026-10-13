#!/usr/bin/env node
/**
 * Launch the PACKAGED app headless on the current OS and assert it
 * (scripts/assert-pack-smoke.mjs): version === apps/desktop/package.json,
 * entry = lib/main.js in app.asar, cordis.yml read from asar, all plugins
 * mounted, renderer + preload load and IPC is LOCAL.
 *
 *   node scripts/launch-smoke.mjs                 # auto-detect unpacked dir
 *   node scripts/launch-smoke.mjs --app <path>    # explicit executable
 *   node scripts/launch-smoke.mjs --arch x64      # mac: pick dist/mac (x64)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'apps', 'desktop');
const DIST = path.join(APP, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8'));
const productName = pkg.build?.productName || pkg.name;
const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };

function findExecutable() {
  if (opt('--app')) return opt('--app');
  if (process.platform === 'win32') return path.join(DIST, 'win-unpacked', `${productName}.exe`);
  if (process.platform === 'darwin') {
    const arch = opt('--arch') || process.arch;
    const dir = arch === 'arm64' ? 'mac-arm64' : arch === 'universal' ? 'mac-universal' : 'mac';
    return path.join(DIST, dir, `${productName}.app`, 'Contents', 'MacOS', productName);
  }
  return path.join(DIST, 'linux-unpacked', pkg.name);
}

const exe = findExecutable();
if (!fs.existsSync(exe)) {
  console.error(`LAUNCH_SMOKE_FAIL missing executable ${exe}`);
  process.exit(1);
}
const outFile = path.join(os.tmpdir(), `kvd-launch-smoke-${process.pid}.txt`);
const args = ['--kvd-pack-smoke'];
let cmd = exe;
let cmdArgs = args;
if (process.platform === 'linux') {
  cmd = 'xvfb-run';
  cmdArgs = ['-a', exe, '--no-sandbox', ...args];
} else if (process.platform === 'darwin' && opt('--arch') === 'x64' && process.arch === 'arm64') {
  cmd = 'arch';
  cmdArgs = ['-x86_64', exe, ...args];
}
console.log(`launching ${[cmd, ...cmdArgs].join(' ')}`);
const res = spawnSync(cmd, cmdArgs, { encoding: 'utf8', timeout: 180_000, env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' } });
const output = `${res.stdout || ''}\n${res.stderr || ''}`;
fs.writeFileSync(outFile, output);
console.log(output.split('\n').filter((l) => l.startsWith('KVD_')).map((l) => l.slice(0, 240)).join('\n'));
if (res.error || res.status !== 0) {
  console.error(output);
  console.error(`LAUNCH_SMOKE_FAIL exit=${res.status} ${res.error ? res.error.message : ''}`);
  process.exit(1);
}
const check = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'assert-pack-smoke.mjs'), outFile], { stdio: 'inherit' });
if (check.status !== 0) process.exit(check.status || 1);
console.log(`LAUNCH_SMOKE_OK ${process.platform}-${opt('--arch') || process.arch} version=${pkg.version}`);
