/**
 * Issue #20: upstream dsh-pwsh-local prepends
 *   [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); …
 * to every -Command. Under Windows read-only sandbox ConstrainedLanguage that
 * type is disallowed, so every call prints two InvalidOperation lines on
 * stderr; with only Windows PowerShell 5.1, Chinese output may also garble.
 *
 * We keep the same UTF-8 intent but wrap it so ConstrainedLanguage failures
 * are silent. pwsh 7 (preferred candidate) already emits UTF-8 and is
 * unaffected. Residual risk: PS 5.1 + ConstrainedLanguage still cannot set
 * OutputEncoding — needs real-machine check.
 */
import { ENCODING_PREAMBLE, PwshLocalExecutor } from '@deepseek-ai/dsh-pwsh-local';

/**
 * ConstrainedLanguage-safe replacement for upstream ENCODING_PREAMBLE.
 * Child scope keeps $ea local; SilentlyContinue + try/catch covers both
 * terminating and non-terminating InvalidOperation from disallowed types.
 */
export const SAFE_ENCODING_PREAMBLE =
  "& { $ea=$ErrorActionPreference; $ErrorActionPreference='SilentlyContinue'; "
  + 'try { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false) } catch {}; '
  + 'try { $OutputEncoding = [System.Text.UTF8Encoding]::new($false) } catch {}; '
  + '$ErrorActionPreference=$ea }; ';

/** Swap upstream preamble for the ConstrainedLanguage-safe one when present. */
export function withSafeEncodingPreamble(commandArg: string): string {
  if (commandArg.startsWith(ENCODING_PREAMBLE)) {
    return SAFE_ENCODING_PREAMBLE + commandArg.slice(ENCODING_PREAMBLE.length);
  }
  return commandArg;
}

/** Upstream argv is protected; patch via a structural view of the prototype. */
type PwshArgv = (spec: { command: string }) => string[];
type PwshProto = { argv: PwshArgv };

let installed = false;

/**
 * Patch PwshLocalExecutor.argv once so SandboxPwshExecutor (and any subclass)
 * emits SAFE_ENCODING_PREAMBLE. Call before mounting dsh-pwsh-sandbox.
 */
export function installSafePwshEncodingPreamble(): void {
  if (installed) return;
  installed = true;
  const proto = PwshLocalExecutor.prototype as unknown as PwshProto;
  const original = proto.argv;
  proto.argv = function argv(this: unknown, spec: { command: string }): string[] {
    const out = original.call(this, spec);
    const last = out.length - 1;
    if (typeof out[last] === 'string') {
      out[last] = withSafeEncodingPreamble(out[last]);
    }
    return out;
  };
}

/** Test/smoke helper: whether the prototype patch is in place. */
export function isSafePwshEncodingPreambleInstalled(): boolean {
  return installed;
}

/** Test helper: invoke the (possibly patched) argv on a stub executor. */
export function probePwshArgvCommand(command: string, pwshPath = 'pwsh'): string {
  const proto = PwshLocalExecutor.prototype as unknown as PwshProto;
  const argv = proto.argv.call({ get pwshPath() { return pwshPath; } }, { command });
  return argv[argv.length - 1] ?? '';
}
