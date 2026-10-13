/**
 * Advanced-mode host: mounts/unmounts the composition advanced fiber,
 * owns a session agent for tool execution, and exposes runTool for smoke/UI.
 *
 * No unsupported SDK profiles. No dsh umbrella package. No BYO Node
 * (Electron 39 embeds Node 22.22.1).
 */
import { randomUUID } from 'node:crypto';
import type { Context, Fiber } from '@deepseek-ai/cordis';
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent';
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import type {} from '@deepseek-ai/dsh-tools';
import type { AdvancedController } from './controller.js';
import type { ApprovalBridgeConfig, ApprovalUiRequest } from './approval-bridge.js';
import type { AuditLogConfig } from './audit-log.js';
import type { ProposeHandler } from './vault-tools.js';
import type { ToolLog } from './tool-log.js';
import * as models from '@kvd/shared/models';

/**
 * The app's configured live model (same id the default-mode skills use, and one
 * of the provider's listed models: deepseek-flash / deepseek-v4-pro).
 */
export const DEFAULT_PROVIDER = models.LIVE_PROVIDER;
export const DEFAULT_MODEL = models.DEFAULT_MODEL;

/** Hard cap for one advanced run (includes time waiting on approval modals). */
const RUN_TIMEOUT_MS = 15 * 60 * 1000;

export interface ModelRoute {
  provider: string;
  model: string;
}

export interface MountAdvancedOptions {
  workspaceRoot: string;
  bridge?: ApprovalBridgeConfig;
  audit?: AuditLogConfig;
  vaultTools?: { onPropose?: ProposeHandler };
}

/** Composition-root handle injected by apps/desktop (runtime/boot). */
export interface RuntimeHandle {
  bootRuntime: () => Promise<unknown>;
  getRuntime: () => Promise<{ ctx: Context }>;
  mountAdvanced: (opts: MountAdvancedOptions) => Promise<Fiber | unknown>;
  unmountAdvanced: () => Promise<void>;
  isAdvancedMounted: () => boolean;
}

export interface HostDeps {
  controller: Pick<AdvancedController, 'getState' | 'onChange'>;
  log: Pick<ToolLog, 'append'> & Partial<Pick<ToolLog, 'file'>>;
  requestApproval: (req: ApprovalUiRequest) => Promise<unknown> | unknown;
  onPropose: ProposeHandler;
  getVaultRoot: () => string | null;
  getSecrets?: () => readonly (string | null | undefined)[];
  getModelRoute?: () => Partial<ModelRoute> | null | undefined;
  runtime: RuntimeHandle;
}

export interface RunToolCallRecord {
  id: string;
  name: string;
  arguments: unknown;
  isError: boolean | null;
  output: string | null;
}

export interface RunSummary {
  answer: string;
  toolCalls: RunToolCallRecord[];
  eventTypes: string[];
}

interface Live {
  agent: Agent;
  handle: AgentHandle;
  vault: string;
  route: string;
}

type Rec = Record<string, unknown>;
const asRec = (v: unknown): Rec => (v && typeof v === 'object' ? (v as Rec) : {});

function routeOf(getModelRoute: HostDeps['getModelRoute']): ModelRoute {
  const r = (typeof getModelRoute === 'function' && getModelRoute()) || {};
  return {
    provider: String(r.provider || DEFAULT_PROVIDER),
    model: String(r.model || DEFAULT_MODEL),
  };
}

function textOfContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((b: unknown) => {
      const r = asRec(b);
      return r.type === 'text' && typeof r.text === 'string' ? r.text : '';
    })
    .join('');
}

/**
 * Fold the session events of one run into { answer, toolCalls, eventTypes }.
 * Events are session events (shape varies per type), read defensively as unknown.
 */
export function summarizeRun(events: readonly unknown[]): RunSummary {
  const toolCalls: RunToolCallRecord[] = [];
  const byId = new Map<string, RunToolCallRecord>();
  let answer = '';
  for (const raw of events) {
    const ev = asRec(raw);
    const type = String(raw && ev.type);
    const data = asRec(ev.data);
    if (type === 'assistant/message') {
      const msg = data.message ? asRec(data.message) : data;
      const content = msg.content || [];
      const t = textOfContent(content);
      if (t.trim()) answer = t;
      for (const item of Array.isArray(content) ? (content as unknown[]) : []) {
        const b = asRec(item);
        if (b.type === 'tool-call') {
          let args: unknown = b.arguments;
          if (typeof args === 'string') {
            try { args = JSON.parse(args) as unknown; } catch { /* keep raw */ }
          }
          const rec: RunToolCallRecord = { id: String(b.id), name: String(b.name), arguments: args, isError: null, output: null };
          byId.set(rec.id, rec);
          toolCalls.push(rec);
        }
      }
    } else if (type === 'tool/result') {
      const msg = data.message ? asRec(data.message) : data;
      const id = String(msg.toolCallId ?? asRec(msg.source).callId ?? data.callId ?? '');
      const rec = byId.get(id);
      if (rec) {
        rec.isError = !!msg.isError;
        const out = msg.content;
        const str = typeof out === 'string' ? out : textOfContent(out);
        rec.output = str.length > 500 ? `${str.slice(0, 500)}…` : str;
      }
    }
  }
  return { answer, toolCalls, eventTypes: events.map((e) => String(e && asRec(e).type)) };
}

/**
 * @param {{
 *   controller: { getState: () => { enabled: boolean, policy: string }, onChange: (fn: Function) => Function },
 *   log: { append: (r: object) => string, file: string },
 *   requestApproval: (req: object) => Promise<'allow'|'deny'>,
 *   onPropose: (change: object) => Promise<object> | object,
 *   getVaultRoot: () => string|null,
 *   getSecrets?: () => (string|null|undefined)[],
 *   runtime: { bootRuntime: Function, getRuntime: Function, mountAdvanced: Function, unmountAdvanced: Function, isAdvancedMounted: Function },
 * }} deps
 */
export function createAdvancedHost(deps: HostDeps) {
  const {
    controller,
    log,
    requestApproval,
    onPropose,
    getVaultRoot,
    getSecrets = () => [],
    getModelRoute = () => ({ provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL }),
    runtime,
  } = deps;
  // The composition root (apps/desktop runtime/boot.mjs) is injected so this
  // package never imports the app shell (one-way dependency: app -> @kvd/advanced).
  if (!runtime || typeof runtime.mountAdvanced !== 'function') {
    throw new Error('createAdvancedHost: deps.runtime (composition root handle) is required');
  }
  const { bootRuntime, getRuntime, mountAdvanced, unmountAdvanced, isAdvancedMounted } = runtime;

  let live: Live | null = null;
  let syntheticTurn = 0;
  let starting: Promise<Live> | null = null;
  let lastError: string | null = null;
  let agentSeq = 0;

  function policyOrOff(): 'off' | 'approve' | 'log-only' {
    const st = controller.getState();
    if (!st.enabled) return 'off';
    return st.policy === 'log-only' ? 'log-only' : 'approve';
  }

  async function stop(reason = 'stopped'): Promise<void> {
    const cur = live;
    live = null;
    starting = null;
    // Unmount the advanced fiber FIRST so AC-12 (tools gone) is immediate.
    await unmountAdvanced().catch(() => {});
    if (cur?.handle) {
      try {
        await cur.handle.dispose();
      } catch {
        /* gone */
      }
    }
    lastError = reason === 'stopped' || reason === 'advanced-off' ? null : reason;
  }

  async function start(): Promise<Live> {
    const st = controller.getState();
    if (!st.enabled) throw new Error('高级档未开启');
    const vault = getVaultRoot();
    if (!vault) throw new Error('未打开 vault');

    const route = routeOf(getModelRoute);
    await bootRuntime();
    await mountAdvanced({
      workspaceRoot: vault,
      bridge: {
        getPolicy: policyOrOff,
        requestApproval,
        onToolCall: (rec: Record<string, unknown>) => log.append(rec),
      },
      audit: {
        log,
        getSecrets,
      },
      vaultTools: {
        onPropose,
      },
    });

    const { ctx } = await getRuntime();
    agentSeq += 1;
    const sid = SessionId(`kvd-adv-${agentSeq}-${randomUUID().slice(0, 8)}`);
    const handle = await ctx.agents.create({
      sessionId: sid,
      meta: { cwd: vault },
      agentOptions: { ...route },
    });
    const next: Live = { agent: handle.agent, handle, vault, route: `${route.provider}/${route.model}` };
    live = next;
    lastError = null;
    return next;
  }

  async function ensureStarted(): Promise<Live> {
    const vault = getVaultRoot();
    const r = routeOf(getModelRoute);
    const want = `${r.provider}/${r.model}`;
    if (live && live.vault === vault && live.route === want && isAdvancedMounted()) return live;
    if (live) await stop(live.vault !== vault ? 'vault-changed' : 'stopped');
    if (!starting) {
      starting = start()
        .catch(async (err: unknown) => {
          lastError = err instanceof Error ? err.message : String(err);
          await stop('start-failed');
          throw err;
        })
        .finally(() => {
          starting = null;
        });
    }
    return starting;
  }

  /**
   * Execute one tool through the mounted registry (AC-13 path).
   * Opens a synthetic turn so approval/request can audit.
   */
  async function runTool({ name, arguments: args, callId }: { name: string; arguments: unknown; callId?: string }) {
    const cur = await ensureStarted();
    if (!controller.getState().enabled) throw new Error('高级档已关闭');
    const { ctx } = await getRuntime();
    const tools = ctx.get('tools');
    if (!tools) throw new Error('tools unavailable (advanced not mounted)');
    const agent = cur.agent;
    // Synthetic turn (smoke / direct tool path): numbered past any real agent turn.
    syntheticTurn += 1;
    const turn = 1_000_000 + syntheticTurn;
    agent.session.append('turn/start', { turn });
    const ac = new AbortController();
    try {
      return await tools.execute({
        callId: ToolCallId(callId || `toolu_${randomUUID().slice(0, 8)}`),
        name,
        arguments: args,
        agent,
        signal: ac.signal,
      });
    } finally {
      try {
        agent.session.append('turn/end', { turn, reason: { kind: 'completed' } });
      } catch {
        /* ignore */
      }
    }
  }

  let running: Promise<RunSummary & { timedOut: boolean; requestErrors: string[]; route: string }> | null = null;

  /**
   * Bug B: run one advanced task end-to-end. Sends the prompt to the mounted
   * dsh agent as a role:'user' message (without the role the DeepSeek
   * transport fails silently), waits until the agent is idle, and returns the
   * final answer plus a summary of every tool call. Every tool call goes
   * through tools/pre-execute + approval/request (kvd-approval-bridge).
   *
   * @param {{ prompt: string, timeoutMs?: number }} opts
   */
  async function run({ prompt, timeoutMs = RUN_TIMEOUT_MS }: { prompt?: string; timeoutMs?: number } = {}) {
    const text = String(prompt || '').trim();
    if (!text) throw new Error('请输入任务');
    if (!controller.getState().enabled) throw new Error('高级档未开启');
    if (running) throw new Error('上一个高级档任务仍在运行');
    const p = (async () => {
      const cur = await ensureStarted();
      const agent = cur.agent;
      const { ctx } = await getRuntime();
      const requestErrors: string[] = [];
      // Observe only: record the failure, then defer to later listeners (e.g. dsh-llm-retry).
      const offErr = ctx.on('agent/request-error', (payload, next) => {
        const msg = payload?.failure?.message;
        if (msg) requestErrors.push(String(msg));
        return next();
      });
      const before = agent.session.snapshotEvents().length;
      let timedOut = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      try {
        agent.followup(
          createUserMessage({
            content: [{ type: 'text', text }],
            source: { kind: 'user' },
          }),
        );
        const timeout = new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            timedOut = true;
            resolve();
          }, timeoutMs);
        });
        await Promise.race([agent.whenIdle(), timeout]);
        if (timedOut) {
          try { agent.cancel({ kind: 'user' }); } catch { /* gone */ }
          await Promise.race([agent.whenIdle(), new Promise((r) => setTimeout(r, 5000))]);
        }
      } finally {
        if (timer) clearTimeout(timer);
        try { if (typeof offErr === 'function') offErr(); } catch { /* ignore */ }
      }
      const events = agent.session.snapshotEvents().slice(before);
      return { ...summarizeRun(events), timedOut, requestErrors, route: cur.route };
    })();
    running = p;
    try {
      return await p;
    } finally {
      running = null;
    }
  }

  controller.onChange((st) => {
    if (!st.enabled) void stop('advanced-off');
  });

  function status(): { running: boolean; lastError: string | null; composition: string; profile: null } {
    return {
      running: !!live && isAdvancedMounted(),
      lastError,
      composition: 'kvd-advanced-group',
      profile: null,
    };
  }

  return { runTool, run, stop, status, ensureStarted, start };
}

export default { createAdvancedHost };
