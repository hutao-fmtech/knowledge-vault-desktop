'use strict';

const views = {
  welcome: document.getElementById('view-welcome'),
  create: document.getElementById('view-create'),
  success: document.getElementById('view-success'),
};

const els = {
  labels: document.getElementById('template-labels'),
  parent: document.getElementById('input-parent'),
  name: document.getElementById('input-name'),
  nameHint: document.getElementById('name-hint'),
  pathPreview: document.getElementById('path-preview'),
  formError: document.getElementById('form-error'),
  successPath: document.getElementById('success-path'),
  successTitle: document.getElementById('success-title'),
  successTree: document.getElementById('success-tree'),
};

let state = {
  parentDir: '',
  lastVaultPath: '',
};

function show(name) {
  Object.entries(views).forEach(([k, el]) => {
    el.classList.toggle('hidden', k !== name);
  });
}

function joinPreview(parent, name) {
  if (!parent || !name) return '—';
  const sep = parent.includes('\\') && !parent.includes('/') ? '\\' : '/';
  const trimmed = parent.replace(/[\\/]+$/, '');
  return `${trimmed}${sep}${name}`;
}

function renderTree(node, prefix = '', isLast = true, lines = [], isRoot = true) {
  if (!node) return lines;
  const branch = isRoot ? '' : prefix + (isLast ? '└── ' : '├── ');
  const nextPrefix = isRoot ? '' : prefix + (isLast ? '    ' : '│   ');
  lines.push(branch + node.name + (node.children && node.children.length && !node.name.includes('.') ? '/' : ''));
  const kids = node.children || [];
  kids.forEach((child, i) => {
    renderTree(child, nextPrefix, i === kids.length - 1, lines, false);
  });
  return lines;
}

async function refreshNameHint() {
  const raw = els.name.value;
  const result = await window.vaultApi.sanitizeName(raw);
  if (!raw.trim()) {
    els.nameHint.textContent = '文件夹名预览：—';
    els.pathPreview.textContent = '—';
    return;
  }
  if (!result.ok) {
    els.nameHint.textContent = result.error;
    els.pathPreview.textContent = '—';
    return;
  }
  els.nameHint.textContent = `文件夹名预览：${result.name}`;
  els.pathPreview.textContent = joinPreview(state.parentDir, result.name);
}

async function init() {
  const preview = await window.vaultApi.getTemplatePreview();
  els.labels.innerHTML = '';
  (preview.labels || []).forEach((label) => {
    const li = document.createElement('li');
    li.textContent = label;
    els.labels.appendChild(li);
  });

  document.getElementById('btn-start').addEventListener('click', () => {
    els.formError.classList.add('hidden');
    show('create');
  });
  document.getElementById('btn-back').addEventListener('click', () => show('welcome'));
  document.getElementById('btn-pick').addEventListener('click', async () => {
    const res = await window.vaultApi.pickFolder();
    if (res.ok) {
      state.parentDir = res.path;
      els.parent.value = res.path;
      await refreshNameHint();
    }
  });
  els.name.addEventListener('input', () => { refreshNameHint(); });

  document.getElementById('btn-create').addEventListener('click', async () => {
    els.formError.classList.add('hidden');
    const btn = document.getElementById('btn-create');
    btn.disabled = true;
    try {
      const result = await window.vaultApi.createVault({
        parentDir: state.parentDir,
        rawName: els.name.value,
      });
      if (!result.ok) {
        els.formError.textContent = result.error;
        els.formError.classList.remove('hidden');
        return;
      }
      state.lastVaultPath = result.vaultPath;
      els.successPath.textContent = result.vaultPath;
      els.successTitle.textContent = `「${result.name}」已就绪`;
      const lines = renderTree(result.tree);
      els.successTree.textContent = lines.join('\n');
      show('success');
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('btn-reveal').addEventListener('click', () => {
    if (state.lastVaultPath) window.vaultApi.showItemInFolder(state.lastVaultPath);
  });
  document.getElementById('btn-another').addEventListener('click', () => {
    els.name.value = '';
    els.formError.classList.add('hidden');
    refreshNameHint();
    show('create');
  });
}

init();
