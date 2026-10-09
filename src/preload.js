'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vaultApi', {
  sanitizeName: (raw) => ipcRenderer.invoke('sanitize-name', raw),
  getTemplatePreview: () => ipcRenderer.invoke('template-preview'),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  createVault: (payload) => ipcRenderer.invoke('create-vault', payload),
  showItemInFolder: (p) => ipcRenderer.invoke('show-item-in-folder', p),
});
