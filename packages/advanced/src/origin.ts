/**
 * Request-origin classification for settings that only a person sitting at
 * this computer may change (AC-11d, AC-14).
 *
 * Only two origins exist:
 *   - LOCAL: an IPC call whose sender is our own main window's top frame,
 *     loaded from our packaged renderer file. Renderer handlers for these
 *     settings are bound to click events in Settings > Advanced.
 *   - anything else (REMOTE): every other caller, including future Feishu /
 *     WeCom bridges, which must construct `remoteOrigin(channel)` and are
 *     therefore rejected by the advanced-mode controller.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const LOCAL = 'local-renderer';
export const REMOTE = 'remote';

export type Origin =
  | Readonly<{ kind: typeof LOCAL }>
  | Readonly<{ kind: typeof REMOTE; channel: string }>;

/** Minimal shape of an Electron IpcMainInvokeEvent that classification needs. */
export interface IpcEventLike {
  sender?: unknown;
  senderFrame?: { url?: string; parent?: unknown } | null;
}

/**
 * Default renderer URL (relative to this module); the Electron shell passes its
 * own packaged renderer URL to classifyIpcOrigin so the check matches the real
 * loaded file.
 */
export const RENDERER_URL = pathToFileURL(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'renderer', 'index.html'),
).href;

export function localOrigin(): Origin {
  return Object.freeze({ kind: LOCAL });
}

export function remoteOrigin(channel?: unknown): Origin {
  return Object.freeze({ kind: REMOTE, channel: String(channel || 'unknown') });
}

/**
 * Classify an Electron IpcMainInvokeEvent.
 * @param rendererUrl file:// URL of the renderer the main window loaded (default: RENDERER_URL)
 */
export function classifyIpcOrigin(
  event: IpcEventLike | null | undefined,
  mainWindow: { webContents?: unknown } | null | undefined,
  rendererUrl: string = RENDERER_URL,
): Origin {
  try {
    if (!event || !mainWindow || !mainWindow.webContents) return remoteOrigin('ipc-unknown-window');
    if (event.sender !== mainWindow.webContents) return remoteOrigin('ipc-foreign-webcontents');
    const frame = event.senderFrame;
    if (!frame || frame.parent) return remoteOrigin('ipc-subframe');
    const url = String(frame.url || '').split(/[#?]/)[0] ?? '';
    if (url !== rendererUrl) return remoteOrigin('ipc-foreign-url');
    return localOrigin();
  } catch {
    return remoteOrigin('ipc-error');
  }
}

export function isLocal(origin: Origin | null | undefined): boolean {
  return !!origin && origin.kind === LOCAL;
}
