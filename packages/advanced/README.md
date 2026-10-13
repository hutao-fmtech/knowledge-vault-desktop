# @kvd/advanced

Advanced mode: controller, IPC origin gate, tool-call log, host, and the approval-bridge / audit-log / vault-tools Cordis plugins.

Mounted from `apps/desktop/cordis.yml`.

## Public exports

| Specifier | File |
| --- | --- |
| `@kvd/advanced/controller` | `./src/controller.js` |
| `@kvd/advanced/origin` | `./src/origin.js` |
| `@kvd/advanced/tool-log` | `./src/tool-log.js` |
| `@kvd/advanced/run-result` | `./src/run-result.js` |
| `@kvd/advanced/host` | `./src/host.mjs` |
| `@kvd/advanced/approval-bridge` | `./src/approval-bridge.mjs` |
| `@kvd/advanced/audit-log` | `./src/audit-log.mjs` |
| `@kvd/advanced/vault-tools` | `./src/vault-tools.mjs` |

Only these entry points may be imported by other workspace packages
(`scripts/check-boundaries.mjs` enforces it).

## Dependencies

- `@deepseek-ai/dsh-session`
- `@deepseek-ai/dsh-tools`
- `@deepseek-ai/schemastery`
- `@kvd/shared`

Every bare import in `src/` must be declared above; relative imports must stay inside this package.

## Test

```sh
pnpm --filter @kvd/advanced test   # node:test, files under test/
```
