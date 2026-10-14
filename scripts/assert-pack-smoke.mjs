#!/usr/bin/env node
/**
 * Assert the packaged-app pack-smoke output (`<app> --kvd-pack-smoke`):
 *  - Electron's Node >= 22.12
 *  - composition was read from cordis.yml INSIDE app.asar
 *  - every plugin row declared in apps/desktop/cordis.yml (default + advanced)
 *    was actually mounted by the packaged app
 *  - template shipped, dispose ran, KVD_PACK_SMOKE_OK printed
 *  - the entry is the compiled lib/main.js inside app.asar (R2: tsc output)
 *  - app.getVersion() === apps/desktop/package.json version
 *  - every @deepseek-ai module reachable from dsh-session imports inside app.asar,
 *    and an offline advanced task reaches approval/request (v0.2.3 dsh-scope bug)
 *  - the real renderer launches: preload exposes vaultApi, app.js renders the
 *    template labels over IPC, and its IPC is classified LOCAL (not REMOTE)
 * Usage: node scripts/assert-pack-smoke.mjs <pack-smoke-output.txt>
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = fs.readFileSync(process.argv[2], 'utf8');
const fail = (msg) => {
  console.error(`PACK_SMOKE_ASSERT_FAIL ${msg}`);
  process.exit(1);
};
const line = (tag) => out.split('\n').reverse().find((l) => l.startsWith(`${tag} `));

const nodeVer = (line('KVD_NODE_VERSION') || '').split(' ')[1] || '';
const [maj, min] = nodeVer.split('.').map(Number);
if (!(maj > 22 || (maj === 22 && min >= 12))) fail(`node too old: ${nodeVer}`);

const src = line('KVD_COMPOSITION_SOURCE');
if (!src || !/cordis\.yml asar$/.test(src)) fail(`composition not read from cordis.yml in asar: ${src}`);

const rows = yaml.load(fs.readFileSync(path.join(ROOT, 'apps', 'desktop', 'cordis.yml'), 'utf8'), { schema: yaml.CORE_SCHEMA });
const expected = rows.flatMap((r) => (Array.isArray(r.children) ? r.children : [r])).filter((r) => !r.disabled && (!r.platforms || r.platforms.includes(process.platform))).map((r) => r.id);
const mountedLine = line('KVD_PLUGINS_MOUNTED');
if (!mountedLine) fail('no KVD_PLUGINS_MOUNTED line');
const [, count, list = ''] = mountedLine.split(' ');
const mounted = list.split(',').filter(Boolean);
const missing = expected.filter((id) => !mounted.includes(id));
const extra = mounted.filter((id) => !expected.includes(id));
if (missing.length) fail(`plugins declared in cordis.yml but not mounted: ${missing.join(',')}`);
if (extra.length) fail(`plugins mounted but not declared: ${extra.join(',')}`);
if (Number(count) !== expected.length) fail(`count ${count} != ${expected.length}`);
const appPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'desktop', 'package.json'), 'utf8'));
const ver = (line('KVD_APP_VERSION') || '').split(' ')[1];
if (ver !== appPkg.version) fail(`app version ${ver} != apps/desktop/package.json ${appPkg.version}`);
const entry = line('KVD_ENTRY');
if (entry !== 'KVD_ENTRY lib/main.js asar') fail(`entry is not lib/main.js in asar: ${entry}`);
const renderer = JSON.parse((line('KVD_RENDERER') || 'KVD_RENDERER {}').slice('KVD_RENDERER '.length));
if (!renderer.ok || renderer.vaultApi !== 'object' || !(renderer.labels > 0) || renderer.localIpc !== true) fail(`renderer launch probe failed: ${JSON.stringify(renderer)}`);
const dsh = JSON.parse((line('KVD_DSH_IMPORTS') || 'KVD_DSH_IMPORTS {}').slice('KVD_DSH_IMPORTS '.length));
if (!dsh.ok || !Array.isArray(dsh.modules) || !dsh.modules.includes('@deepseek-ai/dsh-session') || !dsh.modules.includes('@deepseek-ai/dsh-scope')) fail(`dsh-* closure did not import from asar: ${JSON.stringify(dsh)}`);
const task = JSON.parse((line('KVD_ADVANCED_TASK') || 'KVD_ADVANCED_TASK {}').slice('KVD_ADVANCED_TASK '.length));
if (!task.ok || !(task.approvals > 0) || task.executed !== false) fail(`advanced task did not reach approval/request offline: ${JSON.stringify(task)}`);
for (const tag of ['KVD_SMOKE_MOUNT', 'KVD_TEMPLATE_OK', 'KVD_PACK_SMOKE_OK']) if (!line(tag)) fail(`missing ${tag}`);
for (const id of expected) console.log(`  plugin ok: ${id}`);
console.log(`  dsh modules imported: ${dsh.count}; advanced task approvals: ${task.approvals}`);
console.log(`PACK_SMOKE_ASSERT_OK version=${ver} entry=lib/main.js(asar) node=${nodeVer} plugins=${mounted.length}/${expected.length} source=cordis.yml(asar)`);
