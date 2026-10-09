/**
 * Declarative plugin row table (isomorphic with dsh cordis.patch.yml rows).
 * Each row: { id, name, config?, disabled?, module? }
 * `module` is an optional package specifier / relative path for dynamic import.
 * When omitted, `name` is treated as the @deepseek-ai package or kvd plugin id.
 *
 * See docs/adr/0001-cordis-composition-not-dsh-profile.md.
 */

/** @typedef {{ id: string, name: string, config?: object, disabled?: boolean, module?: string }} PluginRow */

/** Default-mode rows (model-only). Advanced group is a later PR. */
/** @type {PluginRow[]} */
export const DEFAULT_ROWS = [
  {
    id: 'dsh-llm',
    name: 'dsh-llm',
    module: '@deepseek-ai/dsh-llm',
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
  const spec = row.module || row.name;
  const mod = await import(spec);
  if (mod && typeof mod.default !== 'undefined') return mod.default;
  if (mod && typeof mod.apply === 'function') return mod;
  throw new Error(`composition: row "${row.id}" has no plugin export from ${spec}`);
}
