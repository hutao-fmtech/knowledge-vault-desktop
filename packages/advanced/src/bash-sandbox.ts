/**
 * kvd-bash-sandbox — `@deepseek-ai/dsh-bash-sandbox` with an explicit bash on
 * Windows (issue #18). Everything else (read-only policy resolution, runner,
 * denial classification) is upstream's: only argv[0] of the confined
 * `bash -c <command>` changes, and only on win32. Confinement is still always
 * applied through `ctx.sandbox.confine`, so read-only semantics are unchanged.
 */
import { SandboxBashExecutor } from '@deepseek-ai/dsh-bash-sandbox';
import type { SandboxPolicy, ConfinedArgv } from '@deepseek-ai/dsh-sandbox';
import { sandboxBashProgram } from './git-bash.js';

interface SandboxHost {
  ctx: { sandbox: { confine(argv: readonly string[], policy: SandboxPolicy, signal?: AbortSignal): Promise<ConfinedArgv> } };
}

export class KvdSandboxBashExecutor extends SandboxBashExecutor {}

// Upstream declares `confine` private, so TypeScript cannot express the
// override; replace it on the subclass prototype with the same signature.
Object.defineProperty(KvdSandboxBashExecutor.prototype, 'confine', {
  configurable: true,
  writable: true,
  value: function confine(this: SandboxHost, command: string, policy: SandboxPolicy, signal?: AbortSignal): Promise<ConfinedArgv> {
    // Throws GitBashNotFoundError (user-facing) on Windows without Git Bash.
    return this.ctx.sandbox.confine([sandboxBashProgram(), '-c', command], policy, signal);
  },
});

export default KvdSandboxBashExecutor;
