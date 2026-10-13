# @kvd/llm-mock

kvd-llm-mock: deterministic offline llm adapter (provider kvd-mock).

Mounted from `apps/desktop/cordis.yml`.

## Public exports

| Specifier | File |
| --- | --- |
| `@kvd/llm-mock` | `./src/index.ts` → `./lib/index.js` |

Only these entry points may be imported by other workspace packages
(`scripts/check-boundaries.mjs` enforces it).

## Dependencies

- `@deepseek-ai/dsh-llm`
- `@deepseek-ai/schemastery`
- `@kvd/skills-core`

Every bare import in `src/` must be declared above; relative imports must stay inside this package.

## Test

```sh
pnpm --filter @kvd/llm-mock test   # node:test, files under test/
```
