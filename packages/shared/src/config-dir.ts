/**
 * App config directory (outside the vault and the repo). Shared by kvd-prefs,
 * kvd-keychain and the Electron shell (prefs.json, agent-key.json, logs/).
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export function configDir(): string {
  const base =
    process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support', 'KnowledgeVault')
      : process.platform === 'win32'
        ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'KnowledgeVault')
        : path.join(os.homedir(), '.config', 'knowledge-vault');
  fs.mkdirSync(base, { recursive: true });
  return base;
}
