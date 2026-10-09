'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vaultApi', {
  sanitizeName: (raw) => ipcRenderer.invoke('sanitize-name', raw),
  getTemplatePreview: () => ipcRenderer.invoke('template-preview'),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  createVault: (payload) => ipcRenderer.invoke('create-vault', payload),
  openVault: () => ipcRenderer.invoke('open-vault'),
  showItemInFolder: (p) => ipcRenderer.invoke('show-item-in-folder', p),
  agentStatus: () => ipcRenderer.invoke('agent-status'),
  agentSetVault: (p) => ipcRenderer.invoke('agent-set-vault', p),
  agentAcceptPrivacy: () => ipcRenderer.invoke('agent-accept-privacy'),
  agentSaveKey: (k) => ipcRenderer.invoke('agent-save-key', k),
  agentClearKey: () => ipcRenderer.invoke('agent-clear-key'),
  agentListInbox: () => ipcRenderer.invoke('agent-list-inbox'),
  agentAsk: (q) => ipcRenderer.invoke('agent-ask', q),
  agentSort: (n) => ipcRenderer.invoke('agent-sort', n),
  agentCard: (n) => ipcRenderer.invoke('agent-card', n),
  agentApply: (id) => ipcRenderer.invoke('agent-apply', id),
  agentDiscard: (id) => ipcRenderer.invoke('agent-discard', id),
});
