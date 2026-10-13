# @kvd/ipc-bridge

kvd-ipc-bridge: ipc service bridging Cordis to Electron ipcMain/webContents.

Mounted from `apps/desktop/cordis.yml`.

## Public exports

| Specifier | File |
| --- | --- |
| `@kvd/ipc-bridge` | `./src/index.mjs` |

Only these entry points may be imported by other workspace packages
(`scripts/check-boundaries.mjs` enforces it).

## Dependencies

- `@deepseek-ai/cordis`
- `@deepseek-ai/schemastery`
- `electron (peer, optional)`

Every bare import in `src/` must be declared above; relative imports must stay inside this package.

## Test

```sh
pnpm --filter @kvd/ipc-bridge test   # node:test, files under test/
```
