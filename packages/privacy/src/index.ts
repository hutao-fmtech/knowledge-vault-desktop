/**
 * kvd-privacy — gate every model call on llm/stream (prepend).
 * Without privacy consent, short-circuits before any adapter / network.
 * Fixes G1: sort/card/ask all share this seam when they call the model.
 */
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-llm';
import type {} from '@kvd/prefs';

export const name = 'kvd-privacy';
export const inject = ['llm', 'kvdPrefs'];

export function apply(ctx: Context): void {
  ctx.on(
    'llm/stream',
    (options, next) => {
      // Offline mock adapter never leaves the device — exempt from privacy gate.
      // Smoke still uses a separate `mock-offline` route that remains gated.
      if (options && options.provider === 'kvd-mock') {
        return next();
      }
      if (ctx.kvdPrefs.getPrivacyAccepted()) {
        return next();
      }
      return (async function* () {
        yield {
          type: 'finish',
          reason: {
            kind: 'error',
            failure: {
              message: '请先同意隐私说明',
              code: 'PRIVACY_REQUIRED',
            },
          },
        };
      })();
    },
    true, // prepend: run before other llm/stream listeners
  );
}

export default { name, inject, apply };
