# Desk runtime

Start with [BUZZ_SETUP.md](../../BUZZ_SETUP.md).

- `core.js`: local SQLite records, writing templates, exact-revision review and export.
- `jobs.js`: one-time claim, separate Git worktree, Codex/OpenCode adapter, retained evidence.
- `buzz.js`: explicit request intake, timestamp overlap, source deduplication, reviewed outbox and delivery receipts.
- `runtime.js`: authenticated connection to the pinned OpenCode service using its official client.
- `setup.js`: reproducible local settings and profiles.
- `cli.js`: operator commands. There is no unauthenticated HTTP control plane.

The SQLite ledger owns jobs for this pilot. Runtime sessions belong to their own runtime; thread mappings and job evidence remain here. Configured repositories and authorized Buzz senders are explicit allowlists. Imported requests stay queued until an operator runs them.

Do not treat `needs_review` as human acceptance. A crashed claim stays claimed. An uncertain publication stays uncertain. Recovery requires inspection of the saved runtime session or relay delivery before another operation; automatic replay is intentionally not implemented.

The execution timeout is enforced, but it is not a monetary budget. No hard token or spend cap is implemented. The OpenCode worker uses a profile that leaves shell permissions pending for the operator; the Codex worker uses its workspace-write sandbox and installed account configuration.

Integration verification: the v2 plugin loaded as active on the pinned server. A real authenticated Codex job created and verified a fixture file in a separate worktree while preserving its source checkout. Provider-backed OpenCode generation and live Buzz delivery still need their own checks.
