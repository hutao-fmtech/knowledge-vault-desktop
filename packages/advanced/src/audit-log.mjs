/**
 * kvd-audit-log (advanced group) — tools/result observer → vault-external JSONL.
 * Never logs API keys (redaction in tool-log).
 */
import { createRequire } from 'node:module';
import z from '@deepseek-ai/schemastery';

const require = createRequire(import.meta.url);
const { createToolLog } = require('./tool-log.js');

export const name = 'kvd-audit-log';
export const inject = ['tools'];

export const Config = z.object({
  logDir: z.string(),
  getSecrets: z.any(),
  /** Shared log instance from host (optional); else created from logDir */
  log: z.any(),
});

const RESULT_MAX = 8000;

function resultText(result) {
  const parts = (result?.content || []).map((b) =>
    b && b.type === 'text' ? b.text : `[${b?.type || 'block'}]`,
  );
  const text = parts.join('\n');
  return text.length > RESULT_MAX ? `${text.slice(0, RESULT_MAX)}…[truncated]` : text;
}

export function apply(ctx, config = {}) {
  const log =
    config.log
    || createToolLog({
      dir: config.logDir,
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
