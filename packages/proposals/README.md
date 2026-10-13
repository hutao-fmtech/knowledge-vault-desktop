# @kvd/proposals

kvd-proposals: the ONLY write path (propose -> user Apply).

Mounted from `apps/desktop/cordis.yml`.

## Public exports

| Specifier | File |
| --- | --- |
| `@kvd/proposals` | `./src/index.ts` → `./lib/index.js` |

Only these entry points may be imported by other workspace packages
(`scripts/check-boundaries.mjs` enforces it).

## Dependencies

- `@deepseek-ai/cordis`
- `@deepseek-ai/schemastery`
- `@kvd/vault`

Every bare import in `src/` must be declared above; relative imports must stay inside this package.

## Test

```sh
pnpm --filter @kvd/proposals test   # node:test, files under test/
```
