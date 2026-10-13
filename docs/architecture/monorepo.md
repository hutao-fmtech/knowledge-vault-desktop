# Monorepo layout (R1)

Status: implemented on `arch/r1-monorepo` (structure only, still JavaScript; TypeScript is R2).

## Workspace

pnpm workspace (`pnpm-workspace.yaml`: `apps/*`, `packages/*`), `node-linker=hoisted`
(`.npmrc`) because electron-builder cannot follow pnpm's symlinked store. Workspace
deps use `workspace:*`; third-party deps are exact pins (`save-exact`).

```
apps/desktop            knowledge-vault-desktop (version = app/installer version)
  cordis.yml            THE plugin composition (default rows + lazy `advanced` group)
  src/main.js           Electron main (IPC handlers, pack-smoke)
  src/preload.js        contextBridge
  src/renderer/         UI
  src/runtime/boot.mjs  Cordis composition root (boot / advanced child fiber / dispose)
  src/runtime/composition.mjs  loads + validates cordis.yml, resolves rows to plugins
  build/                electron-builder resources
packages/
  shared       @kvd/shared        models (route ids), config-dir
  vault        @kvd/vault         kvd-vault service + path policy; ./create (vault creation)
  search       @kvd/search        kvd-search (vaultSearch)
  proposals    @kvd/proposals     kvd-proposals — the only write path (propose → Apply)
  skills-core  @kvd/skills-core   pure helpers shared by skills + llm-mock
  skills       @kvd/skills        kvd-skills (ask / sortInbox / makeCard)
  llm-mock     @kvd/llm-mock      kvd-mock llm adapter (offline)
  keychain     @kvd/keychain      credentials provider (safeStorage); key never in process.env
  privacy      @kvd/privacy       live-route privacy gate
  prefs        @kvd/prefs         persisted prefs
  ipc-bridge   @kvd/ipc-bridge    Cordis ⇄ Electron IPC
  advanced     @kvd/advanced      controller, origin gate, tool-log, host,
                                  approval-bridge / audit-log / vault-tools plugins
  template     @kvd/template      bundled Obsidian vault template (data)
```

Each package: `package.json` (exact deps it imports, `exports` map = public API),
`src/`, `test/` (node:test), `README.md`.

## Dependency graph (@kvd only; acyclic, enforced)

```
apps/desktop ─► every plugin package named in cordis.yml + shared, template, vault, advanced, keychain
search, proposals ─► vault
skills ─► proposals, shared, skills-core
llm-mock ─► skills-core          (former skills ⇄ llm-mock cycle removed)
keychain, prefs, advanced ─► shared
```

`advanced/host` no longer imports the app's `runtime/boot.mjs`: the composition-root
handle is injected (`createAdvancedHost({ runtime })`), so the dependency is one-way
app → package.

## Composition

`apps/desktop/cordis.yml` follows dsh-orb's `apps/orb/cordis.yml` row shape
(`id`, `name` = package/subpath export, `config`, `disabled`) plus one KVD extension:
a `lazy: true` row with `children` — the `advanced` group mounted as a disposable child
fiber only while Settings > Advanced is on. No `!!js` tags (CORE schema). The loader
re-pins `dsh-sandbox-policy` to `read-only` + the open vault at mount time regardless of
YAML. `scripts/check-boundaries.mjs` verifies every row `name` is a declared dependency
and a public export.

## Packaging

`scripts/build-desktop.mjs`: `pnpm deploy --prod` stages `apps/desktop` with real
(non-symlinked) `@kvd/*` copies, then runs electron-builder in the stage with output in
`apps/desktop/dist`. `cordis.yml` ships inside `app.asar`; pack-smoke proves the packaged
app reads it and mounts all 28 rows (11 default + 17 advanced).

## Security (RS-10, unchanged)

- Writes only via `@kvd/proposals` propose → user Apply; `.obsidian/` and `00-系统/` rejected (`@kvd/vault` path policy).
- Sandbox escalation always rejected (`@kvd/advanced/approval-bridge`); sandbox read-only (composition loader).
- API key lives in `@kvd/keychain` (safeStorage / config dir), never assigned to `process.env`.
- Remote IPC origins cannot enable advanced mode or change policy (`@kvd/advanced/origin` + main.js handlers).
