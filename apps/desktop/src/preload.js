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
  advancedStatus: () => ipcRenderer.invoke('advanced-status'),
  advancedEnable: (acknowledgeRisk) => ipcRenderer.invoke('advanced-enable', { acknowledgeRisk: !!acknowledgeRisk }),
  advancedDisable: () => ipcRenderer.invoke('advanced-disable'),
  advancedSetPolicy: (policy, acknowledgeRisk) => ipcRenderer.invoke('advanced-set-policy', { policy, acknowledgeRisk: !!acknowledgeRisk }),
  advancedApprovalReply: (id, decision) => ipcRenderer.invoke('advanced-approval-reply', { id, decision }),
  advancedRun: (prompt) => ipcRenderer.invoke('advanced-run', prompt),
  advancedRevealLog: () => ipcRenderer.invoke('advanced-reveal-log'),
  onAdvancedState: (cb) => { ipcRenderer.on('advanced-state', (_e, st) => cb(st)); },
  onApprovalRequest: (cb) => { ipcRenderer.on('advanced-approval-request', (_e, req) => cb(req)); },
  onAgentProposal: (cb) => { ipcRenderer.on('agent-proposal', (_e, p) => cb(p)); },
});
