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
  initAdvanced();
}

// ---------------------------------------------------------------------------
// Advanced mode UI (Settings > Advanced, indicator, risk warnings, approvals).
// The main process is authoritative: these handlers only ask it to change
// state, and every change is confirmed back through 'advanced-state'.
// ---------------------------------------------------------------------------
const adv = {
  indicator: document.getElementById('advanced-indicator'),
  indicatorPolicy: document.getElementById('advanced-indicator-policy'),
  badge: document.getElementById('agent-badge'),
  task: document.getElementById('advanced-task'),
  taskPolicy: document.getElementById('advanced-task-policy'),
  settings: document.getElementById('modal-settings'),
  toggle: document.getElementById('toggle-advanced'),
  policySet: document.getElementById('policy-fieldset'),
  runtime: document.getElementById('advanced-runtime'),
  logPath: document.getElementById('advanced-log-path'),
  settingsError: document.getElementById('settings-error'),
  risk: document.getElementById('modal-risk'),
  riskBody: document.getElementById('risk-body'),
  riskAck: document.getElementById('risk-ack'),
  riskConfirm: document.getElementById('btn-risk-confirm'),
  approval: document.getElementById('modal-approval'),
  approvalTool: document.getElementById('approval-tool'),
  approvalNested: document.getElementById('approval-nested'),
  approvalQueue: document.getElementById('approval-queue'),
  approvalCmdWrap: document.getElementById('approval-command-wrap'),
  approvalCmd: document.getElementById('approval-command'),
  approvalArgs: document.getElementById('approval-args'),
  input: document.getElementById('input-advanced'),
};
const approvalQueue = [];
let advState = { enabled: false, policy: 'approve' };

const POLICY_LABEL = { approve: '逐次审批', 'log-only': '直接执行（仅记录）' };

const RISK_TEXT = {
  enable: `<p>开启高级档后，Agent 可以在 dsh 沙箱 profile 中调用内置工具（如 bash 命令、读取文件）。</p>
<ul><li>工具在只读沙箱中运行，工作目录为当前 vault；修改笔记仍只能生成拟改动，需你 Apply。</li>
<li>命令可以读取 vault 内容，并可能读取本机其它可读文件；读取结果会发送给模型服务。</li>
<li>每次调用都会记录到本机日志（vault 之外，不含 API key）。</li>
<li>只能在本机手动开启；随时可在顶部横幅或此处关闭，立即生效。</li></ul>`,
  'log-only': `<p>选择「直接执行，仅记录」后，Agent 的工具调用将<strong>不再逐次询问</strong>，直接执行。</p>
<ul><li>你不会在执行前看到命令；只能事后在日志中查看。</li>
<li>沙箱、只读限制和拟改动 + Apply 规则仍然生效。</li>
<li>可随时切回「逐次审批」。</li></ul>`,
};

function confirmRisk(kind) {
  return new Promise((resolve) => {
    adv.riskBody.innerHTML = RISK_TEXT[kind];
    adv.riskConfirm.textContent = kind === 'enable' ? '确认开启高级档' : '确认直接执行';
    adv.riskAck.checked = false;
    adv.riskConfirm.disabled = true;
    adv.risk.classList.remove('hidden');
    const finish = (v) => {
      adv.risk.classList.add('hidden');
      adv.riskConfirm.onclick = null;
      document.getElementById('btn-risk-cancel').onclick = null;
      resolve(v);
    };
    adv.riskConfirm.onclick = () => finish(adv.riskAck.checked);
    document.getElementById('btn-risk-cancel').onclick = () => finish(false);
  });
}

function renderAdvanced(st) {
  if (!st) return;
  advState = st;
  const on = !!st.enabled;
  const label = POLICY_LABEL[st.policy] || st.policy;
  adv.indicator.classList.toggle('hidden', !on);
  adv.indicator.classList.toggle('log-only', on && st.policy === 'log-only');
  adv.indicatorPolicy.textContent = `· ${label}`;
  adv.badge.textContent = on ? `高级档 · ${label}` : '默认档';
  adv.badge.className = on ? (st.policy === 'log-only' ? 'badge badge-adv-log' : 'badge badge-adv') : 'badge';
  adv.task.classList.toggle('hidden', !on);
  adv.taskPolicy.textContent = label;
  adv.taskPolicy.className = st.policy === 'log-only' ? 'badge badge-adv-log' : 'badge badge-adv';
  adv.toggle.checked = on;
  adv.policySet.disabled = !on;
  document.querySelectorAll('input[name="tool-policy"]').forEach((r) => { r.checked = r.value === st.policy; });
  adv.logPath.textContent = st.logFile || '—';
  const rt = st.runtime || {};
  adv.runtime.textContent = !on
    ? '运行时：未启动（高级档关闭，工具不可用）'
    : rt.running
      ? `运行时：插件组合根高级档（只读沙箱）运行中`
      : `运行时：按需启动${rt.lastError ? ` · 上次错误：${rt.lastError}` : ''}`;
  if (!on) {
    approvalQueue.length = 0;
    adv.approval.classList.add('hidden');
  }
}

function showSettingsError(msg) {
  adv.settingsError.textContent = msg || '';
  adv.settingsError.classList.toggle('hidden', !msg);
}

async function enableAdvanced() {
  let res = await window.vaultApi.advancedEnable(false);
  if (!res.ok && res.needRiskAck) {
    if (!(await confirmRisk('enable'))) return renderAdvanced(advState);
    res = await window.vaultApi.advancedEnable(true);
  }
  if (!res.ok) showSettingsError(res.error || res.code);
  if (res.state) renderAdvanced({ ...advState, ...res.state });
}

async function setPolicy(policy) {
  let res = await window.vaultApi.advancedSetPolicy(policy, false);
  if (!res.ok && res.needRiskAck) {
    if (!(await confirmRisk('log-only'))) return renderAdvanced(advState);
    res = await window.vaultApi.advancedSetPolicy(policy, true);
  }
  if (!res.ok) showSettingsError(res.error || res.code);
  if (res.state) renderAdvanced({ ...advState, ...res.state });
}

function showNextApproval() {
  const req = approvalQueue[0];
  if (!req) {
    adv.approval.classList.add('hidden');
    return;
  }
  adv.approvalTool.textContent = req.tool;
  adv.approvalNested.classList.toggle('hidden', !req.nested);
  adv.approvalQueue.textContent = approvalQueue.length > 1 ? `（另有 ${approvalQueue.length - 1} 个待审批）` : '';
  adv.approvalCmdWrap.classList.toggle('hidden', req.command == null);
  adv.approvalCmd.textContent = req.command == null ? '' : req.command;
  adv.approvalArgs.textContent = JSON.stringify(req.arguments, null, 2);
  adv.approval.classList.remove('hidden');
}

async function answerApproval(decision) {
  const req = approvalQueue.shift();
  if (req) await window.vaultApi.advancedApprovalReply(req.id, decision);
  showNextApproval();
}

async function initAdvanced() {
  const open = async () => {
    showSettingsError('');
    renderAdvanced(await window.vaultApi.advancedStatus());
    adv.settings.classList.remove('hidden');
  };
  document.getElementById('btn-open-settings').addEventListener('click', open);
  document.getElementById('btn-sidebar-settings').addEventListener('click', open);
  document.getElementById('btn-close-settings').addEventListener('click', () => adv.settings.classList.add('hidden'));
  adv.riskAck.addEventListener('change', () => { adv.riskConfirm.disabled = !adv.riskAck.checked; });

  adv.toggle.addEventListener('change', async (ev) => {
    showSettingsError('');
    if (ev.target.checked) await enableAdvanced();
    else renderAdvanced({ ...advState, ...(await window.vaultApi.advancedDisable()).state });
  });
  document.querySelectorAll('input[name="tool-policy"]').forEach((r) => {
    r.addEventListener('change', (ev) => { if (ev.target.checked) setPolicy(ev.target.value); });
  });
  document.getElementById('btn-indicator-off').addEventListener('click', async () => {
    renderAdvanced({ ...advState, ...(await window.vaultApi.advancedDisable()).state });
  });
  document.getElementById('btn-reveal-log').addEventListener('click', () => window.vaultApi.advancedRevealLog());
  document.getElementById('btn-approval-allow').addEventListener('click', () => answerApproval('allow'));
  document.getElementById('btn-approval-deny').addEventListener('click', () => answerApproval('deny'));

  document.getElementById('btn-advanced-run').addEventListener('click', async () => {
    const prompt = adv.input.value.trim();
    if (!prompt) return;
    const btn = document.getElementById('btn-advanced-run');
    btn.disabled = true;
    els.agentAnswer.textContent = '高级档运行中…（工具调用会先请求审批）';
    let res;
    try {
      res = await window.vaultApi.advancedRun(prompt);
    } finally {
      btn.disabled = false;
    }
    if (!res.ok) {
      els.agentAnswer.textContent = res.error || res.code;
      if (res.needPrivacy) els.agentPrivacy.classList.remove('hidden');
      return;
    }
    const calls = (res.toolCalls || [])
      .map((c) => `· ${c.name}${c.command ? `：${c.command}` : ''}${c.isError ? '（被拒绝/失败）' : ''}`)
      .join('\n');
    els.agentAnswer.textContent = `${res.answer || ''}${calls ? `\n\n工具调用：\n${calls}` : ''}`;
    els.agentAnswer.scrollIntoView({ block: 'nearest' });
  });

  window.vaultApi.onAdvancedState((st) => renderAdvanced(st));
  window.vaultApi.onApprovalRequest((req) => {
    approvalQueue.push(req);
    if (approvalQueue.length === 1) showNextApproval();
    else adv.approvalQueue.textContent = `（另有 ${approvalQueue.length - 1} 个待审批）`;
  });
  window.vaultApi.onAgentProposal((p) => {
    state.proposals = state.proposals.concat([p]);
    renderProposals();
  });

  renderAdvanced(await window.vaultApi.advancedStatus());
}

init();
