/**
 * kvd-runtime composition root: one Cordis Context, declarative rows, dispose on quit.
 * Advanced mode mounts ADVANCED_ROWS as a disposable child fiber.
 */
import { Context } from '@deepseek-ai/cordis';
import { DEFAULT_ROWS, resolvePlugin, advancedRowsFor } from './composition.mjs';

/** @type {Promise<{ ctx: import('@deepseek-ai/cordis').Context, rows: object[] }> | null} */
let bootPromise = null;
/** @type {{ ctx: import('@deepseek-ai/cordis').Context, rows: object[] } | null} */
let runtime = null;
let disposeCalled = false;
let disposing = false;
let quitHooksRegistered = false;

/** @type {import('@deepseek-ai/cordis').Fiber | null} */
let advancedFiber = null;
/** @type {Promise<import('@deepseek-ai/cordis').Fiber> | null} */
let advancedMounting = null;

/**
 * Boot (or return) the shared Cordis runtime.
 * @param {{ rows?: import('./composition.mjs').PluginRow[] }} [options]
 */
export async function bootRuntime(options = {}) {
  if (bootPromise) return bootPromise;
  if (disposeCalled) {
    throw new Error('kvd-runtime: already disposed; restart the process to boot again');
  }
  bootPromise = (async () => {
    const ctx = new Context();
    const rows = options.rows || DEFAULT_ROWS;
    for (const row of rows) {
      if (row.disabled) continue;
      const plugin = await resolvePlugin(row);
      await ctx.plugin(plugin, row.config);
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

/** @returns {Promise<{ ctx: import('@deepseek-ai/cordis').Context, rows: object[] }>} */
export function getRuntime() {
  return bootRuntime();
}

export function wasDisposeCalled() {
  return disposeCalled;
}

export function isRuntimeBooted() {
  return !!runtime;
}

export function isAdvancedMounted() {
  return !!advancedFiber;
}

/**
 * Mount the advanced plugin group as a disposable child fiber on the root ctx.
 * Idempotent: if already mounted for the same session, returns the existing fiber.
 * @param {{
 *   workspaceRoot: string,
 *   bridge?: object,
 *   audit?: object,
 *   vaultTools?: object,
 * }} opts
 */
export async function mountAdvanced(opts) {
  const { ctx } = await bootRuntime();
  if (advancedFiber) return advancedFiber;
  if (advancedMounting) return advancedMounting;

  advancedMounting = (async () => {
    const rows = advancedRowsFor(opts);
    const AdvancedGroup = {
      name: 'kvd-advanced-group',
      async apply(groupCtx) {
        for (const row of rows) {
          if (row.disabled) continue;
          const plugin = await resolvePlugin(row);
          await groupCtx.plugin(plugin, row.config);
        }
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
export async function unmountAdvanced() {
  const fiber = advancedFiber;
  advancedFiber = null;
  advancedMounting = null;
  if (!fiber) return;
  await fiber.dispose();
}

/**
 * Dispose the Cordis root fiber (idempotent). Sets wasDisposeCalled().
 */
export async function disposeRuntime() {
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
 * @param {import('electron').App} app
 */
export function registerElectronQuitHooks(app) {
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
          const p = current.ctx.fiber.dispose();
          if (p && typeof p.then === 'function') p.catch(() => {});
        } catch {
          /* ignore */
        }
      }
    }
  });
}
