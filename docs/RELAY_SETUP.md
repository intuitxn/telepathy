# Buzz relay setup

Setup verified on 2026-09-06, as recorded in the supplied relay setup report.

## Channels and members

| Channel | UUID |
| --- | --- |
| telepathy | `f6953abd-e24f-4387-8424-b1e123bc59fd` |
| sansara | `ecf97ed6-34d5-439a-967b-abe9bdd37e41` |
| iktara | `78fedf61-f8e2-43df-9413-37d98d6a430a` |
| intuitxn-general | `e81a4ea1-af2f-4488-83c6-eb66ce7ea5df` |
| changelog | `0e910e3d-2040-431a-ba28-ab531596d3c5` |
| shared-files | `174fceae-85e5-4bd4-8959-71a8ce8a2c8e` |

Shubham, Om, Kush, and the telepathy bot are members of all six channels.
Channel canvases are set on telepathy, changelog, and shared-files.

## Projects, workflow, and knowledge base

- NIP-MP projects: telepathy, sansara, iktara.
- JTBD workflow: `db7464aa-b895-4985-bed4-1f9821aa25a4`, on the telepathy channel.
- Seven shared-file notes in the knowledge base: product, sop, changelog,
  agent-map, harness-state, meta-agent-registry, program-telepathy.

## Desk intake

The local desk reads the channel UUIDs in `.local/config.json` under `channels`;
configure all six above for this setup. `authorizedPubkeys` controls whose
requests can be imported. `npm run desk -- poll` reads each configured channel
once; `npm run desk -- watch` repeats at the configured `pollSeconds` interval.
Intake starts at `since`, then uses per-channel cursors with a one-second overlap
and deduplicates by channel and source event ID.

A request starts with `/intuitxn ` followed by JSON, for example:

```text
/intuitxn {"request":"Update the onboarding guide","acceptance":"Guide covers all six channels and links resolve","repository":0,"runtime":"codex"}
```

`request` and `acceptance` are required. `repository` selects a zero-based entry
in the configured repository list (default 0); optional `runtime` selects
`codex` or `opencode`, otherwise the desk default applies. Ordinary conversation
does not create jobs. Polling queues requests for an operator to run; it does
not execute jobs or publish replies automatically. Candidates and checks still
need human review and acceptance.

## Repository context

See the [README](../README.md), [product contract](../PRODUCT.md),
[project model](PROJECTS.md), and [system index](INDEX.md).
