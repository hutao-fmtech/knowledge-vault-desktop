/**
 * kvd-runtime composition root: one Cordis Context, declarative rows, dispose on quit.
 * Advanced mode mounts ADVANCED_ROWS as a disposable child fiber.
 */
import { Context } from '@deepseek-ai/cordis';
import type { Fiber } from '@deepseek-ai/cordis';
import type { App } from 'electron';
// Service augmentations (ctx.llm / ctx.tools / ctx.vault / ...) for type-checking.
import type {} from '@deepseek-ai/dsh-llm';
import type {} from '@deepseek-ai/dsh-tools';
import type {} from '@deepseek-ai/dsh-credentials';
import type {} from '@kvd/vault';
import type {} from '@kvd/search';
import type {} from '@kvd/proposals';
import type {} from '@kvd/ipc-bridge';
import type {} from '@kvd/skills';
import { DEFAULT_ROWS, resolvePlugin, advancedRowsFor } from './composition.js';
import type { AdvancedMountOptions, PluginRow } from './composition.js';

export interface Runtime {
  ctx: Context;
  rows: PluginRow[];
}

let bootPromise: Promise<Runtime> | null = null;
let runtime: Runtime | null = null;
let disposeCalled = false;
let disposing = false;
let quitHooksRegistered = false;

let advancedFiber: Fiber | null = null;
let advancedMounting: Promise<Fiber> | null = null;
/** Row ids actually mounted (default rows at boot + advanced children while mounted). */
let mountedDefaultIds: string[] = [];
let mountedAdvancedIds: string[] = [];

/**
 * Boot (or return) the shared Cordis runtime.
 */
export async function bootRuntime(options: { rows?: PluginRow[] } = {}): Promise<Runtime> {
  if (bootPromise) return bootPromise;
  if (disposeCalled) {
    throw new Error('kvd-runtime: already disposed; restart the process to boot again');
  }
  bootPromise = (async () => {
    const ctx = new Context();
    mountedDefaultIds = [];
    const rows = options.rows || DEFAULT_ROWS;
    for (const row of rows) {
      if (row.disabled) continue;
      const plugin = await resolvePlugin(row);
      await ctx.plugin(plugin, row.config);
      mountedDefaultIds.push(row.id);
    }
    const llm = ctx.get('llm');
    if (!llm) throw new Error('kvd-runtime: llm service missing after mount');
    const providers = llm.listProviders().map((p) => p.id);
    if (!providers.includes('deepseek-official')) {
      throw new Error(`kvd-runtime: expected deepseek-official, got ${providers.join(',')}`);
    }
    runtime = { ctx, rows };
    return runtime;
  })();
  try {
    return await bootPromise;
  } catch (err) {
    bootPromise = null;
    runtime = null;
    throw err;
  }
}

export function getRuntime(): Promise<Runtime> {
  return bootRuntime();
}

export function wasDisposeCalled(): boolean {
  return disposeCalled;
}

export function isRuntimeBooted(): boolean {
  return !!runtime;
}

/** Ids of every plugin row currently mounted from cordis.yml. */
export function mountedPluginIds(): string[] {
  return [...mountedDefaultIds, ...mountedAdvancedIds];
}

export function isAdvancedMounted(): boolean {
  return !!advancedFiber;
}

/**
 * Mount the advanced plugin group as a disposable child fiber on the root ctx.
 * Idempotent: if already mounted for the same session, returns the existing fiber.
 */
export async function mountAdvanced(opts: AdvancedMountOptions): Promise<Fiber> {
  const { ctx } = await bootRuntime();
  if (advancedFiber) return advancedFiber;
  if (advancedMounting) return advancedMounting;

  advancedMounting = (async () => {
    const rows = advancedRowsFor(opts);
    const AdvancedGroup = {
      name: 'kvd-advanced-group',
      async apply(groupCtx: Context) {
        const ids: string[] = [];
        for (const row of rows) {
          if (row.disabled) continue;
          const plugin = await resolvePlugin(row);
          await groupCtx.plugin(plugin, row.config);
          ids.push(row.id);
        }
        mountedAdvancedIds = ids;
        if (!groupCtx.get('tools')) {
          throw new Error('kvd-advanced: tools service missing after mount');
        }
      },
    };
    const fiber = await ctx.plugin(AdvancedGroup);
    advancedFiber = fiber;
    return fiber;
  })();

  try {
    return await advancedMounting;
  } catch (err) {
    advancedFiber = null;
    throw err;
  } finally {
    advancedMounting = null;
  }
}

/**
 * Dispose the advanced fiber (AC-12). Tools / approval listeners vanish with it.
 * Idempotent.
 */
export async function unmountAdvanced(): Promise<void> {
  const fiber = advancedFiber;
  advancedFiber = null;
  advancedMounting = null;
  mountedAdvancedIds = [];
  if (!fiber) return;
  await fiber.dispose();
}

/**
 * Dispose the Cordis root fiber (idempotent). Sets wasDisposeCalled().
 */
export async function disposeRuntime(): Promise<void> {
  disposeCalled = true;
  if (disposing) return;
  disposing = true;
  try {
    await unmountAdvanced().catch(() => {});
  } catch {
    /* ignore */
  }
  const current = runtime;
  runtime = null;
  bootPromise = null;
  if (!current) return;
  try {
    await current.ctx.fiber.dispose();
  } finally {
    disposing = false;
  }
}

/**
 * Hook Electron quit so the composition root is disposed.
 */
export function registerElectronQuitHooks(app: App): void {
  if (quitHooksRegistered || !app || typeof app.on !== 'function') return;
  quitHooksRegistered = true;
  let quitting = false;

  const runDispose = async () => {
    await disposeRuntime();
  };

  app.on('before-quit', (event) => {
    if (quitting || disposeCalled) return;
    if (!runtime && !bootPromise) {
      disposeCalled = true;
      return;
    }
    event.preventDefault();
    quitting = true;
    runDispose()
      .catch(() => {})
      .finally(() => {
        app.quit();
      });
  });

  app.on('will-quit', () => {
    if (!disposeCalled) {
      disposeCalled = true;
      const current = runtime;
      runtime = null;
      bootPromise = null;
      advancedFiber = null;
      if (current) {
        try {
          const p: unknown = current.ctx.fiber.dispose();
          if (p instanceof Promise) p.catch(() => {});
        } catch {
          /* ignore */
        }
      }
    }
  });
}

/** Offline check used by smoke / pack-smoke: mount succeeds and lists the official route. */
export async function smokeMount() {
  const { ctx } = await bootRuntime();
  return {
    ok: true,
    providers: ctx.llm.listProviders().map((p) => p.id),
    hasCredentials: ctx.get('credentials') !== undefined,
    hasVault: ctx.get('vault') !== undefined,
    hasVaultSearch: ctx.get('vaultSearch') !== undefined,
    hasProposals: ctx.get('proposals') !== undefined,
    hasIpc: ctx.get('ipc') !== undefined,
    hasSkills: ctx.get('kvdSkills') !== undefined,
    plugins: [...mountedDefaultIds],
    hasMockProvider: ctx.llm.listProviders().some((p) => p.id === 'kvd-mock'),
  };
}
