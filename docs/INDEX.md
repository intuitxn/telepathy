# Telepathy system index

Telepathy is Intuitxn's human context layer and its family of focused meta-agent tools.

## Two planes

- **Human workspace:** Shubham, Om, and Kush publish decisions, updates, questions, replies, acknowledgements, and resolutions.
- **Meta-agent interfaces:** narrow tools propose Jobs, produce candidate artifacts, and project accepted outcomes. They do not appear as teammates.

Both planes use one Job and artifact contract. The runtime stays below the product surface.

## Sources and projections

| Surface | Authority |
|---|---|
| Human action | Intent, review, acceptance, external sending |
| Harness ledger | Job and artifact-event history |
| Agent Manager | Execution sessions and RunLinks |
| Git | Accepted code revisions and human-readable activity projection |
| Telepathy UI | Human-relevant workspace and focused interfaces |
| GitHub Project | Planning view over issues |
| OpenKnowledge, Obsidian, Sites | Curated knowledge and publishing projections |

## Code map

- Human product: [`site/`](../site)
- Product contract: [`PRODUCT.md`](../PRODUCT.md)
- Team SOP: [`SOP.md`](../SOP.md)
- Harness boundary: [`HARNESS.md`](../HARNESS.md)
- Job implementation: [`packages/harness/harness/jobs.ts`](../packages/harness/harness/jobs.ts)
- Meta-agent registry: [`plugins/telepathy-meta-agents/registry.json`](../plugins/telepathy-meta-agents/registry.json)
- Accepted activity: [`activity/`](../activity)
- GitHub planning model: [`PROJECTS.md`](./PROJECTS.md)
- Domain map: [`ORG.md`](./ORG.md)
