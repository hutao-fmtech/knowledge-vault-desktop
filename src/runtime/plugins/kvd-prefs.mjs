/**
 * kvd-prefs — schemastery-validated user preferences (privacy consent, etc.).
 * Persists to the same prefs.json as the Electron shell (configDir), never vault.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';

const require = createRequire(import.meta.url);
const { configDir } = require('../../agent/keystore.js');

export const name = 'kvd-prefs';

/** User-facing prefs schema (file payload). */
export const PrefsSchema = z.object({
  privacyAccepted: z.boolean().default(false),
  privacyAcceptedAt: z.string(),
});

function prefsPath() {
  return path.join(configDir(), 'prefs.json');
}

function readRaw() {
  try {
    return JSON.parse(fs.readFileSync(prefsPath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeRaw(next) {
  const file = prefsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2), { mode: 0o600 });
  return next;
}

export class KvdPrefs extends Service {
  static Config = z.object({});

  /** @param {import('@deepseek-ai/cordis').Context} ctx */
  constructor(ctx, _config = {}) {
    super(ctx, 'kvdPrefs');
  }

  /** @returns {{ privacyAccepted: boolean, privacyAcceptedAt?: string }} */
  get() {
    return PrefsSchema(readRaw());
  }

  /**
   * Merge and validate a patch into prefs.json.
   * @param {Record<string, unknown>} patch
   */
  set(patch) {
    const next = PrefsSchema({ ...readRaw(), ...patch });
    writeRaw(next);
    return next;
  }

  getPrivacyAccepted() {
    return !!this.get().privacyAccepted;
  }

  acceptPrivacy(at = new Date().toISOString()) {
    return this.set({ privacyAccepted: true, privacyAcceptedAt: at });
  }

  clearPrivacyForTests() {
    const cur = readRaw();
    delete cur.privacyAccepted;
    delete cur.privacyAcceptedAt;
    writeRaw(cur);
    return this.get();
  }
}

export default KvdPrefs;
