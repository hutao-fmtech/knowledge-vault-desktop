# @kvd/agent-log

Append-only audit log of the proposal lifecycle (and the global write pause),
stored **inside the vault** at:

```
<vault>/.vault/agent-log/YYYY-MM-DD.<deviceId>.jsonl
```

Core module (`@kvd/agent-log`, Node builtins only) + Cordis plugin
(`@kvd/agent-log/plugin`, cordis.yml row `kvd-agent-log`, service `ctx.agentLog`).
The plugin listens to `kvd/agent-log` events `{ root, record }` emitted by
`@kvd/proposals` (proposal lifecycle) and the desktop shell (`pause.on` / `pause.off`),
keeps the device id in `<app config dir>/agent-log-device-id` (outside every vault),
and prunes expired day files once per vault when it is opened.

## Schema (v1)

One JSON object per line, rebuilt from a field **allowlist**:

`v`, `ts` (ISO with local offset, e.g. `+08:00`), `ev`, `id`, `kind`
(`create`/`edit`/`move`), `path` / `from` / `to` (vault-relative, `/`),
`origin` (e.g. `agent-advanced`, `skill:makeCard`, `local-renderer`),
`actor` (`user`/`agent`/`system`), `initiator` (`agent`/`user`, from the proposal), `beforeSha256`, `afterSha256`, `bytes`,
`stale`, `error` (short code such as `stale`; free text becomes `other`), `app`.

Events: `proposal.created`, `proposal.applied`, `proposal.apply_failed`,
`proposal.rejected`, `proposal.expired`, `pause.on`, `pause.off`.

**Never stored:** note content, model `summary`, prompts, API keys. Unknown
fields are dropped; values that fail their validator or look like a secret are
dropped.

## Behaviour

- Best effort: `append` / `readDay` / `prune` never throw; failures go to `onWarn`.
- Corrupt / half-written lines are skipped on read.
- `prune()` removes day files older than `retentionDays` (default 90).
- Agents cannot read or write `.vault/` (`@kvd/vault` `FORBIDDEN_PREFIXES` + `isReadableRel`).

## Public exports

| Specifier | File |
| --- | --- |
| `@kvd/agent-log` | `./src/index.ts` → `./lib/index.js` |
| `@kvd/agent-log/plugin` | `./src/plugin.ts` → `./lib/plugin.js` |

## Dependencies

- `@deepseek-ai/cordis`, `@deepseek-ai/schemastery` (plugin)
- `@kvd/shared` (config dir for the device id), `@kvd/vault` (`kvd/vault-changed` event type)

## Test

```sh
pnpm --filter @kvd/agent-log test
```
