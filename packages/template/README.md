# @kvd/template

The bundled Obsidian PARA/MOC/Zettelkasten vault template (data only).

Library package (not a Cordis plugin row).

## Public exports

| Specifier | File |
| --- | --- |
| `@kvd/template` | `./src/index.js` |

Only these entry points may be imported by other workspace packages
(`scripts/check-boundaries.mjs` enforces it).

## Dependencies

- none (Node builtins only)

Every bare import in `src/` must be declared above; relative imports must stay inside this package.

## Test

```sh
pnpm --filter @kvd/template test   # node:test, files under test/
```
