'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

function configDir() {
  const base =
    process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support', 'KnowledgeVault')
      : process.platform === 'win32'
        ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'KnowledgeVault')
        : path.join(os.homedir(), '.config', 'knowledge-vault');
  fs.mkdirSync(base, { recursive: true });
  return base;
}

function keyFile() {
  return path.join(configDir(), 'agent-key.json');
}

/**
 * Store API key outside the vault and outside the repo.
 * Uses Electron safeStorage when available; otherwise plaintext file in app config dir
 * (still never inside the vault).
 */
function saveApiKey(rawKey, safeStorage) {
  const key = String(rawKey || '').trim();
  if (!key) return { ok: false, error: 'API key 为空' };
  const payload = { updatedAt: new Date().toISOString() };
  if (safeStorage && safeStorage.isEncryptionAvailable && safeStorage.isEncryptionAvailable()) {
    payload.enc = safeStorage.encryptString(key).toString('base64');
    payload.mode = 'safeStorage';
  } else {
    payload.key = key;
    payload.mode = 'localFile';
  }
  fs.writeFileSync(keyFile(), JSON.stringify(payload, null, 2), { mode: 0o600 });
  return { ok: true, mode: payload.mode };
}

function loadApiKey(safeStorage) {
  const f = keyFile();
  if (!fs.existsSync(f)) return { ok: true, key: null };
  try {
    const payload = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (payload.mode === 'safeStorage' && payload.enc && safeStorage) {
      const buf = Buffer.from(payload.enc, 'base64');
      return { ok: true, key: safeStorage.decryptString(buf), mode: 'safeStorage' };
    }
    if (payload.key) return { ok: true, key: payload.key, mode: 'localFile' };
    return { ok: true, key: null };
  } catch (err) {
    return { ok: false, error: err.message, key: null };
  }
}

function clearApiKey() {
  const f = keyFile();
  if (fs.existsSync(f)) fs.unlinkSync(f);
  return { ok: true };
}

function hasApiKey(safeStorage) {
  const r = loadApiKey(safeStorage);
  return !!(r.ok && r.key);
}

module.exports = { saveApiKey, loadApiKey, clearApiKey, hasApiKey, configDir, keyFile };
