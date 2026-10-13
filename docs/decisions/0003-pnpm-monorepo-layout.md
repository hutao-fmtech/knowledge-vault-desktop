# ADR 0003: pnpm monorepo — apps/desktop + one package per capability + cordis.yml

Status: Accepted (R1). Supersedes the file paths in ADR 0002 (its decision stands).

## Context

All code lived in one `src/` tree with a hardcoded plugin row table in
`src/runtime/composition.mjs`; plugins imported each other by relative path and
`kvd-skills` ⇄ `kvd-llm-mock` formed an import cycle. dsh-orb (reference layout) uses a
pnpm workspace with `apps/`, `packages/`, a static `cordis.yml`, and a boundary check.

## Decision

1. pnpm workspace, `node-linker=hoisted` (electron-builder cannot follow pnpm symlinks),
   `workspace:*` for intra-repo deps, exact pins for everything else.
2. `apps/desktop` is the only app: Electron shell, composition root, `cordis.yml`,
   electron-builder config, app version.
3. One package per capability under `packages/` (`@kvd/*`), each with its own
   `package.json` declaring exactly what it imports, `exports` as its public API, `src/`,
   `test/`, `README.md`.
4. Composition is data: `apps/desktop/cordis.yml`, loaded at runtime (also from asar).
5. `scripts/check-boundaries.mjs` runs in CI: undeclared bare imports (incl. `@kvd/*`),
   relative imports leaving the package, non-public subpaths, non-`workspace:` intra-repo
   specs, and `@kvd` cycles all fail.
6. The skills/llm-mock cycle is broken with `@kvd/skills-core` (pure helpers); both depend
   on it one-way. `@kvd/advanced/host` receives the composition-root handle by injection.
7. Packaging stages the app via `pnpm deploy --prod` before electron-builder (25.x
   rejects workspace symlinks outside the app dir and does not walk `workspace:` deps
   transitively; the staged manifest lists the `@kvd` closure).

## Consequences

- Adding a plugin = new package + dependency in `apps/desktop/package.json` + a row in
  `cordis.yml`; the boundary check fails until all three agree.
- JS stays (node:test). R2 moves to TypeScript + vitest; the boundary checker's parser
  is the swap point (acorn → TypeScript, as in dsh-orb).
