# Telepathy meta-agent contract

## Planes

The human workspace shows posts, replies, acknowledgements, ownership, and resolutions authored by Shubham, Om, and Kush. Meta-agent interfaces are focused tools that propose Jobs or candidate artifacts through the same backend. They never join the human feed as people.

## Authority

- Human action owns intent, review, acceptance, external sending, and publication as a person.
- The harness ledger owns Job and artifact-event history.
- Agent Manager owns execution-session state and contributes only a `RunLink`.
- Git owns accepted implementation revisions and the human-readable activity projection.
- OpenKnowledge, Obsidian, Sites, GitHub Projects, and Buzz are derived views.

## Routing

One application and backend should resolve an interface from the request host. Until wildcard routing is live, every interface must also work at its path fallback.

| ID | Host | Path | Purpose |
|---|---|---|---|
| `prime` | `prime.telepathy.intuitxn.com` | `/agents/prime` | Turn human intent into a reviewable Job proposal. |
| `build` | `build.telepathy.intuitxn.com` | `/agents/build` | Produce a tested candidate artifact from an accepted Job. |
| `steward` | `steward.telepathy.intuitxn.com` | `/agents/steward` | Project accepted outcomes into receipts, changelog, Git, and knowledge views. |
| `research` | `research.telepathy.intuitxn.com` | `/agents/research` | Prepare an evidence-backed research artifact. |
| `relationships` | `relationships.telepathy.intuitxn.com` | `/agents/relationships` | Prepare a reviewed external-conversation draft without sending it. |

The root `telepathy.intuitxn.com` remains the human workspace. `agents.telepathy.intuitxn.com` may render the catalog. Project navigation stays path-based at `/projects/:project`.

GitHub Pages can ship the path fallbacks. Wildcard subdomains require verified Cloudflare routing and must not be claimed live until authoritative DNS, HTTPS, and host routing pass.

## Accepted activity projection

Write one immutable Markdown file per accepted event:

```text
activity/<project>/<year>/<month>/<event-id>.md
```

Required frontmatter:

- `id`
- `occurred_at`
- `project`
- `kind`
- `initiator`
- `owner`
- `reviewer`
- `source_event_id`
- `artifact_id`
- `artifact_revision`
- `visibility`

The body records what changed, why, verification evidence, limitations, and the next action. The event ID is the idempotency key. Never rewrite an accepted event to change history; append a correcting event.

Knowledge projections store curated summaries, decisions, accepted outcomes, links, and next actions. They exclude raw sessions, runtime state, prompts, logs, model traces, and generated build directories.
