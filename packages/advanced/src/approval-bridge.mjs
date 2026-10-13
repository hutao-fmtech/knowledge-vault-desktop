/**
 * kvd-approval-bridge (advanced group)
 *
 * AC-13 / AC-14: tools/pre-execute (prepend) stores exec.arguments by callId
 * and returns { kind: 'ask' } in approve-each-call mode, or next() in log-only.
 * approval/request responder looks up full args and asks the local UI, then
 * returns allowed-once / rejected.
 *
 * Config callbacks are injected by the advanced host at mount time.
 */
import z from '@deepseek-ai/schemastery';

export const name = 'kvd-approval-bridge';
export const inject = ['tools', 'approval'];

export const Config = z.object({
  /** () => 'approve' | 'log-only' | null (advanced off) */
  getPolicy: z.any(),
  /** (req) => Promise<'allow'|'deny'> — UI modal; receives full tool+args */
  requestApproval: z.any(),
  /** optional logger */
  onToolCall: z.any(),
});

function plainJson(value) {
  try {
    return JSON.parse(JSON.stringify(value ?? null));
  } catch {
    return { unserializable: String(value) };
  }
}

/** Argument keys that ask the executor for a wider sandbox than read-only. */
const ESCALATION_KEYS = new Set(['sandbox_permissions', 'sandboxPermissions', 'sandbox_mode', 'sandboxMode']);
const ESCALATION_REASON_RE = /escalat|sandbox/i;

/**
 * Bug C: find any sandbox-escalation request in tool arguments (any depth).
 * The advanced sandbox is pinned read-only; the only write path is
 * vault_propose_change + Apply, so ANY ask for a wider mode is an escalation.
 * @returns {string|null} the requested mode, or null when none
 */
export function findEscalation(args, depth = 0) {
  if (args == null || depth > 8) return null;
  if (typeof args === 'string') {
    // Some providers hand arguments over as a JSON string.
    if (depth === 0 && /sandbox/i.test(args)) {
      try { return findEscalation(JSON.parse(args), depth + 1); } catch { return null; }
    }
    return null;
  }
  if (Array.isArray(args)) {
    for (const v of args) {
      const hit = findEscalation(v, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof args === 'object') {
    for (const [k, v] of Object.entries(args)) {
      if (ESCALATION_KEYS.has(k) && v != null && v !== '' && v !== 'read-only') return String(v);
      const hit = findEscalation(v, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

/** True when an approval/request is a sandbox escalation (dsh approveEscalation reason). */
export function isEscalationRequest(req) {
  if (!req || typeof req !== 'object') return false;
  const texts = [req.reason, req.displayReason?.en, req.displayReason?.zh, req.displayReason]
    .filter((x) => typeof x === 'string');
  return texts.some((t) => ESCALATION_REASON_RE.test(t));
}

function displayCommand(tool, args) {
  if (args && typeof args === 'object' && typeof args.command === 'string') return args.command;
  return null;
}

export function apply(ctx, config = {}) {
  /** @type {Map<string, { tool: string, arguments: unknown, command: string|null, nested: boolean }>} */
  const byCallId = new Map();
  /** @type {Map<string, (d: 'allow'|'deny') => void>} */
  const pendingUi = new Map();
  /** callIds that already got their single approval prompt */
  const asked = new Set();

  const getPolicy = typeof config.getPolicy === 'function' ? config.getPolicy : () => 'approve';
  const requestApproval =
    typeof config.requestApproval === 'function'
      ? config.requestApproval
      : async () => 'deny';
  const onToolCall = typeof config.onToolCall === 'function' ? config.onToolCall : () => {};

  ctx.on(
    'tools/pre-execute',
    async (exec, next) => {
      const policy = getPolicy();
      const callId = String(exec.callId ?? '');
      const tool = String(exec.name);
      const args = plainJson(exec.arguments);
      const record = {
        tool,
        arguments: args,
        command: displayCommand(tool, args),
        nested: exec.parent !== undefined,
      };
      byCallId.set(callId, record);

      // Bug C: hard-reject sandbox escalation BEFORE any policy (incl. log-only).
      const escalation = findEscalation(args);
      if (escalation) {
        record.escalation = escalation;
        onToolCall({
          event: 'escalation-rejected',
          callId,
          tool,
          arguments: args,
          policy: policy ?? null,
          requestedMode: escalation,
          decision: 'deny',
          decidedBy: 'escalation-guard',
          stage: 'pre-execute',
        });
        return {
          kind: 'deny',
          reason:
            `Knowledge Vault keeps the sandbox read-only; escalation to "${escalation}" is always rejected. `
            + 'Do not retry with sandbox_permissions. To change the vault, call vault_propose_change (the user presses Apply).',
        };
      }

      if (policy == null || policy === 'off') {
        onToolCall({
          event: 'tool-call',
          callId,
          tool,
          arguments: args,
          policy: null,
          decision: 'deny',
          decidedBy: 'advanced-off',
        });
        return { kind: 'deny', reason: 'Knowledge Vault advanced mode is off; tools are unavailable.' };
      }

      if (policy === 'log-only') {
        onToolCall({
          event: 'tool-call',
          callId,
          tool,
          arguments: args,
          policy,
          decision: 'allow',
          decidedBy: 'policy',
        });
        return next();
      }

      // approve-each-call: ask → approval/request (AC-13)
      return {
        kind: 'ask',
        reason: 'Knowledge Vault requires approval for this tool call',
        displayReason: 'approve each call',
      };
    },
    { prepend: true },
  );

  ctx.on(
    'approval/request',
    async (req) => {
      const callId = String(req.callId ?? '');
      const stored = byCallId.get(callId);
      const tool = stored?.tool || String(req.toolName || '');
      const args = stored?.arguments ?? null;
      const command = stored?.command ?? displayCommand(tool, args);
      const policy = getPolicy();

      // Bug C: sandbox escalation is never approvable, under any policy. Do not
      // key this on callId alone: dsh re-asks with the SAME callId for the
      // escalation, so check the request reason, the stored args, and whether
      // this callId has already had its one approval prompt.
      const escalationFromArgs = findEscalation(args) || findEscalation(req.arguments);
      const repeatAsk = asked.has(callId);
      if (isEscalationRequest(req) || escalationFromArgs || repeatAsk) {
        onToolCall({
          event: 'escalation-rejected',
          callId,
          tool,
          arguments: args,
          policy: policy ?? null,
          requestedMode: escalationFromArgs || (String(req.reason || '').match(/to\s+([\w-]+)/)?.[1] ?? null),
          reason: typeof req.reason === 'string' ? req.reason : null,
          decision: 'deny',
          decidedBy: 'escalation-guard',
          stage: 'approval-request',
          repeatAsk,
        });
        return 'rejected';
      }

      if (policy == null || policy === 'off') {
        onToolCall({
          event: 'tool-call',
          callId,
          tool,
          arguments: args,
          policy: null,
          decision: 'deny',
          decidedBy: 'advanced-off',
          approvalId: null,
        });
        return 'rejected';
      }

      // Unknown asks without our pre-execute record: reject.
      // log-only never asks via pre-execute, so any ask under log-only is not ours: reject.
      if (!stored || policy === 'log-only') {
        onToolCall({
          event: 'tool-call',
          callId,
          tool,
          arguments: args,
          policy,
          decision: 'deny',
          decidedBy: !stored ? 'no-args' : 'unexpected-ask',
        });
        return 'rejected';
      }

      asked.add(callId);
      const id = `apr_${callId}`;
      const decision = await new Promise((resolve) => {
        pendingUi.set(id, resolve);
        Promise.resolve()
          .then(() =>
            requestApproval({
              id,
              callId,
              tool,
              arguments: args,
              command,
              nested: !!stored.nested,
            }),
          )
          .then((d) => {
            const r = pendingUi.get(id);
            if (r) {
              pendingUi.delete(id);
              r(d === 'allow' ? 'allow' : 'deny');
            }
          })
          .catch(() => {
            const r = pendingUi.get(id);
            if (r) {
              pendingUi.delete(id);
              r('deny');
            }
          });
      });

      // Advanced may have been switched off while the modal was open.
      const stillOn = getPolicy() != null && getPolicy() !== 'off';
      const finalDecision = decision === 'allow' && stillOn ? 'allow' : 'deny';
      onToolCall({
        event: 'tool-call',
        callId,
        tool,
        arguments: args,
        policy,
        approvalId: id,
        decision: finalDecision,
        decidedBy: 'user',
      });
      return finalDecision === 'allow' ? 'allowed-once' : 'rejected';
    },
    { prepend: true },
  );

  // Expose cancel for immediate disable (AC-12)
  ctx.effect(() => {
    return () => {
      for (const [id, resolve] of pendingUi) {
        pendingUi.delete(id);
        resolve('deny');
      }
      byCallId.clear();
      asked.clear();
    };
  });
}

export default { name, inject, Config, apply, findEscalation, isEscalationRequest };
