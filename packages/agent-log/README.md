# @kvd/agent-log

Append-only audit log of the proposal lifecycle (and the global write pause),
stored **inside the vault** at:

```
<vault>/.vault/agent-log/YYYY-MM-DD.<deviceId>.jsonl
```

Library package (not a Cordis plugin row yet — wiring into `@kvd/proposals`
and `cordis.yml` lands in a follow-up PR).

## Schema (v1)

One JSON object per line, rebuilt from a field **allowlist**:

`v`, `ts` (ISO with local offset, e.g. `+08:00`), `ev`, `id`, `kind`
(`create`/`edit`/`move`), `path` / `from` / `to` (vault-relative, `/`),
`origin` (e.g. `agent-advanced`, `skill:makeCard`, `local-renderer`),
`actor` (`user`/`agent`/`system`), `beforeSha256`, `afterSha256`, `bytes`,
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

## Dependencies

- none (Node builtins only)

## Test

```sh
pnpm --filter @kvd/agent-log test
```
