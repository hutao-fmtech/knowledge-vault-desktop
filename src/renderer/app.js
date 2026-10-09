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
  shell: document.getElementById('shell'),
  sidebar: document.getElementById('agent-sidebar'),
  agentVault: document.getElementById('agent-vault'),
  agentKeyState: document.getElementById('agent-key-state'),
  agentPrivacy: document.getElementById('agent-privacy'),
  agentAnswer: document.getElementById('agent-answer'),
  proposalList: document.getElementById('proposal-list'),
  selectInbox: document.getElementById('select-inbox'),
  inputAsk: document.getElementById('input-ask'),
  inputKey: document.getElementById('input-api-key'),
};

let state = {
  parentDir: '',
  lastVaultPath: '',
  proposals: [],
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

function renderProposals() {
  els.proposalList.innerHTML = '';
  if (!state.proposals.length) {
    els.proposalList.innerHTML = '<p class="muted">暂无拟改动。</p>';
    return;
  }
  for (const p of state.proposals) {
    const div = document.createElement('div');
    div.className = 'proposal';
    let detail = '';
    if (p.kind === 'move') detail = `${p.from} → ${p.to}`;
    else if (p.kind === 'create') detail = `创建 ${p.path}\n\n${(p.content || '').slice(0, 400)}`;
    else if (p.kind === 'edit') detail = `编辑 ${p.path}`;
    div.innerHTML = `<div class="meta">${p.summary || p.kind}</div><pre></pre><div class="actions"></div>`;
    div.querySelector('pre').textContent = detail;
    const actions = div.querySelector('.actions');
    const applyBtn = document.createElement('button');
    applyBtn.className = 'primary';
    applyBtn.textContent = 'Apply';
    applyBtn.addEventListener('click', async () => {
      const res = await window.vaultApi.agentApply(p.id);
      if (!res.ok) {
        els.agentAnswer.textContent = res.error;
        return;
      }
      state.proposals = state.proposals.filter((x) => x.id !== p.id);
      renderProposals();
      els.agentAnswer.textContent = `已落盘：${p.summary || p.kind}`;
      await refreshInbox();
    });
    const discardBtn = document.createElement('button');
    discardBtn.className = 'secondary';
    discardBtn.textContent = 'Discard';
    discardBtn.addEventListener('click', async () => {
      await window.vaultApi.agentDiscard(p.id);
      state.proposals = state.proposals.filter((x) => x.id !== p.id);
      renderProposals();
    });
    actions.appendChild(applyBtn);
    actions.appendChild(discardBtn);
    els.proposalList.appendChild(div);
  }
}

async function refreshAgentChrome() {
  const st = await window.vaultApi.agentStatus();
  els.agentVault.textContent = st.vaultPath ? `Vault：${st.vaultPath}` : '未打开 vault';
  els.agentKeyState.textContent = st.hasKey
    ? '已保存 API key（不在 vault / 仓库内）。引擎：DeepSeek 模型调用。'
    : '未配置 key：使用本地模拟引擎（不联网），仍可预览拟改动。';
  els.agentPrivacy.classList.toggle('hidden', st.privacyAccepted || !st.hasKey);
}

async function refreshInbox() {
  const res = await window.vaultApi.agentListInbox();
  els.selectInbox.innerHTML = '';
  if (!res.ok || !res.notes.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = res.ok ? '（收件箱为空）' : res.error;
    els.selectInbox.appendChild(opt);
    return;
  }
  for (const n of res.notes) {
    const opt = document.createElement('option');
    opt.value = n;
    opt.textContent = n;
    els.selectInbox.appendChild(opt);
  }
}

async function openAgent(vaultPath) {
  if (vaultPath) await window.vaultApi.agentSetVault(vaultPath);
  els.sidebar.classList.remove('hidden');
  els.shell.classList.add('with-agent');
  state.proposals = [];
  renderProposals();
  await refreshAgentChrome();
  await refreshInbox();
}

function closeAgent() {
  els.sidebar.classList.add('hidden');
  els.shell.classList.remove('with-agent');
}

function mergeProposals(res) {
  if (res.proposals && res.proposals.length) {
    state.proposals = state.proposals.concat(res.proposals);
    renderProposals();
  }
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

  document.getElementById('btn-open-existing').addEventListener('click', async () => {
    const res = await window.vaultApi.openVault();
    if (!res.ok) return;
    state.lastVaultPath = res.vaultPath;
    els.successPath.textContent = res.vaultPath;
    els.successTitle.textContent = '已打开知识库';
    els.successTree.textContent = '（已有 vault）';
    show('success');
    await openAgent(res.vaultPath);
  });

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
      els.successTree.textContent = renderTree(result.tree).join('\n');
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
  document.getElementById('btn-open-agent').addEventListener('click', async () => {
    await openAgent(state.lastVaultPath);
  });
  document.getElementById('btn-close-agent').addEventListener('click', closeAgent);

  document.getElementById('btn-accept-privacy').addEventListener('click', async () => {
    await window.vaultApi.agentAcceptPrivacy();
    await refreshAgentChrome();
  });
  document.getElementById('btn-save-key').addEventListener('click', async () => {
    const res = await window.vaultApi.agentSaveKey(els.inputKey.value);
    els.inputKey.value = '';
    els.agentAnswer.textContent = res.ok ? `Key 已保存（${res.mode}）` : res.error;
    await refreshAgentChrome();
  });
  document.getElementById('btn-clear-key').addEventListener('click', async () => {
    await window.vaultApi.agentClearKey();
    await refreshAgentChrome();
  });

  document.getElementById('btn-ask').addEventListener('click', async () => {
    const q = els.inputAsk.value.trim();
    if (!q) return;
    els.agentAnswer.textContent = '思考中…';
    const res = await window.vaultApi.agentAsk(q);
    if (!res.ok) {
      els.agentAnswer.textContent = res.error;
      if (res.needPrivacy) els.agentPrivacy.classList.remove('hidden');
      return;
    }
    els.agentAnswer.textContent = res.answer || '';
    mergeProposals(res);
  });

  document.getElementById('btn-sort').addEventListener('click', async () => {
    const note = els.selectInbox.value;
    if (!note) return;
    els.agentAnswer.textContent = '归类中…';
    const res = await window.vaultApi.agentSort(note);
    els.agentAnswer.textContent = res.ok ? res.answer : res.error;
    if (res.ok) mergeProposals(res);
  });

  document.getElementById('btn-card').addEventListener('click', async () => {
    const note = els.selectInbox.value;
    if (!note) return;
    els.agentAnswer.textContent = '生成卡片…';
    const res = await window.vaultApi.agentCard(note);
    els.agentAnswer.textContent = res.ok ? res.answer : res.error;
    if (res.ok) mergeProposals(res);
  });

  renderProposals();
}

init();
