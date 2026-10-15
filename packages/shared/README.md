# @kvd/shared

Shared constants: model routes, the app config directory (outside any vault), and WeChat OA vault paths.

Library package (not a Cordis plugin row).

## Public exports

| Specifier | File |
| --- | --- |
| `@kvd/shared/models` | `./src/models.ts` → `./lib/models.js` |
| `@kvd/shared/config-dir` | `./src/config-dir.ts` → `./lib/config-dir.js` |
| `@kvd/shared/wechat-oa` | `./src/wechat-oa.ts` → `./lib/wechat-oa.js` |

Only these entry points may be imported by other workspace packages
(`scripts/check-boundaries.mjs` enforces it).

WeChat OA paths (W1): scope §2 adapted to this PARA tree (`04-资源` / `05-归档`). Writing skills must use these vault-relative paths — never `/workspace/content-team`.

## Dependencies

- none (Node builtins only)

Every bare import in `src/` must be declared above; relative imports must stay inside this package.

## Test

```sh
pnpm --filter @kvd/shared test   # node:test, files under test/
```
