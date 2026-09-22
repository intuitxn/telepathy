# Agent directory and information-flow map

Draft. Canonical inventory of the Intuitxn/Telepathy agents, the session kinds
that carry their work, and a numbered map of how information actually moves
through the system. Every transition cites the exact command or function with
`file:line`.

Authority and status:

- Charters in `.opencode/agents/` are the single source of truth for agent
  names and behaviour.
- `plugins/telepathy-meta-agents/registry.json` mirrors five of the nine
  charters as a declarative catalog. `@telepathy`, `@bend-forge`,
  `@relay-keeper` and `@meta` are charter-only and have no registry entry;
  nothing here is invented to fill a gap.
- `plugins/telepathy-meta-agents/bend-specialist.md` is an unmerged draft whose
  own text says registry wiring is an owner edit. It is **not** a canonical
  agent and is not listed below.
- Session identity is described by mechanism only. No session IDs, pubkeys,
  receipts, prompts, transcripts or job IDs appear in this document.
- This document is a draft. It creates no external effect and authorizes no
  publication, relay write, or commit.

Related: [`AGENT_MAP.md`](AGENT_MAP.md) · [`AGENT_ROLES.md`](AGENT_ROLES.md) ·
[`INDEX.md`](INDEX.md) · [`PROJECTS.md`](PROJECTS.md).

---

## Part A1 — Canonical agents

| # | Canonical | Charter | JTBD | Mode | Runtime |
|---|---|---|---|---|---|
| A1.1 | `@telepathy` | `.opencode/agents/telepathy.md` | route | primary | opencode (desk optional) |
| A1.2 | `@prime` | `.opencode/agents/prime.md` | propose, scope | subagent | desk |
| A1.3 | `@build` | `.opencode/agents/build.md` | implement, verify | subagent | desk (codex or opencode) |
| A1.4 | `@steward` | `.opencode/agents/steward.md` | resolve, project, learn | subagent | desk |
| A1.5 | `@research` | `.opencode/agents/research.md` | research | subagent | desk |
| A1.6 | `@relationships` | `.opencode/agents/relationships.md` | draft-external | subagent | desk |
| A1.7 | `@bend-forge` | `.opencode/agents/bend-forge.md` | prove (Bend) | subagent | local Bend |
| A1.8 | `@relay-keeper` | `.opencode/agents/relay-keeper.md` | infra health | subagent | local / host |
| A1.9 | `@meta` | `.opencode/agents/meta.md` | orchestrate | primary | opencode |

Registry mirror status (from `plugins/telepathy-meta-agents/registry.json`):
`prime` (:4), `build` (:29), `steward` (:54), `research` (:81),
`relationships` (:104). All five are `status: planned` and point at the same
charter paths. No registry entry exists for A1.1, A1.7, A1.8, A1.9.

Retired names (do not use): `@atlas`→`@prime`, `@forge`→`@build`,
`@ledger`→`@steward`, `@scout`→`@research`, `@diplomat`→`@relationships`
(`docs/AGENT_ROLES.md:8-10`).

### Per-agent authority

Each entry states what the agent **may** do and what it **must not** do. Charters
carry a shared boundary: agents draft, humans accept; no agent accepts its own
artifact, resolves a job, publishes, or sends externally.

**A1.1 `@telepathy`** — primary entry point (`.opencode/agents/telepathy.md:1-3`).
- May: route intent to the narrowest meta-agent (`:13-24`), compose drafts with the
  `telepathy_*` tools (`:40-44`), own routing memory (`:69-74`).
- Must not: publish without approval (`:33-34`), break the human-owned outcome rule
  (`:28-29`), expose agent internals — no transcripts, prompts, tool calls, `:37-38`.

**A1.2 `@prime`** — project steward (`.opencode/agents/prime.md:1-3`).
- May: read accepted context and prior decisions (`:11-13`), draft a job proposal as a
  `telepathy_post` with owner, reviewer, acceptance (`:14-16`).
- Must not: activate or execute work, publish a post, accept an artifact, resolve a
  job, send externally (`:18-23`).

**A1.3 `@build`** — builder (`.opencode/agents/build.md:1-3`).
- May: implement in the owning repo worktree (`:12-13`, `:57-65`), run verification and
  record evidence (`:14`, `:27-30`), draft a `telepathy_artifact` review request (`:15-16`).
- Must not: accept its own artifact, merge without review, resolve the job, publish,
  send externally (`:18-23`).

**A1.4 `@steward`** — release keeper (`.opencode/agents/steward.md:1-3`).
- May: read accepted context/artifacts (`:12`), draft a resolution (`:13`), draft a
  change/announcement post (`:14-16`), prepare changelog and `activity/` projections
  (`:16-17`), draft `HARNESS_STATE.md` lessons (`:57-68`).
- Must not: author or publish posts, accept artifacts, change accepted history, send
  externally (`:19-23`).

**A1.5 `@research`** — research scout (`.opencode/agents/research.md:1-3`).
- May: retrieve and cite sources (`:12-13`), draft a dossier with a source map and
  stated uncertainty (`:14-16`).
- Must not: state an unverified claim as fact, accept artifacts, publish, send
  externally, present its own summary as a human conclusion (`:18-22`).

**A1.6 `@relationships`** — relationship desk (`.opencode/agents/relationships.md:1-3`).
- May: draft an external message from explicitly approved context, citing sources
  (`:12-13`), note recipient, evidence and privacy boundary (`:14-16`).
- Must not: send externally, record sent without verified delivery, expose unapproved
  context (`:18-23`).

**A1.7 `@bend-forge`** — Bend algorithm designer (`.opencode/agents/bend-forge.md:1-3`).
- May: write Bend defs, laws and proofs (`:13-15`), gate and run with the absolute-path
  binary and telemetry off (`:16-23`), parallelize with fork-join (`:24-26`).
- Must not: self-accept (`:32-34`), merge/tag/resolve or write git beyond the draft
  `PROOF.bend` (`:35-36`), touch network/credentials/transcripts/private IDs (`:37-38`),
  invent digests (`:39-40`), send externally (`:41`).

**A1.8 `@relay-keeper`** — node networking and infra health (`.opencode/agents/relay-keeper.md:1-3`).
- May: run read-only health checks (`python3 scripts/workspace-service.py status`,
  `npm run doctor`, tunnel/port probes, route reads) (`:12-14`), read service logs
  (`:15`), restart only the user-domain workspace service (`:16`), draft infra change
  proposals with rollback notes (`:17`).
- Must not: publish, accept, resolve (`:21`), send externally (`:22`), touch
  credentials or membership (`:23`), rewire network / open ports / merge-push (`:24`),
  restart anything outside the user-domain service (`:25`).

---

## Part A2 — Session kinds and identity

| # | Session kind | Identity mechanism | Where state lives | Lifetime |
|---|---|---|---|---|
| A2.1 | Telepathy peers | `sessionID`; display name `<agent>:<id8>` | `~/.config/opencode/telepathy/` | ephemeral coordination; registry disposable |
| A2.2 | OpenCode server sessions | server-issued session ID | server `run/` + `logs/`, session store | live, disposable |
| A2.3 | Desk job sessions | codex `thread_id`, or `opencode run` submission label | `.local/desk.sqlite` + `.local/jobs/<id>/` | job durable, worktree disposable |
| A2.4 | Bend worker snapshots | numeric event id within one snapshot lineage | caller-supplied private snapshot files | durable evidence, single writer |

**A2.1 Telepathy peers.** A peer *is* a `sessionID`; its display name is
`<agent>:<id8>` where `id8` is the first 8 characters of the session ID
(`~/.config/opencode/plugins/telepathy.ts:101-103`). Peers self-register on
`session.created` and on any telepathy tool call (`:175-181`, `:165-166`). State:
`peers.json` (registry keyed by `sessionID`, `:79-99`), `mailboxes/<peer>.jsonl`
(append-only, `:106-120`), `cursors/<peer>.json` (per-peer read cursor,
`:122-129`), `events.jsonl` (workspace event log, `:197`). The store is explicitly
described as disposable — stop the server, remove it, restart
(`~/.config/opencode/server/ARCHITECTURE.md:185-186`). Addressable by agent role,
peer name, session id, id prefix, or `all` (`telepathy.ts:131-144`).

**A2.2 OpenCode server sessions.** A headless server (`opencode serve`, loopback
`127.0.0.1:4096`, project `~/Desktop/Attri`) owns sessions, agents and tools;
the telepathy plugin runs beside it (`ARCHITECTURE.md:15-30`, `:53-75`). Two spawn
paths: the **Task tool** (parallel subagents inside the current session, sharing
its context) and **server sessions** via `client.session.create()` for
independently attachable agents; both register as telepathy peers
(`ARCHITECTURE.md:139-144`). State: `server/run/server.pid`,
`server/run/server.json`, `server/logs/opencode-server.log` (`:70-71`). Session
state is live/disposable; durable knowledge belongs to the memory-store or the
vault (`ARCHITECTURE.md:32-40`, `:150-152`).

**A2.3 Desk job sessions.** `runtime/desk` runs one job per execution in a
detached worktree. Codex records `event.thread_id` as `job.sessionID`
(`runtime/desk/src/jobs.js:37`); the opencode path records
`submission: 'opencode-run'` and a saved stdout/stderr instead (`jobs.js:43-56`,
`:52`). Durable state is the SQLite ledger `.local/desk.sqlite` — tables `jobs`,
`artifacts`, `outbox`, `cursors` (`runtime/desk/src/core.js:19-29`). The job folder
`.local/jobs/<id>/` (worktree, `brief.md`, `result.md`, `events.jsonl`,
`changes.patch`) is a disposable candidate (`jobs.js:15-22`, `:29`, `:57-60`;
`docs/HARNESS_STATE.md:16`).

**A2.4 Bend worker snapshots.** The one-file Lorenz worker
(`runtime/worker/system.bend`) keeps a single-writer immutable snapshot lineage:
every command takes `IN OUT`, and each `OUT` must be new
(`system.bend:1828-1829` help text; `runtime/worker/README.md:36-44`). Identity
is the numeric event id within one history plus the sequence number
`n = 1 + lorenz_size(history)` assigned at each commit (`system.bend:1515`,
`:1520`, `:1537`, `:1554`). State is caller-supplied private files; there are no
locks, no atomic writes, no authenticated actor labels, and no automatic merge
across branches (`runtime/worker/README.md:41-44`).

---

## Part B — Information-flow / trajectory map

Conventions: a **hop** is one transition, labelled **[durable]** (survives the
session and is the record of truth) or **[ephemeral]** (transient coordination or
a disposable candidate). The *store* column names where the hop's output lives.
Ordering/dedupe rules are stated after each trajectory.

### T1 — Human request → desk poll/ingest → job

| Hop | Source → Sink | Store | Transition (file:line) | Lifetime |
|---|---|---|---|---|
| T1.1 | authorized human post → parsed intake | Buzz relay event | `ingest()` `runtime/desk/src/buzz.js:34-49` | durable relay; job durable |
| T1.2 | relay page → new job row | desk SQLite `jobs` | `newJob()` `buzz.js:46` → `core.js:76-85` | durable |
| T1.3 | channel history → cursor advance | desk SQLite `cursors` | `poll()` `buzz.js:50-70` (read `:53`, write `:67`) | cursor durable, page ephemeral |
| T1.4 | queued job → owner notification | desk SQLite `outbox` → relay | `cli.js:86-88` → `notify()` `buzz.js:89-94` | draft durable until sent |

Details: `ingest` admits only events whose pubkey is in `authorizedPubkeys` and
whose content starts with `/intuitxn ` (`buzz.js:37`), whose id is a 64-hex
event id (`:38`), that parse to JSON with `request` and `acceptance` (`:40-41`),
that name a configured repository (`:42`), and that select `codex` or `opencode`
(`:45`). It writes `source = ${channel}:${event.id}` (`:46`).

**Ordering / dedupe.** `jobs.source` is a `UNIQUE` column
(`core.js:24`); `newJob` returns the existing row when the source already exists
(`core.js:80-83`). `poll` deliberately re-reads a 1-second overlap on every pass
and relies on that unique constraint to deduplicate (`buzz.js:62-63`). Each
channel keeps its own cursor (`cursors` table, `:53`, `:67`); a saturated page
fails without advancing the cursor (`:59`).

### T2 — Job → runtime session → candidate

| Hop | Source → Sink | Store | Transition (file:line) | Lifetime |
|---|---|---|---|---|
| T2.1 | queued job → claimed job | desk SQLite | `claim()` `runtime/desk/src/jobs.js:6-10` | durable |
| T2.2 | accepted base rev → detached worktree | `.local/jobs/<id>/worktree` | `runJob()` `jobs.js:20-22` | ephemeral candidate |
| T2.3 | job + sha256 context → brief | `.local/jobs/<id>/brief.md` | `brief()` `jobs.js:11-13`, write `:29` | ephemeral |
| T2.4 | brief → codex/opencode run | job folder + SQLite | codex `jobs.js:32-42`; opencode `:43-56` | session ephemeral |
| T2.5 | run output + diff → needs_review | `.local/jobs/<id>/result.md`, `changes.patch` | `jobs.js:57-61` | durable candidate |

Details: the job's repository must be in `cfg.repositories` (`jobs.js:19`); the
base is `git rev-parse HEAD` (`:20`); context files are confined to the repo,
sha256-pinned, and capped at 120 KB (`:23-27`). Codex runs sandboxed
`workspace-write` with `BUZZ_PRIVATE_KEY`/`BUZZ_AUTH_TAG` stripped (`:34-35`);
the opencode path uses the installed CLI and normal config
(`runtime/desk/src/runtime.js:1-9`, `jobs.js:46-48`). Failure records
`needs_attention` with the error (`jobs.js:62-65`).

**Ordering / dedupe.** Claim is exclusive and once: the update only matches
`state='queued'` and errors otherwise (`jobs.js:7-8`, covered by
`runtime/desk/test/core.test.js:32`). A retry clears stale `error`/`stopped`
fields (`jobs.js:17`). Independent snapshot branches do not provide a global
claim; the guarantee is per-ledger.

### T3 — Candidate → human accept → projection → learning

| Hop | Source → Sink | Store | Transition (file:line) | Lifetime |
|---|---|---|---|---|
| T3.1 | candidate → thread notification | `outbox` → relay | `cli.js:92` | draft durable |
| T3.2 | `accept` reply → matched job | relay event → memory | `acceptEvents()` `buzz.js:72-87` | ephemeral match |
| T3.3 | accepted job → resolved + commit/push | git accepted revision | `landJob()` `jobs.js:76-101`; `acceptJob()` `:68-74` | durable |
| T3.4 | accepted outcome → activity event | `activity/<project>/<year>/<month>/<event-id>.md` | draft only — `docs/SOP.md:17-19`, `activity/README.md` | durable projection |
| T3.5 | accepted outcome → changelog | `CHANGELOG.md` + changelog channel | draft only — `SOP.md:38-46`, `docs/AGENT_MAP.md:46` | durable |
| T3.6 | accepted outcome → lesson / engram | `docs/HARNESS_STATE.md`; Buzz memory | draft only — `docs/HARNESS_STATE.md:49-63`, `runtime/worker/BUZZ.md:60-79` | durable |

Details: `acceptEvents` admits only authorized pubkeys, only content matching
`/^accept\b/i`, and only when the reply’s thread root matches an open
`needs_review` job’s `threadRoot` or `sourceEvent` (`buzz.js:76-82`). `landJob`
requires `needs_review`, copies the worktree changes into the main repo, commits
with the reviewer named, pushes `origin` and `buzz`, then resolves the job via
`acceptJob` (`jobs.js:78-100`). `acceptJob` only transitions `needs_review →
resolved` (`jobs.js:70`) and records the named reviewer (`:73`).

**Projection is draft-only.** There is no projection command; `@steward` drafts
resolutions, changelog entries and `activity/` files for human review
(`steward.md:12-23`). Idempotency key is the source event id — retrying the same
source event must not create a duplicate, and corrections append a new event
(`activity/README.md`; `docs/SOP.md:19`). A projection failure is retryable and
never rolls back accepted truth (`steward.md:32`).

**Ordering / dedupe.** Accept-once: `acceptJob`’s guarded update means an
already-resolved job cannot be accepted twice (`jobs.js:70-71`). Outbound
ordering is claim-once in the outbox (`buzz.js:20-21`); a failed send is marked
`uncertain` and is never auto-resent (`buzz.js:30`, test at
`runtime/desk/test/core.test.js:26`).

### T4 — Intra-node: orchestrator → Task subagents → telepathy mailbox

| Hop | Source → Sink | Store | Transition (file:line) | Lifetime |
|---|---|---|---|---|
| T4.1 | session created → registered peer | `peers.json` | `telepathy.ts:175-181` | ephemeral, disposable |
| T4.2 | orchestrator → Task/server subagents | server sessions | `ARCHITECTURE.md:139-144` | ephemeral |
| T4.3 | agent handoff → recipient mailbox | `mailboxes/<peer>.jsonl` | `telepathy_send` `telepathy.ts:248-296` (append `:284`) | ephemeral |
| T4.4 | mailbox → system prompt on next turn | cursor advance | passive injection `telepathy.ts:204-222` | ephemeral |
| T4.5 | deliberate read / ack | cursor advance | `telepathy_inbox` `:298-317`; `telepathy_ack` `:319-327` | ephemeral |

**Ordering / dedupe.** Each peer has a per-peer read cursor at
`cursors/<peer>.json` (`telepathy.ts:122-129`); injection injects only
`messages.slice(cursor)` and then advances the cursor to `messages.length`
(`:207-218`). This is a per-channel cursor, not a global clock. `telepathy_send`
appends to the target’s append-only mailbox and never edits prior lines
(`:284`). Peers are only as live as their `lastSeen`; presence flips to `stale`
past a fixed window (`:28`, `:335-337`). Telepathy is coordination, explicitly
separated from durable memory-store knowledge (`ARCHITECTURE.md:32-36`,
`:166-174`).

### T5 — `/meta` worker path: init → capture → work → worker → claim → packet → return → learn

Coordinator: one writer per snapshot lineage (`runtime/adaptive/META.md:66-73`;
`runtime/worker/README.md:36-44`). Every transition reads `IN`, writes a new
`OUT`.

| Hop | Source → Sink | Store | Transition (file:line) | Lifetime |
|---|---|---|---|---|
| T5.1 | no state → empty history | private snapshot | `init` → `lorenz_dispatch_pair` `runtime/worker/system.bend:1911-1920`; `lorenz_save` | durable snapshot |
| T5.2 | task request → retained conversation | snapshot | `capture` `system.bend:1374-1377` | durable |
| T5.3 | conversation → queued work | snapshot (kind 4) | `work` `system.bend:1445-1448`, `lorenz_work_found:1433-1436` | durable |
| T5.4 | — → registered worker | snapshot (kind 5) | `worker` `system.bend:1512-1515` | durable |
| T5.5 | work + worker → exclusive claim | snapshot (kind 6) | `claim` `system.bend:1529-1532`, `lorenz_claim_found:1517-1520` | durable |
| T5.6 | claimed work → bounded packet | printed task data | `packet` `system.bend:1595-1599`, fields `:1573-1576` | ephemeral |
| T5.7 | packet → delivered prompt | loopback HTTP | `opencode` `system.bend:1823-1826`; request `:1634-1635` | ephemeral |
| T5.8 | result → reported result | snapshot (kind 7) | `return` `system.bend:1546-1549`, `lorenz_return_found:1534-1537` | durable |
| T5.9 | selected result → learned memory | snapshot (kind 8) | `learn` `system.bend:1566-1569`, `lorenz_learn_found:1551-1554` | durable |

Details: each commit stamps `n = 1 + lorenz_size(history)` and links cause via
`c` (conversation/reference) and `d` (dependency event id) — worker `:1515`,
claim `:1520`, return `:1537`, learn `:1554`. `return` sets the dependency to the
claim’s event id and the result id to the returned event (`:1537`). `learn`
records the selected result id and an explicit dependency (0 = none)
(`:1554`, help `:1829`). The connector validates the session id shape and sends
`POST /session/<id>/prompt_async` to loopback (`:1624-1635`); HTTP 204 is an
acknowledgement, **not** completion (`:1601-1604`, help `:1829`), and an
ambiguous timeout must not be blindly retried (`runtime/worker/README.md:41-44`).

Command templates: `runtime/adaptive/META.md:58-65` (`init`, `capture`, `work`,
`worker`, `claim`, `packet`), `:86` (`opencode`), `:99` (`return`), `:107`
(`learn`). Resolution rule for the worker source is META.md:17-36; the packaged
source `runtime/worker/system.bend` qualifies (its `-- help` lists `worker`,
`claim`, `packet`, `return`, `learn`).

**Ordering / dedupe.** Ordering is a per-lineage Lamport-style sequence: the
next event number is `1 + size(history)`, and causal edges are carried by the
`reference`/`dependency` fields (`system.bend:1515`, `:1520`, `:1537`, `:1554`).
Claim-once is enforced by ownership within one history (wrong worker rejected;
`runtime/worker/protocol.test.mjs:17`, `runtime/worker/README.md:17-20`).
`OUT` must be a new path; reuse of an existing output fails
(`protocol.test.mjs:23`). For an out-of-snapshot retained finding, use Buzz
native memory, not the snapshot: `buzz mem` reads and reviewed writes
(`runtime/worker/BUZZ.md:60-79`), which does **not** merge snapshots or inherit
dependency checks (`runtime/worker/BUZZ.md:120-132`).

### T6 — Retained learning (historical registry / evaluator)

| Hop | Source → Sink | Store | Transition (file:line) | Lifetime |
|---|---|---|---|---|
| T6.1 | candidate core → offline evaluation | private temp run dir | `node --test runtime/lorenz/evaluate.test.mjs` — `runtime/lorenz/README.md:21`, `:35-43` | ephemeral run, retained report |
| T6.2 | selected finding → Buzz engram | Buzz memory (owner-scoped) | `buzz mem set/patch` — `runtime/worker/BUZZ.md:70-79` | durable |
| T6.3 | accepted outcome → human lesson log | `docs/HARNESS_STATE.md` | draft only — `docs/HARNESS_STATE.md:49-63`; `steward.md:57-68` | durable |

Historical note: the custom JavaScript shared registry is retired
(`runtime/adaptive/HARNESS.md:27-41`; `runtime/worker/README.md:46-50`). Its
historical identifier/evaluator names are retained only as evidence
(`runtime/lorenz/README.md:35-43`). Buzz engrams do **not** reproduce that
registry’s admission/rollback/revocation guarantees (`HARNESS.md:33-35`), and
engrams are attribution, not proof that a worker answer is correct
(`BUZZ.md:84-85`).

---

## Part C — Trajectories most worth observing

Ranked by how much a single observation tells you about system health. Each
names the signal it reveals.

1. **T2.1 claim + T1.3 cursor/dedupe** — reveals duplicate execution and intake
   drift. Watching claim-once (`jobs.js:7`) and the `source` unique constraint
   (`core.js:24`, `buzz.js:62-63`) shows whether the same relay request is being
   run twice or silently dropped by a stalled per-channel cursor.
2. **T3.2–T3.3 accept → land** — reveals authorization and truth-integrity
   failures. The signal is whether only authorized pubkeys matching
   `root`/`sourceEvent` can resolve a `needs_review` job, and whether
   commit+push+resolve happen atomically (`buzz.js:76-82`, `jobs.js:70-100`).
3. **T4 telepathy mailbox + cursor** — reveals lost or duplicated handoffs
   between the orchestrator and its subagents. The signal is cursor lag and
   mailbox growth per peer (`telepathy.ts:122-129`, `:204-222`).
4. **T5.8–T5.9 return vs learn** — reveals unverified work being treated as
   learned. The signal is whether a reported result exists before an explicit
   `learn`, and whether the learned entry’s dependency is real
   (`system.bend:1534-1554`; `runtime/worker/README.md:28-32`).
5. **T3.4–T3.6 projection vs accepted revision** — reveals accepted truth
   diverging from its changelog/activity/lesson projections. The signal is
   whether projections cite the exact accepted revision and use the source event
   id as their idempotency key (`activity/README.md`, `docs/SOP.md:19`).
6. **T5.7 connector acknowledgement** — reveals delivery/completion confusion.
   The signal is that a 204 is only submission, so a timeout must be inspected
   rather than retried (`system.bend:1601-1604`, `:1829`).

---

## Part D — Verification and outstanding work

Verification actually run while drafting this document (checkout
`/Users/a3fckx/Desktop/Attri/telepathy-shared-learning`):

- `npm run check` → `node --test runtime/desk/test/*.test.js`: **12 tests, 12
  pass, 0 fail**. Covers intake/claim-once (`core.test.js:32`), worktree
  isolation (`jobs.test.js:9`), review-gated accept (`jobs.test.js:20`), land
  (`jobs.test.js:35`), accept matching (`jobs.test.js:53`), and the native
  OpenCode CLI path (`opencode.test.js:10`).
- Worker source resolution and check:
  `BEND_NO_TELEMETRY=1 ~/.bend/bin/bend runtime/worker/system.bend --check-only`
  → `All terms check.`; `-- help` lists `worker`, `claim`, `packet`, `return`,
  `learn` (`bend 2.0.21`).
- A full local `/meta` lineage (`init → capture → work → worker → claim →
  packet → return → learn`) was executed once by the coordinator in a private
  single-writer temp directory. The packet rendered bounded task data and active
  memory; the final history showed kinds 1, 4, 5, 6, 7, 8 with the expected
  reference/dependency edges. This is protocol-execution evidence, not a code
  bundle and not human acceptance.

Outstanding work (not done here, by design):

- The projection steps T3.4–T3.6, T6.3 have **no command**; `@steward` drafts
  them for human review. A future task could make the `activity/` projection a
  checked transition with the source event id as its idempotency key.
- This document is a draft: no Buzz/relay write, no publication, no commit.
- A machine-readable JSON companion was not produced; if added it must be
  derived verbatim from the tables in Parts A1/A2 and B.

### Cross-references

Cross-linked from [`AGENT_MAP.md`](AGENT_MAP.md) and [`INDEX.md`](INDEX.md).
