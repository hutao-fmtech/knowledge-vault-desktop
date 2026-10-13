# apps/desktop — Knowledge Vault (Electron shell)

The only app in the workspace. It owns:

- `src/main.ts`, `src/preload.cts`, `src/renderer/` — Electron main / preload / renderer.
- `cordis.yml` — **the** plugin composition (default rows + the lazy `advanced` group).
  `src/runtime/composition.ts` loads it at runtime (also from inside `app.asar`);
  no plugin list is hardcoded in code. Every row `name` must be a dependency in
  this `package.json` (checked by `scripts/check-boundaries.mjs`).
- `src/runtime/boot.ts` — the Cordis composition root (boot, advanced child fiber, dispose on quit).
- electron-builder config (`build` in `package.json`, resources in `build/`).

The app version (`version` here, currently 0.2.2) is the in-app/installer version
and the one `release.yml` compares with the pushed tag.

```sh
pnpm --filter knowledge-vault-desktop start
pnpm --filter knowledge-vault-desktop test
pnpm --filter knowledge-vault-desktop exec electron-builder --dir --linux   # then: <app> --kvd-pack-smoke
```

## TypeScript build (R2)

Sources are TypeScript (`strict`, project references from the root `tsconfig.json`).
`pnpm run build` (= `tsc -b` + renderer assets) emits `lib/`; Electron's `main` is
`lib/main.js` (ESM), the sandboxed preload is `lib/preload.cjs`, the renderer is
`lib/renderer/`. The installers pack only `lib/**`, `cordis.yml` and `package.json`.
