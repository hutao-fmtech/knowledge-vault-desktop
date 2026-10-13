#!/usr/bin/env node
/** tsc only emits JS: copy the renderer's static assets next to lib/renderer/app.js. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'apps', 'desktop', 'src', 'renderer');
const OUT = path.join(ROOT, 'apps', 'desktop', 'lib', 'renderer');
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(SRC)) {
  if (/\.(html|css)$/.test(f)) fs.copyFileSync(path.join(SRC, f), path.join(OUT, f));
}
console.log(`RENDERER_ASSETS_OK ${path.relative(ROOT, OUT)}`);
