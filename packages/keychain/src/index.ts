/**
 * kvd-keychain — CredentialProvider backed by the key file helpers below (safeStorage or
 * app-config file mode 0600). Never stores keys in the vault or process.env.
 *
 * Records API (R8): empty / unsupported in v0.2.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { Context } from '@deepseek-ai/cordis';
import CredentialProvider, { credentialRef } from '@deepseek-ai/dsh-credentials';
import type {
  CredentialInfo,
  CredentialKey,
  CredentialRecord,
  CredentialRecordEntry,
  CredentialRecordInfo,
  CredentialRef,
  ResolvedCredential,
} from '@deepseek-ai/dsh-credentials';
import { configDir } from '@kvd/shared/config-dir';

const require = createRequire(import.meta.url);

/** Minimal subset of Electron's safeStorage used here (absent in pure Node). */
export interface SafeStorageLike {
  isEncryptionAvailable?: () => boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

interface KeyFilePayload {
  updatedAt?: string;
  mode?: 'safeStorage' | 'localFile';
  enc?: string;
  key?: string;
}

export type SaveKeyResult = { ok: true; mode: 'safeStorage' | 'localFile' } | { ok: false; error: string };
export type LoadKeyResult =
  | { ok: true; key: string | null; mode?: 'safeStorage' | 'localFile' }
  | { ok: false; error: string; key: null };

// ---- key file storage (folded from src/agent/keystore.js) ----
export function keyFile(): string {
  return path.join(configDir(), 'agent-key.json');
}

/**
 * Store API key outside the vault and outside the repo.
 * Uses Electron safeStorage when available; otherwise plaintext file in app config dir
 * (still never inside the vault).
 */
export function saveApiKey(rawKey: unknown, safeStorage?: SafeStorageLike | null): SaveKeyResult {
  const key = String(rawKey || '').trim();
  if (!key) return { ok: false, error: 'API key 为空' };
  const payload: KeyFilePayload & { mode: 'safeStorage' | 'localFile' } = {
    updatedAt: new Date().toISOString(),
    mode: 'localFile',
  };
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

export function loadApiKey(safeStorage?: SafeStorageLike | null): LoadKeyResult {
  const f = keyFile();
  if (!fs.existsSync(f)) return { ok: true, key: null };
  try {
    const payload = JSON.parse(fs.readFileSync(f, 'utf8')) as KeyFilePayload;
    if (payload.mode === 'safeStorage' && payload.enc && safeStorage) {
      const buf = Buffer.from(payload.enc, 'base64');
      return { ok: true, key: safeStorage.decryptString(buf), mode: 'safeStorage' };
    }
    if (payload.key) return { ok: true, key: payload.key, mode: 'localFile' };
    return { ok: true, key: null };
  } catch (err) {
    return { ok: false, error: (err as Error).message, key: null };
  }
}

export function clearApiKey(): { ok: true } {
  const f = keyFile();
  if (fs.existsSync(f)) fs.unlinkSync(f);
  return { ok: true };
}

export function hasApiKey(safeStorage?: SafeStorageLike | null): boolean {
  const r = loadApiKey(safeStorage);
  return !!(r.ok && r.key);
}

export const name = 'kvd-keychain';

const API_KEY_REF = 'DEEPSEEK_API_KEY';

function asRefString(ref: CredentialRef | string): string {
  return String(ref);
}

export interface KeychainConfig {
  safeStorage?: SafeStorageLike | null;
}

function getSafeStorage(config: KeychainConfig | undefined): SafeStorageLike | null {
  if (config && config.safeStorage) return config.safeStorage;
  try {
    // Electron main only; absent in pure-Node smoke (require('electron') is then a path string).
    const electron = require('electron') as { safeStorage?: SafeStorageLike } | string;
    return typeof electron === 'object' && electron.safeStorage ? electron.safeStorage : null;
  } catch {
    return null;
  }
}

export class KvdKeychain extends CredentialProvider {
  readonly config: KeychainConfig;

  constructor(ctx: Context, config: KeychainConfig = {}) {
    super(ctx);
    this.config = config;
  }

  safeStorage(): SafeStorageLike | null {
    return getSafeStorage(this.config);
  }

  async resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    if (asRefString(ref) !== API_KEY_REF) return undefined;
    const loaded = loadApiKey(this.safeStorage());
    if (!loaded.ok || !loaded.key || !String(loaded.key).trim()) return undefined;
    return { value: String(loaded.key).trim(), source: 'kvd-keychain' };
  }

  async describe(ref: CredentialRef): Promise<CredentialInfo> {
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

  async set(ref: CredentialRef, value: string): Promise<void> {
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

  async unset(ref: CredentialRef): Promise<void> {
    if (asRefString(ref) !== API_KEY_REF) return;
    clearApiKey();
    this.notifyUpdated(typeof ref === 'string' ? credentialRef(ref) : ref);
  }

  async readRecord(_key: CredentialKey): Promise<CredentialRecord | undefined> {
    return undefined;
  }

  async describeRecord(_key: CredentialKey): Promise<CredentialRecordInfo> {
    return { configured: false, writable: false };
  }

  async listRecords(): Promise<readonly CredentialRecordEntry[]> {
    return [];
  }

  async modifyRecord(
    _key: CredentialKey,
    _mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> {
    throw new Error('kvd-keychain: credential records are not supported in v0.2');
  }

  async deleteRecord(_key: CredentialKey): Promise<void> {
    throw new Error('kvd-keychain: credential records are not supported in v0.2');
  }
}

export default KvdKeychain;
