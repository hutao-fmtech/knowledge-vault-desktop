# @kvd/shared

Shared constants: model routes and the app config directory (outside any vault).

Library package (not a Cordis plugin row).

## Public exports

| Specifier | File |
| --- | --- |
| `@kvd/shared/models` | `./src/models.ts` → `./lib/models.js` |
| `@kvd/shared/config-dir` | `./src/config-dir.ts` → `./lib/config-dir.js` |

Only these entry points may be imported by other workspace packages
(`scripts/check-boundaries.mjs` enforces it).

## Dependencies

- none (Node builtins only)

Every bare import in `src/` must be declared above; relative imports must stay inside this package.

## Test

```sh
pnpm --filter @kvd/shared test   # node:test, files under test/
```
