/**
 * Renderer-side view of the preload bridge (window.vaultApi). Results come back
 * over IPC as plain JSON, so they are modelled as one permissive result shape;
 * the main process is authoritative.
 */
interface UiProposal {
  id: string;
  kind: 'create' | 'edit' | 'move';
  path?: string;
  from?: string;
  to?: string;
  content?: string;
  before?: string;
  summary?: string;
  /** Stamped by the main-process proposals service (R2.6); read-only for the UI. */
  initiator?: 'agent' | 'user';
}

interface UiTreeNode {
  name: string;
  children?: UiTreeNode[];
}

interface UiAdvancedState {
  enabled: boolean;
  policy: string;
  logFile?: string;
  runtime?: { running?: boolean; lastError?: string | null };
}

interface UiWritePauseState {
  paused: boolean;
  pausedAt?: string;
}

interface UiApprovalRequest {
  id: string;
  tool: string;
  nested?: boolean;
  command?: string | null;
  commandLanguage?: 'PowerShell' | 'bash' | null;
  arguments?: unknown;
}

interface ApiResult {
  ok: boolean;
  error?: string;
  code?: string;
  name?: string;
  path?: string;
  mode?: string;
  vaultPath?: string;
  tree?: UiTreeNode;
  notes?: string[];
  content?: string;
  answer?: string;
  layoutPath?: string;
  layoutAbs?: string;
  html?: string;
  text?: string;
  copied?: boolean;
  opened?: boolean;
  proposals?: UiProposal[];
  needPrivacy?: boolean;
  needRiskAck?: string;
  state?: Partial<UiAdvancedState>;
  toolCalls?: { name: string; command?: string | null; isError?: boolean | null }[];
}

interface AgentStatus extends ApiResult {
  hasKey?: boolean;
  privacyAccepted?: boolean;
}

interface VaultApi {
  sanitizeName(raw: string): Promise<ApiResult>;
  getTemplatePreview(): Promise<{ labels?: string[] }>;
  pickFolder(): Promise<ApiResult>;
  createVault(payload: { parentDir: string; rawName: string }): Promise<ApiResult>;
  openVault(): Promise<ApiResult>;
  showItemInFolder(p: string): Promise<ApiResult>;
  agentStatus(): Promise<AgentStatus>;
  agentSetVault(p: string): Promise<ApiResult>;
  agentAcceptPrivacy(): Promise<ApiResult>;
  agentSaveKey(k: string): Promise<ApiResult>;
  agentClearKey(): Promise<ApiResult>;
  agentListInbox(): Promise<ApiResult>;
  agentListWechatOa(): Promise<ApiResult>;
  agentOpenNote(n: string): Promise<ApiResult>;
  agentAsk(q: string): Promise<ApiResult>;
  agentSort(n: string): Promise<ApiResult>;
  agentCard(n: string): Promise<ApiResult>;
  agentWechatDraft(n: string): Promise<ApiResult>;
  agentWechatTitles(n: string): Promise<ApiResult>;
  agentWechatLayout(n: string): Promise<ApiResult>;
  agentWechatCopyHtml(n: string): Promise<ApiResult>;
  agentWechatPublish(n: string): Promise<ApiResult>;
  agentWechatPreview(n: string): Promise<ApiResult>;
  agentApply(id: string): Promise<ApiResult>;
  agentDiscard(id: string): Promise<ApiResult>;
  writePauseStatus(): Promise<UiWritePauseState & ApiResult>;
  writePauseSet(paused: boolean): Promise<ApiResult & { state?: UiWritePauseState }>;
  onWritePauseState(cb: (st: UiWritePauseState) => void): void;
  advancedStatus(): Promise<UiAdvancedState & ApiResult>;
  advancedEnable(acknowledgeRisk: boolean): Promise<ApiResult>;
  advancedDisable(): Promise<ApiResult>;
  advancedSetPolicy(policy: string, acknowledgeRisk: boolean): Promise<ApiResult>;
  advancedApprovalReply(id: string, decision: 'allow' | 'deny'): Promise<ApiResult>;
  advancedRun(prompt: string): Promise<ApiResult>;
  advancedRevealLog(): Promise<ApiResult>;
  onAdvancedState(cb: (st: UiAdvancedState) => void): void;
  onApprovalRequest(cb: (req: UiApprovalRequest) => void): void;
  onAgentProposal(cb: (p: UiProposal) => void): void;
}

interface Window {
  vaultApi: VaultApi;
}
