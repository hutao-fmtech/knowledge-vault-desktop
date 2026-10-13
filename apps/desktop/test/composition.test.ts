import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  CORDIS_YML,
  DEFAULT_ROWS,
  ADVANCED_ROWS,
  parseComposition,
  compositionPluginIds,
  advancedRowsFor,
  resolvePlugin,
} from '../src/runtime/composition.js';

test('composition is loaded from apps/desktop/cordis.yml', () => {
  assert.ok(CORDIS_YML.endsWith('cordis.yml'));
  assert.deepEqual(DEFAULT_ROWS.map((r) => r.id), [
    'kvd-prefs', 'kvd-ipc-bridge', 'kvd-keychain', 'kvd-vault', 'kvd-search', 'kvd-proposals',
    'dsh-llm', 'kvd-privacy', 'dsh-llm-deepseek-api-key', 'kvd-llm-mock', 'kvd-skills',
  ]);
  assert.equal(ADVANCED_ROWS.length, 17);
  assert.equal(compositionPluginIds().length, 28);
});

test('persona prefix and key env survive the YAML move unchanged', () => {
  const persona = ADVANCED_ROWS.find((r) => r.id === 'dsh-system-prompt')?.config?.personaPrefix;
  assert.equal(
    persona,
    "You are the Knowledge Vault assistant working inside the user's Obsidian vault. "
      + "Answer in the user's language. Cite vault-relative note paths. "
      + 'The filesystem is read-only to you. To change the vault, call vault_propose_change; the user reviews and presses Apply. '
      + 'Never touch .obsidian/ or 00-系统/. Never overwrite existing notes. '
      + 'Never set sandbox_permissions or ask for sandbox escalation: it is always rejected.',
  );
  assert.deepEqual(DEFAULT_ROWS.find((r) => r.id === 'dsh-llm-deepseek-api-key')?.config, { apiKeyEnv: 'DEEPSEEK_API_KEY' });
});

test('sandbox policy is pinned read-only at mount time whatever the YAML says', () => {
  const sp = advancedRowsFor({ workspaceRoot: '/v' }).find((r) => r.id === 'dsh-sandbox-policy');
  assert.deepEqual(sp?.config, { mode: 'read-only', workspaceRoot: '/v' });
});

test('parseComposition rejects malformed documents', () => {
  assert.throws(() => parseComposition('a: 1'), /list of rows/);
  assert.throws(() => parseComposition('- id: a\n  name: x\n- id: a\n  name: y'), /duplicate id/);
  assert.throws(() => parseComposition('- id: a'), /missing name/);
  assert.throws(() => parseComposition('- id: a\n  name: !!js/function "x"'), /unknown tag|js\/function/);
});

test('every default row resolves to a Cordis plugin from apps/desktop', async () => {
  for (const row of DEFAULT_ROWS) {
    const plugin = await resolvePlugin(row);
    assert.ok(plugin, row.id);
  }
});
