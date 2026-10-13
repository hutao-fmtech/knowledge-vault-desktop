// Sandboxed preload: must be CommonJS (.cts -> lib/preload.cjs).
import { contextBridge, ipcRenderer } from 'electron';

type Cb<T> = (value: T) => void;

contextBridge.exposeInMainWorld('vaultApi', {
  sanitizeName: (raw: unknown) => ipcRenderer.invoke('sanitize-name', raw),
  getTemplatePreview: () => ipcRenderer.invoke('template-preview'),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  createVault: (payload: unknown) => ipcRenderer.invoke('create-vault', payload),
  openVault: () => ipcRenderer.invoke('open-vault'),
  showItemInFolder: (p: unknown) => ipcRenderer.invoke('show-item-in-folder', p),
  agentStatus: () => ipcRenderer.invoke('agent-status'),
  agentSetVault: (p: unknown) => ipcRenderer.invoke('agent-set-vault', p),
  agentAcceptPrivacy: () => ipcRenderer.invoke('agent-accept-privacy'),
  agentSaveKey: (k: unknown) => ipcRenderer.invoke('agent-save-key', k),
  agentClearKey: () => ipcRenderer.invoke('agent-clear-key'),
  agentListInbox: () => ipcRenderer.invoke('agent-list-inbox'),
  agentAsk: (q: unknown) => ipcRenderer.invoke('agent-ask', q),
  agentSort: (n: unknown) => ipcRenderer.invoke('agent-sort', n),
  agentCard: (n: unknown) => ipcRenderer.invoke('agent-card', n),
  agentApply: (id: unknown) => ipcRenderer.invoke('agent-apply', id),
  agentDiscard: (id: unknown) => ipcRenderer.invoke('agent-discard', id),
  advancedStatus: () => ipcRenderer.invoke('advanced-status'),
  advancedEnable: (acknowledgeRisk: unknown) => ipcRenderer.invoke('advanced-enable', { acknowledgeRisk: !!acknowledgeRisk }),
  advancedDisable: () => ipcRenderer.invoke('advanced-disable'),
  advancedSetPolicy: (policy: unknown, acknowledgeRisk: unknown) => ipcRenderer.invoke('advanced-set-policy', { policy, acknowledgeRisk: !!acknowledgeRisk }),
  advancedApprovalReply: (id: unknown, decision: unknown) => ipcRenderer.invoke('advanced-approval-reply', { id, decision }),
  advancedRun: (prompt: unknown) => ipcRenderer.invoke('advanced-run', prompt),
  advancedRevealLog: () => ipcRenderer.invoke('advanced-reveal-log'),
  onAdvancedState: (cb: Cb<unknown>) => { ipcRenderer.on('advanced-state', (_e, st: unknown) => cb(st)); },
  onApprovalRequest: (cb: Cb<unknown>) => { ipcRenderer.on('advanced-approval-request', (_e, req: unknown) => cb(req)); },
  onAgentProposal: (cb: Cb<unknown>) => { ipcRenderer.on('agent-proposal', (_e, p: unknown) => cb(p)); },
});
