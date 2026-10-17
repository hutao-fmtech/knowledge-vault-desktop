import { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, clipboard } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createVault, sanitizeVaultName, topLevelSkeletonLabels } from '@kvd/vault/create';
import { writeWechatLayoutHtml } from '@kvd/vault';
// readWechatLayoutHtml used inside skills wechatCopyHtml/Preview
import { createAdvancedController } from '@kvd/advanced/controller';
import type { AdvancedController, AdvancedState, PrefsRecord } from '@kvd/advanced/controller';
import { classifyIpcOrigin as classifyOrigin, isLocal } from '@kvd/advanced/origin';
import type { Origin } from '@kvd/advanced/origin';
import { createToolLog } from '@kvd/advanced/tool-log';
import type { ToolLog } from '@kvd/advanced/tool-log';
import { advancedRunResult } from '@kvd/advanced/run-result';
import type { ApprovalUiRequest } from '@kvd/advanced/approval-bridge';
import type { ProposeChange } from '@kvd/advanced/vault-tools';
import type { createAdvancedHost } from '@kvd/advanced/host';
import * as keychain from '@kvd/keychain';
import { configDir } from '@kvd/shared/config-dir';
import * as models from '@kvd/shared/models';
import { templateRoot as TEMPLATE_ROOT } from '@kvd/template';
import type { Context } from '@deepseek-ai/cordis';
import type { SkillResult } from '@kvd/skills';
import type { Proposal } from '@kvd/proposals';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** The renderer file this main window loads (lib/renderer/index.html). */
const RENDERER_HTML = path.join(HERE, 'renderer', 'index.html');
const RENDERER_URL = pathToFileURL(RENDERER_HTML).href;

/** Classify an IPC sender against OUR packaged renderer URL (AC-11d, AC-14). */
function classifyIpcOrigin(e: IpcMainInvokeEvent, win: BrowserWindow | null): Origin {
  return classifyOrigin(e, win, RENDERER_URL);
}

// Plugin-owned ESM modules (key file helpers from kvd-keychain, configDir, model ids).
// Default-mode skills/search/proposals go through ctx services.
const kvd = {
  saveApiKey: keychain.saveApiKey,
  loadApiKey: keychain.loadApiKey,
  clearApiKey: keychain.clearApiKey,
  hasApiKey: keychain.hasApiKey,
  configDir,
  models,
};
const kvdReady = Promise.resolve(kvd);
const hasApiKey = (ss: keychain.SafeStorageLike) => kvd.hasApiKey(ss);
const loadApiKey = (ss: keychain.SafeStorageLike) => kvd.loadApiKey(ss);

const PACK_SMOKE = process.argv.includes('--kvd-pack-smoke');

async function runPackSmoke(): Promise<void> {
  const nodeVersion = process.versions.node;
  console.log('KVD_NODE_VERSION', nodeVersion);
  const [major = 0, minor = 0] = String(nodeVersion).split('.').map((x) => parseInt(x, 10));
  const okNode = major > 22 || (major === 22 && minor >= 12) || major >= 24;
  if (!okNode) {
    console.error('KVD_PACK_SMOKE_FAIL node', nodeVersion, 'need >=22.12');
    app.exit(2);
    return;
  }
  // ESM dynamic import of runtime + smokeMount from inside asar / unpacked tree.
  // Plugin-owned ESM (kvd-keychain, shared/config-dir, shared/models) must load from asar too.
  await kvdReady;
  const { smokeMount } = await import('./runtime/boot.js');
  const mount = await smokeMount();
  if (!mount.ok || !mount.providers.includes('deepseek-official')) {
    console.error('KVD_PACK_SMOKE_FAIL mount', mount);
    app.exit(3);
    return;
  }
  console.log('KVD_SMOKE_MOUNT', JSON.stringify(mount));
  // RS: the packaged app must read cordis.yml and compose ALL declared plugins,
  // including the lazy advanced group (mounted read-only on a throwaway dir, then disposed).
  const comp = await import('./runtime/composition.js');
  const { mountAdvanced, unmountAdvanced, mountedPluginIds } = await import('./runtime/boot.js');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'kvd-pack-smoke-'));
  await mountAdvanced({
    workspaceRoot: scratch,
    bridge: { getPolicy: () => 'off', requestApproval: async () => ({ decision: 'deny' }), onToolCall: () => {} },
    audit: { log: { append: () => '' }, getSecrets: () => [] },
    vaultTools: { onPropose: async () => ({ ok: false, error: 'pack-smoke' }) },
  });
  const declared = comp.compositionPluginIds();
  const mounted = mountedPluginIds();
  await unmountAdvanced();
  fs.rmSync(scratch, { recursive: true, force: true });
  console.log('KVD_COMPOSITION_SOURCE', path.relative(path.join(HERE, '..'), comp.CORDIS_YML), comp.CORDIS_YML.includes('app.asar') ? 'asar' : 'fs');
  console.log('KVD_PLUGINS_DECLARED', declared.length, declared.join(','));
  console.log('KVD_PLUGINS_MOUNTED', mounted.length, mounted.join(','));
  const missing = declared.filter((id) => !mounted.includes(id));
  if (missing.length || mounted.length !== declared.length) {
    console.error('KVD_PACK_SMOKE_FAIL plugins missing', missing.join(','));
    app.exit(5);
    return;
  }
  // v0.2.3 regression: every @deepseek-ai module reachable from dsh-session must
  // resolve + import from inside app.asar, and an advanced task must reach
  // approval/request offline (scripted model on kvd-mock; the call is denied).
  const { probeDshImports, probeAdvancedTask } = await import('./runtime/pack-smoke-advanced.js');
  const dsh = await probeDshImports(path.join(HERE, '..', 'package.json'));
  console.log('KVD_DSH_IMPORTS', JSON.stringify(dsh));
  if (!dsh.ok) {
    console.error('KVD_PACK_SMOKE_FAIL dsh imports', JSON.stringify(dsh.failures), dsh.outsideAsar.join(','));
    app.exit(8);
    return;
  }
  const task = await probeAdvancedTask();
  console.log('KVD_ADVANCED_TASK', JSON.stringify(task));
  if (!task.ok) {
    console.error('KVD_PACK_SMOKE_FAIL advanced task', JSON.stringify(task));
    app.exit(9);
    return;
  }
  const { disposeRuntime, wasDisposeCalled } = await import('./runtime/boot.js');
  await disposeRuntime();
  if (!wasDisposeCalled()) {
    console.error('KVD_PACK_SMOKE_FAIL dispose not called');
    app.exit(4);
    return;
  }
  // @kvd/template must ship inside the package (vault creation source).
  const tplOk = ['00-系统', '01-收件箱', '.obsidian'].every((d) => fs.existsSync(path.join(TEMPLATE_ROOT, d)));
  if (!tplOk) {
    console.error('KVD_PACK_SMOKE_FAIL template missing at', TEMPLATE_ROOT);
    app.exit(6);
    return;
  }
  console.log('KVD_TEMPLATE_OK', topLevelSkeletonLabels(TEMPLATE_ROOT).length);
  // Renderer launch smoke: the compiled preload (CJS, sandboxed) + renderer script
  // load, talk to main over IPC, and are classified as the LOCAL origin.
  const rendererProbe = await probeRenderer();
  console.log('KVD_RENDERER', JSON.stringify(rendererProbe));
  if (!rendererProbe.ok) {
    console.error('KVD_PACK_SMOKE_FAIL renderer', JSON.stringify(rendererProbe));
    app.exit(7);
    return;
  }
  console.log('KVD_APP_VERSION', app.getVersion());
  // Electron must be running the compiled tsc output (lib/), from inside app.asar when packaged.
  console.log('KVD_ENTRY', path.relative(path.join(HERE, '..'), fileURLToPath(import.meta.url)).split(path.sep).join('/'), HERE.includes('app.asar') ? 'asar' : 'fs');
  console.log('KVD_PACK_SMOKE_OK', nodeVersion);
  app.exit(0);
}

/** Load the real renderer in a hidden window and check preload + app script + local IPC. */
async function probeRenderer(): Promise<{ ok: boolean; vaultApi?: string; labels?: number; localIpc?: boolean; error?: string }> {
  createWindow(false);
  const win = mainWindow;
  if (!win) return { ok: false, error: 'no window' };
  try {
    await new Promise<void>((resolve, reject) => {
      win.webContents.once('did-finish-load', () => resolve());
      win.webContents.once('did-fail-load', (_e, code, desc) => reject(new Error(`${code} ${desc}`)));
    });
    let labels = 0;
    for (let i = 0; i < 50 && labels === 0; i++) {
      labels = Number(await win.webContents.executeJavaScript("document.querySelectorAll('#template-labels li').length"));
      if (!labels) await new Promise((r) => setTimeout(r, 100));
    }
    const vaultApi = String(await win.webContents.executeJavaScript('typeof window.vaultApi'));
    // Same policy as current => no state change; REMOTE_FORBIDDEN would mean origin misclassified.
    const current = advanced.getState().policy;
    const res = (await win.webContents.executeJavaScript(
      `window.vaultApi.advancedSetPolicy(${JSON.stringify(current)}, false)`,
    )) as { ok?: boolean; code?: string };
    const localIpc = !!res && res.ok === true;
    return { ok: vaultApi === 'object' && labels > 0 && localIpc, vaultApi, labels, localIpc };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  } finally {
    win.destroy();
    mainWindow = null;
  }
}

if (PACK_SMOKE) {
  app
    .whenReady()
    .then(runPackSmoke)
    .catch((err: unknown) => {
      console.error('KVD_PACK_SMOKE_FAIL', err instanceof Error ? err.message : err);
      app.exit(1);
    });
} else {
  // Register Cordis dispose on quit (composition root lifecycle).
  import('./runtime/boot.js')
    .then(({ registerElectronQuitHooks }) => registerElectronQuitHooks(app))
    .catch(() => {});
}

const PREFS_FILE = () => path.join(kvd.configDir(), 'prefs.json');

let mainWindow: BrowserWindow | null = null;
let activeVault: string | null = null;

/**
 * Boot (or return) the Cordis runtime and its context.
 */
async function getRuntimeCtx(): Promise<Context> {
  const { getRuntime } = await import('./runtime/boot.js');
  const { ctx } = await getRuntime();
  return ctx;
}

/**
 * Keep Cordis `ctx.vault` in sync with the shell's activeVault.
 * Emits `kvd/vault-changed` via VaultService.setRoot / clear
 * (kvd-proposals clears pending on that event — G4).
 */
async function syncVaultService(vaultPath: string | null): Promise<void> {
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


function readPrefs(): PrefsRecord {
  try {
    return JSON.parse(fs.readFileSync(PREFS_FILE(), 'utf8')) as PrefsRecord;
  } catch {
    return {};
  }
}

function writePrefs(patch: PrefsRecord): PrefsRecord {
  const next = { ...readPrefs(), ...patch };
  fs.writeFileSync(PREFS_FILE(), JSON.stringify(next, null, 2));
  return next;
}

// ---------------------------------------------------------------------------
// Advanced mode (AC-11..14) on the Cordis composition root (PR-7).
// Default mode ask/sort/card stays model-only; tools exist only while advanced
// is ON and the advanced fiber is mounted.
// ---------------------------------------------------------------------------
// Both are created synchronously at module load (config-dir backed).
const advanced: AdvancedController = createAdvancedController({ readPrefs, writePrefs });
const toolLog: ToolLog = createToolLog({
  dir: path.join(kvd.configDir(), 'logs'),
  getSecrets: () => [loadApiKey(safeStorage).key],
});
type UiDecision = 'allow' | 'deny';
const approvalWaiters = new Map<string, (d: UiDecision) => void>();
let advancedHost: ReturnType<typeof createAdvancedHost> | null = null;

function sendToRenderer(channel: string, payload: unknown): void {
  // Prefer ipc bridge push when runtime is up; fall back to direct send.
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

async function ipcPush(channel: string, payload: unknown): Promise<void> {
  try {
    const ctx = await getRuntimeCtx();
    const ipc = ctx.get('ipc');
    if (ipc && ipc.push(channel, payload)) return;
  } catch {
    /* fall through */
  }
  sendToRenderer(channel, payload);
}

function requestApproval(req: ApprovalUiRequest): Promise<UiDecision> {
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.resolve('deny');
  return new Promise<UiDecision>((resolve) => {
    approvalWaiters.set(req.id, resolve);
    void ipcPush('advanced-approval-request', req);
  });
}

async function proposeFromAgent(change: ProposeChange | null | undefined): Promise<{ ok: boolean; proposalId?: string; error?: string }> {
  if (!activeVault) return { ok: false, error: '未打开 vault' };
  try {
    const ctx = await getRuntimeCtx();
    const proposals = ctx.get('proposals');
    if (!proposals) return { ok: false, error: 'proposals service missing' };
    await syncVaultService(activeVault);
    const c = change || {};
    let res: ReturnType<typeof proposals.create>;
    if (c.kind === 'create') res = proposals.create(c.path, c.content, c.summary);
    else if (c.kind === 'edit') res = proposals.edit(c.path, c.content, c.summary);
    else if (c.kind === 'move') res = proposals.move(c.from, c.to, c.summary);
    else res = { ok: false, error: `未知改动类型：${String(c.kind)}` };
    if (!res.ok) return res;
    proposals.pushToUi(res.proposal);
    return { ok: true, proposalId: res.proposal.id };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

function errorMessage(err: unknown): string {
  return (err instanceof Error && err.message) || String(err);
}

async function getAdvancedHost(): Promise<ReturnType<typeof createAdvancedHost>> {
  if (advancedHost) return advancedHost;
  const { createAdvancedHost } = await import('@kvd/advanced/host');
  const runtime = await import('./runtime/boot.js');
  advancedHost = createAdvancedHost({
    runtime,
    controller: advanced,
    log: toolLog,
    requestApproval,
    onPropose: proposeFromAgent,
    getVaultRoot: () => activeVault,
    getSecrets: () => [loadApiKey(safeStorage).key],
    // Same model the rest of the app uses; offline mock when no key is saved.
    getModelRoute: () =>
      hasApiKey(safeStorage)
        ? { provider: kvd.models.LIVE_PROVIDER, model: kvd.models.DEFAULT_MODEL }
        : { provider: kvd.models.MOCK_PROVIDER, model: kvd.models.MOCK_MODEL },
  });
  return advancedHost;
}

/** Build config-dir-backed shell state once the plugin-owned modules are loaded. */
const shellReady = kvdReady.then(() => {
  advanced.onChange(onAdvancedChange);
});

function onAdvancedChange(st: AdvancedState): void {
  if (!st.enabled) {
    for (const [id, resolve] of approvalWaiters) {
      approvalWaiters.delete(id);
      resolve('deny');
    }
  }
  toolLog.append({ event: 'settings', advancedEnabled: st.enabled, policy: st.policy });
  sendToRenderer('advanced-state', advancedStatusSync());
}

function advancedStatusSync() {
  const st = advanced.getState();
  return {
    ...st,
    runtime: advancedHost ? advancedHost.status() : { running: false, lastError: null, composition: 'kvd-advanced-group' },
    logFile: toolLog.file,
  };
}

/**
 * Run default-mode skills through kvd-skills (mock = llm adapter swap).
 * WeChat layout uses writeLayout local tool (not propose into 90-附件).
 */
function layoutLocalTool() {
  return (vaultRoot: string, relPath: string, html: string) => {
    const w = writeWechatLayoutHtml(vaultRoot, relPath, html);
    if (!w.ok) return w;
    return { ok: true as const, path: w.path };
  };
}

async function runSkill(action: 'ask', payload: { question: string }): Promise<SkillResult>;
async function runSkill(action: 'sortInbox' | 'makeCard', payload: { noteRel: string }): Promise<SkillResult>;
async function runSkill(
  action: 'wechatDraft',
  payload: { briefRel: string },
): Promise<SkillResult>;
async function runSkill(
  action: 'wechatTitles',
  payload: { draftRel: string },
): Promise<SkillResult>;
async function runSkill(
  action: 'wechatLayout',
  payload: { draftRel: string; title?: string },
): Promise<SkillResult>;
async function runSkill(
  action: 'wechatCopyHtml' | 'wechatPreview',
  payload: { draftRel?: string; layoutRel?: string },
): Promise<SkillResult>;
async function runSkill(
  action: 'wechatPublish',
  payload: { draftRel: string; publishedAt?: string },
): Promise<SkillResult>;
async function runSkill(
  action:
    | 'ask'
    | 'sortInbox'
    | 'makeCard'
    | 'wechatDraft'
    | 'wechatTitles'
    | 'wechatLayout'
    | 'wechatCopyHtml'
    | 'wechatPublish'
    | 'wechatPreview',
  payload:
    | { question: string }
    | { noteRel: string }
    | { briefRel: string }
    | { draftRel: string; title?: string }
    | { draftRel?: string; layoutRel?: string }
    | { draftRel: string; publishedAt?: string },
): Promise<SkillResult> {
  const ctx = await getRuntimeCtx();
  await syncVaultService(activeVault);
  const skills = ctx.get('kvdSkills');
  if (!skills || typeof skills[action] !== 'function') {
    throw new Error('kvdSkills missing — composition did not mount kvd-skills');
  }
  if (action === 'ask') return skills.ask(payload as { question: string });
  if (action === 'sortInbox' || action === 'makeCard') {
    return skills[action](payload as { noteRel: string });
  }
  if (action === 'wechatDraft') {
    return skills.wechatDraft({
      ...(payload as { briefRel: string }),
      writeLayout: layoutLocalTool(),
    });
  }
  if (action === 'wechatTitles') {
    return skills.wechatTitles({
      ...(payload as { draftRel: string }),
      writeLayout: layoutLocalTool(),
    });
  }
  if (action === 'wechatLayout') {
    return skills.wechatLayout({
      ...(payload as { draftRel: string; title?: string }),
      writeLayout: layoutLocalTool(),
    });
  }
  if (action === 'wechatCopyHtml') {
    return skills.wechatCopyHtml(payload as { draftRel?: string; layoutRel?: string });
  }
  if (action === 'wechatPublish') {
    return skills.wechatPublish(payload as { draftRel: string; publishedAt?: string });
  }
  return skills.wechatPreview(payload as { draftRel?: string; layoutRel?: string });
}

function showOpenDialog(opts: Electron.OpenDialogOptions): Promise<Electron.OpenDialogReturnValue> {
  return mainWindow ? dialog.showOpenDialog(mainWindow, opts) : dialog.showOpenDialog(opts);
}

function createWindow(show = true): void {
  mainWindow = new BrowserWindow({
    show,
    width: 1100,
    height: 780,
    minWidth: 880,
    minHeight: 600,
    title: 'Knowledge Vault Desktop',
    webPreferences: {
      preload: path.join(HERE, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  void mainWindow.loadFile(RENDERER_HTML);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

if (!PACK_SMOKE) {
  app.whenReady().then(async () => {
    await shellReady;
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

ipcMain.handle('sanitize-name', (_e, raw: unknown) => sanitizeVaultName(raw));

ipcMain.handle('template-preview', () => ({
  labels: topLevelSkeletonLabels(TEMPLATE_ROOT),
  pin: 'a3320825e59e',
}));

ipcMain.handle('pick-folder', async () => {
  const result = await showOpenDialog({
    title: '选择知识库父目录',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths.length) {
    return { ok: false, canceled: true };
  }
  return { ok: true, path: result.filePaths[0] };
});

ipcMain.handle('create-vault', async (_e, payload: { parentDir?: unknown; rawName?: unknown } | null) => {
  const { parentDir, rawName } = payload || {};
  const result = createVault({ parentDir: String(parentDir ?? ''), rawName, templateRoot: TEMPLATE_ROOT });
  if (result.ok) {
    activeVault = result.vaultPath;
    await syncVaultService(activeVault);
  }
  return result;
});

ipcMain.handle('open-vault', async () => {
  const result = await showOpenDialog({
    title: '打开已有知识库',
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths.length) {
    return { ok: false, canceled: true };
  }
  const picked = result.filePaths[0] ?? null;
  activeVault = picked;
  await syncVaultService(activeVault);
  return { ok: true, vaultPath: picked };
});

ipcMain.handle('show-item-in-folder', (_e, targetPath: unknown) => {
  if (!targetPath || typeof targetPath !== 'string') return { ok: false };
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

ipcMain.handle('agent-set-vault', async (_e, vaultPath: unknown) => {
  if (!vaultPath || typeof vaultPath !== 'string' || !fs.existsSync(vaultPath)) {
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
    const { getRuntime } = await import('./runtime/boot.js');
    const { ctx } = await getRuntime();
    const prefs = ctx.get('kvdPrefs');
    if (prefs) prefs.acceptPrivacy(at);
  } catch {
    /* runtime may not be booted yet; file write is enough */
  }
  return { ok: true };
});

ipcMain.handle('agent-save-key', async (_e, key: unknown) => (await kvdReady).saveApiKey(key, safeStorage));
ipcMain.handle('agent-clear-key', async () => (await kvdReady).clearApiKey());

ipcMain.handle('agent-list-inbox', async () => {
  if (!activeVault) return { ok: false, error: '未打开 vault' };
  try {
    const ctx = await getRuntimeCtx();
    await syncVaultService(activeVault);
    const vaultSearch = ctx.get('vaultSearch');
    if (!vaultSearch) return { ok: false, error: 'vaultSearch service missing' };
    return vaultSearch.listInbox();
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
});

ipcMain.handle('agent-list-wechat-oa', async () => {
  if (!activeVault) return { ok: false, error: '未打开 vault' };
  try {
    const ctx = await getRuntimeCtx();
    await syncVaultService(activeVault);
    const vaultSearch = ctx.get('vaultSearch');
    if (!vaultSearch) return { ok: false, error: 'vaultSearch service missing' };
    return vaultSearch.listWechatOa();
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
});

ipcMain.handle('agent-open-note', async (_e, noteRel: unknown) => {
  if (!activeVault) return { ok: false, error: '未打开 vault' };
  try {
    const ctx = await getRuntimeCtx();
    await syncVaultService(activeVault);
    const vaultSearch = ctx.get('vaultSearch');
    if (!vaultSearch) return { ok: false, error: 'vaultSearch service missing' };
    return vaultSearch.readNote(String(noteRel ?? ''));
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
});

async function stashProposals(result: SkillResult): Promise<SkillResult & { proposalIds?: string[] }> {
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
  return { ...result, proposalIds: (result.proposals || []).map((p: Proposal) => p.id) };
}

ipcMain.handle('agent-ask', async (_e, question: unknown) => {
  if (!activeVault) return { ok: false, error: '未打开 vault' };
  const prefs = readPrefs();
  if (!prefs.privacyAccepted && hasApiKey(safeStorage)) {
    return { ok: false, error: '请先同意隐私说明', needPrivacy: true };
  }
  try {
    return stashProposals(await runSkill('ask', { question: String(question ?? '') }));
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
});

ipcMain.handle('agent-sort', async (_e, noteRel: unknown) => {
  if (!activeVault) return { ok: false, error: '未打开 vault' };
  const prefs = readPrefs();
  if (!prefs.privacyAccepted && hasApiKey(safeStorage)) {
    return { ok: false, error: '请先同意隐私说明', needPrivacy: true };
  }
  try {
    return stashProposals(await runSkill('sortInbox', { noteRel: String(noteRel ?? '') }));
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
});

ipcMain.handle('agent-card', async (_e, noteRel: unknown) => {
  if (!activeVault) return { ok: false, error: '未打开 vault' };
  const prefs = readPrefs();
  if (!prefs.privacyAccepted && hasApiKey(safeStorage)) {
    return { ok: false, error: '请先同意隐私说明', needPrivacy: true };
  }
  try {
    return stashProposals(await runSkill('makeCard', { noteRel: String(noteRel ?? '') }));
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
});

ipcMain.handle('agent-wechat-draft', async (_e, briefRel: unknown) => {
  if (!activeVault) return { ok: false, error: '未打开 vault' };
  const prefs = readPrefs();
  if (!prefs.privacyAccepted && hasApiKey(safeStorage)) {
    return { ok: false, error: '请先同意隐私说明', needPrivacy: true };
  }
  try {
    return stashProposals(await runSkill('wechatDraft', { briefRel: String(briefRel ?? '') }));
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
});

ipcMain.handle('agent-wechat-titles', async (_e, draftRel: unknown) => {
  if (!activeVault) return { ok: false, error: '未打开 vault' };
  const prefs = readPrefs();
  if (!prefs.privacyAccepted && hasApiKey(safeStorage)) {
    return { ok: false, error: '请先同意隐私说明', needPrivacy: true };
  }
  try {
    return stashProposals(await runSkill('wechatTitles', { draftRel: String(draftRel ?? '') }));
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
});

ipcMain.handle('agent-wechat-layout', async (_e, draftRel: unknown) => {
  if (!activeVault) return { ok: false, error: '未打开 vault' };
  const prefs = readPrefs();
  if (!prefs.privacyAccepted && hasApiKey(safeStorage)) {
    return { ok: false, error: '请先同意隐私说明', needPrivacy: true };
  }
  try {
    // Layout lands via local tool immediately — no proposal stash required.
    return await runSkill('wechatLayout', { draftRel: String(draftRel ?? '') });
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
});

ipcMain.handle('agent-wechat-copy-html', async (_e, draftRel: unknown) => {
  if (!activeVault) return { ok: false, error: '未打开 vault' };
  try {
    const res = await runSkill('wechatCopyHtml', { draftRel: String(draftRel ?? '') });
    if (!res.ok) return res;
    const html = typeof res.html === 'string' ? res.html : '';
    const text = typeof res.text === 'string' ? res.text : '';
    if (!html) return { ok: false, error: '布局 HTML 为空' };
    // Electron clipboard — desktop-local; no network / WeChat login.
    clipboard.write({ html, text: text || html });
    return {
      ...res,
      answer: (res.answer || '') + ' 已复制到系统剪贴板。',
      copied: true,
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
});

ipcMain.handle('agent-wechat-publish', async (_e, draftRel: unknown) => {
  if (!activeVault) return { ok: false, error: '未打开 vault' };
  const prefs = readPrefs();
  if (!prefs.privacyAccepted && hasApiKey(safeStorage)) {
    return { ok: false, error: '请先同意隐私说明', needPrivacy: true };
  }
  try {
    return stashProposals(await runSkill('wechatPublish', { draftRel: String(draftRel ?? '') }));
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
});

ipcMain.handle('agent-wechat-preview', async (_e, draftRel: unknown) => {
  if (!activeVault) return { ok: false, error: '未打开 vault' };
  try {
    const res = await runSkill('wechatPreview', { draftRel: String(draftRel ?? '') });
    if (!res.ok) return res;
    const abs = typeof res.layoutAbs === 'string' ? res.layoutAbs : '';
    if (!abs) return { ok: false, error: '预览路径缺失' };
    const openErr = await shell.openPath(abs);
    if (openErr) return { ok: false, error: `无法打开预览：${openErr}` };
    return { ...res, opened: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
});

// agent-apply / agent-discard: registered by kvd-proposals via kvd-ipc-bridge

// ---- Settings > Advanced IPC (local origin only for enable/policy/approval) ----

ipcMain.handle('advanced-status', async () => {
  try { await getAdvancedHost(); } catch { /* host lazy */ }
  return { ok: true, ...advancedStatusSync() };
});

ipcMain.handle('advanced-enable', async (e, opts: { acknowledgeRisk?: unknown } | null) => {
  const origin = classifyIpcOrigin(e, mainWindow);
  const res = advanced.enable(origin, { acknowledgeRisk: !!(opts && opts.acknowledgeRisk) });
  if (res.ok && res.state.enabled) {
    try { await getAdvancedHost(); } catch { /* start on demand */ }
  }
  return res;
});

ipcMain.handle('advanced-disable', async (e) => {
  const res = advanced.disable(classifyIpcOrigin(e, mainWindow));
  if (advancedHost) await advancedHost.stop('advanced-off');
  return res;
});

ipcMain.handle('advanced-set-policy', (e, opts: { policy?: unknown; acknowledgeRisk?: unknown } | null) => {
  const origin = classifyIpcOrigin(e, mainWindow);
  return advanced.setPolicy(origin, opts && opts.policy, { acknowledgeRisk: !!(opts && opts.acknowledgeRisk) });
});

ipcMain.handle('advanced-approval-reply', (e, opts: { id?: unknown; decision?: unknown } | null) => {
  const origin = classifyIpcOrigin(e, mainWindow);
  if (!isLocal(origin)) return { ok: false, code: 'REMOTE_FORBIDDEN' };
  const id = String((opts && opts.id) ?? '');
  const decision = opts && opts.decision === 'allow' ? 'allow' : 'deny';
  const waiter = approvalWaiters.get(id);
  if (!waiter) return { ok: false, error: 'no pending approval' };
  approvalWaiters.delete(id);
  waiter(decision);
  return { ok: true };
});

ipcMain.handle('advanced-run', async (e, prompt: unknown) => {
  if (!isLocal(classifyIpcOrigin(e, mainWindow))) return { ok: false, code: 'REMOTE_FORBIDDEN', error: '高级档任务只能在本机发起' };
  const prefs = readPrefs();
  if (!prefs.privacyAccepted && hasApiKey(safeStorage)) {
    return { ok: false, error: '请先同意隐私说明', needPrivacy: true };
  }
  if (!advanced.getState().enabled) return { ok: false, error: '高级档未开启' };
  if (!activeVault) return { ok: false, error: '未打开 vault' };
  const text = typeof prompt === 'string' ? prompt.trim() : '';
  if (!text) return { ok: false, error: '请输入任务' };
  try {
    const host = await getAdvancedHost();
    // Real run: prompt -> mounted dsh agent -> tool calls gated by
    // kvd-approval-bridge (modal per call) -> final answer.
    const res = await host.run({ prompt: text });
    return advancedRunResult(res, host.status());
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
});

ipcMain.handle('advanced-reveal-log', () => {
  try {
    const dir = path.dirname(toolLog.file);
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(toolLog.file)) fs.writeFileSync(toolLog.file, '', { mode: 0o600 });
    shell.showItemInFolder(toolLog.file);
    return { ok: true, file: toolLog.file };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
});
