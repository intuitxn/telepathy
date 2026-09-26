# Buzz relay setup record

This is a historical record of the relay setup verified on 2026-09-06. It does not establish current membership, channel health, a running watcher, or DSH intake. Inspect the relay through an authorized owner-controlled Buzz host before acting on these identifiers.

## Channels and members observed

| Channel | UUID |
| --- | --- |
| telepathy | `f6953abd-e24f-4387-8424-b1e123bc59fd` |
| sansara | `ecf97ed6-34d5-439a-967b-abe9bdd37e41` |
| iktara | `78fedf61-f8e2-43df-9413-37d98d6a430a` |
| intuitxn-general | `e81a4ea1-af2f-4488-83c6-eb66ce7ea5df` |
| changelog | `f739c450-3461-46cc-88a1-f70ac5cfcaa0` (recreated 2026-09-08) |
| shared-files | `174fceae-85e5-4bd4-8959-71a8ce8a2c8e` |

The report recorded Shubham, Om, Kush, and the telepathy bot as members of all six channels, with canvases on telepathy, changelog, and shared-files. It also recorded three NIP-MP projects, one JTBD workflow, and seven shared-file notes. These are observations from that date, not current verification or an instruction to redeploy the workflow.

## Retired intake

The earlier Desk watcher read `.local/config.json`, polled channels, and admitted `/intuitxn` JSON requests into its own ledger. That source path and its root npm commands are retired. An installed old service may still have private state; preserve it during migration. A Buzz thread does not automatically become a DSH task or accepted knowledge.

The current [DSH resident ingress](../runtime/dsh/README.md#funded-research-task-program) accepts local, host-submitted research or analysis requests against reviewed profiles. It does not poll Buzz. See [Telepathy setup](../BUZZ_SETUP.md), the [product contract](../PRODUCT.md), and the [system index](INDEX.md) for the current boundaries.
