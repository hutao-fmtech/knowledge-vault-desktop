/**
 * kvd-prefs — schemastery-validated user preferences (privacy consent, etc.).
 * Persists to the same prefs.json as the Electron shell (configDir), never vault.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Context, Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { configDir } from '@kvd/shared/config-dir';

export const name = 'kvd-prefs';

/** User-facing prefs schema (file payload). */
export const PrefsSchema = z.object({
  privacyAccepted: z.boolean().default(false),
  privacyAcceptedAt: z.string(),
});

export interface Prefs {
  privacyAccepted: boolean;
  privacyAcceptedAt?: string;
  [key: string]: unknown;
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    kvdPrefs: KvdPrefs;
  }
}

function prefsPath(): string {
  return path.join(configDir(), 'prefs.json');
}

function readRaw(): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(prefsPath(), 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeRaw<T>(next: T): T {
  const file = prefsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2), { mode: 0o600 });
  return next;
}

export class KvdPrefs extends Service {
  static Config = z.object({});

  constructor(ctx: Context, _config: unknown = {}) {
    super(ctx, 'kvdPrefs');
  }

  get(): Prefs {
    return PrefsSchema(readRaw()) as Prefs;
  }

  /**
   * Merge and validate a patch into prefs.json.
   * @param {Record<string, unknown>} patch
   */
  set(patch: Record<string, unknown>): Prefs {
    const next = PrefsSchema({ ...readRaw(), ...patch }) as Prefs;
    writeRaw(next);
    return next;
  }

  getPrivacyAccepted(): boolean {
    return !!this.get().privacyAccepted;
  }

  acceptPrivacy(at: string = new Date().toISOString()): Prefs {
    return this.set({ privacyAccepted: true, privacyAcceptedAt: at });
  }

  clearPrivacyForTests(): Prefs {
    const cur = readRaw();
    delete cur.privacyAccepted;
    delete cur.privacyAcceptedAt;
    writeRaw(cur);
    return this.get();
  }
}

export default KvdPrefs;
