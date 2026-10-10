/**
 * Declarative plugin row table (isomorphic with dsh cordis.patch.yml rows).
 * Each row: { id, name, config?, disabled?, module? }
 *
 * See docs/adr/0001-cordis-composition-not-dsh-profile.md.
 * Advanced mode mounts ADVANCED_ROWS as a disposable child fiber (PR-7).
 * Never the unsupported minimal SDK profile or the dsh umbrella package.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** @typedef {{ id: string, name: string, config?: object, disabled?: boolean, module?: string }} PluginRow */

/** Default-mode rows (model-only). No ctx.tools. */
/** @type {PluginRow[]} */
export const DEFAULT_ROWS = [
  {
    id: 'kvd-prefs',
    name: 'kvd-prefs',
    module: './plugins/kvd-prefs.mjs',
  },
  {
    id: 'kvd-ipc-bridge',
    name: 'kvd-ipc-bridge',
    module: './plugins/kvd-ipc-bridge.mjs',
  },
  {
    id: 'kvd-keychain',
    name: 'kvd-keychain',
    module: './plugins/kvd-keychain.mjs',
  },
  {
    id: 'kvd-vault',
    name: 'kvd-vault',
    module: './plugins/kvd-vault.mjs',
  },
  {
    id: 'kvd-search',
    name: 'kvd-search',
    module: './plugins/kvd-search.mjs',
  },
  {
    id: 'kvd-proposals',
    name: 'kvd-proposals',
    module: './plugins/kvd-proposals.mjs',
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
 * Advanced-mode group (mounted only while Settings > Advanced is on).
 * workspaceRoot / bridge callbacks are filled at mount time via row config overrides.
 * @type {PluginRow[]}
 */
export const ADVANCED_ROWS = [
  {
    id: 'dsh-system-prompt',
    name: 'system-prompt',
    module: '@deepseek-ai/dsh-system-prompt',
    config: {
      personaPrefix:
        "You are the Knowledge Vault assistant working inside the user's Obsidian vault. "
        + 'Answer in the user\'s language. Cite vault-relative note paths. '
        + 'The filesystem is read-only to you. To change the vault, call vault_propose_change; the user reviews and presses Apply. '
        + 'Never touch .obsidian/ or 00-系统/. Never overwrite existing notes.',
    },
  },
  {
    id: 'dsh-tools',
    name: 'tools',
    module: '@deepseek-ai/dsh-tools',
  },
  {
    id: 'dsh-user-approval',
    name: 'approval',
    module: '@deepseek-ai/dsh-user-approval',
    config: { policy: 'ask' },
  },
  {
    id: 'dsh-session',
    name: 'session',
    module: '@deepseek-ai/dsh-session',
  },
  {
    id: 'dsh-session-projection',
    name: 'session-projection',
    module: '@deepseek-ai/dsh-session-projection',
  },
  {
    id: 'dsh-agent',
    name: 'agent',
    module: '@deepseek-ai/dsh-agent',
  },
  {
    id: 'dsh-agent-loop',
    name: 'agent-loop',
    module: '@deepseek-ai/dsh-agent-loop',
    config: { agents: [] },
  },
  {
    id: 'dsh-subprocess-local',
    name: 'subprocess',
    module: '@deepseek-ai/dsh-subprocess-local',
  },
  {
    id: 'dsh-sandbox-local',
    name: 'sandbox',
    module: '@deepseek-ai/dsh-sandbox-local',
  },
  {
    id: 'dsh-sandbox-policy',
    name: 'sandbox-policy',
    module: '@deepseek-ai/dsh-sandbox-policy',
    config: { mode: 'read-only', workspaceRoot: process.cwd() },
  },
  {
    id: 'dsh-bash-sandbox',
    name: 'bash-sandbox',
    module: '@deepseek-ai/dsh-bash-sandbox',
  },
  {
    id: 'dsh-shell-env',
    name: 'shell-env',
    module: '@deepseek-ai/dsh-shell-env',
  },
  {
    id: 'dsh-jobs-local',
    name: 'jobs',
    module: '@deepseek-ai/dsh-jobs-local',
  },
  {
    id: 'dsh-tool-bash',
    name: 'tool-bash',
    module: '@deepseek-ai/dsh-tool-bash',
  },
  {
    id: 'kvd-approval-bridge',
    name: 'kvd-approval-bridge',
    module: './plugins/kvd-approval-bridge.mjs',
  },
  {
    id: 'kvd-audit-log',
    name: 'kvd-audit-log',
    module: './plugins/kvd-audit-log.mjs',
  },
  {
    id: 'kvd-vault-tools',
    name: 'kvd-vault-tools',
    module: './plugins/kvd-vault-tools.mjs',
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

/**
 * Build advanced rows with vault-specific sandbox root and bridge config.
 * @param {{ workspaceRoot: string, bridge?: object, audit?: object, vaultTools?: object }} opts
 * @returns {PluginRow[]}
 */
export function advancedRowsFor(opts) {
  const root = opts.workspaceRoot;
  return ADVANCED_ROWS.map((row) => {
    if (row.id === 'dsh-sandbox-policy') {
      return { ...row, config: { ...row.config, mode: 'read-only', workspaceRoot: root } };
    }
    if (row.id === 'kvd-approval-bridge') {
      return { ...row, config: { ...(row.config || {}), ...(opts.bridge || {}) } };
    }
    if (row.id === 'kvd-audit-log') {
      return { ...row, config: { ...(row.config || {}), ...(opts.audit || {}) } };
    }
    if (row.id === 'kvd-vault-tools') {
      return { ...row, config: { ...(row.config || {}), ...(opts.vaultTools || {}) } };
    }
    return { ...row };
  });
}
