# Knowledge Vault Desktop

Electron desktop app that creates an **Obsidian-compatible** personal knowledge vault from a **bundled offline** template (PARA / MOC / Zettelkasten), with an optional agent sidebar for ask-with-citations, inbox → PARA sorting, and Zettelkasten cards.

Every agent write is a **proposed change**; disk updates only after you **Apply**. Paths outside the vault, `..`, `.obsidian/`, and `00-系统/` are rejected.

## Install

Prebuilt installers (Windows NSIS/portable, macOS dmg/zip): see [Releases](https://github.com/hutao-fmtech/knowledge-vault-desktop/releases).

macOS unsigned builds: right-click the app → **Open** on first launch.

## Build from source

Requires **Node ≥ 22.12** and **pnpm 9** (see `packageManager` in root `package.json`). Dependencies resolve from the public npm registry (including `@deepseek-ai/*`); no private registry or `NPM_TOKEN` is required.

```bash
git clone https://github.com/hutao-fmtech/knowledge-vault-desktop.git
cd knowledge-vault-desktop
pnpm install
pnpm run build
pnpm run smoke          # createVault + agent + advanced checks (headless)
pnpm start              # Electron UI (needs a display)
```

Useful checks:

```bash
pnpm run check-boundaries
pnpm -r test
pnpm run smoke:agent    # agent write path only
pnpm run smoke:advanced # advanced mode only
```

Packaging (local):

```bash
node scripts/build-desktop.mjs --win    # Windows host (or Linux + wine)
node scripts/build-desktop.mjs --mac    # macOS host
node scripts/build-desktop.mjs --dir --linux
```

Output lands under `apps/desktop/dist/` (git-ignored). Pushing a tag `vX.Y.Z` runs the Release workflow (unsigned Windows + macOS assets).

## What it does / does not do

**Does**

- One-click vault creation from the bundled template
- Agent sidebar (default mode): ask with citations, sort inbox → PARA, make a Zettelkasten card — propose then Apply
- Optional Advanced mode (off by default): Cordis plugin fiber with per-call tool approval; API key stored in OS keychain / app config, never in the vault or repo
- Local-first; works offline with a mock LLM when no API key is set

**Does not**

- Auto-post to WeChat / social, soft-ad generation, or act as a coding IDE
- Vendor or require a private DeepSeek Harness checkout — `@deepseek-ai/cordis*` / `dsh-*` packages are public npm pins
- Ship code-signed / notarized installers in the open-source first release

## Layout

```
apps/desktop/     Electron shell (main / preload / renderer), cordis.yml, electron-builder
packages/         Capability packages (@kvd/*): vault, search, proposals, skills,
                  skills-core, llm-mock, keychain, privacy, prefs, ipc-bridge, advanced,
                  shared, template (bundled Obsidian vault template)
docs/             architecture/ · decisions/ (ADRs) · requirements/ · verification/
scripts/          smokes, check-boundaries, build-desktop, pack-smoke
```

See `docs/architecture/monorepo.md` and `docs/decisions/0003-pnpm-monorepo-layout.md`.

## Security

- API keys: enter in the app only; stored via OS `safeStorage` when available, else the app config directory — **never** in the vault, repo, env files committed to git, or logs.
- Do not paste secrets into Issues or PRs.
- Advanced mode: approve-each-call by default; remote cannot enable or change policy.

## License

[MIT](./LICENSE) — Copyright (c) 2026 hutao.

Bundled vault template: see `packages/template/template/LICENSE` (also MIT).
Upstream `@deepseek-ai/*` packages keep their own licenses on npm; this repo does not vendor their source.
