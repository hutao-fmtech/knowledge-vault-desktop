# Knowledge Vault Desktop

Thin desktop shell that creates an Obsidian-compatible personal knowledge vault from a **bundled offline** template (`obsidian-knowledge-system` @ `a3320825e59e`).

M1 scope (see `/workspace/vault-desktop-m0-decisions.md` §5):

- Select parent folder → name vault → copy built-in template → success page + skeleton preview
- macOS + Windows local installers (packaging milestone)
- **Not** included: `embedded-agent-kit`, DeepSeek Harness (`dsh`) deep integration, full PKM editor

## Develop

```bash
npm install
npm run smoke    # headless createVault check
npm start        # Electron UI (needs a display)
```

## Layout

- `src/main.js` / `preload.js` / `renderer/` — Electron thin shell
- `src/sanitize.js` / `vault.js` — name rules + materialize pipeline
- `resources/template/` — vendored vault skeleton (offline)

## License

MIT (application). Bundled template license: see `resources/template/LICENSE`.


## Agent sidebar (v0.2 default mode)

Default mode (this PR): ask the vault with citations, sort inbox → PARA, make a Zettelkasten card.
Every write is a **proposed change**; disk updates only after **Apply**. Paths outside the vault, `..`, `.obsidian/`, and `00-系统/` are rejected.

- Engine pins (exact, no umbrella): `@deepseek-ai/cordis@4.0.4`, `@deepseek-ai/dsh-llm@0.2.0-rc.2`, `@deepseek-ai/dsh-llm-deepseek-api-key@0.2.0-rc.2`, `@deepseek-ai/dsh-credentials@0.2.0-rc.2`, `@deepseek-ai/schemastery@3.18.4`. `@deepseek-ai/dsh` is not a dependency; default mode never loads tool packages.
- Without an API key the UI uses a local mock engine (offline). With a DeepSeek key, model calls go through an in-process Cordis mount of `@deepseek-ai/dsh-llm` + `@deepseek-ai/dsh-llm-deepseek-api-key` (`ctx.llm.stream`, provider `deepseek-official`). No raw `fetch` to the public API.
- Not in this PR: dsh agent-loop / durable sessions / tool packages. Those need a `dsh` profile + SDK client (advanced-mode PR). Reference source lives outside this repo at `deepseek-ai/deepseek-harness` (local checkout: `/workspace/deepseek-harness`).
- Key storage: OS `safeStorage` when available, else app config dir — never inside the vault or repo.
- Advanced mode (bash/tools) is **not** in this PR.

```bash
npm run smoke          # createVault + AC-7 agent write confirmation
npm run smoke:agent    # AC-7 only
npm start
```

Screenshots: `docs/screenshots/`.

## Packaging

M1 ships **unsigned** internal-test installers for **Windows + macOS** via GitHub Actions (`.github/workflows/release.yml`):

- Push a tag `vX.Y.Z` → smoke → build on `windows-latest` (NSIS + portable) and `macos-latest` (dmg/zip, arm64 + x64) → assets uploaded to a GitHub pre-release.
- Or run the workflow manually (Actions → Release) to just produce downloadable artifacts.

Local builds: `npm run dist:win` (Windows host, or Linux + wine), `npm run dist:mac` (macOS host). `dist/` is git-ignored.

macOS first launch of an unsigned build: right-click the app → **Open**.
