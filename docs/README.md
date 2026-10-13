# Knowledge Vault Desktop — engineering docs

Docs are organised by the question they answer (same structure as dsh-orb `docs/`):

| Dir | Answers | Entry |
| --- | --- | --- |
| [requirements/](requirements/README.md) | what we build and how it is accepted | requirements index (AC / RS checklists) |
| [architecture/](architecture/README.md) | how the system is composed, who owns which boundary | [monorepo layout](architecture/monorepo.md) |
| [decisions/](decisions/README.md) | why (ADRs; numbering never changes) | ADR index |
| [verification/](verification/README.md) | how it is verified and what the evidence proves | smokes, pack-smoke, boundaries, screenshots |

Rules: requirements define targets, not delivery status. Accepted ADRs are design
constraints; superseded ones stay for history. Verification records are bound to a
date/commit; old counts do not prove the current build passes — CI does.
