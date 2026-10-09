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

M1 targets **macOS + Windows** local installers (`electron-builder`).

```bash
npm run dist:win   # NSIS + portable (needs wine on Linux)
npm run dist:mac   # dmg/zip (needs macOS host)
```

On this Linux box without wine/root: `dist/win-unpacked/` is produced, and
`dist/Knowledge Vault-0.1.0-win-x64-portable.zip` is a zip of that folder.
NSIS `.exe` installer and macOS `.dmg` need wine or a macOS/Windows runner.
