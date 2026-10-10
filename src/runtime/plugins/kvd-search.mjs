/**
 * kvd-search — keyword search over the active vault (Chinese bigram + Latin tokens).
 * Excludes `00-系统/` and `90-附件/` (and `.obsidian`). File reads go through
 * `vault.resolveAgainst()` so path guards / realpath apply (depends on kvd-vault).
 *
 * Pure helpers remain in src/agent/search.js for CJS engine callers; this service
 * is the Cordis-facing API (`ctx.vaultSearch`).
 */
import { createRequire } from 'node:module';
import { Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';

const require = createRequire(import.meta.url);
const { searchVault, listInboxNotes, tokenize } = require('../../agent/search.js');

export const name = 'kvd-search';
export const inject = ['vault'];

export const Config = z.object({});

export class VaultSearchService extends Service {
  static Config = Config;
  static inject = ['vault'];

  /** @param {import('@deepseek-ai/cordis').Context} ctx */
  constructor(ctx, _config = {}) {
    super(ctx, 'vaultSearch');
  }

  /**
   * Keyword search against the active vault.
   * @param {string} query
   * @param {number} [limit=8]
   * @returns {{ ok: true, hits: { path: string, snippet: string }[] } | { ok: false, error: string }}
   */
  search(query, limit = 8) {
    const root = this.ctx.vault.getRoot();
    if (!root) return { ok: false, error: '未打开 vault' };
    return searchVault(root, query, limit, {
      resolve: (vaultRoot, rel) => this.ctx.vault.resolveAgainst(vaultRoot, rel),
    });
  }

  /**
   * List inbox note relative paths (excludes README).
   * @returns {{ ok: true, notes: string[] } | { ok: false, error: string }}
   */
  listInbox() {
    const root = this.ctx.vault.getRoot();
    if (!root) return { ok: false, error: '未打开 vault' };
    return { ok: true, notes: listInboxNotes(root) };
  }

  /** Expose tokenizer for smoke / debugging. */
  tokenize(query) {
    return tokenize(query);
  }
}

export default VaultSearchService;
