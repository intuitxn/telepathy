# DRAFT — `@steward` projection steps for gaps T3.4–T3.6 and T6.3

Status: draft, agent-authored · **Not published, not sent, not committed.** This
document creates no external effect and authorizes no publication, relay write,
or commit. It is written for human review.

Question under examination: `docs/AGENT_DIRECTORY.md` marks the projection hops
T3.4, T3.5, T3.6 and T6.3 as having **no command**, only human-reviewed
`@steward` drafts. What is the concrete `@steward` projection step for each, with
its input, output store/path, exact command or file edit, and human gate — and
which parts already exist?

Cross-links: [`docs/AGENT_DIRECTORY.md`](../../AGENT_DIRECTORY.md) ·
[`activity/README.md`](../../../activity/README.md) ·
[`docs/SOP.md`](../../SOP.md) · [`SOP.md`](../../../SOP.md) ·
[`CHANGELOG.md`](../../../CHANGELOG.md) ·
[`docs/HARNESS_STATE.md`](../../HARNESS_STATE.md) ·
[`docs/AGENT_MAP.md`](../../AGENT_MAP.md) ·
[`.opencode/agents/steward.md`](../../../.opencode/agents/steward.md) ·
[`runtime/worker/BUZZ.md`](../../../runtime/worker/BUZZ.md) ·
[`runtime/adaptive/META.md`](../../../runtime/adaptive/META.md) ·
[`PRODUCT.md`](../../../PRODUCT.md).

## 0. Evidence base

| Item | Value | Evidence |
|---|---|---|
| Checkout | `/Users/a3fckx/Desktop/Attri/telepathy-shared-learning` | symlink `~/.config/opencode/commands/meta.md` → `.opencode/commands/meta.md` |
| Worker source | `runtime/worker/system.bend` | resolved per `runtime/adaptive/META.md:17-25`; `-- help` lists `worker`, `claim`, `packet`, `return`, `learn` |
| Source digest | sha256 `6e224e26d47c56d3601b26b55ae77497ab4680cacda89846640380a1d9e69d74` | `shasum -a 256`; matches `runtime/worker/README.md:5` |
| Toolchain | Bend 2.0.21, `~/.bend/bin/bend` | `bend version` |
| Checker | `runtime/worker/system.bend --check-only` → `All terms check.` | run in this session |
| Protocol test | `node --test runtime/worker/protocol.test.mjs` → 2/2 pass | run in this session |
| Desk check | `npm run check` → 12/12 pass | run in this session (`package.json:17`) |
| Projection command | **none exists** | only `.opencode/commands/meta.md` is installed; no script writes `activity/`, `CHANGELOG.md` or `docs/HARNESS_STATE.md` |
| Activity validator | **missing** | `.github/workflows/activity-integrity.yml` calls `node plugins/telepathy-meta-agents/scripts/validate.mjs`, but that file does not exist in the checkout |

## (a) The gap hops exactly as `AGENT_DIRECTORY.md` records them

Restated verbatim from the source table rows.

| Hop | Recorded row (verbatim) | Cite |
|---|---|---|
| T3.4 | `accepted outcome → activity event` → store `` `activity/<project>/<year>/<month>/<event-id>.md` `` → `draft only — docs/SOP.md:17-19, activity/README.md` → `durable projection` | [`docs/AGENT_DIRECTORY.md:225`](../../AGENT_DIRECTORY.md) |
| T3.5 | `accepted outcome → changelog` → store `` `CHANGELOG.md` + changelog channel `` → `draft only — SOP.md:38-46, docs/AGENT_MAP.md:46` → `durable` | [`docs/AGENT_DIRECTORY.md:226`](../../AGENT_DIRECTORY.md) |
| T3.6 | `accepted outcome → lesson / engram` → store `` `docs/HARNESS_STATE.md`; Buzz memory `` → `draft only — docs/HARNESS_STATE.md:49-63, runtime/worker/BUZZ.md:60-79` → `durable` | [`docs/AGENT_DIRECTORY.md:227`](../../AGENT_DIRECTORY.md) |
| T6.3 | `accepted outcome → human lesson log` → store `` `docs/HARNESS_STATE.md` `` → `draft only — docs/HARNESS_STATE.md:49-63; steward.md:57-68` → `durable` | [`docs/AGENT_DIRECTORY.md:321`](../../AGENT_DIRECTORY.md) |

Supporting restatements of the same "no command" status:

- "**Projection is draft-only.** There is no projection command; `@steward`
  drafts resolutions, changelog entries and `activity/` files for human review"
  — [`docs/AGENT_DIRECTORY.md:237-238`](../../AGENT_DIRECTORY.md).
- "The projection steps T3.4–T3.6, T6.3 have **no command**; `@steward` drafts
  them for human review. A future task could make the `activity/` projection a
  checked transition with the source event id as its idempotency key."
  — [`docs/AGENT_DIRECTORY.md:386-388`](../../AGENT_DIRECTORY.md).
- Observation rank 5: the signal is "whether projections cite the exact accepted
  revision and use the source event id as their idempotency key"
  — [`docs/AGENT_DIRECTORY.md:353-356`](../../AGENT_DIRECTORY.md).

Pointer notes (truthful, non-blocking): the row citations embedded in the hops
point at third documents; the `activity` pointer resolves to
`docs/SOP.md:17-19` and `activity/README.md`; the `changelog` pointer
`SOP.md:38-46` resolves to root `SOP.md` section 7 ("Record product changes"),
while `docs/AGENT_MAP.md:46` points at the `telepathy` program-row — the
`changelog` channel row is actually `docs/AGENT_MAP.md:50`. The `lesson`
pointers `docs/HARNESS_STATE.md:49-63` resolve to the historical status
table/open-gaps block; the actual lesson-log convention is
`docs/HARNESS_STATE.md:69-83`.

## (b) Proposed `@steward` projection step per target

Common input for every step is the **accepted outcome**: a named human's
acceptance statement plus the **exact accepted revision** (the merged commit /
artifact revision) and the **source event id** of the originating request. The
source event id is the idempotency key for every projection
([`activity/README.md:13`](../../../activity/README.md),
[`docs/SOP.md:19`](../../SOP.md)). Every step below is a **draft prepared by
`@steward`, landed only by a named human.**

### P1 — accepted outcome → activity event (hop T3.4)

- **Input:** accepted revision (commit SHA) + source event id + human
  initiator, owner, reviewer, verification evidence, limitations, next action.
- **Output store/path:** new immutable file
  `activity/<project>/<year>/<month>/<event-id>.md`
  ([`activity/README.md:9-11`](../../../activity/README.md)).
- **Exact edit (no command exists):** `@steward` **creates a new file** with the
  fixed field set required by
  [`activity/README.md:15`](../../../activity/README.md) — human initiator,
  owner, reviewer, exact artifact revision, verification evidence, limitations,
  next action. It MUST NOT overwrite. The concrete idempotency guard is a
  path-existence check before writing, e.g.
  `test -e "activity/<project>/<year>/<month>/<event-id>.md"`; if the file
  exists, stop and append a **new correction event** instead
  ([`activity/README.md:13`](../../../activity/README.md),
  [`docs/SOP.md:19`](../../SOP.md)). The draft is presented as an uncommitted
  diff for review; `@steward` does not commit.
- **Human gate:** a named human reviews the draft diff against the accepted
  revision and lands it through normal Git review/commit; the reference
  validator (see §d) may then check the tree.
- **Status:** format/contract **implemented** (`activity/README.md`,
  `docs/SOP.md:17-19`, plus the declared `activity-integrity` workflow); the
  write step and its idempotency guard are **newly proposed**; the referenced
  validator is **missing**.

### P2 — accepted outcome → changelog entry (hop T3.5)

- **Input:** accepted revision + a human-readable, plain-language statement of
  what changed and why it matters (Added / Improved / Fixed).
- **Output store/path:** one dated entry under `## [Unreleased]` in
  [`CHANGELOG.md`](../../../CHANGELOG.md) (subsections Added/Changed/Fixed,
  `CHANGELOG.md:3-26`), plus an optional draft post to the relay `changelog`
  stream ([`docs/AGENT_MAP.md:50`](../../AGENT_MAP.md),
  [`scripts/canvas-changelog.md`](../../../scripts/canvas-changelog.md)).
- **Exact edit (no command exists):** `@steward` **edits `CHANGELOG.md`**:
  insert one bullet in the correct subsection with the exact revision link and
  no "planned work as shipped" claim
  ([`SOP.md:38-46`](../../../SOP.md),
  [`CHANGELOG.md:29`](../../../CHANGELOG.md)). The relay post is only a **draft
  message** prepared for the owner; it is not sent by the agent.
- **Human gate:** a named human reviews wording, category and revision link,
  commits the `CHANGELOG.md` edit, and (separately, as the owner-controlled
  sender) posts the changelog entry to the `changelog` channel.
- **Status:** the `CHANGELOG.md` file and the `changelog` stream/canvas exist
  (**implemented**, provisioned at `scripts/setup-programs.sh:95,113`); the
  `@steward` edit step and channel-post draft are **newly proposed**.

### P3 — accepted outcome → relay thread resolution

- **Input:** accepted revision + the originating job thread + resolution
  outcome (`completed` / `no_change`) and next action.
- **Output store/path:** the resolution reply on the originating Buzz thread.
  In the optional Desk path this is an `outbox` row in `.local/desk.sqlite`
  ([`docs/AGENT_DIRECTORY.md:176-179`](../../AGENT_DIRECTORY.md),
  [`docs/AGENT_DIRECTORY.md:223`](../../AGENT_DIRECTORY.md)); otherwise it is a
  private `@steward` draft file. Relay write authority stays with the human /
  owner-controlled signer.
- **Exact command or file edit:** `@steward` **drafts a local Markdown
  resolution** with a written outcome and the exact revision link
  ([`.opencode/agents/steward.md:13`](../../../.opencode/agents/steward.md),
  [`docs/AGENT_DIRECTORY.md:76-78`](../../AGENT_DIRECTORY.md)). Where Desk is
  configured, the reviewed text may be queued and then sent through the
  existing outbox commands (`runtime/desk/src/cli.js` `reply`/`send`,
  `runtime/desk/src/buzz.js:9-33`); the send is a separate authorized human
  action, never automatic.
- **Human gate:** a named human reviews recipient, evidence, privacy boundary
  and wording, then sends; "sent" is recorded only from verified delivery (a
  failed send is `uncertain`, never auto-resent —
  `docs/AGENT_DIRECTORY.md:246-248`).
- **Status:** the accepted-outcome resolution *mechanics* are **implemented** in
  the optional Desk engine (`landJob`/`acceptJob`,
  `docs/AGENT_DIRECTORY.md:224,229-235`) and the design-stage
  `scripts/agit.py` `accept` prints a human-sends reply template
  (`scripts/agit.py:1193-1196`); the `@steward` **resolution draft** is
  charter-level intent (**implemented as a charter**,
  `.opencode/agents/steward.md:13`) and **newly proposed as an operational
  step**. Note: this target is not itself a numbered gap hop; the nearest
  recorded hops are T3.1 and T3.3.

### P4 — accepted outcome → `HARNESS_STATE` lesson / NIP-AE engram (hops T3.6, T6.3)

- **Input:** accepted revision + the observed pattern (what worked, what failed,
  what changed), and a counterexample/limitation.
- **Output store/path:** (i) a dated lesson entry in the `## Lesson log` of
  [`docs/HARNESS_STATE.md`](../../HARNESS_STATE.md) (convention at
  `docs/HARNESS_STATE.md:69-83`); (ii) a Buzz memory engram slug
  ([`runtime/worker/BUZZ.md:57-85`](../../../runtime/worker/BUZZ.md)).
- **Exact command or file edit:**
  - Lesson: `@steward` **appends one dated, human-attributed bullet** to
    `docs/HARNESS_STATE.md`; the file records "checked facts only — mark
    uncertainty as such" and lessons are "written only after a human accepts the
    outcome" (`docs/HARNESS_STATE.md:3-4,71`).
  - Engram: `@steward` **writes the reviewed finding to a private file**, a
    human reviews the exact content/revision, and the **owner-controlled Buzz
    signer** runs it — new entry
    `"$BUZZ" mem set "<slug>" - < "<private/finding.txt"`
    ([`runtime/worker/BUZZ.md:66-72`](../../../runtime/worker/BUZZ.md)); existing
    entry `"$BUZZ" mem patch "<slug>" --base-hash "<captured-sha256>"
    --patch-file "<private/change.diff>" --dry-run` then apply
    (`runtime/worker/BUZZ.md:74-79`).
- **Human gate:** every lesson entry is human-approved before it lands
  ([`.opencode/agents/steward.md:65`](../../../.opencode/agents/steward.md):
  "Present both drafts for human review. Do not send or commit."), and every
  engram is sent only by the owner-controlled signer after reviewing the exact
  payload ([`runtime/worker/BUZZ.md:66-69`](../../../runtime/worker/BUZZ.md)).
  Engrams are attributed evidence, not proof a worker answer is correct, and do
  not reproduce the retired registry's admission/rollback semantics
  (`runtime/worker/BUZZ.md:84-85,126-132`).
- **Status:** the `HARNESS_STATE.md` format and lesson convention are
  **implemented**; the Buzz memory read/set/patch CLI surface is
  **implemented**; the `@steward` lesson-edit and engram-draft steps are
  **charter-level intent** (`.opencode/agents/steward.md:57-68`) and **newly
  proposed as operational steps**.

## (c) Draft → human-approved only; what must NOT be automated

The whole projection surface is a deliberate human gate, not a pipeline.

- **No self-accept.** The shared boundary is "agents draft, humans accept; no
  agent accepts its own artifact, resolves a job, publishes, or sends
  externally" ([`docs/AGENT_DIRECTORY.md:53-55`](../../AGENT_DIRECTORY.md)); the
  steward charter's "must not" is "Accept artifacts or change accepted history"
  ([`.opencode/agents/steward.md:20`](../../../.opencode/agents/steward.md)).
  The product contract keeps humans as the visible participants: "Automation may
  organize, route, remember, and prepare work, but humans remain the visible
  participants" ([`PRODUCT.md:5`](../../../PRODUCT.md)); derived summaries "may
  reference human content but never become an author"
  ([`PRODUCT.md:56`](../../../PRODUCT.md)).
- **No automatic sending.** `@steward` "must not ... send anything externally"
  ([`.opencode/agents/steward.md:22`](../../../.opencode/agents/steward.md));
  external drafts are prepared only and sent by a named human
  ([`docs/SOP.md:30-31`](../../SOP.md)). The projection SOP states the same for
  external communication ("Diplomat tools prepare drafts only",
  [`docs/SOP.md:29-31`](../../SOP.md)). The `/meta` command itself "is not an
  enforced hook, background daemon or automatic authorization to publish"
  ([`runtime/adaptive/META.md:5-7`](../../../runtime/adaptive/META.md)).
- **No rewrite of accepted history.** "One accepted event gets one immutable
  file. The source event ID is its idempotency key. A correction appends a new
  event rather than rewriting history"
  ([`activity/README.md:13`](../../../activity/README.md)); the SOP repeats "A
  correction appends a new event" ([`docs/SOP.md:19`](../../SOP.md)); the
  steward "must not ... change accepted history"
  ([`.opencode/agents/steward.md:21`](../../../.opencode/agents/steward.md)). The
  source of truth is "the accepted revision (a merged commit) and the Buzz
  thread it was resolved in"
  ([`activity/README.md:17`](../../../activity/README.md)).
- **No automatic acceptance of projections.** The activity tree is "the
  Git-synced, human-readable projection of **accepted** Telepathy outcomes. It
  is not the execution ledger"
  ([`activity/README.md:3-5`](../../../activity/README.md)); "tools prepare,
  humans accept" ([`docs/AGENT_MAP.md:77-78`](../../AGENT_MAP.md)).
- **Idempotency, not automation.** Retrying the same source event "must not
  create a duplicate" ([`docs/SOP.md:19`](../../SOP.md)); this is a correctness
  rule for the draft step, not permission to write without review.
- **No leakage.** Raw sessions, prompts, tool calls, secrets and unaccepted
  artifacts "do not belong here"
  ([`activity/README.md:5`](../../../activity/README.md)); the interface
  "exposes no agent transcript, prompt, or tool call"
  ([`PRODUCT.md:66`](../../../PRODUCT.md)); `AGENT_DIRECTORY.md` itself records
  no "session IDs, pubkeys, receipts, prompts, transcripts or job IDs"
  ([`docs/AGENT_DIRECTORY.md:20`](../../AGENT_DIRECTORY.md)).

## (d) Implemented vs newly proposed

**Already implemented (exists in the checkout today):**

1. `@steward` charter with explicit "may"/"must not"/workflow and the learning
   duty — [`.opencode/agents/steward.md:10-31,57-68`](../../../.opencode/agents/steward.md).
2. Registry entry `steward` (JTBD `resolve`, `project`, `learn`) —
   `plugins/telepathy-meta-agents/registry.json` (`status: planned`, so
   cataloged, not active).
3. Projection format contracts: `activity/README.md`;
   `docs/SOP.md:17-27`; `CHANGELOG.md:1-29`; `docs/HARNESS_STATE.md:3-4,69-83`.
4. Relay surfaces: the `changelog` stream + canvas
   (`scripts/setup-programs.sh:95,113`; `docs/AGENT_MAP.md:50`) and the
   `shared-files` mirror list (`scripts/shared-files.list:3,5`).
5. Buzz memory (NIP-AE engram) CLI surface: `mem ls/get/hash/set/patch`
   ([`runtime/worker/BUZZ.md:59-85`](../../../runtime/worker/BUZZ.md)).
6. Accepted-outcome resolution mechanics in the optional Desk engine
   (`landJob`/`acceptJob`, `docs/AGENT_DIRECTORY.md:224,229-235`), and the
   design-stage `scripts/agit.py` `accept` that resolves a git job and prints a
   human-sends reply template (`scripts/agit.py:1127-1197`).

**Newly proposed in this draft (no command is implemented):**

1. **P1** — the concrete `activity/<project>/<year>/<month>/<event-id>.md`
   write step with a path-existence idempotency guard and correction-event
   behavior.
2. **P2** — the concrete `CHANGELOG.md` edit step and a review-only changelog
   channel draft.
3. **P3** — an operational `@steward` resolution draft for the originating
   thread, routed through the existing outbox only under human authorization.
4. **P4** — the concrete `HARNESS_STATE.md` lesson edit and the
   reviewed-payload engram draft sent by the owner-controlled signer.
5. **Optional hardening** — make the `activity/` projection a checked
   transition keyed on the source event id (flagged as future work at
   `docs/AGENT_DIRECTORY.md:387-388`).
6. **Optional repair** — implement the missing
   `plugins/telepathy-meta-agents/scripts/validate.mjs` so the already-declared
   `activity-integrity` workflow actually validates the projection it names.

## Outstanding work (not done here, by design)

- No projection command exists; all four steps remain `@steward` drafts for a
  named human.
- The `activity-integrity` CI workflow references a validator that is not in
  the checkout; the check cannot pass today.
- The `steward` registry entry remains `status: planned`; activation is an
  owner edit.
- This is a draft: no edit to `AGENT_DIRECTORY.md`, `activity/`, `CHANGELOG.md`,
  `docs/HARNESS_STATE.md` or any shared doc; no commit, no Buzz/relay write, no
  publication.

## Verification commands run for this draft

```sh
shasum -a 256 runtime/worker/system.bend
BEND_NO_TELEMETRY=1 ~/.bend/bin/bend runtime/worker/system.bend --check-only
BEND_NO_TELEMETRY=1 ~/.bend/bin/bend runtime/worker/system.bend -- help
node --test runtime/worker/protocol.test.mjs
npm run check
test -e plugins/telepathy-meta-agents/scripts/validate.mjs   # → missing
```

The coordinator also executed one private single-writer Bend lineage
(`init → capture → work → worker → claim → packet → return → learn`) in a
private temp directory, outside Git and outside this artifact. The packet
rendered the bounded task data and active memory, and the final history carried
the expected `reference`/`dependency` edges. That is protocol-execution
evidence, not a code bundle and not human acceptance.
