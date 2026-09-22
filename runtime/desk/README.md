# Desk runtime

Start with [BUZZ_SETUP.md](../../BUZZ_SETUP.md).

- `core.js`: local SQLite records, writing templates, exact-revision review and export.
- `jobs.js`: one-time claim, separate Git worktree, Codex/OpenCode adapter, retained evidence.
- `buzz.js`: explicit request intake, timestamp overlap, source deduplication, reviewed outbox and delivery receipts.
- `runtime.js`: selects the installed OpenCode CLI (`OPENCODE_BIN` or `opencode`) and passes an environment without Buzz keys; there is no pinned service client.
- `setup.js`: reproducible local settings and profiles.
- `cli.js`: operator commands. There is no unauthenticated HTTP control plane.

The SQLite ledger owns jobs for this pilot. Runtime sessions belong to their own runtime; thread mappings and job evidence remain here. Configured repositories and authorized Buzz senders are explicit allowlists. Imported requests stay queued until an operator runs them.

Do not treat `needs_review` as human acceptance. A crashed claim stays claimed. An uncertain publication stays uncertain. Recovery requires inspection of the saved runtime session or relay delivery before another operation; automatic replay is intentionally not implemented.

The execution timeout is enforced, but it is not a monetary budget. No hard token or spend cap is implemented. No OpenCode permission profile is applied on this path: the worker runs the installed CLI with its normal configuration, so approvals follow that configuration. The Codex worker uses its workspace-write sandbox and installed account configuration.

Integration verification: the v2 plugin loaded as active on the pinned server. A real authenticated Codex job created and verified a fixture file in a separate worktree while preserving its source checkout. Provider-backed OpenCode generation and live Buzz delivery still need their own checks.
