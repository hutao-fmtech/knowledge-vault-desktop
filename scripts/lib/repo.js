'use strict';

/**
 * Monorepo layout helpers for the smokes: the app lives in apps/desktop, each
 * capability in packages/<name>. Static policy checks walk ALL of them.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const APP = path.join(ROOT, 'apps', 'desktop');
const PACKAGES = path.join(ROOT, 'packages');

function packageDirs() {
  return fs
    .readdirSync(PACKAGES, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(PACKAGES, e.name, 'package.json')))
    .map((e) => path.join(PACKAGES, e.name));
}

/** apps/desktop + every packages/* dir. */
function workspaceDirs() {
  return [APP, ...packageDirs()];
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/** [{ dir, pkg }] for apps/desktop and every package. */
function manifests() {
  return workspaceDirs().map((dir) => ({ dir, pkg: readJson(path.join(dir, 'package.json')) }));
}

/** Every `src/` dir of the workspace (app + packages). */
function sourceRoots() {
  return workspaceDirs().map((d) => path.join(d, 'src')).filter((d) => fs.existsSync(d));
}

/** All declared specs of `name` across dependencies/peer/optional/dev of all manifests. */
function declaredVersions(name) {
  const out = [];
  for (const { dir, pkg } of manifests()) {
    for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies', 'devDependencies']) {
      if (pkg[field] && Object.prototype.hasOwnProperty.call(pkg[field], name)) {
        out.push({ where: `${path.relative(ROOT, dir)}:${field}`, spec: pkg[field][name] });
      }
    }
  }
  return out;
}

const pnpmLock = () => fs.readFileSync(path.join(ROOT, 'pnpm-lock.yaml'), 'utf8');

module.exports = { ROOT, APP, PACKAGES, packageDirs, workspaceDirs, manifests, sourceRoots, declaredVersions, pnpmLock, readJson };
