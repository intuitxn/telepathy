# Agent map — Intuitxn

How people, Buzz agents, Telepathy meta-agents, and execution runtimes connect,
and how a Job To Be Done (JTBD) moves through them.

Authoritative sources: `.opencode/agents/` (charters), `plugins/telepathy-meta-agents/registry.json`
(declarative catalog), `runtime/adaptive/HARNESS.md` (active build plan), `runtime/worker/`
(checked Bend worker), `docs/PROJECTS.md` (job lifecycle). The Desk engine (`runtime/desk`)
was retired 2026-09-22; references to it below are historical.

Full inventory of canonical agents, session kinds, and the numbered
information-flow map: [`AGENT_DIRECTORY.md`](AGENT_DIRECTORY.md).

## Canonical agent names

The charters in `.opencode/agents/` are the single source of truth for agent names,
while `plugins/telepathy-meta-agents/registry.json` catalogs five product interfaces.
It does not register every charter or deploy a Buzz identity. Earlier aliases remain
in historical documents; use the canonical names for new work.

| Canonical (use this) | Retired name | JTBD |
|---|---|---|
| `@telepathy` | — | route |
| `@prime` | `@atlas` | propose, scope |
| `@build` | `@forge` | implement, verify |
| `@steward` | `@ledger` | resolve, project, learn |
| `@research` | `@scout` | research |
| `@relationships` | `@diplomat` | draft-external |
| `@bend-forge` | — | prove (Bend) |
| `@relay-keeper` | — | infra health |

## People — visible authors, accountable owners

| Person | Role |
|---|---|
| Shubham | Priorities, accepted direction, owner gate |
| Om | Active member |
| Kush | Onboarding (invite pending) |

People own every post, reply, acknowledgement, and resolution. Agents compose; humans decide.

## Programs — Buzz projects (NIP-MP)

One Buzz project per code repository, each bound to its home channel:

| Program | Repository | Home channel | Owns |
|---|---|---|---|
| `telepathy` | telepathy | `telepathy` (stream) | Human context layer + focused interfaces |
| `sansara` | sansara | `sansara` (stream) | Agent portal / world runtime |
| `iktara` | iktara | `iktara` (stream) | Personal reflection app |
| — | — | `intuitxn-general` (forum) | Cross-program communication |
| — | — | `changelog` (stream) | Ledger posts one dated changelog entry per change (draft -> human approve) |
| — | — | `shared-files` (stream) | Canonical shared files mirrored from the repo; canvas is the index; NIP-23 notes per file |

Program details live in [`programs/*.md`](../programs/). Create the relay objects with
`scripts/setup-programs.sh` (needs `BUZZ_PRIVATE_KEY` in the environment).

## Agent activity model

All agent activity happens as threads inside the program channels. The retained
harness runs execution through standard OpenCode with native Buzz ACP and a checked
Bend worker; the retired Desk engine (2026-09-22) previously handled intake,
execution and projection. Agent updates are thread replies, not new channels or
personas. Pollen, Fizz, and Honey are optional Desktop helpers; they are
not required for the loop. Humans accept a candidate by replying `accept` in the job
thread.

## Telepathy agents — JTBD interfaces

| Agent | JTBD stage | May | Must not | Runtime |
|---|---|---|---|---|
| `@telepathy` (primary) | route | Route intent to the narrowest agent | Publish without approval; invent interfaces | opencode / Buzz ACP |
| `@prime` | propose, scope | Draft a job proposal (owner, reviewer, acceptance) | Execute, activate, publish, accept, resolve | opencode |
| `@build` | implement, verify | Implement in worktree, record verification evidence, draft artifact review | Accept own work, merge, resolve, publish | opencode or codex |
| `@steward` | resolve, project, learn | Draft resolutions, changelog, activity projections, lesson entries | Author posts, change accepted history, send | opencode |
| `@research` | research | Retrieve sources, draft dossiers with source maps | Assert unverified claims, publish | opencode |
| `@relationships` | draft-external | Draft external messages from approved context | Send, record sent without delivery evidence | opencode |
| `@bend-forge` | prove | Draft `PROOF.bend` defs, laws, proofs; gate with `bend` | Self-accept, merge, resolve, publish | local Bend |
| `@relay-keeper` | infra | Read-only health checks; draft infra proposals; restart only within explicit operational authorization | Publish, accept, touch credentials, rewire network | local |

Required boundary (charters are instructions, not an isolation guarantee): **tools prepare, humans accept.**
No interface may activate its own Job, accept its own artifact, resolve a Job, or speak as a person.

## Buzz agents — the Nest front desk

Names as registered in the Buzz Nest (`~/.buzz/AGENTS.md`). Personas are owned in Buzz Desktop.

| Buzz agent | Proposed pairing | Notes |
|---|---|---|
| Pollen | `@prime` + `@research` | Gather context, scope proposals, research |
| Fizz | `@build` | Execution energy, candidate production |
| Honey | `@steward` | Consolidation, receipts, projections |
| (no persona) | `@telepathy`, `@relationships`, `@bend-forge`, `@relay-keeper` | Route, external drafts, proofs, infra — no named Desktop persona |

This pairing is a proposal, not yet authoritative — confirm each agent's persona in Buzz Desktop,
then either keep this table or replace it with the real split.

## Runtimes

| Runtime | What it runs | Where |
|---|---|---|
| `runtime/adaptive/HARNESS.md` | The active harness and build plan for the retained system | `telepathy/runtime/adaptive` |
| `runtime/worker/` | The checked Bend worker: explicit protocol transitions, Lorenz memory, native Buzz memory | `telepathy/runtime/worker` |
| opencode | Standard OpenCode — native `opencode run` with the user-configured provider/model, and `opencode acp` for Buzz. No fork or beta build is required. | local install |
| codex CLI | Sandboxed execution worker (`codex exec --json`) | local install |
| `runtime/desk` (historical) | Retired 2026-09-22 job engine (SQLite jobs/artifacts/outbox/cursors, Buzz poll + ingest, worktrees, dispatch). History remains in git. | — |

The active baseline runs roles through native OpenCode/Buzz and the checked Bend
worker; the Desk flow described below was an optional implementation and is now
retired, not a required orchestrator.

## JTBD lifecycle

```text
Proposed -> Ready -> Active -> Waiting -> Review -> Resolved | Cancelled
```

Buzz is the human surface; standard OpenCode / native Buzz ACP and the checked Bend
worker carry execution; Git holds accepted revisions. Desk, which previously owned
its own jobs, was retired 2026-09-22.

| Stage | Buzz surface | Execution state (historical Desk ledger) |
|---|---|---|
| Proposed / Ready | Issue created on the program repo, or `/intuitxn {json}` message in the home channel | job `queued` |
| Active | Issue assigned; thread updated | job `running`, worktree created |
| Waiting / Review | Candidate + evidence posted to the thread | artifact drafted |
| Resolved | Human accepts; issue `resolved`; outcome reply in thread | artifact accepted, outbox `sent` |
| Cancelled | Issue `closed` | job `cancelled` |

The execution-state column names the retired Desk ledger vocabulary; it is retained
as the contract vocabulary, not a current command reference.

## The loop — working from Buzz on a JTBD

1. **Human asks** in the program's home channel: either an issue on the program repo, or a message starting with `/intuitxn ` followed by JSON (`repository`, `request`, `acceptance`, optional `runtime`).
2. **Intake** (historical: the retired Desk engine polled the configured channels, deduplicated by source event id, and created a job).
3. **Runtime executes** in an isolated jj workspace at a pinned base revision
   when submitted through the resident meta shell. The older Desk intake used a
   Git worktree; that engine is retired.
4. **Candidate + evidence** returns: changed files, verification results, unresolved issues, exact revision.
5. **Human reviews and accepts** in the Buzz thread — acceptance is a named human at an exact revision.
6. **Projection** (historical: the retired Desk ledger projected the outcome): resolution, changelog, activity; the reply returns to the original thread.

## Where state lives

| State | Store |
|---|---|
| Human requests, acceptance, receipts | Buzz relay |
| Job state, outbox, cursors (historical) | Desk SQLite (`.local/desk.sqlite`) — retired 2026-09-22 |
| Instructions, source, accepted revisions | git |
| Secrets (BUZZ_PRIVATE_KEY, provider keys) | runtime env only — never in git, never in Buzz posts |
