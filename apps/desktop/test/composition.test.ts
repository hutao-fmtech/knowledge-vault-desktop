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
    'kvd-prefs', 'kvd-ipc-bridge', 'kvd-keychain', 'kvd-vault', 'kvd-search', 'kvd-agent-log', 'kvd-proposals',
    'dsh-llm', 'kvd-privacy', 'dsh-llm-deepseek-api-key', 'kvd-llm-mock', 'kvd-skills',
  ]);
  assert.equal(ADVANCED_ROWS.length, 17);
  assert.equal(compositionPluginIds().length, 29);
});

test('persona prefix and key env survive the YAML move unchanged', () => {
  const persona = ADVANCED_ROWS.find((r) => r.id === 'dsh-system-prompt')?.config?.personaPrefix;
  assert.equal(
    persona,
    "You are the Knowledge Vault assistant working inside the user's Obsidian vault. "
      + "Answer in the user's language. Cite vault-relative note paths. "
      + 'The filesystem is read-only to you. To change the vault, call vault_propose_change; the user reviews and presses Apply. '
      + 'Never touch .obsidian/, 00-系统/, or 90-附件/. Never overwrite existing notes. '
      + 'WeChat OA pipeline (vault-relative only; never /workspace/content-team): '
      + 'briefs/drafts/review under 10-卡片盒/公众号/; intel under 01-收件箱/公众号线索/; '
      + 'layout under 90-附件/公众号/layout/ (desktop tools only); published under 05-归档/公众号/; '
      + 'analytics under 04-资源/公众号/analytics/; voice seed at 00-系统/公众号/voice.md. '
      + 'Never set sandbox_permissions or ask for sandbox escalation: it is always rejected. '
      + '{{shellTool}}',
  );
  // {{shellTool}} is filled per platform at mount time.
  const mounted = advancedRowsFor({ workspaceRoot: '/v' }).find((r) => r.id === 'dsh-system-prompt')?.config?.personaPrefix;
  assert.ok(typeof mounted === 'string' && !mounted.includes('{{shellTool}}') && mounted.includes(process.platform === 'win32' ? '`pwsh`' : '`bash`'));
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
