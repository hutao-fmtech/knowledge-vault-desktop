'use strict';

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
const { isLocal } = require('./origin');

const POLICIES = Object.freeze(['approve', 'log-only']);
const DEFAULTS = Object.freeze({ advancedEnabled: false, toolPolicy: 'approve' });

/**
 * @param {{ readPrefs: () => object, writePrefs: (patch: object) => object, now?: () => Date }} io
 */
function createAdvancedController({ readPrefs, writePrefs, now = () => new Date() }) {
  const listeners = new Set();

  function getState() {
    const p = readPrefs() || {};
    const policy = POLICIES.includes(p.toolPolicy) ? p.toolPolicy : DEFAULTS.toolPolicy;
    return {
      enabled: p.advancedEnabled === true,
      policy,
      riskAckEnable: !!p.advancedRiskAckAt,
      riskAckLogOnly: !!p.logOnlyRiskAckAt,
    };
  }

  function emit(reason) {
    const st = getState();
    for (const fn of listeners) {
      try { fn(st, reason); } catch { /* listener failures never block a state change */ }
    }
    return st;
  }

  function rejectRemote(origin) {
    return { ok: false, code: 'REMOTE_FORBIDDEN', error: '高级档设置只能在本机「设置 > 高级」中由用户手动更改，远程请求已拒绝' };
  }

  function enable(origin, { acknowledgeRisk = false } = {}) {
    if (!isLocal(origin)) return rejectRemote(origin);
    const st = getState();
    if (st.enabled) return { ok: true, state: st };
    const patch = { advancedEnabled: true, advancedEnabledAt: now().toISOString() };
    if (!st.riskAckEnable) {
      if (!acknowledgeRisk) return { ok: false, code: 'NEED_RISK_ACK', needRiskAck: 'enable', state: st };
      patch.advancedRiskAckAt = now().toISOString();
    }
    writePrefs(patch);
    return { ok: true, state: emit('enabled') };
  }

  function disable(_origin) {
    writePrefs({ advancedEnabled: false, advancedDisabledAt: now().toISOString() });
    return { ok: true, state: emit('disabled') };
  }

  function setPolicy(origin, policy, { acknowledgeRisk = false } = {}) {
    if (!isLocal(origin)) return rejectRemote(origin);
    if (!POLICIES.includes(policy)) return { ok: false, code: 'BAD_POLICY', error: `未知策略：${policy}` };
    const st = getState();
    if (st.policy === policy) return { ok: true, state: st };
    const patch = { toolPolicy: policy };
    if (policy === 'log-only' && !st.riskAckLogOnly) {
      if (!acknowledgeRisk) return { ok: false, code: 'NEED_RISK_ACK', needRiskAck: 'log-only', state: st };
      patch.logOnlyRiskAckAt = now().toISOString();
    }
    writePrefs(patch);
    return { ok: true, state: emit('policy') };
  }

  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return { getState, enable, disable, setPolicy, onChange };
}

module.exports = { createAdvancedController, POLICIES, DEFAULTS };
