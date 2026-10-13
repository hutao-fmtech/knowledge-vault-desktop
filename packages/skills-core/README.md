# @kvd/skills-core

Pure helpers shared by @kvd/skills and @kvd/llm-mock (breaks the former import cycle).

Library package (not a Cordis plugin row).

## Public exports

| Specifier | File |
| --- | --- |
| `@kvd/skills-core` | `./src/index.ts` → `./lib/index.js` |

Only these entry points may be imported by other workspace packages
(`scripts/check-boundaries.mjs` enforces it).

## Dependencies

- none (Node builtins only)

Every bare import in `src/` must be declared above; relative imports must stay inside this package.

## Test

```sh
pnpm --filter @kvd/skills-core test   # node:test, files under test/
```
