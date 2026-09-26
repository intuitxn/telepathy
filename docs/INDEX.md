# Telepathy system index

Telepathy is Intuitxn's human context layer and a source tree for a bounded algorithm machine. The [product contract](../PRODUCT.md) and [team SOP](../SOP.md) govern the human workspace. The [DSH operator guide](../runtime/dsh/README.md) governs the new algorithm source; operational cutover remains pending.

## Current code map

| Surface | Source and boundary |
| --- | --- |
| Human alpha | [`site/`](../site) — local browser preview, not authenticated team state |
| Algorithm candidate | [`runtime/core/telepathy.bend`](../runtime/core/telepathy.bend) — checked pure computation |
| DSH host capability | [`runtime/dsh/`](../runtime/dsh) — grants, source archives, receipts, independent checks, and local ingress |
| Review gate | [`scripts/jj-gate.mjs`](../scripts/jj-gate.mjs), [release guide](../runtime/dsh/README.md#check-and-install-a-trusted-production-release) — exact jj revision |
| Human records | [`forum/`](../forum), [`activity/`](../activity), [`programs/`](../programs) — versioned writing and projections |
| Role catalog | [`plugins/telepathy-meta-agents/registry.json`](../plugins/telepathy-meta-agents/registry.json) — planned product interfaces, not live endpoints |

The [agent map](AGENT_MAP.md) explains the role names and current machine boundary. [UX & AX](designs/ux-ax.md) and [A2A protocol](designs/a2a-protocol.md) are design records with dated implementation limits.

## Historical stores

The Desk job engine and its SQLite ledger, the Meta shell, Mundus wrapper, and OpenCode mailbox were present in earlier revisions. Their source entry points are retired here. Installed processes and private state are not changed by source retirement. The [local-main reconciliation](designs/local-main-reconciliation.md) names the retained capability ports and migration gates. Buzz relay posts remain human context; they do not automatically enter DSH task state or confer task authority.
