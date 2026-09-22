# Telepathy system index

Design records (check their dated implementation boundaries): [UX & AX — work environments as apps](designs/ux-ax.md) · [A2A protocol & identity](designs/a2a-protocol.md).

Telepathy is Intuitxn's human context layer and its family of focused meta-agent tools.

Start with [the active harness and build plan](../runtime/adaptive/HARNESS.md) and [native setup](../runtime/worker/BUZZ.md). Historical services and optional Desk are not prerequisites.

## Two planes

- **Human workspace:** Shubham, Om, and Kush publish decisions, updates, questions, replies, acknowledgements, and resolutions.
- **Meta-agent interfaces:** narrow tools propose Jobs, produce candidate artifacts, and project accepted outcomes. They do not appear as teammates.

Both planes use one Job and artifact contract. The runtime stays below the product surface.

## Sources and projections

| Surface | Authority |
|---|---|
| Human action | Intent, review, acceptance, external sending |
| Bend snapshots / optional Desk ledger | Local worker history / Desk jobs and artifacts; separate stores, not automatically merged |
| Native Buzz ACP + OpenCode | Execution sessions; Agent Manager integration remains a proposal |
| Git | Accepted code revisions and human-readable activity projection |
| Telepathy UI | Human-relevant workspace and focused interfaces |
| GitHub Project | Planning view over issues |
| OpenKnowledge, Obsidian, Sites | Curated knowledge and publishing projections |

## Code map

- Human product: [`site/`](../site)
- Product contract: [`PRODUCT.md`](../PRODUCT.md)
- Team SOP: [`SOP.md`](../SOP.md)
- Harness boundary: [`HARNESS.md`](../HARNESS.md)
- Job implementation: [`runtime/desk/src/jobs.js`](../runtime/desk/src/jobs.js) (optional Desk)
- Meta-agent registry: [`plugins/telepathy-meta-agents/registry.json`](../plugins/telepathy-meta-agents/registry.json)
- Agent directory + information-flow map: [`AGENT_DIRECTORY.md`](./AGENT_DIRECTORY.md)
- Agent map: [`AGENT_MAP.md`](./AGENT_MAP.md)
- Worktree lifecycle: [`WORKTREE_LIFECYCLE.md`](./WORKTREE_LIFECYCLE.md)
- Draft (review only): [one self-contained Bend command vs the npm surface](./drafts/meta/one-file-bend-command.md)
- Draft (review only): [ops as Bend — procedures as executable kernels](./drafts/meta/ops-as-bend.md) · [op dispatch convention](./drafts/meta/op-dispatch-convention.md)
- Accepted activity: [`activity/`](../activity)
- GitHub planning model: [`PROJECTS.md`](./PROJECTS.md)
- Domain map: [`ORG.md`](./ORG.md)
