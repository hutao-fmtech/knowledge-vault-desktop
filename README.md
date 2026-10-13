# Knowledge Vault Desktop

Thin desktop shell that creates an Obsidian-compatible personal knowledge vault from a **bundled offline** template (`obsidian-knowledge-system` @ `a3320825e59e`).

M1 scope (see `/workspace/vault-desktop-m0-decisions.md` §5):

- Select parent folder → name vault → copy built-in template → success page + skeleton preview
- macOS + Windows local installers (packaging milestone)
- **Not** included: `embedded-agent-kit`, DeepSeek Harness (`dsh`) deep integration, full PKM editor

## Develop

pnpm workspace (Node >= 22.12, pnpm 9; `node-linker=hoisted`, see `.npmrc`).

```bash
pnpm install
pnpm run check-boundaries   # per-package dependency/import boundaries
pnpm -r test                # node:test unit tests in every package
pnpm run smoke              # createVault + AC-7 + advanced AC-11..14 (headless)
pnpm start                  # Electron UI (needs a display)
```

## Layout

```
apps/desktop/     Electron shell (main / preload / renderer), cordis.yml (plugin composition),
                  runtime/boot.mjs (Cordis composition root), electron-builder config
packages/         one package per capability (@kvd/*): vault, search, proposals, skills,
                  skills-core, llm-mock, keychain, privacy, prefs, ipc-bridge, advanced,
                  shared, template (the bundled Obsidian vault template)
docs/             architecture/ · decisions/ (ADRs) · requirements/ · verification/
scripts/          smokes, check-boundaries, build-desktop (pnpm deploy + electron-builder), pack-smoke assert
```

See `docs/architecture/monorepo.md` and `docs/decisions/0003-pnpm-monorepo-layout.md`.

## License

MIT (application). Bundled template license: see `packages/template/template/LICENSE`.


## Agent sidebar (v0.2 default mode)

Default mode (this PR): ask the vault with citations, sort inbox → PARA, make a Zettelkasten card.
Every write is a **proposed change**; disk updates only after **Apply**. Paths outside the vault, `..`, `.obsidian/`, and `00-系统/` are rejected.

- Engine pins (exact, no umbrella): `@deepseek-ai/cordis@4.0.4`, `@deepseek-ai/dsh-llm@0.2.0-rc.2`, `@deepseek-ai/dsh-llm-deepseek-api-key@0.2.0-rc.2`, `@deepseek-ai/dsh-credentials@0.2.0-rc.2`, `@deepseek-ai/schemastery@3.18.4`. `@deepseek-ai/dsh` is not a dependency; default mode never loads tool packages.
- Without an API key the UI uses a local mock engine (offline). With a DeepSeek key, model calls go through an in-process Cordis mount of `@deepseek-ai/dsh-llm` + `@deepseek-ai/dsh-llm-deepseek-api-key` (`ctx.llm.stream`, provider `deepseek-official`). No raw `fetch` to the public API.
- Key storage: OS `safeStorage` when available, else app config dir — never inside the vault or repo.
- Advanced mode: see below (plugin fiber on the composition root; reference source for dsh APIs: `deepseek-ai/deepseek-harness`).

```bash
pnpm run smoke          # createVault + AC-7 + advanced AC-11..14
pnpm run smoke:agent    # AC-7 only
pnpm run smoke:advanced # AC-11..14 only
pnpm start
```

Screenshots: `docs/verification/screenshots/`.

## Packaging

M1 ships **unsigned** internal-test installers for **Windows + macOS** via GitHub Actions (`.github/workflows/release.yml`):

- Push a tag `vX.Y.Z` → smoke → build on `windows-latest` (NSIS + portable) and `macos-latest` (dmg/zip, arm64 + x64) → assets uploaded to a GitHub pre-release.
- Or run the workflow manually (Actions → Release) to just produce downloadable artifacts.

Local builds: `node scripts/build-desktop.mjs --win` (Windows host, or Linux + wine), `--mac` (macOS host), `--dir --linux` (unpacked, used by CI pack-smoke). The script stages `apps/desktop` with `pnpm deploy --prod` and runs electron-builder there; output in `apps/desktop/dist/` (git-ignored). Installer names and the in-app version come from `apps/desktop/package.json`.

macOS first launch of an unsigned build: right-click the app → **Open**.

## Advanced mode (AC-11..14, plugin architecture)

Off by default. **Settings > Advanced** (local UI only) mounts the lazy `advanced` group of `apps/desktop/cordis.yml` as a disposable Cordis fiber on the composition root:

- `kvd-approval-bridge`: `tools/pre-execute` (prepend) stores full `exec.arguments` by `callId` and returns `ask`; `approval/request` shows full tool name + all arguments (Approve / Deny → `allowed-once` / `rejected`).
- Policy: approve-each-call (default) or run-directly-log-only (one-time risk prompt). Remote can never enable or change policy; any origin may disable.
- Disable disposes the fiber immediately (no restart). Audit log outside the vault, never contains the API key.
- Read-only sandbox; note changes only via `vault_propose_change` → Apply.
- Electron 39.8.10 embeds Node 22.22.1 — no bring-your-own Node. No unsupported SDK profiles, no `@deepseek-ai/dsh` umbrella, no `embedded-agent-kit`.

Screenshots: `docs/verification/screenshots/05`–`14`.
