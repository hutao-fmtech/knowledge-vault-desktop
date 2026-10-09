/**
 * kvd-keychain — CredentialProvider backed by keystore.js (safeStorage or
 * app-config file mode 0600). Never stores keys in the vault or process.env.
 *
 * Records API (R8): empty / unsupported in v0.2.
 */
import { createRequire } from 'node:module';
import CredentialProvider, { credentialRef } from '@deepseek-ai/dsh-credentials';

const require = createRequire(import.meta.url);
const {
  loadApiKey,
  saveApiKey,
  clearApiKey,
  hasApiKey,
} = require('../../agent/keystore.js');

export const name = 'kvd-keychain';

const API_KEY_REF = 'DEEPSEEK_API_KEY';

function asRefString(ref) {
  return String(ref);
}

function getSafeStorage(config) {
  if (config && config.safeStorage) return config.safeStorage;
  try {
    // Electron main only; absent in pure-Node smoke.
    return require('electron').safeStorage;
  } catch {
    return null;
  }
}

export class KvdKeychain extends CredentialProvider {
  /** @param {import('@deepseek-ai/cordis').Context} ctx */
  constructor(ctx, config = {}) {
    super(ctx);
    this.config = config;
  }

  safeStorage() {
    return getSafeStorage(this.config);
  }

  async resolve(ref) {
    if (asRefString(ref) !== API_KEY_REF) return undefined;
    const loaded = loadApiKey(this.safeStorage());
    if (!loaded.ok || !loaded.key || !String(loaded.key).trim()) return undefined;
    return { value: String(loaded.key).trim(), source: 'kvd-keychain' };
  }

  async describe(ref) {
    if (asRefString(ref) !== API_KEY_REF) {
      return { configured: false, writable: false };
    }
    const configured = hasApiKey(this.safeStorage());
    return {
      configured,
      source: configured ? 'kvd-keychain' : undefined,
      writable: true,
    };
  }

  async set(ref, value) {
    if (asRefString(ref) !== API_KEY_REF) {
      throw new Error(`kvd-keychain: unsupported credential ref "${asRefString(ref)}"`);
    }
    const trimmed = String(value || '').trim();
    if (!trimmed) {
      throw new Error('kvd-keychain: refusing empty credential (use unset)');
    }
    const saved = saveApiKey(trimmed, this.safeStorage());
    if (!saved.ok) throw new Error(saved.error || 'kvd-keychain: save failed');
    this.notifyUpdated(typeof ref === 'string' ? credentialRef(ref) : ref);
  }

  async unset(ref) {
    if (asRefString(ref) !== API_KEY_REF) return;
    clearApiKey();
    this.notifyUpdated(typeof ref === 'string' ? credentialRef(ref) : ref);
  }

  async readRecord(_key) {
    return undefined;
  }

  async describeRecord(_key) {
    return { configured: false, writable: false };
  }

  async listRecords() {
    return [];
  }

  async modifyRecord(_key, _mutate) {
    throw new Error('kvd-keychain: credential records are not supported in v0.2');
  }

  async deleteRecord(_key) {
    throw new Error('kvd-keychain: credential records are not supported in v0.2');
  }
}

export default KvdKeychain;
