# @kvd/vault

kvd-vault Cordis service (vault root, read-only path policy) + vault creation from @kvd/template.

Mounted from `apps/desktop/cordis.yml`.

## Public exports

| Specifier | File |
| --- | --- |
| `@kvd/vault` | `./src/index.mjs` |
| `@kvd/vault/create` | `./src/create.js` |
| `@kvd/vault/sanitize` | `./src/sanitize.js` |

Only these entry points may be imported by other workspace packages
(`scripts/check-boundaries.mjs` enforces it).

## Dependencies

- `@deepseek-ai/cordis`
- `@deepseek-ai/schemastery`

Every bare import in `src/` must be declared above; relative imports must stay inside this package.

## Test

```sh
pnpm --filter @kvd/vault test   # node:test, files under test/
```
