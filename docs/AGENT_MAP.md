# Agent map — Intuitxn

How people, Buzz agents, Telepathy meta-agents, and execution runtimes connect,
and how a Job To Be Done (JTBD) moves through them.

Authoritative sources: `.opencode/agents/` (charters), `plugins/telepathy-meta-agents/registry.json`
(declarative catalog), `runtime/desk/` (job engine), `docs/PROJECTS.md` (job lifecycle).

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
| — | — | `changelog` (stream) | Steward posts one dated changelog entry per change (draft -> human approve) |
| — | — | `shared-files` (stream) | Canonical shared files mirrored from the repo; canvas is the index; NIP-23 notes per file |

Program details live in [`programs/*.md`](../programs/). Create the relay objects with
`scripts/setup-programs.sh` (needs `BUZZ_PRIVATE_KEY` in the environment).

## Telepathy agents — JTBD interfaces

| Agent | JTBD stage | May | Must not | Runtime |
|---|---|---|---|---|
| `@telepathy` (primary) | route | Route intent to the narrowest agent | Publish without approval; invent interfaces | opencode2 / desk |
| `@prime` | propose, scope | Draft a job proposal (owner, reviewer, acceptance) | Execute, activate, publish, accept, resolve | desk |
| `@build` | implement, verify | Implement in worktree, record verification evidence, draft artifact review | Accept own work, merge, resolve, publish | desk (codex or opencode2) |
| `@steward` | resolve, project | Draft resolutions, changelog, activity projections | Author posts, change accepted history, send | desk |
| `@research` | research | Retrieve sources, draft dossiers with source maps | Assert unverified claims, publish | desk |
| `@relationships` | draft-external | Draft external messages from approved context | Send, record sent without delivery evidence | desk |

Boundary rule (enforced by charters + permission gates): **tools prepare, humans accept.**
No interface may activate its own Job, accept its own artifact, resolve a Job, or speak as a person.

## Buzz agents — the Nest front desk

Names as registered in the Buzz Nest (`~/.buzz/AGENTS.md`). Personas are owned in Buzz Desktop.

| Buzz agent | Proposed pairing | Notes |
|---|---|---|
| Pollen | `@prime` + `@research` | Gather context, scope proposals, research |
| Fizz | `@build` | Execution energy, candidate production |
| Honey | `@steward` | Consolidation, receipts, projections |

This pairing is a proposal, not yet authoritative — confirm each agent's persona in Buzz Desktop,
then either keep this table or replace it with the real split.

## Runtimes

| Runtime | What it runs | Where |
|---|---|---|
| `runtime/desk` | The job engine: SQLite jobs/artifacts/outbox/cursors, Buzz poll + ingest, worktrees, dispatch | `telepathy/runtime/desk` |
| opencode2 (v2 pilot) | Interactive planning sessions only — service healthy but free zen models are unavailable for execution (`ModelUnavailable`) | `~/.local/share/intuitxn-opencode-v2` via `runtime/opencode-v2/run.sh` |
| codex CLI | Sandboxed execution worker (`codex exec --json`) | local install |

## JTBD lifecycle

```text
Proposed -> Ready -> Active -> Waiting -> Review -> Resolved | Cancelled
```

Buzz is the human surface; the desk ledger is execution truth; git holds accepted revisions.

| Stage | Buzz surface | Desk ledger |
|---|---|---|
| Proposed / Ready | Issue created on the program repo, or `/intuitxn {json}` message in the home channel | job `queued` |
| Active | Issue assigned; thread updated | job `running`, worktree created |
| Waiting / Review | Candidate + evidence posted to the thread | artifact drafted |
| Resolved | Human accepts; issue `resolved`; outcome reply in thread | artifact accepted, outbox `sent` |
| Cancelled | Issue `closed` | job `cancelled` |

## The loop — working from Buzz on a JTBD

1. **Human asks** in the program's home channel: either an issue on the program repo, or a message starting with `/intuitxn ` followed by JSON (`repository`, `request`, `acceptance`, optional `runtime`).
2. **desk polls** the configured channels, deduplicates by source event id, and creates a job.
3. **Runtime executes** in a git worktree at the accepted base revision (codex or opencode2 per job).
4. **Candidate + evidence** returns: changed files, verification results, unresolved issues, exact revision.
5. **Human reviews and accepts** in the Buzz thread — acceptance is a named human at an exact revision.
6. **Steward projects** the outcome: resolution, changelog, activity; the outbox replies to the original thread.

## Where state lives

| State | Store |
|---|---|
| Human requests, acceptance, receipts | Buzz relay |
| Job state, outbox, cursors | desk SQLite (`.local/desk.sqlite`) |
| Instructions, source, accepted revisions | git |
| Secrets (BUZZ_PRIVATE_KEY, provider keys) | runtime env only — never in git, never in Buzz posts |
