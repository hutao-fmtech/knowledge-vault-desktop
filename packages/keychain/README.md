# @kvd/keychain

kvd-keychain: credentials provider backed by Electron safeStorage; key never enters process.env.

Mounted from `apps/desktop/cordis.yml`.

## Public exports

| Specifier | File |
| --- | --- |
| `@kvd/keychain` | `./src/index.mjs` |

Only these entry points may be imported by other workspace packages
(`scripts/check-boundaries.mjs` enforces it).

## Dependencies

- `@deepseek-ai/dsh-credentials`
- `@kvd/shared`
- `electron (peer, optional)`

Every bare import in `src/` must be declared above; relative imports must stay inside this package.

## Test

```sh
pnpm --filter @kvd/keychain test   # node:test, files under test/
```
