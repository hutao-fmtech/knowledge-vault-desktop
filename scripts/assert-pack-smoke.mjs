#!/usr/bin/env node
/**
 * Assert the packaged-app pack-smoke output (`<app> --kvd-pack-smoke`):
 *  - Electron's Node >= 22.12
 *  - composition was read from cordis.yml INSIDE app.asar
 *  - every plugin row declared in apps/desktop/cordis.yml (default + advanced)
 *    was actually mounted by the packaged app
 *  - template shipped, dispose ran, KVD_PACK_SMOKE_OK printed
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
const expected = rows.flatMap((r) => (Array.isArray(r.children) ? r.children : [r])).filter((r) => !r.disabled).map((r) => r.id);
const mountedLine = line('KVD_PLUGINS_MOUNTED');
if (!mountedLine) fail('no KVD_PLUGINS_MOUNTED line');
const [, count, list = ''] = mountedLine.split(' ');
const mounted = list.split(',').filter(Boolean);
const missing = expected.filter((id) => !mounted.includes(id));
const extra = mounted.filter((id) => !expected.includes(id));
if (missing.length) fail(`plugins declared in cordis.yml but not mounted: ${missing.join(',')}`);
if (extra.length) fail(`plugins mounted but not declared: ${extra.join(',')}`);
if (Number(count) !== expected.length) fail(`count ${count} != ${expected.length}`);
for (const tag of ['KVD_SMOKE_MOUNT', 'KVD_TEMPLATE_OK', 'KVD_PACK_SMOKE_OK']) if (!line(tag)) fail(`missing ${tag}`);
for (const id of expected) console.log(`  plugin ok: ${id}`);
console.log(`PACK_SMOKE_ASSERT_OK node=${nodeVer} plugins=${mounted.length}/${expected.length} source=cordis.yml(asar)`);
