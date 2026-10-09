'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { createVault, sanitizeVaultName, topLevelSkeletonLabels } = require('./vault');

const TEMPLATE_ROOT = path.join(__dirname, '..', 'resources', 'template');

/** @type {BrowserWindow | null} */
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 880,
    height: 740,
    minWidth: 720,
    minHeight: 560,
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

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

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
  return createVault({ parentDir, rawName, templateRoot: TEMPLATE_ROOT });
});

ipcMain.handle('show-item-in-folder', (_e, targetPath) => {
  if (!targetPath) return { ok: false };
  shell.showItemInFolder(targetPath);
  return { ok: true };
});
