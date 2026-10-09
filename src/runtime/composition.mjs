/**
 * Declarative plugin row table (isomorphic with dsh cordis.patch.yml rows).
 * Each row: { id, name, config?, disabled?, module? }
 *
 * See docs/adr/0001-cordis-composition-not-dsh-profile.md.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** @typedef {{ id: string, name: string, config?: object, disabled?: boolean, module?: string }} PluginRow */

/** Default-mode rows (model-only). Advanced group is a later PR. */
/** @type {PluginRow[]} */
export const DEFAULT_ROWS = [
  {
    id: 'kvd-prefs',
    name: 'kvd-prefs',
    module: './plugins/kvd-prefs.mjs',
  },
  {
    id: 'kvd-keychain',
    name: 'kvd-keychain',
    module: './plugins/kvd-keychain.mjs',
  },
  {
    id: 'dsh-llm',
    name: 'dsh-llm',
    module: '@deepseek-ai/dsh-llm',
  },
  {
    id: 'kvd-privacy',
    name: 'kvd-privacy',
    module: './plugins/kvd-privacy.mjs',
  },
  {
    id: 'dsh-llm-deepseek-api-key',
    name: 'llm-deepseek-api-key',
    module: '@deepseek-ai/dsh-llm-deepseek-api-key',
    config: { apiKeyEnv: 'DEEPSEEK_API_KEY' },
  },
];

/**
 * Resolve a row to a Cordis plugin export (default or namespace).
 * @param {PluginRow} row
 */
export async function resolvePlugin(row) {
  let spec = row.module || row.name;
  if (spec.startsWith('.')) {
    spec = pathToFileURL(path.resolve(HERE, spec)).href;
  }
  const mod = await import(spec);
  if (mod && typeof mod.default !== 'undefined') return mod.default;
  if (mod && typeof mod.apply === 'function') return mod;
  throw new Error(`composition: row "${row.id}" has no plugin export from ${spec}`);
}
