# @kvd/skills

kvd-skills: default-mode ask / sortInbox / makeCard flows as a Cordis service.

Mounted from `apps/desktop/cordis.yml`.

## Public exports

| Specifier | File |
| --- | --- |
| `@kvd/skills` | `./src/index.ts` → `./lib/index.js` |

Only these entry points may be imported by other workspace packages
(`scripts/check-boundaries.mjs` enforces it).

## Dependencies

- `@deepseek-ai/cordis`
- `@deepseek-ai/dsh-credentials`
- `@deepseek-ai/dsh-llm`
- `@deepseek-ai/schemastery`
- `@kvd/proposals`
- `@kvd/shared`
- `@kvd/skills-core`

Every bare import in `src/` must be declared above; relative imports must stay inside this package.

## Test

```sh
pnpm --filter @kvd/skills test   # node:test, files under test/
```
