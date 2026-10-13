/**
 * kvd-ipc-bridge — plugins register IPC routes on their own fiber (auto-unregister
 * on dispose) and push events to the local main window.
 *
 * Host (main.js) must call `ipc.attachMainWindow(() => mainWindow)` once the
 * BrowserWindow exists. Sender is checked against that window's webContents.
 */
import { createRequire } from 'node:module';
import { Context, Service } from '@deepseek-ai/cordis';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import z from '@deepseek-ai/schemastery';

const require = createRequire(import.meta.url);

export const name = 'kvd-ipc-bridge';

export const Config = z.object({});

declare module '@deepseek-ai/cordis' {
  interface Context {
    ipc: IpcBridge;
  }
}

/** Handler shape for ipc.handle (args come from the renderer: untrusted, hence unknown). */
export type IpcHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

function tryElectron(): typeof import('electron') | null {
  try {
    // In pure Node, require('electron') returns the binary path string, not the API.
    const electron = require('electron') as typeof import('electron') | string;
    return typeof electron === 'object' ? electron : null;
  } catch {
    return null;
  }
}

export class IpcBridge extends Service {
  static Config = Config;

  private _getMainWindow: null | (() => BrowserWindow | null) = null;
  private readonly _handled = new Set<string>();

  constructor(ctx: Context, _config: unknown = {}) {
    super(ctx, 'ipc');
  }

  /**
   * @param {() => import('electron').BrowserWindow | null} getter
   */
  attachMainWindow(getter: (() => BrowserWindow | null) | null): void {
    this._getMainWindow = typeof getter === 'function' ? getter : null;
  }

  /**
   * @param {import('electron').IpcMainInvokeEvent} event
   */
  isLocalSender(event: IpcMainInvokeEvent | null | undefined): boolean {
    const win = this._getMainWindow && this._getMainWindow();
    if (!win || win.isDestroyed() || !event || !event.sender) return false;
    try {
      return event.sender.id === win.webContents.id;
    } catch {
      return false;
    }
  }

  /**
   * Register an invoke handler. Unregisters when the owning fiber disposes.
   * In pure-Node smoke (no electron), this is a no-op that still tracks the name.
   * @param {string} channel
   * @param {(event: any, ...args: any[]) => any} fn
   */
  handle(channel: string, fn: IpcHandler): void {
    if (!channel || typeof fn !== 'function') {
      throw new Error('ipc.handle: channel and fn required');
    }
    const electron = tryElectron();
    if (!electron || !electron.ipcMain) {
      this._handled.add(channel);
      return;
    }
    const { ipcMain } = electron;
    if (this._handled.has(channel)) {
      throw new Error(`ipc.handle: channel already registered: ${channel}`);
    }
    const handler = async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<unknown> => {
      if (!this.isLocalSender(event)) {
        return { ok: false, error: 'forbidden', code: 'REMOTE_FORBIDDEN' };
      }
      return fn(event, ...args);
    };
    ipcMain.handle(channel, handler);
    this._handled.add(channel);
    this.ctx.effect(() => () => {
      try {
        ipcMain.removeHandler(channel);
      } catch {
        /* already gone */
      }
      this._handled.delete(channel);
    });
  }

  /**
   * Push an event to the local main-window renderer (no-op if no window).
   * @param {string} channel
   * @param {unknown} payload
   */
  push(channel: string, payload: unknown): boolean {
    const win = this._getMainWindow && this._getMainWindow();
    if (!win || win.isDestroyed()) return false;
    try {
      win.webContents.send(channel, payload);
      return true;
    } catch {
      return false;
    }
  }

  /** Channels registered via this bridge (for smoke). */
  listHandled(): string[] {
    return [...this._handled];
  }
}

export default IpcBridge;
