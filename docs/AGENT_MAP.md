# Agent map — Intuitxn

People own Telepathy's posts, replies, decisions, and external sends. The five focused interfaces in [`plugins/telepathy-meta-agents/registry.json`](../plugins/telepathy-meta-agents/registry.json) are a product catalog, not deployed DSH agents or authenticated Buzz identities. The retained [OpenCode charters](../.opencode/agents) describe roles for direct OpenCode use; they do not start Desk or submit a DSH task.

## Names and roles

| Name | Earlier alias | Role |
| --- | --- | --- |
| `@telepathy` | — | route intent |
| `@prime` | `@atlas` | scope a request |
| `@build` | `@forge` | implement and verify |
| `@steward` | `@ledger` | record supported outcomes and lessons |
| `@research` | `@scout` | prepare source-backed research |
| `@relationships` | `@diplomat` | prepare external messages |
| `@bend-forge` | — | write and check Bend candidates |
| `@relay-keeper` | — | inspect host and relay health |

Shubham sets priorities and direction; Om is an active member; Kush's onboarding was pending in the earlier roster. Buzz Desktop personas Pollen, Fizz, and Honey had proposed pairings to these roles, but no pairing is authenticated by this catalog. Check the current Buzz roster before attributing an action or message.

## Current machine boundary

A trusted host freezes a task, its authority and acceptance, exact jj source head, finite compute, and independent evaluator. For funded research or analysis, the [resident ingress](../runtime/dsh/README.md#funded-research-task-program) accepts a local request naming a reviewed profile and records durable status. It does not poll Buzz or run the old Desk ledger. DSH sessions propose and execute within grants; host task control admits source-linked results only after independent settlement. Bend holds the one-file algorithm computation. The integration owner combines jj changes and checks the exact resulting revision. See the [algorithm design](designs/dsh-algorithm-machine.md) and [workspace lifecycle](WORKTREE_LIFECYCLE.md).

The website, forum, Buzz channels, and product role catalog are separate from that task state. A thread or agent message is context, not an automatic grant or accepted finding. Existing authorization for routine internal work is governed by [`runtime/AUTONOMY.md`](../runtime/AUTONOMY.md); publication still follows its actual destination and sender authority.

## Historical Job flow

The earlier Desk engine polled `/intuitxn` messages, created jobs in its SQLite ledger, used Git worktrees, and projected replies through an outbox. Its source and root npm commands are retired from this tree. The [relay setup record](RELAY_SETUP.md) and [harness state](HARNESS_STATE.md) preserve dated observations. An installed legacy service may still have private state; preserve it through the [migration gates](designs/local-main-reconciliation.md#migration-gates). Do not treat a historical Desk job as a DSH task or an independently accepted result.
