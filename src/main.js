'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { createVault, sanitizeVaultName, topLevelSkeletonLabels } = require('./vault');
const { createMockEngine, createDeepSeekEngine, listInboxNotes } = require('./agent/engine');
// proposals apply/discard/create live in kvd-proposals (ctx.proposals); pure helpers remain in ./agent/proposals.js
const { saveApiKey, loadApiKey, clearApiKey, hasApiKey, configDir } = require('./agent/keystore');
const { createAdvancedController } = require('./agent/advanced/controller');
const { classifyIpcOrigin } = require('./agent/advanced/origin');
const { createToolLog } = require('./agent/advanced/tool-log');

const PACK_SMOKE = process.argv.includes('--kvd-pack-smoke');

async function runPackSmoke() {
  const nodeVersion = process.versions.node;
  console.log('KVD_NODE_VERSION', nodeVersion);
  const parts = String(nodeVersion).split('.').map((x) => parseInt(x, 10));
  const okNode =
    parts[0] > 22 || (parts[0] === 22 && parts[1] >= 12) || parts[0] >= 24;
  if (!okNode) {
    console.error('KVD_PACK_SMOKE_FAIL node', nodeVersion, 'need >=22.12');
    app.exit(2);
    return;
  }
  // ESM dynamic import of runtime + smokeMount from inside asar / unpacked tree.
  const { smokeMount } = require('./agent/dsh-runtime');
  const mount = await smokeMount();
  if (!mount.ok || !mount.providers.includes('deepseek-official')) {
    console.error('KVD_PACK_SMOKE_FAIL mount', mount);
    app.exit(3);
    return;
  }
  console.log('KVD_SMOKE_MOUNT', JSON.stringify(mount));
  const { disposeRuntime, wasDisposeCalled } = await import('./runtime/boot.mjs');
  await disposeRuntime();
  if (!wasDisposeCalled()) {
    console.error('KVD_PACK_SMOKE_FAIL dispose not called');
    app.exit(4);
    return;
  }
  console.log('KVD_PACK_SMOKE_OK', nodeVersion);
  app.exit(0);
}

if (PACK_SMOKE) {
  app
    .whenReady()
    .then(runPackSmoke)
    .catch((err) => {
      console.error('KVD_PACK_SMOKE_FAIL', err && err.message ? err.message : err);
      app.exit(1);
    });
} else {
  // Register Cordis dispose on quit (composition root lifecycle).
  import('./runtime/boot.mjs')
    .then(({ registerElectronQuitHooks }) => registerElectronQuitHooks(app))
    .catch(() => {});
}

const TEMPLATE_ROOT = path.join(__dirname, '..', 'resources', 'template');
const PREFS_FILE = () => path.join(configDir(), 'prefs.json');

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {string | null} */
let activeVault = null;

/**
 * Boot (or return) the Cordis runtime and its context.
 * @returns {Promise<import('@deepseek-ai/cordis').Context>}
 */
async function getRuntimeCtx() {
  const { getRuntime } = await import('./runtime/boot.mjs');
  const { ctx } = await getRuntime();
  return ctx;
}

/**
 * Keep Cordis `ctx.vault` in sync with the shell's activeVault.
 * Emits `kvd/vault-changed` via VaultService.setRoot / clear
 * (kvd-proposals clears pending on that event — G4).
 * @param {string | null} vaultPath
 */
async function syncVaultService(vaultPath) {
  try {
    const ctx = await getRuntimeCtx();
    const vault = ctx.get('vault');
    if (!vault) return;
    if (vaultPath) vault.setRoot(vaultPath);
    else vault.clear();
  } catch {
    /* runtime may not be booted yet */
  }
}

/** Attach BrowserWindow getter to kvd-ipc-bridge for push + sender checks. */
async function attachIpcBridge() {
  try {
    const ctx = await getRuntimeCtx();
    const ipc = ctx.get('ipc');
    if (ipc && typeof ipc.attachMainWindow === 'function') {
      ipc.attachMainWindow(() => mainWindow);
    }
  } catch {
    /* ignore */
  }
}


function readPrefs() {
  try {
    return JSON.parse(fs.readFileSync(PREFS_FILE(), 'utf8'));
  } catch {
    return {};
  }
}

function writePrefs(patch) {
  const next = { ...readPrefs(), ...patch };
  fs.writeFileSync(PREFS_FILE(), JSON.stringify(next, null, 2));
  return next;
}

// ---------------------------------------------------------------------------
// Advanced mode (AC-11..14) on the Cordis composition root (PR-7).
// Default mode ask/sort/card stays model-only; tools exist only while advanced
// is ON and the advanced fiber is mounted.
// ---------------------------------------------------------------------------
const advanced = createAdvancedController({ readPrefs, writePrefs });
const toolLog = createToolLog({
  dir: path.join(configDir(), 'logs'),
  getSecrets: () => [loadApiKey(safeStorage).key],
});
/** @type {Map<string, (d: 'allow'|'deny') => void>} */
const approvalWaiters = new Map();
/** @type {ReturnType<typeof import('./agent/advanced/host.mjs').createAdvancedHost> | null} */
let advancedHost = null;

function sendToRenderer(channel, payload) {
  // Prefer ipc bridge push when runtime is up; fall back to direct send.
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

async function ipcPush(channel, payload) {
  try {
    const ctx = await getRuntimeCtx();
    const ipc = ctx.get('ipc');
    if (ipc && ipc.push(channel, payload)) return;
  } catch {
    /* fall through */
  }
  sendToRenderer(channel, payload);
}

function requestApproval(req) {
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.resolve('deny');
  return new Promise((resolve) => {
    approvalWaiters.set(req.id, resolve);
    ipcPush('advanced-approval-request', req);
  });
}

async function proposeFromAgent(change) {
  if (!activeVault) return { ok: false, error: '未打开 vault' };
  try {
    const ctx = await getRuntimeCtx();
    const proposals = ctx.get('proposals');
    if (!proposals) return { ok: false, error: 'proposals service missing' };
    await syncVaultService(activeVault);
    const c = change || {};
    let res;
    if (c.kind === 'create') res = proposals.create(c.path, c.content, c.summary);
    else if (c.kind === 'edit') res = proposals.edit(c.path, c.content, c.summary);
    else if (c.kind === 'move') res = proposals.move(c.from, c.to, c.summary);
    else res = { ok: false, error: `未知改动类型：${c.kind}` };
    if (!res.ok) return res;
    proposals.pushToUi(res.proposal);
    return { ok: true, proposalId: res.proposal.id };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

async function getAdvancedHost() {
  if (advancedHost) return advancedHost;
  const { createAdvancedHost } = await import('./agent/advanced/host.mjs');
  advancedHost = createAdvancedHost({
    controller: advanced,
    log: toolLog,
    requestApproval,
    onPropose: proposeFromAgent,
    getVaultRoot: () => activeVault,
    getSecrets: () => [loadApiKey(safeStorage).key],
  });
  return advancedHost;
}

advanced.onChange((st) => {
  if (!st.enabled) {
    for (const [id, resolve] of approvalWaiters) {
      approvalWaiters.delete(id);
      resolve('deny');
    }
  }
  toolLog.append({ event: 'settings', advancedEnabled: st.enabled, policy: st.policy });
  sendToRenderer('advanced-state', advancedStatusSync());
});

function advancedStatusSync() {
  const st = advanced.getState();
  return {
    ...st,
    runtime: advancedHost ? advancedHost.status() : { running: false, lastError: null, composition: 'kvd-advanced-group' },
    logFile: toolLog.file,
  };
}

function getEngine() {
  // Legacy facade for status labeling / tests. Default-mode IPC uses ctx.kvdSkills.
  const key = loadApiKey(safeStorage).key;
  if (!key) return createMockEngine();
  return createDeepSeekEngine(() => loadApiKey(safeStorage).key);
}

/**
 * Run A1/A2/A3 through kvd-skills (single path; mock = llm adapter swap).
 * @param {'ask'|'sortInbox'|'makeCard'} action
 * @param {object} payload
 */
async function runSkill(action, payload) {
  const ctx = await getRuntimeCtx();
  await syncVaultService(activeVault);
  const skills = ctx.get('kvdSkills');
  if (!skills || typeof skills[action] !== 'function') {
    throw new Error('kvdSkills missing — composition did not mount kvd-skills');
  }
  return skills[action](payload);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 880,
    minHeight: 600,
    title: 'Knowledge Vault Desktop',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

if (!PACK_SMOKE) {
  app.whenReady().then(async () => {
    await attachIpcBridge();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

if (!PACK_SMOKE) {
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

ipcMain.handle('sanitize-name', (_e, raw) => sanitizeVaultName(raw));

ipcMain.handle('template-preview', () => ({
  labels: topLevelSkeletonLabels(TEMPLATE_ROOT),
  pin: 'a3320825e59e',
}));

ipcMain.handle('pick-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择知识库父目录',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths.length) {
    return { ok: false, canceled: true };
  }
  return { ok: true, path: result.filePaths[0] };
});

ipcMain.handle('create-vault', async (_e, { parentDir, rawName }) => {
  const result = createVault({ parentDir, rawName, templateRoot: TEMPLATE_ROOT });
  if (result.ok) {
    activeVault = result.vaultPath;
    await syncVaultService(activeVault);
  }
  return result;
});

ipcMain.handle('open-vault', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '打开已有知识库',
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths.length) {
    return { ok: false, canceled: true };
  }
  activeVault = result.filePaths[0];
  await syncVaultService(activeVault);
  return { ok: true, vaultPath: activeVault };
});

ipcMain.handle('show-item-in-folder', (_e, targetPath) => {
  if (!targetPath) return { ok: false };
  shell.showItemInFolder(targetPath);
  return { ok: true };
});

ipcMain.handle('agent-status', () => {
  const prefs = readPrefs();
  return {
    ok: true,
    vaultPath: activeVault,
    hasKey: hasApiKey(safeStorage),
    privacyAccepted: !!prefs.privacyAccepted,
    mode: advanced.getState().enabled ? 'advanced' : 'default',
    toolPolicy: advanced.getState().policy,
    engine: hasApiKey(safeStorage) ? 'dsh-llm-model-only' : 'mock',
  };
});

ipcMain.handle('agent-set-vault', async (_e, vaultPath) => {
  if (!vaultPath || !fs.existsSync(vaultPath)) {
    return { ok: false, error: '无效的 vault 路径' };
  }
  activeVault = vaultPath;
  // pending cleared by kvd-proposals on kvd/vault-changed (G4)
  await syncVaultService(activeVault);
  return { ok: true, vaultPath };
});

ipcMain.handle('agent-accept-privacy', async () => {
  const at = new Date().toISOString();
  writePrefs({ privacyAccepted: true, privacyAcceptedAt: at });
  try {
    const { getRuntime } = await import('./runtime/boot.mjs');
    const { ctx } = await getRuntime();
    const prefs = ctx.get('kvdPrefs');
    if (prefs) prefs.acceptPrivacy(at);
  } catch {
    /* runtime may not be booted yet; file write is enough */
  }
  return { ok: true };
});

ipcMain.handle('agent-save-key', (_e, key) => saveApiKey(key, safeStorage));
ipcMain.handle('agent-clear-key', () => clearApiKey());

ipcMain.handle('agent-list-inbox', () => {
  if (!activeVault) return { ok: false, error: '未打开 vault' };
  return { ok: true, notes: listInboxNotes(activeVault) };
});

async function stashProposals(result) {
  if (!result || !result.ok) return result;
  try {
    const ctx = await getRuntimeCtx();
    const proposals = ctx.get('proposals');
    if (proposals) {
      await syncVaultService(activeVault);
      const ids = proposals.stashMany(result.proposals || []);
      return { ...result, proposalIds: ids };
    }
  } catch {
    /* fall through with empty ids */
  }
  return { ...result, proposalIds: (result.proposals || []).map((p) => p.id) };
}

ipcMain.handle('agent-ask', async (_e, question) => {
  if (!activeVault) return { ok: false, error: '未打开 vault' };
  const prefs = readPrefs();
  if (!prefs.privacyAccepted && hasApiKey(safeStorage)) {
    return { ok: false, error: '请先同意隐私说明', needPrivacy: true };
  }
  try {
    return stashProposals(await runSkill('ask', { question }));
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('agent-sort', async (_e, noteRel) => {
  if (!activeVault) return { ok: false, error: '未打开 vault' };
  const prefs = readPrefs();
  if (!prefs.privacyAccepted && hasApiKey(safeStorage)) {
    return { ok: false, error: '请先同意隐私说明', needPrivacy: true };
  }
  try {
    return stashProposals(await runSkill('sortInbox', { noteRel }));
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('agent-card', async (_e, noteRel) => {
  if (!activeVault) return { ok: false, error: '未打开 vault' };
  const prefs = readPrefs();
  if (!prefs.privacyAccepted && hasApiKey(safeStorage)) {
    return { ok: false, error: '请先同意隐私说明', needPrivacy: true };
  }
  try {
    return stashProposals(await runSkill('makeCard', { noteRel }));
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// agent-apply / agent-discard: registered by kvd-proposals via kvd-ipc-bridge

// ---- Settings > Advanced IPC (local origin only for enable/policy/approval) ----

ipcMain.handle('advanced-status', async () => {
  try { await getAdvancedHost(); } catch { /* host lazy */ }
  return { ok: true, ...advancedStatusSync() };
});

ipcMain.handle('advanced-enable', async (e, opts) => {
  const origin = classifyIpcOrigin(e, mainWindow);
  const res = advanced.enable(origin, { acknowledgeRisk: !!(opts && opts.acknowledgeRisk) });
  if (res.ok && res.state.enabled) {
    try { await getAdvancedHost(); } catch (err) { /* start on demand */ }
  }
  return res;
});

ipcMain.handle('advanced-disable', async (e) => {
  const res = advanced.disable(classifyIpcOrigin(e, mainWindow));
  if (advancedHost) await advancedHost.stop('advanced-off');
  return res;
});

ipcMain.handle('advanced-set-policy', (e, opts) => {
  const origin = classifyIpcOrigin(e, mainWindow);
  return advanced.setPolicy(origin, opts && opts.policy, { acknowledgeRisk: !!(opts && opts.acknowledgeRisk) });
});

ipcMain.handle('advanced-approval-reply', (e, opts) => {
  const origin = classifyIpcOrigin(e, mainWindow);
  const { isLocal } = require('./agent/advanced/origin');
  if (!isLocal(origin)) return { ok: false, code: 'REMOTE_FORBIDDEN' };
  const id = opts && opts.id;
  const decision = opts && opts.decision === 'allow' ? 'allow' : 'deny';
  const waiter = approvalWaiters.get(id);
  if (!waiter) return { ok: false, error: 'no pending approval' };
  approvalWaiters.delete(id);
  waiter(decision);
  return { ok: true };
});

ipcMain.handle('advanced-run', async (e, prompt) => {
  const prefs = readPrefs();
  if (!prefs.privacyAccepted && hasApiKey(safeStorage)) {
    return { ok: false, error: '请先同意隐私说明', needPrivacy: true };
  }
  if (!advanced.getState().enabled) return { ok: false, error: '高级档未开启' };
  if (!activeVault) return { ok: false, error: '未打开 vault' };
  try {
    const host = await getAdvancedHost();
    // Advanced chat: for v0.2 plugin rewrite, surface that tools run via approval.
    // Model-driven tool loops can be wired once a mock/live provider is selected;
    // the sidebar still uses default-mode ask for plain Q&A.
    await host.ensureStarted();
    return {
      ok: true,
      answer: '高级档已就绪（组合根插件）。请通过工具调用触发审批；默认档提问仍可用侧栏「提问」。',
      toolCalls: [],
      runtime: host.status(),
    };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

ipcMain.handle('advanced-reveal-log', () => {
  try {
    const dir = path.dirname(toolLog.file);
    require('fs').mkdirSync(dir, { recursive: true });
    if (!require('fs').existsSync(toolLog.file)) require('fs').writeFileSync(toolLog.file, '', { mode: 0o600 });
    shell.showItemInFolder(toolLog.file);
    return { ok: true, file: toolLog.file };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
