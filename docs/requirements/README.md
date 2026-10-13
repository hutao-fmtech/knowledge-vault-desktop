# Requirements

Product scope and acceptance live in the M0 decision memo (outside this repo); this
directory tracks the acceptance lists that the repo is gated on.

## Restructure acceptance (memo §13, RS-1..RS-10)

| ID | Requirement | R1 |
| --- | --- | --- |
| RS-1 | apps/desktop + packages/* (src, test, README each) + docs/{architecture,decisions,requirements,verification} | ✔ |
| RS-2 | pnpm workspace, hoisted linker, `workspace:` protocol | ✔ |
| RS-3 | composition declared in apps/desktop/cordis.yml; packaged app reads it and composes all plugins | ✔ |
| RS-4 | check-boundaries in CI (declared deps per package, no cross-package relative imports) | ✔ |
| RS-5 | AC-8 exact pins asserted across packages; no umbrella | ✔ |
| RS-6 | no import cycles (skills ⇄ llm-mock broken); ≥1 unit test per package, `pnpm -r test` in CI | ✔ |
| RS-7 | smoke assertions only increase (AGENT ≥114, ADVANCED ≥109, KVD_PACK_SMOKE_OK) | ✔ |
| RS-8 | installer names / in-app version behaviour unchanged; release tag check reads apps/desktop | ✔ |
| RS-9 | TypeScript | R2 |
| RS-10 | security unchanged (escalation rejected, proposal→Apply only, key never in env, remote can't enable advanced, never touch .obsidian/ or 00-系统/) | ✔ |

Feature acceptance (AC-*) is asserted by the smokes listed in [../verification](../verification/README.md).
