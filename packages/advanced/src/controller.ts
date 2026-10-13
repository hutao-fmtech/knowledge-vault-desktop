/**
 * Advanced-mode controller: the single owner of the two advanced settings
 * (AC-11b/d, AC-12, AC-14).
 *
 *   advancedEnabled  boolean, default false
 *   toolPolicy       'approve' (default) | 'log-only'
 *
 * Rules enforced here, in the main process:
 *   - Turning advanced mode ON and changing the tool policy require a LOCAL
 *     origin (see origin.js). Any other origin — including future Feishu /
 *     WeCom remote commands — is rejected with code REMOTE_FORBIDDEN.
 *   - The first enable needs an explicit risk acknowledgement; so does the
 *     first switch to 'log-only'. Acknowledgements are remembered (one-time).
 *   - Turning advanced mode OFF is always allowed (it only reduces capability)
 *     and listeners run synchronously so the runtime is torn down immediately.
 */
import { isLocal } from './origin.js';
import type { Origin } from './origin.js';

export type ToolPolicy = 'approve' | 'log-only';
export const POLICIES: readonly ToolPolicy[] = Object.freeze(['approve', 'log-only'] as const);
export const DEFAULTS = Object.freeze({ advancedEnabled: false, toolPolicy: 'approve' as ToolPolicy });

export interface AdvancedState {
  enabled: boolean;
  policy: ToolPolicy;
  riskAckEnable: boolean;
  riskAckLogOnly: boolean;
}

export type ControllerResult =
  | { ok: true; state: AdvancedState }
  | { ok: false; code: 'REMOTE_FORBIDDEN' | 'BAD_POLICY'; error: string }
  | { ok: false; code: 'NEED_RISK_ACK'; needRiskAck: 'enable' | 'log-only'; state: AdvancedState };

export type StateListener = (state: AdvancedState, reason: string) => void;

export interface AdvancedController {
  getState(): AdvancedState;
  enable(origin: Origin | null | undefined, opts?: { acknowledgeRisk?: boolean }): ControllerResult;
  disable(origin?: Origin | null): ControllerResult;
  setPolicy(origin: Origin | null | undefined, policy: unknown, opts?: { acknowledgeRisk?: boolean }): ControllerResult;
  onChange(fn: StateListener): () => boolean;
}

export type PrefsRecord = Record<string, unknown>;

function isPolicy(v: unknown): v is ToolPolicy {
  return typeof v === 'string' && (POLICIES as readonly string[]).includes(v);
}

export function createAdvancedController({
  readPrefs,
  writePrefs,
  now = () => new Date(),
}: {
  readPrefs: () => PrefsRecord | null | undefined;
  writePrefs: (patch: PrefsRecord) => unknown;
  now?: () => Date;
}): AdvancedController {
  const listeners = new Set<StateListener>();

  function getState(): AdvancedState {
    const p = readPrefs() || {};
    const policy = isPolicy(p.toolPolicy) ? p.toolPolicy : DEFAULTS.toolPolicy;
    return {
      enabled: p.advancedEnabled === true,
      policy,
      riskAckEnable: !!p.advancedRiskAckAt,
      riskAckLogOnly: !!p.logOnlyRiskAckAt,
    };
  }

  function emit(reason: string): AdvancedState {
    const st = getState();
    for (const fn of listeners) {
      try { fn(st, reason); } catch { /* listener failures never block a state change */ }
    }
    return st;
  }

  function rejectRemote(_origin: Origin | null | undefined): ControllerResult {
    return { ok: false, code: 'REMOTE_FORBIDDEN', error: '高级档设置只能在本机「设置 > 高级」中由用户手动更改，远程请求已拒绝' };
  }

  function enable(origin: Origin | null | undefined, { acknowledgeRisk = false } = {}): ControllerResult {
    if (!isLocal(origin)) return rejectRemote(origin);
    const st = getState();
    if (st.enabled) return { ok: true, state: st };
    const patch: PrefsRecord = { advancedEnabled: true, advancedEnabledAt: now().toISOString() };
    if (!st.riskAckEnable) {
      if (!acknowledgeRisk) return { ok: false, code: 'NEED_RISK_ACK', needRiskAck: 'enable', state: st };
      patch.advancedRiskAckAt = now().toISOString();
    }
    writePrefs(patch);
    return { ok: true, state: emit('enabled') };
  }

  function disable(_origin?: Origin | null): ControllerResult {
    writePrefs({ advancedEnabled: false, advancedDisabledAt: now().toISOString() });
    return { ok: true, state: emit('disabled') };
  }

  function setPolicy(origin: Origin | null | undefined, policy: unknown, { acknowledgeRisk = false } = {}): ControllerResult {
    if (!isLocal(origin)) return rejectRemote(origin);
    if (!isPolicy(policy)) return { ok: false, code: 'BAD_POLICY', error: `未知策略：${String(policy)}` };
    const st = getState();
    if (st.policy === policy) return { ok: true, state: st };
    const patch: PrefsRecord = { toolPolicy: policy };
    if (policy === 'log-only' && !st.riskAckLogOnly) {
      if (!acknowledgeRisk) return { ok: false, code: 'NEED_RISK_ACK', needRiskAck: 'log-only', state: st };
      patch.logOnlyRiskAckAt = now().toISOString();
    }
    writePrefs(patch);
    return { ok: true, state: emit('policy') };
  }

  function onChange(fn: StateListener): () => boolean {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return { getState, enable, disable, setPolicy, onChange };
}
