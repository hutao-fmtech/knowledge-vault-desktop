'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const APP = path.join(__dirname, '..', 'apps', 'desktop');
const dist = path.join(APP, 'dist');
// Installer names follow the app version (apps/desktop/package.json), never a hardcoded one.
const { version, build } = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8'));
const productName = (build && build.productName) || 'Knowledge Vault';
const src = path.join(dist, 'win-unpacked');
const out = path.join(dist, `${productName}-${version}-win-x64-portable.zip`);
if (!fs.existsSync(src)) {
  console.error('Missing apps/desktop/dist/win-unpacked — run electron-builder --win --dir first');
  process.exit(1);
}
const python = process.platform === 'win32' ? 'python' : 'python3';
execFileSync(python, ['-c', `
import zipfile, os
src=${JSON.stringify(src)}
out=${JSON.stringify(out)}
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
  for root, dirs, files in os.walk(src):
    for f in files:
      p=os.path.join(root,f)
      z.write(p, os.path.relpath(p, os.path.dirname(src)))
print('wrote', out, os.path.getsize(out))
`], { stdio: 'inherit' });
