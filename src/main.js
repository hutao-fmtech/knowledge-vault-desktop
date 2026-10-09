'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { createVault, sanitizeVaultName, topLevelSkeletonLabels } = require('./vault');
const { createMockEngine, createDeepSeekEngine, listInboxNotes } = require('./agent/engine');
const { applyProposal, discardProposal } = require('./agent/proposals');
const { saveApiKey, loadApiKey, clearApiKey, hasApiKey, configDir } = require('./agent/keystore');

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
/** @type {Map<string, object>} */
const pending = new Map();

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

function getEngine() {
  const key = loadApiKey(safeStorage).key;
  if (!key) return createMockEngine();
  return createDeepSeekEngine(() => loadApiKey(safeStorage).key);
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
  app.whenReady().then(() => {
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

ipcMain.handle('create-vault', (_e, { parentDir, rawName }) => {
  const result = createVault({ parentDir, rawName, templateRoot: TEMPLATE_ROOT });
  if (result.ok) activeVault = result.vaultPath;
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
    mode: 'default',
    engine: hasApiKey(safeStorage) ? 'dsh-llm-model-only' : 'mock',
  };
});

ipcMain.handle('agent-set-vault', (_e, vaultPath) => {
  if (!vaultPath || !fs.existsSync(vaultPath)) {
    return { ok: false, error: '无效的 vault 路径' };
  }
  activeVault = vaultPath;
  pending.clear();
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

function stashProposals(result) {
  if (!result || !result.ok) return result;
  const ids = [];
  for (const p of result.proposals || []) {
    pending.set(p.id, p);
    ids.push(p.id);
  }
  return { ...result, proposalIds: ids };
}

ipcMain.handle('agent-ask', async (_e, question) => {
  if (!activeVault) return { ok: false, error: '未打开 vault' };
  const prefs = readPrefs();
  if (!prefs.privacyAccepted && hasApiKey(safeStorage)) {
    return { ok: false, error: '请先同意隐私说明', needPrivacy: true };
  }
  try {
    return stashProposals(await getEngine().ask({ vaultRoot: activeVault, question }));
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
    return stashProposals(await getEngine().sortInbox({ vaultRoot: activeVault, noteRel }));
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
    return stashProposals(await getEngine().makeCard({ vaultRoot: activeVault, noteRel }));
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('agent-apply', (_e, id) => {
  if (!activeVault) return { ok: false, error: '未打开 vault' };
  const proposal = pending.get(id);
  if (!proposal) return { ok: false, error: '找不到拟改动（可能已处理）' };
  const result = applyProposal(activeVault, proposal);
  if (result.ok) pending.delete(id);
  return result;
});

ipcMain.handle('agent-discard', (_e, id) => {
  const proposal = pending.get(id);
  if (!proposal) return { ok: false, error: '找不到拟改动' };
  pending.delete(id);
  return discardProposal(proposal);
});
