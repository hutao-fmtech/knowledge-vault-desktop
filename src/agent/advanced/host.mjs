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
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-chat' },
    });
    live = { agent: handle.agent, handle, vault };
    lastError = null;
    return live;
  }

  async function ensureStarted() {
    const vault = getVaultRoot();
    if (live && live.vault === vault && isAdvancedMounted()) return live;
    if (live) await stop('vault-changed');
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

  return { runTool, stop, status, ensureStarted, start };
}

export default { createAdvancedHost };
