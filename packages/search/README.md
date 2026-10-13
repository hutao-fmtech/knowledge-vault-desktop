# @kvd/search

kvd-search: vaultSearch service (full-text search with code-point-safe snippets).

Mounted from `apps/desktop/cordis.yml`.

## Public exports

| Specifier | File |
| --- | --- |
| `@kvd/search` | `./src/index.mjs` |

Only these entry points may be imported by other workspace packages
(`scripts/check-boundaries.mjs` enforces it).

## Dependencies

- `@deepseek-ai/cordis`
- `@deepseek-ai/schemastery`
- `@kvd/vault`

Every bare import in `src/` must be declared above; relative imports must stay inside this package.

## Test

```sh
pnpm --filter @kvd/search test   # node:test, files under test/
```
