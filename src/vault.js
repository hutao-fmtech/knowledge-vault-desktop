'use strict';

const fs = require('fs');
const path = require('path');
const { sanitizeVaultName } = require('./sanitize');

function isNonEmptyDir(dirPath) {
  if (!fs.existsSync(dirPath)) return false;
  const st = fs.statSync(dirPath);
  if (!st.isDirectory()) return true;
  return fs.readdirSync(dirPath).length > 0;
}

function removeTree(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(from, to);
    } else if (entry.isSymbolicLink()) {
      continue;
    } else {
      fs.copyFileSync(from, to);
    }
  }
}

/**
 * Build a shallow skeleton tree for UI preview (dirs + a few files per level).
 */
function buildSkeletonPreview(root, maxDepth = 2, maxChildren = 12) {
  function walk(dir, depth) {
    const name = path.basename(dir);
    const node = { name, path: dir, children: [] };
    if (depth >= maxDepth) return node;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return node;
    }
    const dirs = entries.filter((e) => e.isDirectory() && e.name !== '.git');
    const files = entries.filter((e) => e.isFile());
    const shown = [
      ...dirs.slice(0, maxChildren),
      ...files.filter((f) => /\.(md|canvas)$/i.test(f.name)).slice(0, 3),
    ].slice(0, maxChildren);
    for (const e of shown) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        node.children.push(walk(full, depth + 1));
      } else {
        node.children.push({ name: e.name, path: full, children: [] });
      }
    }
    return node;
  }
  return walk(root, 0);
}

function topLevelSkeletonLabels(templateRoot) {
  try {
    return fs
      .readdirSync(templateRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

const REQUIRED_TOP = [
  '00-系统',
  '01-收件箱',
  '02-项目',
  '03-领域',
  '04-资源',
  '05-归档',
  '10-卡片盒',
  '20-日志',
  '30-输出',
  '90-附件',
  '.obsidian',
];

function validateVault(vaultPath) {
  const missing = [];
  for (const name of REQUIRED_TOP) {
    if (!fs.existsSync(path.join(vaultPath, name))) missing.push(name);
  }
  return missing;
}

/**
 * Materialize bundled template into D/N.
 */
function createVault({ parentDir, rawName, templateRoot }) {
  if (!parentDir || !fs.existsSync(parentDir) || !fs.statSync(parentDir).isDirectory()) {
    return { ok: false, error: '请选择有效的父目录' };
  }
  if (!templateRoot || !fs.existsSync(templateRoot)) {
    return { ok: false, error: '内置模板缺失，请检查 resources/template' };
  }
  const sanitized = sanitizeVaultName(rawName);
  if (!sanitized.ok) return sanitized;

  const vaultPath = path.join(parentDir, sanitized.name);
  if (isNonEmptyDir(vaultPath)) {
    return {
      ok: false,
      error: `目标已存在且非空：${vaultPath}\n请改名或更换目录（不会覆盖）。`,
    };
  }

  const createdHere = !fs.existsSync(vaultPath);
  try {
    fs.mkdirSync(vaultPath, { recursive: true });
    for (const entry of fs.readdirSync(templateRoot, { withFileTypes: true })) {
      if (entry.name === 'TEMPLATE_PROVENANCE.md') continue;
      const from = path.join(templateRoot, entry.name);
      const to = path.join(vaultPath, entry.name);
      if (entry.isDirectory()) {
        copyDirRecursive(from, to);
      } else if (entry.isSymbolicLink()) {
        continue;
      } else {
        fs.copyFileSync(from, to);
      }
    }
    const missing = validateVault(vaultPath);
    if (missing.length) {
      throw new Error(`模板不完整，缺少：${missing.join(', ')}`);
    }
  } catch (err) {
    try {
      if (createdHere || (fs.existsSync(vaultPath) && fs.readdirSync(vaultPath).length)) {
        removeTree(vaultPath);
      }
    } catch {
      /* best-effort cleanup */
    }
    const msg = err && err.code === 'EACCES'
      ? `权限不足：${err.message}`
      : err && err.code === 'ENOSPC'
        ? `磁盘空间不足：${err.message}`
        : `创建失败：${err.message}`;
    return { ok: false, error: msg };
  }

  const tree = buildSkeletonPreview(vaultPath, 2, 14);
  const labels = topLevelSkeletonLabels(vaultPath);
  return { ok: true, vaultPath, name: sanitized.name, tree, labels };
}

module.exports = {
  sanitizeVaultName,
  createVault,
  buildSkeletonPreview,
  topLevelSkeletonLabels,
  isNonEmptyDir,
  validateVault,
  REQUIRED_TOP,
};
