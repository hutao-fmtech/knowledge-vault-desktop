# Verification

| Gate | Command | Proves |
| --- | --- | --- |
| Boundaries | `pnpm run check-boundaries` (+ `node --test scripts/test/*.test.mjs`) | RS-4: per-package declared deps, no cross-package relative imports, public exports only, no `@kvd` cycles, cordis.yml rows declared |
| Unit | `pnpm -r test` | RS-6: ≥1 node:test file per package (14 workspace packages) |
| Smoke | `pnpm run smoke` (Node ≥ 22.12; CI sets `KVD_REQUIRE_DSH_E2E=1`) | AC-7, AC-8 (pins across packages), AC-11..14, RS-10; prints `AGENT_SMOKE_OK <n> asserts`, `ADVANCED_SMOKE_OK <n> checks` |
| Pack-smoke | `node scripts/build-desktop.mjs --dir --linux` → `xvfb-run <app> --no-sandbox --kvd-pack-smoke` → `node scripts/assert-pack-smoke.mjs out.txt` | RS-3/RS-8: Electron Node ≥ 22.12, cordis.yml read from app.asar, all declared plugins mounted, template shipped, dispose on quit |

CI (`.github/workflows/ci.yml`) runs all four on every PR. Counts in PR descriptions are
evidence for that commit only.

Screenshots of the UI states: [screenshots/](screenshots/).
