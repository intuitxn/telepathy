# Buzz relay setup

Setup verified on 2026-09-06, as recorded in the supplied relay setup report.

**Historical record.** This document is a dated channel/setup snapshot, not a
current operating guide. The Desk intake path it describes was retired
2026-09-22 with the Desk engine; the channel UUIDs, project identifiers, and
workflow ID are retained as historical evidence only. For the current setup use
[BUZZ_SETUP.md](../BUZZ_SETUP.md) and the native
[Buzz/Bend guide](../runtime/worker/BUZZ.md).

## Channels and members

| Channel | UUID |
| --- | --- |
| telepathy | `f6953abd-e24f-4387-8424-b1e123bc59fd` |
| sansara | `ecf97ed6-34d5-439a-967b-abe9bdd37e41` |
| iktara | `78fedf61-f8e2-43df-9413-37d98d6a430a` |
| intuitxn-general | `e81a4ea1-af2f-4488-83c6-eb66ce7ea5df` |
| changelog | `f739c450-3461-46cc-88a1-f70ac5cfcaa0` (recreated 2026-09-08 after the relay lost the original) |
| shared-files | `174fceae-85e5-4bd4-8959-71a8ce8a2c8e` |

Shubham, Om, Kush, and the telepathy bot are members of all six channels.
Channel canvases are set on telepathy, changelog, and shared-files.

## Projects, workflow, and knowledge base

- NIP-MP projects: telepathy, sansara, iktara.
- JTBD workflow: `db7464aa-b895-4985-bed4-1f9821aa25a4`, on the telepathy channel.
- Seven shared-file notes in the knowledge base: product, sop, changelog,
  agent-map, harness-state, meta-agent-registry, program-telepathy.

## Desk intake — retired 2026-09-22

The Desk engine, its `poll`/`watch` intake, `.local/config.json` channel list,
and the `/intuitxn ` request envelope were retired with `runtime/desk`. Their
history remains in git. Do not run `npm run desk -- poll` or `npm run desk --
watch`; those npm scripts no longer exist.

Current coordination is native: use the Buzz relay for human context and accepted
outcomes, and the native ACP/Bend worker for local execution, per
[BUZZ_SETUP.md](../BUZZ_SETUP.md) and
[runtime/worker/BUZZ.md](../runtime/worker/BUZZ.md). Agent work is verified
separately from human acceptance.

## Repository context

See the [README](../README.md), [product contract](../PRODUCT.md),
[project model](PROJECTS.md), and [system index](INDEX.md).
