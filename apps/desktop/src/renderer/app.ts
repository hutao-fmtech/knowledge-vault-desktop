/** Look up a required element by id (the markup ships with the app). */
function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
}

const views = {
  welcome: $('view-welcome'),
  create: $('view-create'),
  success: $('view-success'),
};

const els = {
  labels: $('template-labels'),
  parent: $<HTMLInputElement>('input-parent'),
  name: $<HTMLInputElement>('input-name'),
  nameHint: $('name-hint'),
  pathPreview: $('path-preview'),
  formError: $('form-error'),
  successPath: $('success-path'),
  successTitle: $('success-title'),
  successTree: $('success-tree'),
  shell: $('shell'),
  sidebar: $('agent-sidebar'),
  agentVault: $('agent-vault'),
  agentKeyState: $('agent-key-state'),
  agentPrivacy: $('agent-privacy'),
  agentAnswer: $('agent-answer'),
  proposalList: $('proposal-list'),
  selectInbox: $<HTMLSelectElement>('select-inbox'),
  selectWechatOa: $<HTMLSelectElement>('select-wechat-oa'),
  inputAsk: $<HTMLInputElement>('input-ask'),
  inputKey: $<HTMLInputElement>('input-api-key'),
};

/** R2: mirrored from the main process ('write-pause-state'); main stays authoritative. */
let writePaused = false;

const state: { parentDir: string; lastVaultPath: string; proposals: UiProposal[] } = {
  parentDir: '',
  lastVaultPath: '',
  proposals: [],
};

function show(name: keyof typeof views): void {
  Object.entries(views).forEach(([k, el]) => {
    el.classList.toggle('hidden', k !== name);
  });
}

function joinPreview(parent: string, name: string | undefined): string {
  if (!parent || !name) return '—';
  const sep = parent.includes('\\') && !parent.includes('/') ? '\\' : '/';
  const trimmed = parent.replace(/[\\/]+$/, '');
  return `${trimmed}${sep}${name}`;
}

function renderTree(node: UiTreeNode | undefined, prefix = '', isLast = true, lines: string[] = [], isRoot = true): string[] {
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
    els.nameHint.textContent = result.error ?? '';
    els.pathPreview.textContent = '—';
    return;
  }
  els.nameHint.textContent = `文件夹名预览：${result.name}`;
  els.pathPreview.textContent = joinPreview(state.parentDir, result.name);
}


/** Line-level LCS diff for proposal review (mirrors @kvd/proposals lineDiff; renderer has no package imports). */
type DiffLine = { op: 'equal' | 'insert' | 'delete'; text: string };

function splitDiffLines(s: string): string[] {
  if (s === '') return [];
  const parts = s.split('\n');
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

function lineDiff(before: string, after: string): DiffLine[] {
  const a = splitDiffLines(before);
  const b = splitDiffLines(after);
  const n = a.length;
  const m = b.length;
  // Flat (n+1)*(m+1) DP table avoids nested noUncheckedIndexedAccess noise.
  const dp = new Array<number>((n + 1) * (m + 1)).fill(0);
  const at = (i: number, j: number): number => dp[i * (m + 1) + j]!;
  const set = (i: number, j: number, v: number): void => {
    dp[i * (m + 1) + j] = v;
  };
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      set(i, j, a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1)));
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: 'equal', text: a[i]! });
      i += 1;
      j += 1;
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      out.push({ op: 'delete', text: a[i]! });
      i += 1;
    } else {
      out.push({ op: 'insert', text: b[j]! });
      j += 1;
    }
  }
  while (i < n) {
    out.push({ op: 'delete', text: a[i]! });
    i += 1;
  }
  while (j < m) {
    out.push({ op: 'insert', text: b[j]! });
    j += 1;
  }
  return out;
}

/** Fill the proposal detail pane from the IPC payload (create body / edit unified diff / move summary). */
function fillProposalDetail(host: HTMLElement, p: UiProposal): void {
  host.replaceChildren();
  if (p.kind === 'move') {
    const pre = document.createElement('pre');
    pre.className = 'proposal-body';
    pre.textContent = `${p.from} → ${p.to}`;
    host.appendChild(pre);
    return;
  }
  if (p.kind === 'create') {
    const pre = document.createElement('pre');
    pre.className = 'proposal-body';
    pre.textContent = `创建 ${p.path}\n\n${p.content || ''}`;
    host.appendChild(pre);
    return;
  }
  if (p.kind === 'edit') {
    const pathEl = document.createElement('div');
    pathEl.className = 'diff-path';
    pathEl.textContent = `编辑 ${p.path}`;
    host.appendChild(pathEl);
    const box = document.createElement('pre');
    box.className = 'proposal-diff';
    const lines = lineDiff(p.before || '', p.content || '');
    if (!lines.length) {
      const empty = document.createElement('div');
      empty.className = 'diff-eq';
      empty.textContent = '（无内容变化）';
      box.appendChild(empty);
    } else {
      for (const l of lines) {
        const row = document.createElement('div');
        row.className = l.op === 'equal' ? 'diff-eq' : l.op === 'insert' ? 'diff-add' : 'diff-del';
        const prefix = l.op === 'equal' ? ' ' : l.op === 'insert' ? '+' : '-';
        row.textContent = `${prefix}${l.text}`;
        box.appendChild(row);
      }
    }
    host.appendChild(box);
    return;
  }
  const pre = document.createElement('pre');
  pre.className = 'proposal-body';
  pre.textContent = String(p.kind);
  host.appendChild(pre);
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
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = p.summary || p.kind;
    div.appendChild(meta);
    const detail = document.createElement('div');
    detail.className = 'proposal-detail';
    fillProposalDetail(detail, p);
    div.appendChild(detail);
    const actions = document.createElement('div');
    actions.className = 'actions';
    const applyBtn = document.createElement('button');
    applyBtn.className = 'primary';
    applyBtn.textContent = 'Apply';
    // R2.6: pause blocks agent-initiated proposals only; user-initiated
    // (e.g. 标记已发布) still Apply. Main re-checks — this is just the UI state.
    const pausedForThis = writePaused && p.initiator !== 'user';
    applyBtn.disabled = pausedForThis;
    if (pausedForThis) applyBtn.title = '写入已暂停：Agent 发起的拟改动需解除暂停后才能 Apply';
    applyBtn.addEventListener('click', async () => {
      const res = await window.vaultApi.agentApply(p.id);
      if (!res.ok) {
        els.agentAnswer.textContent = res.error ?? '';
        return;
      }
      state.proposals = state.proposals.filter((x) => x.id !== p.id);
      renderProposals();
      els.agentAnswer.textContent = `已落盘：${p.summary || p.kind}`;
      await refreshInbox();
      await refreshWechatOa();
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
    div.appendChild(actions);
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
  const notes = res.notes ?? [];
  if (!res.ok || !notes.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = res.ok ? '（收件箱为空）' : (res.error ?? '');
    els.selectInbox.appendChild(opt);
    return;
  }
  for (const n of notes) {
    const opt = document.createElement('option');
    opt.value = n;
    opt.textContent = n;
    els.selectInbox.appendChild(opt);
  }
}

async function refreshWechatOa() {
  const res = await window.vaultApi.agentListWechatOa();
  els.selectWechatOa.innerHTML = '';
  const notes = res.notes ?? [];
  if (!res.ok || !notes.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = res.ok ? '（暂无 Brief / 成稿）' : (res.error ?? '');
    els.selectWechatOa.appendChild(opt);
    return;
  }
  for (const n of notes) {
    const opt = document.createElement('option');
    opt.value = n;
    opt.textContent = n;
    els.selectWechatOa.appendChild(opt);
  }
}

async function openAgent(vaultPath: string): Promise<void> {
  if (vaultPath) await window.vaultApi.agentSetVault(vaultPath);
  els.sidebar.classList.remove('hidden');
  els.shell.classList.add('with-agent');
  state.proposals = [];
  renderProposals();
  await refreshAgentChrome();
  await refreshInbox();
  await refreshWechatOa();
}

function closeAgent() {
  els.sidebar.classList.add('hidden');
  els.shell.classList.remove('with-agent');
}

function mergeProposals(res: ApiResult): void {
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

  $('btn-start').addEventListener('click', () => {
    els.formError.classList.add('hidden');
    show('create');
  });
  $('btn-back').addEventListener('click', () => show('welcome'));
  $('btn-pick').addEventListener('click', async () => {
    const res = await window.vaultApi.pickFolder();
    if (res.ok && res.path) {
      state.parentDir = res.path;
      els.parent.value = res.path;
      await refreshNameHint();
    }
  });
  els.name.addEventListener('input', () => { refreshNameHint(); });

  $('btn-open-existing').addEventListener('click', async () => {
    const res = await window.vaultApi.openVault();
    if (!res.ok || !res.vaultPath) return;
    state.lastVaultPath = res.vaultPath;
    els.successPath.textContent = res.vaultPath;
    els.successTitle.textContent = '已打开知识库';
    els.successTree.textContent = '（已有 vault）';
    show('success');
    await openAgent(res.vaultPath);
  });

  $<HTMLButtonElement>('btn-create').addEventListener('click', async () => {
    els.formError.classList.add('hidden');
    const btn = $<HTMLButtonElement>('btn-create');
    btn.disabled = true;
    try {
      const result = await window.vaultApi.createVault({
        parentDir: state.parentDir,
        rawName: els.name.value,
      });
      if (!result.ok || !result.vaultPath) {
        els.formError.textContent = result.error ?? '';
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

  $('btn-reveal').addEventListener('click', () => {
    if (state.lastVaultPath) window.vaultApi.showItemInFolder(state.lastVaultPath);
  });
  $('btn-another').addEventListener('click', () => {
    els.name.value = '';
    els.formError.classList.add('hidden');
    refreshNameHint();
    show('create');
  });
  $('btn-open-agent').addEventListener('click', async () => {
    await openAgent(state.lastVaultPath);
  });
  $('btn-close-agent').addEventListener('click', closeAgent);

  $('btn-accept-privacy').addEventListener('click', async () => {
    await window.vaultApi.agentAcceptPrivacy();
    await refreshAgentChrome();
  });
  $('btn-save-key').addEventListener('click', async () => {
    const res = await window.vaultApi.agentSaveKey(els.inputKey.value);
    els.inputKey.value = '';
    els.agentAnswer.textContent = res.ok ? `Key 已保存（${res.mode}）` : (res.error ?? '');
    await refreshAgentChrome();
  });
  $('btn-clear-key').addEventListener('click', async () => {
    await window.vaultApi.agentClearKey();
    await refreshAgentChrome();
  });

  $('btn-ask').addEventListener('click', async () => {
    const q = els.inputAsk.value.trim();
    if (!q) return;
    els.agentAnswer.textContent = '思考中…';
    const res = await window.vaultApi.agentAsk(q);
    if (!res.ok) {
      els.agentAnswer.textContent = res.error ?? '';
      if (res.needPrivacy) els.agentPrivacy.classList.remove('hidden');
      return;
    }
    els.agentAnswer.textContent = res.answer || '';
    mergeProposals(res);
  });

  $('btn-sort').addEventListener('click', async () => {
    const note = els.selectInbox.value;
    if (!note) return;
    els.agentAnswer.textContent = '归类中…';
    const res = await window.vaultApi.agentSort(note);
    els.agentAnswer.textContent = (res.ok ? res.answer : res.error) ?? '';
    if (res.ok) mergeProposals(res);
  });

  $('btn-card').addEventListener('click', async () => {
    const note = els.selectInbox.value;
    if (!note) return;
    els.agentAnswer.textContent = '生成卡片…';
    const res = await window.vaultApi.agentCard(note);
    els.agentAnswer.textContent = (res.ok ? res.answer : res.error) ?? '';
    if (res.ok) mergeProposals(res);
  });

  $('btn-refresh-wechat-oa').addEventListener('click', async () => {
    await refreshWechatOa();
  });
  $('btn-open-wechat-oa').addEventListener('click', async () => {
    const note = els.selectWechatOa.value;
    if (!note) return;
    els.agentAnswer.textContent = '打开中…';
    const res = await window.vaultApi.agentOpenNote(note);
    if (!res.ok) {
      els.agentAnswer.textContent = res.error ?? '';
      return;
    }
    const body = res.content ?? '';
    const clipped = body.length > 4000 ? body.slice(0, 4000) + '\n…' : body;
    els.agentAnswer.textContent = `📄 ${res.path || note}\n\n${clipped}`;
  });

  $('btn-wechat-draft').addEventListener('click', async () => {
    const note = els.selectWechatOa.value;
    if (!note) return;
    els.agentAnswer.textContent = '起草中…';
    const res = await window.vaultApi.agentWechatDraft(note);
    els.agentAnswer.textContent = (res.ok ? res.answer : res.error) ?? '';
    if (res.ok) mergeProposals(res);
    await refreshWechatOa();
  });
  $('btn-wechat-titles').addEventListener('click', async () => {
    const note = els.selectWechatOa.value;
    if (!note) return;
    els.agentAnswer.textContent = '起标题…';
    const res = await window.vaultApi.agentWechatTitles(note);
    els.agentAnswer.textContent = (res.ok ? res.answer : res.error) ?? '';
    if (res.ok) mergeProposals(res);
    await refreshWechatOa();
  });
  $('btn-wechat-layout').addEventListener('click', async () => {
    const note = els.selectWechatOa.value;
    if (!note) return;
    els.agentAnswer.textContent = '排版中…';
    const res = await window.vaultApi.agentWechatLayout(note);
    els.agentAnswer.textContent = (res.ok ? res.answer : res.error) ?? '';
    await refreshWechatOa();
  });
  $('btn-wechat-copy-html').addEventListener('click', async () => {
    const note = els.selectWechatOa.value;
    if (!note) return;
    els.agentAnswer.textContent = '复制 HTML…';
    const res = await window.vaultApi.agentWechatCopyHtml(note);
    els.agentAnswer.textContent = (res.ok ? res.answer : res.error) ?? '';
  });
  $('btn-wechat-preview').addEventListener('click', async () => {
    const note = els.selectWechatOa.value;
    if (!note) return;
    els.agentAnswer.textContent = '打开预览…';
    const res = await window.vaultApi.agentWechatPreview(note);
    els.agentAnswer.textContent = (res.ok ? res.answer : res.error) ?? '';
  });
  $('btn-wechat-publish').addEventListener('click', async () => {
    const note = els.selectWechatOa.value;
    if (!note) return;
    els.agentAnswer.textContent = '标记已发布…';
    const res = await window.vaultApi.agentWechatPublish(note);
    els.agentAnswer.textContent = (res.ok ? res.answer : res.error) ?? '';
    if (res.ok) mergeProposals(res);
    await refreshWechatOa();
  });

  renderProposals();
  initAdvanced();
  void initWritePause();
}

// ---------------------------------------------------------------------------
// Global write pause (R2): sidebar quick toggle + Settings > Agent + indicator.
// Pausing is always allowed; resuming is honoured by main only for this window.
// ---------------------------------------------------------------------------
function renderWritePause(st: UiWritePauseState | null | undefined): void {
  if (!st) return;
  writePaused = !!st.paused;
  $('write-pause-indicator').classList.toggle('hidden', !writePaused);
  const btn = $<HTMLButtonElement>('btn-write-pause');
  btn.textContent = writePaused ? '▶' : '⏸';
  btn.title = writePaused ? '解除写入暂停' : '暂停写入';
  btn.classList.toggle('active', writePaused);
  $<HTMLInputElement>('toggle-write-pause').checked = writePaused;
  renderProposals();
}

async function setWritePause(paused: boolean): Promise<void> {
  const res = await window.vaultApi.writePauseSet(paused);
  if (!res.ok) els.agentAnswer.textContent = res.error || res.code || '';
  renderWritePause(res.state || (await window.vaultApi.writePauseStatus()));
}

async function initWritePause(): Promise<void> {
  $('btn-write-pause').addEventListener('click', () => void setWritePause(!writePaused));
  $('btn-indicator-resume').addEventListener('click', () => void setWritePause(false));
  $<HTMLInputElement>('toggle-write-pause').addEventListener('change', (ev) => {
    void setWritePause((ev.target as HTMLInputElement).checked);
  });
  window.vaultApi.onWritePauseState((st) => renderWritePause(st));
  renderWritePause(await window.vaultApi.writePauseStatus());
}

// ---------------------------------------------------------------------------
// Advanced mode UI (Settings > Advanced, indicator, risk warnings, approvals).
// The main process is authoritative: these handlers only ask it to change
// state, and every change is confirmed back through 'advanced-state'.
// ---------------------------------------------------------------------------
const adv = {
  indicator: $('advanced-indicator'),
  indicatorPolicy: $('advanced-indicator-policy'),
  badge: $('agent-badge'),
  task: $('advanced-task'),
  taskPolicy: $('advanced-task-policy'),
  settings: $('modal-settings'),
  toggle: $<HTMLInputElement>('toggle-advanced'),
  policySet: $<HTMLFieldSetElement>('policy-fieldset'),
  runtime: $('advanced-runtime'),
  logPath: $('advanced-log-path'),
  settingsError: $('settings-error'),
  risk: $('modal-risk'),
  riskBody: $('risk-body'),
  riskAck: $<HTMLInputElement>('risk-ack'),
  riskConfirm: $<HTMLButtonElement>('btn-risk-confirm'),
  approval: $('modal-approval'),
  approvalTool: $('approval-tool'),
  approvalNested: $('approval-nested'),
  approvalQueue: $('approval-queue'),
  approvalCmdWrap: $('approval-command-wrap'),
  approvalCmd: $('approval-command'),
  approvalCmdLabel: $('approval-command-label'),
  approvalArgs: $('approval-args'),
  input: $<HTMLInputElement>('input-advanced'),
};
const approvalQueue: UiApprovalRequest[] = [];
let advState: UiAdvancedState = { enabled: false, policy: 'approve' };

const POLICY_LABEL: Record<string, string> = { approve: '逐次审批', 'log-only': '直接执行（仅记录）' };

const RISK_TEXT: Record<'enable' | 'log-only', string> = {
  enable: `<p>开启高级档后，Agent 可以在 dsh 沙箱 profile 中调用内置工具（如 shell 命令：macOS/Linux 为 bash，Windows 为 PowerShell；读取文件）。</p>
<ul><li>工具在只读沙箱中运行，工作目录为当前 vault；修改笔记仍只能生成拟改动，需你 Apply。</li>
<li>命令可以读取 vault 内容，并可能读取本机其它可读文件；读取结果会发送给模型服务。</li>
<li>每次调用都会记录到本机日志（vault 之外，不含 API key）。</li>
<li>只能在本机手动开启；随时可在顶部横幅或此处关闭，立即生效。</li></ul>`,
  'log-only': `<p>选择「直接执行，仅记录」后，Agent 的工具调用将<strong>不再逐次询问</strong>，直接执行。</p>
<ul><li>你不会在执行前看到命令；只能事后在日志中查看。</li>
<li>沙箱、只读限制和拟改动 + Apply 规则仍然生效。</li>
<li>可随时切回「逐次审批」。</li></ul>`,
};

function confirmRisk(kind: 'enable' | 'log-only'): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    adv.riskBody.innerHTML = RISK_TEXT[kind];
    adv.riskConfirm.textContent = kind === 'enable' ? '确认开启高级档' : '确认直接执行';
    adv.riskAck.checked = false;
    adv.riskConfirm.disabled = true;
    adv.risk.classList.remove('hidden');
    const finish = (v: boolean): void => {
      adv.risk.classList.add('hidden');
      adv.riskConfirm.onclick = null;
      $('btn-risk-cancel').onclick = null;
      resolve(v);
    };
    adv.riskConfirm.onclick = () => finish(adv.riskAck.checked);
    $('btn-risk-cancel').onclick = () => finish(false);
  });
}

function renderAdvanced(st: UiAdvancedState | null | undefined): void {
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
  document.querySelectorAll<HTMLInputElement>('input[name="tool-policy"]').forEach((r) => { r.checked = r.value === st.policy; });
  adv.logPath.textContent = st.logFile || '—';
  const rt: NonNullable<UiAdvancedState['runtime']> = st.runtime || {};
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

function showSettingsError(msg: string | undefined): void {
  adv.settingsError.textContent = msg || '';
  adv.settingsError.classList.toggle('hidden', !msg);
}

async function enableAdvanced(): Promise<void> {
  let res = await window.vaultApi.advancedEnable(false);
  if (!res.ok && res.needRiskAck) {
    if (!(await confirmRisk('enable'))) return renderAdvanced(advState);
    res = await window.vaultApi.advancedEnable(true);
  }
  if (!res.ok) showSettingsError(res.error || res.code);
  if (res.state) renderAdvanced({ ...advState, ...res.state });
}

async function setPolicy(policy: string): Promise<void> {
  let res = await window.vaultApi.advancedSetPolicy(policy, false);
  if (!res.ok && res.needRiskAck) {
    if (!(await confirmRisk('log-only'))) return renderAdvanced(advState);
    res = await window.vaultApi.advancedSetPolicy(policy, true);
  }
  if (!res.ok) showSettingsError(res.error || res.code);
  if (res.state) renderAdvanced({ ...advState, ...res.state });
}

/** Must match @kvd/advanced approvalCommandHeading (issue #20 dialog label). */
function approvalCommandHeading(lang: string | null | undefined): string {
  return lang ? `${lang} 命令` : '命令';
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
  adv.approvalCmdLabel.textContent = approvalCommandHeading(req.commandLanguage);
  adv.approvalArgs.textContent = JSON.stringify(req.arguments, null, 2);
  adv.approval.classList.remove('hidden');
}

async function answerApproval(decision: 'allow' | 'deny'): Promise<void> {
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
  $('btn-open-settings').addEventListener('click', open);
  $('btn-sidebar-settings').addEventListener('click', open);
  $('btn-close-settings').addEventListener('click', () => adv.settings.classList.add('hidden'));
  adv.riskAck.addEventListener('change', () => { adv.riskConfirm.disabled = !adv.riskAck.checked; });

  adv.toggle.addEventListener('change', async (ev) => {
    showSettingsError('');
    if ((ev.target as HTMLInputElement).checked) await enableAdvanced();
    else renderAdvanced({ ...advState, ...(await window.vaultApi.advancedDisable()).state });
  });
  document.querySelectorAll<HTMLInputElement>('input[name="tool-policy"]').forEach((r) => {
    r.addEventListener('change', () => { if (r.checked) void setPolicy(r.value); });
  });
  $('btn-indicator-off').addEventListener('click', async () => {
    renderAdvanced({ ...advState, ...(await window.vaultApi.advancedDisable()).state });
  });
  $('btn-reveal-log').addEventListener('click', () => window.vaultApi.advancedRevealLog());
  $('btn-approval-allow').addEventListener('click', () => answerApproval('allow'));
  $('btn-approval-deny').addEventListener('click', () => answerApproval('deny'));

  $<HTMLButtonElement>('btn-advanced-run').addEventListener('click', async () => {
    const prompt = adv.input.value.trim();
    if (!prompt) return;
    const btn = $<HTMLButtonElement>('btn-advanced-run');
    btn.disabled = true;
    els.agentAnswer.textContent = '高级档运行中…（工具调用会先请求审批）';
    let res: ApiResult;
    try {
      res = await window.vaultApi.advancedRun(prompt);
    } finally {
      btn.disabled = false;
    }
    if (!res.ok) {
      els.agentAnswer.textContent = res.error || res.code || '';
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
