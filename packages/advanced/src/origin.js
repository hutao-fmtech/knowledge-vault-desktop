'use strict';

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
const path = require('path');
const { pathToFileURL } = require('url');

const LOCAL = 'local-renderer';
const REMOTE = 'remote';

const RENDERER_URL = pathToFileURL(path.join(__dirname, '..', '..', 'renderer', 'index.html')).href;

function localOrigin() {
  return Object.freeze({ kind: LOCAL });
}

function remoteOrigin(channel) {
  return Object.freeze({ kind: REMOTE, channel: String(channel || 'unknown') });
}

/**
 * Classify an Electron IpcMainInvokeEvent.
 * @param {{ sender?: any, senderFrame?: { url?: string, parent?: any } }} event
 * @param {{ webContents?: any } | null} mainWindow
 */
function classifyIpcOrigin(event, mainWindow) {
  try {
    if (!event || !mainWindow || !mainWindow.webContents) return remoteOrigin('ipc-unknown-window');
    if (event.sender !== mainWindow.webContents) return remoteOrigin('ipc-foreign-webcontents');
    const frame = event.senderFrame;
    if (!frame || frame.parent) return remoteOrigin('ipc-subframe');
    const url = String(frame.url || '').split('#')[0].split('?')[0];
    if (url !== RENDERER_URL) return remoteOrigin('ipc-foreign-url');
    return localOrigin();
  } catch {
    return remoteOrigin('ipc-error');
  }
}

function isLocal(origin) {
  return !!origin && origin.kind === LOCAL;
}

module.exports = { LOCAL, REMOTE, RENDERER_URL, localOrigin, remoteOrigin, classifyIpcOrigin, isLocal };
