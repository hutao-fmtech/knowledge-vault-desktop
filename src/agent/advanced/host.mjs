/**
 * Advanced-mode host: mounts/unmounts the composition advanced fiber,
 * owns a session agent for tool execution, and exposes runTool for smoke/UI.
 *
 * No unsupported SDK profiles. No dsh umbrella package. No BYO Node
 * (Electron 39 embeds Node 22.22.1).
 */
import { randomUUID } from 'node:crypto';
import { SessionId } from '@deepseek-ai/dsh-session';
import {
  bootRuntime,
  getRuntime,
  mountAdvanced,
  unmountAdvanced,
  isAdvancedMounted,
} from '../../runtime/boot.mjs';
import * as models from '../../runtime/shared/models.mjs';

/**
 * The app's configured live model (same id the default-mode skills use, and one
 * of the provider's listed models: deepseek-flash / deepseek-v4-pro).
 */
export const DEFAULT_PROVIDER = models.LIVE_PROVIDER;
export const DEFAULT_MODEL = models.DEFAULT_MODEL;

/** Hard cap for one advanced run (includes time waiting on approval modals). */
const RUN_TIMEOUT_MS = 15 * 60 * 1000;

function routeOf(getModelRoute) {
  const r = (typeof getModelRoute === 'function' && getModelRoute()) || {};
  return {
    provider: String(r.provider || DEFAULT_PROVIDER),
    model: String(r.model || DEFAULT_MODEL),
  };
}

function textOfContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');
}

/**
 * Fold the session events of one run into { answer, toolCalls, eventTypes }.
 * @param {readonly any[]} events
 */
export function summarizeRun(events) {
  const toolCalls = [];
  const byId = new Map();
  let answer = '';
  for (const ev of events) {
    const type = String(ev && ev.type);
    const data = (ev && ev.data) || {};
    if (type === 'assistant/message') {
      const msg = data.message || data;
      const content = msg.content || [];
      const t = textOfContent(content);
      if (t.trim()) answer = t;
      for (const b of Array.isArray(content) ? content : []) {
        if (b && b.type === 'tool-call') {
          let args = b.arguments;
          if (typeof args === 'string') {
            try { args = JSON.parse(args); } catch { /* keep raw */ }
          }
          const rec = { id: String(b.id), name: String(b.name), arguments: args, isError: null, output: null };
          byId.set(rec.id, rec);
          toolCalls.push(rec);
        }
      }
    } else if (type === 'tool/result') {
      const msg = data.message || data;
      const id = String(msg.toolCallId ?? msg.source?.callId ?? data.callId ?? '');
      const rec = byId.get(id);
      if (rec) {
        rec.isError = !!msg.isError;
        const out = msg.content;
        const str = typeof out === 'string' ? out : textOfContent(out);
        rec.output = str.length > 500 ? `${str.slice(0, 500)}…` : str;
      }
    }
  }
  return { answer, toolCalls, eventTypes: events.map((e) => String(e && e.type)) };
}

/**
 * @param {{
 *   controller: { getState: () => { enabled: boolean, policy: string }, onChange: (fn: Function) => Function },
 *   log: { append: (r: object) => string, file: string },
 *   requestApproval: (req: object) => Promise<'allow'|'deny'>,
 *   onPropose: (change: object) => Promise<object> | object,
 *   getVaultRoot: () => string|null,
 *   getSecrets?: () => (string|null|undefined)[],
 * }} deps
 */
export function createAdvancedHost(deps) {
  const {
    controller,
    log,
    requestApproval,
    onPropose,
    getVaultRoot,
    getSecrets = () => [],
    getModelRoute = () => ({ provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL }),
  } = deps;

  /** @type {{ agent: any, handle: any, vault: string } | null} */
  let live = null;
  let starting = null;
  let lastError = null;
  let agentSeq = 0;

  function policyOrOff() {
    const st = controller.getState();
    if (!st.enabled) return 'off';
    return st.policy === 'log-only' ? 'log-only' : 'approve';
  }

  async function stop(reason = 'stopped') {
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

  async function start() {
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
        onToolCall: (rec) => log.append(rec),
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
    live = { agent: handle.agent, handle, vault, route: `${route.provider}/${route.model}` };
    lastError = null;
    return live;
  }

  async function ensureStarted() {
    const vault = getVaultRoot();
    const r = routeOf(getModelRoute);
    const want = `${r.provider}/${r.model}`;
    if (live && live.vault === vault && live.route === want && isAdvancedMounted()) return live;
    if (live) await stop(live.vault !== vault ? 'vault-changed' : 'stopped');
    if (!starting) {
      starting = start()
        .catch(async (err) => {
          lastError = err.message;
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
  async function runTool({ name, arguments: args, callId }) {
    await ensureStarted();
    if (!controller.getState().enabled) throw new Error('高级档已关闭');
    const { ctx } = await getRuntime();
    const tools = ctx.get('tools');
    if (!tools) throw new Error('tools unavailable (advanced not mounted)');
    const agent = live.agent;
    agent.session.append('turn/start', {});
    const ac = new AbortController();
    try {
      return await tools.execute({
        callId: callId || `toolu_${randomUUID().slice(0, 8)}`,
        name,
        arguments: args,
        agent,
        signal: ac.signal,
      });
    } finally {
      try {
        agent.session.append('turn/end', {});
      } catch {
        /* ignore */
      }
    }
  }

  let running = null;

  /**
   * Bug B: run one advanced task end-to-end. Sends the prompt to the mounted
   * dsh agent as a role:'user' message (without the role the DeepSeek
   * transport fails silently), waits until the agent is idle, and returns the
   * final answer plus a summary of every tool call. Every tool call goes
   * through tools/pre-execute + approval/request (kvd-approval-bridge).
   *
   * @param {{ prompt: string, timeoutMs?: number }} opts
   */
  async function run({ prompt, timeoutMs = RUN_TIMEOUT_MS } = {}) {
    const text = String(prompt || '').trim();
    if (!text) throw new Error('请输入任务');
    if (!controller.getState().enabled) throw new Error('高级档未开启');
    if (running) throw new Error('上一个高级档任务仍在运行');
    const p = (async () => {
      const cur = await ensureStarted();
      const agent = cur.agent;
      const { ctx } = await getRuntime();
      const requestErrors = [];
      const offErr = ctx.on('agent/request-error', (...args) => {
        for (const a of args) {
          const e = a && (a.error || (a instanceof Error ? a : null));
          if (e) requestErrors.push(String(e.message || e));
        }
        return undefined;
      });
      const before = agent.session.snapshotEvents().length;
      let timedOut = false;
      let timer = null;
      try {
        agent.followup({
          role: 'user',
          content: [{ type: 'text', text }],
          source: { kind: 'user' },
        });
        const timeout = new Promise((resolve) => {
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

  function status() {
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
