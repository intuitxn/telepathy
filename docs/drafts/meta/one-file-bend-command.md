# DRAFT — one self-contained Bend command to replace the npm surface

Status: draft, agent-authored · Updated: 2026-09-22 · **Not published, not sent,
not committed.** This document creates no external effect and authorizes no
publication. It is written for review, not as an announcement.

Question under examination: *"Why keep npm when one Bend command could own the
whole thing — a single self-contained command that updates itself in the system,
invoked whenever `/meta` is selected in OpenCode?"*

Answer, stated up front: **a single command can own the local state model and the
checked transitions, but it cannot own the process, Git, build, or server effects
that npm currently performs.** Bend 2.0.21 has no subprocess API. It does have
raw loopback TCP and native file I/O, which is exactly enough for the worker to
deliver a packet to an already-running OpenCode server and no more. The rest
needs the host or an OpenCode plugin hook.

Cross-links: [`runtime/adaptive/META.md`](../../../runtime/adaptive/META.md) ·
[`runtime/worker/README.md`](../../../runtime/worker/README.md) ·
[`runtime/adaptive/HARNESS.md`](../../../runtime/adaptive/HARNESS.md) ·
[`runtime/adaptive/README.md`](../../../runtime/adaptive/README.md) ·
[`docs/AGENT_DIRECTORY.md`](../../AGENT_DIRECTORY.md) ·
[`docs/INDEX.md`](../../INDEX.md) · [`BUZZ_SETUP.md`](../../../BUZZ_SETUP.md) ·
[`runtime/worker/BUZZ.md`](../../../runtime/worker/BUZZ.md).

## 0. Resolution and evidence base

| Item | Value | Evidence |
|---|---|---|
| Checkout | `/Users/a3fckx/Desktop/Attri/telepathy-shared-learning` | symlink `~/.config/opencode/commands/meta.md` → `.opencode/commands/meta.md` |
| Worker source | `runtime/worker/system.bend` | resolved per `runtime/adaptive/META.md:17-25` |
| Source digest | sha256 `6e224e26d47c56d3601b26b55ae77497ab4680cacda89846640380a1d9e69d74` | `shasum -a 256`; matches `runtime/worker/README.md:5` |
| Toolchain | Bend 2.0.21, `~/.bend/bin/bend` | `bend version` |
| Checker | `runtime/worker/system.bend --check-only` → `All terms check.` | run in this session |
| Protocol test | `node --test runtime/worker/protocol.test.mjs` → 2/2 pass | run in this session |
| Desk check | `npm run check` → 12/12 pass | run in this session (`package.json:17`) |

### The subprocess contradiction, resolved with source evidence

Two claims appeared to conflict:

- `runtime/adaptive/README.md:112-114`: "The current Bend Base has no subprocess
  API, so automatic Git transport is not implemented in this one-file program."
- The worker advertises `opencode IN WORK PORT SESSION RECEIPT`
  (`runtime/worker/system.bend:1828-1829`), described as reaching `127.0.0.1`.

They are **not** in conflict; they describe different primitives. The worker's
`opencode` command is implemented over the TCP and File primitives of Bend Base:

- `TCP.connect("127.0.0.1", port)` — `system.bend:1769`
- `TCP.send(socket, request)` — `system.bend:1760`
- `TCP.poll(socket, 4096, 1000)` — `system.bend:1710`
- `Socket.close(socket)` — `system.bend:1726`
- hand-written HTTP/1.1 request and 204-only response validation —
  `system.bend:1634-1635`, `system.bend:1663-1671`
- the connector is explicitly "explicit loopback delivery, not automatic
  execution" and "HTTP 204 acknowledges submission only. It never imports model
  output" — `system.bend:1601-1603`

The only occurrence of the word "subprocess" in the worker is the negative
capability statement at `system.bend:863-865` ("No native subprocess, Git, SHA,
directory creation, locks or atomic rename are available in this Bend Base").
There is no spawn/exec/process primitive anywhere in the source.

**Conclusion.** Bend can open a socket to a server that is *already running* and
POST a packet to it. Bend cannot start that server, run `npm`, run `git`, run a
build, execute JavaScript, or compute an independent SHA-256. Those effects live
outside the one-file program. The advertised loopback endpoint is reached over
TCP, not by spawning a process. This is the boundary that binds every verdict in
Part (b).

## (a) Inventory of everything npm owns in this checkout

"npm" here means the root `package.json` (`package.json:1-19`) plus the two
independent package manifests it does not orchestrate, plus the non-npm scripts
that are commonly mistaken for npm-owned.

| # | Responsibility | Owning script / manifest | Exact files | What it does |
|---|---|---|---|---|
| 1 | Root script surface | `package.json:11-18` | `package.json` | Declares `setup`, `doctor`, `desk`, `opencode`, `test`, `check`; root workspace is `runtime/desk` only (`package.json:8-10`) |
| 2 | Desk job engine | `npm run desk`/`run`/`accept` (`cli.js:61-72`) | `runtime/desk/src/jobs.js`, `process.js`, `runtime.js` | Claim-once job (`jobs.js:6-10`), detached Git worktree (`jobs.js:20-22`), Codex/OpenCode subprocess adapters (`jobs.js:32-56`), diff/status evidence (`jobs.js:57-61`), human accept (`jobs.js:68-74`), land+commit+push (`jobs.js:76-101`) |
| 3 | Desk writing/artifact engine | `npm run desk -- new/review/export` (`cli.js:55-59`) | `runtime/desk/src/core.js` | SQLite ledger (`core.js:19-29`), templates + SHA-256 review snapshot (`core.js:47-64`), export with receipt (`core.js:65-75`) |
| 4 | Desk Buzz intake/outbox | `npm run desk -- poll/watch/queue/send` (`cli.js:73-108`) | `runtime/desk/src/buzz.js` | Buzz CLI wrapper (`buzz.js:3-8`), draft/sending/sent/uncertain outbox (`buzz.js:9-33`), authorized intake dedupe (`buzz.js:34-49`), cursor pagination (`buzz.js:50-70`), accept matching (`buzz.js:72-87`), notify (`buzz.js:89-94`) |
| 5 | Desk runtime adapter | `npm run opencode` (`cli.js:37-41`) | `runtime/desk/src/runtime.js` | Resolves the installed `opencode`/`OPENCODE_BIN` (`runtime.js:2`) and strips Buzz secrets from the child env (`runtime.js:3-9`) |
| 6 | Setup | `npm run setup` (`package.json:12`) | `runtime/desk/src/setup.js` | Creates `.local/` + `config.json` defaults (`setup.js:4-9`) |
| 7 | Doctor | `npm run doctor` (`package.json:13`) | `runtime/desk/src/cli.js` | Checks settings file and probes `node`/`codex`/`opencode`/`buzz` by spawning them (`cli.js:42-49`) |
| 8 | `npm run check` / `test` | `package.json:16-17` | `runtime/desk/test/*.test.js` | `node --test` over `core.test.js`, `jobs.test.js`, `opencode.test.js` (12 tests) |
| 9 | Site build | `site/package.json:6-14` | `site/` (`vite.config.ts`, `src/**`) | `dev`/`preview`/`build` (`tsc -b && vite build`)/`test`/`typecheck`/`check`; Node/TypeScript/Vite toolchain, `site/package.json:15-31` |
| 10 | Telepathy plugin build | `plugins/telepathy/package.json:10-14` | `plugins/telepathy/src/**`, `dist/**` | `check` (`tsc --noEmit`), `build` (`tsc`), `test` (build + `node --test test/smoke.mjs`). Manifest exists but root install does not load it; `plugins/telepathy/README.md:1-4` |
| 11 | `runtime/programs` | **no npm script** (not npm-owned) | `runtime/programs/cli.py:1-20`, `v11.py`, `bend-laws/`, `retrieval/` | Python host wrapper compiling Nudge v1.1 programs and running the `oc2`/`opencode` binary; Bend law proofs. Never referenced by any `package.json` |
| 12 | Shell/Python operator scripts | **no npm script** (not npm-owned) | `scripts/desk-watch.sh`, `scripts/setup-programs.sh`, `scripts/refresh-notes.sh`, `scripts/workspace-service.py`, `ops/loops/*` | launchd watch wrapper, Buzz program/notes provisioning, workspace service install/check, unattended proposal loops |
| 13 | CI build/deploy | **GitHub Actions, not npm** | `.github/workflows/pages.yml`, `deploy-macmini.yml`, `activity-integrity.yml` | Site build+Pages deploy, Docker/nginx deploy, activity/registry validation (`node plugins/telepathy-meta-agents/scripts/validate.mjs`) |

Every responsibility is accounted for. Items 11–13 are listed so that "npm
owns" is not overstated: they run without npm.

## (b) Move / stay / partial, per responsibility, with cited lines

Capability facts that drive every verdict:

- Bend Base **has**: native file I/O (`system.bend:908-924`), raw TCP
  (`system.bend:1710`, `:1760`, `:1769`), `IO.print`/`IO.die` (e.g.
  `system.bend:872`, `:1008`), and pure computation.
- Bend Base **lacks**: subprocess/spawn, Git transport, SHA, directory creation,
  locks, atomic rename (`system.bend:863-865`), TLS (the connector is plain TCP
  to `127.0.0.1:port` only, `system.bend:1634-1635`, `:1769`), and any JS
  parser/executor.

| # | Responsibility | Verdict | Cited reason |
|---|---|---|---|
| 1 | Root script surface | **Motionless (host)** | npm is the installed process runner; Bend cannot spawn node (`system.bend:863-865`). A Bend "command" is a *bend invocation*, not a shell script, so `npm run` semantics do not transfer. |
| 2 | Desk job engine (worktree/exec/diff/land) | **Stay** | Uses `child_process.spawn` (`process.js:2-17`), `git worktree` (`jobs.js:20-22`), `git diff/status` (`jobs.js:58-59`), `codex`/`opencode` (`jobs.js:32-56`), `git commit`/`push` (`jobs.js:90-98`). None is a Bend Base primitive. |
| 3 | Desk writing/artifact engine | **Partial** | A draft→reviewed→exported state machine with content hashing is expressible in Bend's immutable + file-I/O model (`system.bend:908-924`), but the stores it uses (SQLite `core.js:19-29`) and SHA-256 (`core.js:8`) are not; `.local/artifacts/<id>/` directories need `mkdirSync` (`core.js:51`), and Bend has no directory creation (`system.bend:863-865`). |
| 4 | Desk Buzz intake/outbox | **Stay / partial** | Sending shells out to the `buzz` CLI (`buzz.js:3-8`); parsing JSON relay payloads is JS (`buzz.js:7`, `:40`). Bend has no subprocess and no JSON parser. The *dedupe concept* (`buzz.js:12-14`, `core.js:24`) is mirrorable as a Bend event key; the transport is not. |
| 5 | Desk runtime adapter | **Stay** | Only purpose is to spawn OpenCode and filter env (`runtime.js:2-9`, `jobs.js:47-48`); spawning is outside Bend. Note the worker's `opencode` connector performs the *submission* half without spawning (`system.bend:1763-1770`), so this is the closest partial overlap. |
| 6 | Setup | **Partial** | Default config generation is pure text (`setup.js:7`) and could be a Bend file write; directory creation (`setup.js:5`, `File` has no mkdir, `system.bend:863-865`) and "don't overwrite existing settings" (`setup.js:6`) must be host-side. |
| 7 | Doctor | **Stay** | Spawns and compares tool versions (`cli.js:44-45`); Bend cannot spawn. The narrower "does `.local/config.json` exist" probe (`cli.js:43`) is one `File.open` Bend could do. |
| 8 | `npm run check` / tests | **Stay** | `node --test` is the driver (`package.json:16`); the worker protocol test likewise uses Node "only [as] the test driver" (`runtime/worker/README.md:20-21`). Bend checks *itself* (`--check-only`, `META.md:34`) but cannot run Node tests. |
| 9 | Site build | **Stay** | `tsc -b && vite build` (`site/package.json:9`); Node toolchain. |
| 10 | Telepathy plugin build | **Stay (retired)** | `tsc` (`plugins/telepathy/package.json:11-13`); the plugin is not loaded (`BUZZ_SETUP.md:1-9`, `plugins/telepathy/README.md:1-4`). |
| 11 | `runtime/programs` | **Not applicable** | Already non-npm; Python host + Bend (`runtime/programs/cli.py:1-20`). |
| 12 | Shell/Python scripts | **Not applicable** | Already non-npm. |
| 13 | CI deploy | **Not applicable** | GitHub Actions; needs git hosting and containers. |

Nothing in this checkout can move *wholly* into the one-file worker, because the
worker can neither spawn processes nor create directories. What can move is the
**state model and its checked transitions** — which Part (d) and Part (e)
address.

## (c) What "one command that updates itself in the system" can and cannot mean

### The single entry point

`/meta` is already the single entry point, but it is an instruction document, not
a hook: "The command provides instructions to the host agent; it is not an
enforced hook, background daemon or automatic authorization to publish"
(`runtime/adaptive/META.md:5-7`; confirmed `runtime/adaptive/LEARNING.md:148-152`).
Its self-resolution already works — the installed symlink is followed to the
checkout (`META.md:9-15`).

### Self-check

The self-check is `bend FILE --check-only` → `All terms check.`
(`META.md:32-36`; `runtime/worker/README.md:11-14`). **Bend cannot run this on
itself** — the checker is the external launcher. So the self-check is a host
step, not a Bend transition.

### Self-record

The worker already has a native self-record path: `record FILE SOURCE`
(`system.bend:1008-1022`, help at `:1828-1829`) writes the exact source text and
computed evidence, idempotently, to a private file (`runtime/adaptive/README.md:29-34`).
Two halves must be kept distinct:

- **Bend-doable:** writing the evidence record and refusing stale/mismatched
  content (`system.bend:927-940`).
- **Host-only:** computing the independent source SHA and attesting which path
  is actually the running program. Base "cannot independently attest that the
  supplied path is the running program" (`runtime/adaptive/README.md:36-42`).

### Reconcile on `/meta` selection

OpenCode does not automatically trigger work on command selection; there is no
enforced lifecycle hook (`META.md:5-7`). To reconcile *automatically* when `/meta`
is selected you need an **OpenCode plugin hook** (`command.execute.before` /
tool hook). The checkout once shipped exactly such a hook —
`plugins/telepathy/` with `_send`/permission hooks (`plugins/telepathy/README.md:8-13`)
— but it is retired from the active install (`BUZZ_SETUP.md:1-9`). A live
telepathy plugin is present at `~/.config/opencode/plugins/telepathy.ts` and
maintains a peer registry, but it is a coordination layer, not a Bend reconciler.

### Verdict on the slogan

| Reading | Achievable? | Who does it |
|---|---|---|
| Resolves its own real path through the symlink | Yes, already | command file (`META.md:9-15`) |
| Re-checks and records its own worker source | Partial | host computes SHA + invokes `--check-only`; Bend writes `record` |
| Reconciles local entity state on `/meta` | Partial | Bend computes/records transitions; **plugin hook** triggers reconcile |
| Updates its own installed copies / `node_modules` / command text | No | Bend cannot write over existing files at a known path beyond `File.open(path,"w")` with no mkdir/locks/rename (`system.bend:863-865`, `:920-924`), and cannot spawn installers |

The honest framing: **one command can own the checked state transitions; a thin
host/plugin layer must own every effect that touches the outside world.**

## (d) Internal state model

### Entities

| Entity | Identity / key | Lifecycle states | Transitions | Store | Durability |
|---|---|---|---|---|---|
| **Agent** | role name + charter path; catalog `id` | declared → planned → active → retired | charter edit / registry status change | `.opencode/agents/*.md`; `plugins/telepathy-meta-agents/registry.json` | Durable (Git) |
| **Session** | runtime-issued id (A2.2); peer `sessionID` (A2.1) | created → live → idle → ended; peer `status=active` | `session.created`/`idle` (`events.jsonl` types) | OpenCode server `run/`+`logs/`; `~/.config/opencode/telepathy/peers.json` | Ephemeral / disposable (`AGENT_DIRECTORY.md:116-141`) |
| **Job** | `id` = randomUUID; dedupe key `source` UNIQUE | `queued → running → needs_review → resolved \| needs_attention` | `claim()` `jobs.js:6-10`; `runJob()` `:61`,`:63`; `acceptJob()` `:70` | `.local/desk.sqlite` table `jobs` (`core.js:24`) + `.local/jobs/<id>/` | Ledger durable; worktree ephemeral (`AGENT_DIRECTORY.md:147-151`) |
| **Worker snapshot (Bend lineage)** | `(lineage dir, event id = 1 + lorenz_size)` | derived per kind: work `queued→claimed→reported`; memory `active→needs-review→superseded`; worker | `worker` `system.bend:1515`; `claim` `:1520`; `return` `:1537`; `learn` `:1554`; `correct` `:1400` | caller-supplied private immutable files `sN` | Durable, **single writer**, no atomic writes (`runtime/worker/README.md:36-44`) |
| **Memory (local Bend)** | event id, kinds 2/3/8 | active / needs-review / superseded | `remember` (`system.bend:1382`), `correct` (`:1400`), `learn` (`:1554`); status logic `:1087-1102`, `:1346-1347` | same immutable lineage | Durable |
| **Registry run** (retired) | bundle/core contract id (`lorenz-memory-v1`, evaluator `lorenz-memory-cli-v1`) | staged → admitted → revoked | historical admission/sync (removed) | Git branch `learning/shared-v1`, preserved at `d7a6c7b` (`runtime/adaptive/HARNESS.md:27-35`; `runtime/lorenz/README.md:35-37`) | Durable **historical**, not migrated |
| **Engram (Buzz memory)** | slug | present → tombstoned (`mem rm`) | `mem set`/`mem patch` under owner signer (`runtime/worker/BUZZ.md:57-85`) | Buzz relay, owner-signed | Durable remote |
| **Artifact** | `id` = randomUUID | draft → reviewed → exported | `createArtifact`/`approveArtifact`/`exportArtifact` (`core.js:47-75`) | `.local/desk.sqlite` table `artifacts` (`core.js:25`) + files | Durable |
| **Outbox message** | `id` = content digest | draft → sending → sent \| uncertain | `queueMessage`/`sendMessage` (`buzz.js:9-33`) | `.local/desk.sqlite` table `outbox` (`core.js:26`) | Durable |

### Single-writer / ordering / dedupe rule per store

| Store | Writer | Ordering | Dedupe |
|---|---|---|---|
| `.local/desk.sqlite` | one process holds the `DatabaseSync` handle (`core.js:21-22`) | `rowid` insertion order (`core.js:38`) | `jobs.source` UNIQUE (`core.js:24`, `:80-83`); outbox `id` digest (`buzz.js:12-14`) |
| Bend lineage | **one coordinator per lineage** (`runtime/worker/README.md:36-39`); no locks | `id = 1 + lorenz_size(history)` (`system.bend:1515`, `:1520`, `:1537`, `:1554`) | none across snapshots; each `OUT` must be new (`META.md:67-73`) |
| Buzz memory | owner-controlled signer (`BUZZ.md:57`) | relay order | slug uniqueness; patches check base hash (`BUZZ.md:75-85`) |
| Telepathy peer store | plugin, `session.created` events | append-only `events.jsonl` | registry keyed by `sessionID` (`AGENT_DIRECTORY.md:121-130`) |

### Overlaps and conflicts (both paths named)

1. **Job identity, two namespaces.** Desk `id` = randomUUID in
   `.local/desk.sqlite` `jobs` (`core.js:24`) vs Bend work event numeric id in
   the snapshot lineage (`system.bend:1039-1040`). Same concept, no
   cross-reference column.
2. **Job state vocabulary, four spellings.** Desk
   `queued/running/needs_review/needs_attention/resolved` (`jobs.js:7`,`:61`,`:63`,`:70`);
   the documented harness lifecycle
   `Proposed → Ready → Active → Waiting → Review → Resolved | Cancelled`
   (`docs/HARNESS_STATE.md:38-41`); Bend work `queued/claimed/reported`
   (`system.bend:1346-1347`); the product surface `Posts/Replies/
   Acknowledgements/Resolutions` (`README.md:21-24`).
3. **Acceptance, three gates.** Desk `resolved` + named reviewer
   (`jobs.js:68-73`) vs Bend `learn` memory promotion (`system.bend:1554`) vs the
   Buzz signer review (`BUZZ.md:57`). None references another; "accepted" means
   three different things.
4. **Claim exclusivity, two semantics.** Desk is atomic per ledger via
   `UPDATE ... WHERE state='queued'` (`jobs.js:7-8`); Bend claim is exclusive
   only within one lineage, with "no distributed locks, globally exclusive claims
   across forks" (`runtime/worker/README.md:41-44`).
5. **Memory, three stores.** Local Bend memory (`system.bend:1382-1410`), Buzz
   engrams (`BUZZ.md:57-85`), and the retired registry bundle
   (`runtime/lorenz/README.md:35-37`). They do not synchronize
   (`runtime/worker/README.md:46-49`).
6. **Session, four id spaces.** OpenCode server session (A2.2,
   `AGENT_DIRECTORY.md:132-141`), desk `job.sessionID` (`jobs.js:37`), telepathy
   peer `sessionID` (`AGENT_DIRECTORY.md:121-130`), Bend numeric `conversation`
   (`system.bend:1039-1040`).
7. **Message/notification, two entities.** Telepathy peer mailbox/status
   (`peers.json`, `events.jsonl`) vs desk `outbox` rows (`buzz.js:9-33`). The
   retired plugin sent directly with "no Desk outbox's deduplication contract"
   (`plugins/telepathy/README.md:14-16`).
8. **Dedupe, three rules.** `jobs.source` UNIQUE (`core.js:24`), outbox content
   digest (`buzz.js:12-14`), Bend "OUT must be new" (`META.md:67-73`).

### Minimal canonical set (proposal)

Collapse to **five** entities with one writer each:

1. **Agent** — keep (charter + registry catalog).
2. **Session** — keep, marked explicitly ephemeral; id supplied by the owning
   runtime, never cross-referenced by value in durable artifacts.
3. **Job** — the single unit of work, merging desk `jobs`, Bend `work`, and
   product "Post/Resolution". One canonical state enum:
   `queued → claimed → reported → reviewed → accepted | rejected | needs_attention`.
   *Important:* this is a proposal, not the current wording, and the mapping to
   the four existing vocabularies must be reviewed before any code change.
   Identity: `source` for dedupe, plus a `evidence_ref` pointing at the Bend
   lineage + event id.
4. **Memory** — merge Bend local memory and Buzz engram under one identity
   (`slug` / event id) with a `scope` field (`local` | `published`); Buzz remains
   the published store, Bend the local one.
5. **Evidence** — the immutable record: Bend snapshot events, artifact review
   snapshots, registry bundle digest. Absorbs "worker snapshot", "registry run",
   and "artifact revision" as read-only records.

Drop as separate entities: `outbox` (projection of a Job message), `registry
run` (historical Evidence), and the product object names (views of Job/Memory).
One writer per entity; ordering by monotonic id; dedupe by `source` (Job) and
content digest (Message/Evidence).

## (e) Migration boundary and the smallest first step

**Stays npm / host (no Bend path today):** the desk job-execution engine
(`jobs.js`, `process.js`, `runtime.js`), site build (`site/package.json:9`),
plugin build (retired), doctor probes (`cli.js:44-45`), `runtime/programs`
(Python), and all CI/deploy workflows.

**Becomes Bend (already mostly is):** the local state model and its checked
transitions — `worker`/`claim`/`return`/`learn`/`correct`, memory invalidation,
and `record`/`replay` evidence (`system.bend:1382-1410`, `:1515-1554`,
`:1008-1022`). The new work is one **read-only reconcile/status transition** that
projects a lineage into the canonical five-entity view of Part (d).

**Needs the host or an OpenCode plugin hook:** detecting `/meta` selection,
spawning Bend (`--check-only`), spawning Git/npm/OpenCode, starting the loopback
server the connector posts to (`system.bend:1769`), computing an independent
source SHA, and any directory creation or file overwrite.

**Smallest first step (atomic, testable, no external effect):**
add a read-only `status IN` subcommand to `runtime/worker/system.bend` that
loads one snapshot lineage and prints a normalized table of the five canonical
entities and their states, using only `lorenz_load`/`history` (`system.bend:1039-1102`,
`:1346-1347`) and `IO.print`. No writes, no spawning, no network. Add one named
law over a fixed fixture snapshot asserting the projection is deterministic
(matching the existing fixture style at `system.bend:1971`).

- **Test:** `bend runtime/worker/system.bend --check-only` → `All terms check.`;
  `bend runtime/worker/system.bend -- status <snapshot>` → deterministic table;
  `npm run check` still 12/12. All three are runnable today.
- **Why this first:** it makes the state overlaps in Part (d) *visible and
  testable* before any store is changed, and it introduces no new write path,
  no directory creation, and no process spawn — the exact constraints Bend
  imposes at `system.bend:863-865`.

## Outstanding work (not done here, by design)

- The canonical five-entity enum is a proposal; it requires review before any
  mapping or code change.
- No OpenCode plugin hook is implemented or re-enabled here; the retired plugin
  stays retired.
- No `node_modules`/manifest change; `npm` is not removed.
- This is a draft: no Buzz/relay write, no publication, no commit, no raw
  session identifiers, receipts, transcripts, prompts or tool calls.

## Verification commands run for this draft

```sh
shasum -a 256 runtime/worker/system.bend
BEND_NO_TELEMETRY=1 ~/.bend/bin/bend runtime/worker/system.bend --check-only
BEND_NO_TELEMETRY=1 ~/.bend/bin/bend runtime/worker/system.bend -- help
node --test runtime/worker/protocol.test.mjs
npm run check
```

The coordinator also executed a private single-writer Bend lineage
(`init → capture → work → worker → claim → packet → return → learn`) in
`.local/`, outside Git. That is protocol-execution evidence, not a code bundle
and not human acceptance.
