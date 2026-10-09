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

## Packaging

M1 ships **unsigned** internal-test installers for **Windows + macOS** via GitHub Actions (`.github/workflows/release.yml`):

- Push a tag `vX.Y.Z` → smoke → build on `windows-latest` (NSIS + portable) and `macos-latest` (dmg/zip, arm64 + x64) → assets uploaded to a GitHub pre-release.
- Or run the workflow manually (Actions → Release) to just produce downloadable artifacts.

Local builds: `npm run dist:win` (Windows host, or Linux + wine), `npm run dist:mac` (macOS host). `dist/` is git-ignored.

macOS first launch of an unsigned build: right-click the app → **Open**.
