# @kvd/proposals

kvd-proposals: the ONLY write path (propose -> user Apply).

Also exports pure `lineDiff` / `formatProposalReview` for the sidebar
「可审 diff」pane (edit = unified before→content; create = full body; move = from→to).

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
