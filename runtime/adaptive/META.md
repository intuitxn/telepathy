# Historical `/meta agents` route

This document records the earlier OpenCode `/meta agents` workflow. Its repository command `.opencode/commands/meta.md` and the resident Meta shell are retired from the current source tree, so `/meta agents` is not a supported entry point from this checkout. Installed old commands or sessions may still exist outside the repository; preserve their private state during migration.

The old route coordinated a Lorenz Bend snapshot lineage (`capture`, `work`, `claim`, `packet`, `return`, explicit `learn` and `correct`). A reported worker result did not by itself establish truth or enter retained memory. The [local-main reconciliation](../../docs/designs/local-main-reconciliation.md) maps these behaviors to DSH task control and records the migration gates.

For new algorithm work, read the [DSH capability guide](../dsh/README.md) and [operator guide](../../OPERATE.md). The checked one-file candidate is [`runtime/core/telepathy.bend`](../core/telepathy.bend). The [resident ingress](../dsh/README.md#funded-research-task-program) is a local, host-owned submit/status/list interface for reviewed research and analysis profiles. It does not resume an old ACP session or import the Meta shell database. Operational cutover requires a separate backup, trial, and deliberate switch; source retirement alone performs none of those actions.
