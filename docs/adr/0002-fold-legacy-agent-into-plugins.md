# ADR 0002: Fold pre-pluginization `src/agent/*` modules into Cordis plugins

- **Status**: Accepted
- **Date**: 2026-10-13
- **Builds on**: ADR 0001

## Decision

The CJS modules under `src/agent/` that pre-date the Cordis composition are removed.
Their logic now lives in the plugin that owns the corresponding service (exported as
named ESM helpers alongside the plugin's default export), plus two tiny shared modules.

| Old module (deleted)          | New home |
|-------------------------------|----------|
| `agent/paths.js`              | `runtime/plugins/kvd-vault.mjs` (`resolveVaultPath`, `assertInsideVault`, `isReadableRel`, `FORBIDDEN_PREFIXES`) |
| `agent/search.js`             | `runtime/plugins/kvd-search.mjs` (`searchVault`, `makeSnippet`, `toWellFormed`, `tokenize`, `listInboxNotes`, `SEARCH_EXCLUDED_TOP`) |
| `agent/proposals.js`          | `runtime/plugins/kvd-proposals.mjs` (`proposeCreate/Edit/Move`, `applyProposal`, `discardProposal`) |
| `agent/keystore.js`           | `runtime/plugins/kvd-keychain.mjs` (`saveApiKey`, `loadApiKey`, `clearApiKey`, `hasApiKey`, `keyFile`); `configDir` → `runtime/shared/config-dir.mjs` (also used by kvd-prefs) |
| `agent/skills-logic.js`       | `runtime/plugins/kvd-skills.mjs` (`runAsk`, `runSortInbox`, `runMakeCard`, `createSkillsEngine`, `pickParaDest`, …) |
| `agent/mock-responses.js`     | `runtime/plugins/kvd-llm-mock.mjs` |
| `agent/models.js`             | `runtime/shared/models.mjs` (single source of truth) |
| `agent/dsh-runtime.js`        | `smokeMount` → `runtime/boot.mjs`; `streamText` superseded by `kvdSkills.streamText` |
| `agent/engine.js`             | removed. Default mode goes through `ctx.kvdSkills` only; mock vs live is the llm adapter route (`kvd-mock` vs `deepseek-official`) chosen by kvd-skills |

`src/agent/advanced/` is unchanged (only `host.mjs` now imports `runtime/shared/models.mjs`).

## Interop

Plugins are ESM. `src/main.js` (CJS) loads them with dynamic `import()` — the same
pattern it already used for `runtime/boot.mjs`. Config-dir-backed shell state
(advanced controller, tool log) is built after those imports resolve and before the
window is created. Pack-smoke awaits the same imports inside asar.
