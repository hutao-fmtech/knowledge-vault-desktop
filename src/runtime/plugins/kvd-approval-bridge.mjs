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

function displayCommand(tool, args) {
  if (args && typeof args === 'object' && typeof args.command === 'string') return args.command;
  return null;
}

export function apply(ctx, config = {}) {
  /** @type {Map<string, { tool: string, arguments: unknown, command: string|null, nested: boolean }>} */
  const byCallId = new Map();
  /** @type {Map<string, (d: 'allow'|'deny') => void>} */
  const pendingUi = new Map();

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

      // Sandbox escalation / unknown asks without our pre-execute record: reject.
      if (!stored) {
        onToolCall({
          event: 'tool-call',
          callId,
          tool,
          arguments: args,
          policy,
          decision: 'deny',
          decidedBy: 'no-args',
        });
        return 'rejected';
      }

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
    };
  });
}

export default { name, inject, Config, apply };
