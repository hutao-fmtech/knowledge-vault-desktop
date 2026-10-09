# ADR 0001: kvd = in-process Cordis composition (not dsh profile launcher)

- **Status**: Accepted
- **Date**: 2026-10-10
- **Context**: Architecture review `/workspace/kvd-arch-review-dsh-plugin.md` §0–§1, §4.1, §5 PR-0, risk R6

## Decision

Knowledge Vault Desktop (kvd) is an **in-process Cordis composition** hosted inside the Electron main process. We compose a single `Context` from a declarative plugin row table (isomorphic with `cordis.patch.yml` rows: `id` / `name` / `config` / `disabled`). We are **not** using the dsh profile / CLI launcher (`dsh --profile …`) as the application boot path for now.

## Reasons

1. **Electron + Node mismatch (review R2)**: dsh’s supported application launch path expects a Node `^22.19 || >=24` host and a profile runner. Electron 33 (previous pin) shipped Node ~20.18, which cannot load parts of `dsh-base` (e.g. `node:sqlite`). Even after upgrading Electron for Node ≥ 22.12, keeping the runtime inside main remains the lowest-risk path for v0.2 default mode (model-only `ctx.llm.stream`).
2. **dsh itself documents the gap**: “direct in-process plugin mounting… are not Harness application launchers” (`docs/architecture.md`). We knowingly deviate; the row table stays profile-shaped so we can migrate later without rewriting product plugins.
3. **Product scope**: v0.2 default mode only needs `dsh-llm` + `dsh-llm-deepseek-api-key` (+ kvd plugins). Mounting a full `dsh-base` / `sdk` / `sdk-minimal` profile would pull tools, sandbox native addons, and session persistence we do not want on by default (memo AC-11a, review R3/R7).
4. **Thin-adapter memo vs plugin model**: memo §11.2’s “thin adapter; rest of app does not import dsh” conflicts with “everything is a plugin”. This ADR re-boards that: the composition root *is* the integration surface; feature code becomes providers/listeners on Cordis seams.

## Consequences

- App owns boot / dispose (`before-quit` / `will-quit`); Context is not a lazy singleton forever.
- Direct dependencies pin every package we `import` / mount (`@deepseek-ai/cordis`, `dsh-llm`, `dsh-llm-deepseek-api-key`, `dsh-credentials`, …). The `@deepseek-ai/dsh` umbrella remains pinned for AC-8 until the owner agrees to retarget that assertion (review R4).
- Upgrading dsh is a deliberate release (exact pins), not a floating range — same spirit as dsh Desktop “release identity”.
- Advanced mode (tools / approval / sandbox) will still be a **plugin group fiber** on this composition, not `--profile sdk` (SDK profile has no approval responder).

## Exit conditions (when to adopt a real dsh profile / kvd-host)

Any of the following can trigger moving off in-process composition to a profile runner or `ELECTRON_RUN_AS_NODE` kvd-host (review PR-8):

1. Advanced-mode spike (PR-7a) proves native sandbox / addon ABI is unstable inside Electron main.
2. We need dsh’s supported launcher guarantees (upgrade compatibility, HMR, official profile patches).
3. Session / tool / sandbox row group cannot boot without the rest of `dsh-base` and that rest is incompatible with our Electron host.
4. Product owner explicitly chooses “kvd is a dsh application” and accepts Host-process IPC for credentials decrypt (key never in env/argv).

Until then: composition root + row table; document this deviation in PR bodies that touch runtime boot.
