/**
 * kvd-audit-log (advanced group) — tools/result observer → vault-external JSONL.
 * Never logs API keys (redaction in tool-log).
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools';
import z from '@deepseek-ai/schemastery';
import { createToolLog } from './tool-log.js';
import type { ToolLog } from './tool-log.js';

export const name = 'kvd-audit-log';
export const inject = ['tools'];

export const Config = z.object({
  logDir: z.string(),
  getSecrets: z.any(),
  /** Shared log instance from host (optional); else created from logDir */
  log: z.any(),
});

const RESULT_MAX = 8000;

export interface AuditLogConfig {
  logDir?: string;
  getSecrets?: () => readonly (string | null | undefined)[];
  /** Shared log instance from host (optional); else created from logDir. */
  log?: Pick<ToolLog, 'append'>;
}

function resultText(result: Readonly<ToolExecutionResult> | undefined): string {
  const parts = (result?.content || []).map((b) =>
    b && b.type === 'text' ? b.text : `[${b?.type || 'block'}]`,
  );
  const text = parts.join('\n');
  return text.length > RESULT_MAX ? `${text.slice(0, RESULT_MAX)}…[truncated]` : text;
}

export function apply(ctx: Context, config: AuditLogConfig = {}): void {
  const log =
    config.log
    || createToolLog({
      dir: String(config.logDir),
      getSecrets: typeof config.getSecrets === 'function' ? config.getSecrets : () => [],
    });

  ctx.on('tools/result', (exec, result) => {
    log.append({
      event: 'tool-result',
      callId: String(exec.callId ?? ''),
      tool: String(exec.name || ''),
      isError: !!result?.isError,
      output: resultText(result),
    });
  });
}

export default { name, inject, Config, apply };
