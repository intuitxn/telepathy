# DRAFT — the neat stack: drop npm, move desk toward general memory ops in Bend

Status: draft, agent-authored · Updated: 2026-09-22 · **Not published, not sent,
not committed.** No external effect; no shared doc, store, worker source,
`package.json`, `Makefile` or `INDEX.md` was edited. This file is the only
artifact written.

Privacy: this draft contains no credentials, no raw session identifiers, no
receipts, no transcripts, no prompts and no tool-call records. Entities are
named by file and line; private snapshot contents stay private. Fixtures use
only the placeholder labels already used by the design drafts (`worker-a`,
`conversation:example`, `operator`, `local-worker`).

Owner/reviewer: Shubham. Coordinator: `@meta` (single writer of one private
Lorenz snapshot lineage, `runtime/adaptive/META.md:45-79`).

---

## 0. Resolution, evidence base, and a concurrent-mutation note

| Item | Value | Evidence |
|---|---|---|
| Checkout | `/Users/a3fckx/Desktop/Attri/telepathy-shared-learning` | `~/.config/opencode/commands/meta.md` names this checkout (the installed command is a plain file here, not a symlink) |
| Meta instructions | `runtime/adaptive/META.md` | read in full |
| Worker source | `runtime/worker/system.bend` | resolves per `runtime/adaptive/META.md:17-25`; `runtime/worker/README.md:2-9` |
| Source digest | sha256 `6e224e26d47c56d3601b26b55ae77497ab4680cacda89846640380a1d9e69d74` | `shasum -a 256`; matches `runtime/worker/README.md:5` |
| Toolchain | Bend 2.0.21, `~/.bend/bin/bend` | `bend version` |
| Boundary description | `runtime/adaptive/README.md`, `runtime/worker/README.md` | read in full |
| Checker | `runtime/worker/system.bend --check-only` → `All terms check.` | run in this session, exit 0 |

### Concurrent-mutation note (material to several citations)

The checkout is shared and was written by more than one session during this run.
Between the start of this task and the end, a concurrent writer moved a set of
untracked files out of the working tree into a Git stash:

- `Makefile` (35 lines)
- `runtime/ops/status.bend` (284 lines)
- `scripts/telepathy-discover.mjs` (168 lines) and `scripts/telepathy-discover.test.mjs`
- `runtime/worker/diffusion.bend` (924 lines) and `runtime/worker/history.bend` (484 lines)

They are preserved (not deleted) in `stash@{1}`, untracked commit `stash@{1}^3`
— `git stash list` reports `stash@{1}: On refactor/buzz-native-bend: preserve
shared-learning before removal 2026-09-22`. The tracked `package.json` also
reverted from the task revision (20 lines, with `discover`) to HEAD (19 lines,
without it).

Consequences for this draft:

- The **task premise** — "the Makefile already added: make check, make discover,
  make bend-status" — held at task issuance (the Makefile was present and was
  read in this session) and is documented here from that revision.
- Every `Makefile`, `runtime/ops/status.bend`, `runtime/worker/diffusion.bend`
  and `runtime/worker/history.bend` citation below is to the task revision as
  preserved in `stash@{1}^3`; the Makefile and status content is quoted so it is
  verifiable without restoring the stash. **Do not restore the stash as part of
  this task**: that would be an unauthorized external effect.
- Every other citation is to files that exist in the working tree now and were
  re-verified at the end of the run.

At the close of this run `runtime/ops/status.bend` reappeared in the working
tree (untracked) and is byte-identical to `stash@{1}^3`, so its citations below
resolve directly; the `Makefile` and `scripts/telepathy-discover.mjs` were still
absent from the working tree and remain stashed. The tree is being edited
concurrently, so a reviewer should treat the stash as the durable copy of the
task-revision files.

Verification of the preserved kernels is in §Verification.

---

## (a) Inventory: what npm and desk own today

### A.1 npm entry surface

Root `package.json` (current HEAD, 19 lines): identity/engines/workspaces at
`package.json:1-10` (`engines` `:6-7`, `workspaces` `:8-10`), script block at
`package.json:11-18`:

| Script | Line | Target |
|---|---|---|
| `setup` | `package.json:12` | `node runtime/desk/src/setup.js` |
| `doctor` | `package.json:13` | `node runtime/desk/src/cli.js doctor` |
| `desk` | `package.json:14` | `node runtime/desk/src/cli.js` |
| `opencode` | `package.json:15` | `node runtime/desk/src/cli.js opencode` |
| `test` | `package.json:16` | `node --test runtime/desk/test/*.test.js` |
| `check` | `package.json:17` | `npm test` |

Task revision (preserved in `stash@{1}`) additionally widened `test` to
`node --test runtime/desk/test/*.test.js scripts/*.test.mjs` and added
`discover` → `node scripts/telepathy-discover.mjs` (task-revision
`package.json:16-18`).

The desk workspace manifest is `runtime/desk/package.json:1-6`. The npm
workspace declaration is `package.json:8-10`. Documentation couples operators to
npm: `runtime/desk/src/cli.js:12-34` (help text written as `npm run ...`),
`runtime/desk/README.md:1-18`.

### A.2 desk runtime (`runtime/desk/src/*`)

`core.js` — local records, hashing, artifacts, jobs:

| Responsibility | Lines |
|---|---|
| `hash` = SHA-256 | `core.js:8` |
| `home()` / `config()` | `core.js:11-12` |
| `confined()` path guard | `core.js:13-18` |
| SQLite store + schema (`jobs`, `artifacts`, `outbox`, `cursors`) | `core.js:19-29` |
| `get` / `list` / `put` row mapping | `core.js:30-46` |
| `createArtifact` (template + dir) | `core.js:47-56` |
| `approveArtifact` (review snapshot) | `core.js:57-64` |
| `exportArtifact` (export + receipt) | `core.js:65-75` |
| `newJob` (dedupe by `source`) | `core.js:76-85` |

`jobs.js` — job engine:

| Responsibility | Lines |
|---|---|
| `claim` (one-time, `queued → running`) | `jobs.js:6-10` |
| `brief` (prompt assembly) | `jobs.js:11-13` |
| `runJob` dispatch/evidence | `jobs.js:14-66` |
| git worktree create (`--detach`) | `jobs.js:20-22` |
| context snapshots (confined, 120 KB, sha256) | `jobs.js:23-27` |
| Codex dispatch (`codex exec`) | `jobs.js:32-42` |
| OpenCode dispatch (installed CLI) | `jobs.js:43-56` |
| diff/status evidence (`changes.patch`) | `jobs.js:57-61` |
| `acceptJob` (named human reviewer) | `jobs.js:68-74` |
| `landJob` (apply, commit, push `origin` + `buzz`) | `jobs.js:76-101` |

`buzz.js` — Buzz intake/outbox:

| Responsibility | Lines |
|---|---|
| `buzz` CLI wrapper + relay URL (remote HTTPS) | `buzz.js:3-8` |
| `queueMessage` (outbox, content digest) | `buzz.js:9-16` |
| `sendMessage` (draft→sending→sent/uncertain, receipt) | `buzz.js:17-33` |
| `ingest` (allowlist, `/intuitxn` JSON parse, dedupe) | `buzz.js:34-49` |
| `poll` (cursor pagination + persist) | `buzz.js:50-70` |
| `acceptEvents` (match authorized reply to open job) | `buzz.js:72-87` |
| `notify` (queue + send) | `buzz.js:89-94` |

`cli.js` — operator surface:

| Responsibility | Lines |
|---|---|
| `help` (npm-shaped) | `cli.js:12-34` |
| `opencode` spawn | `cli.js:37-41` |
| `doctor` (spawn/version probes) | `cli.js:42-49` |
| `stop` (static message) | `cli.js:50-52` |
| `new`/`list`/`show`/`review`/`export` | `cli.js:55-59` |
| `job` (enqueue from JSON) | `cli.js:60` |
| `run`/`accept` (prefix resolution) | `cli.js:61-72` |
| `queue-artifact`/`queue`/`reply`/`send` | `cli.js:73-79` |
| `poll`/`watch` (loop, `autoRun`, land, notify) | `cli.js:80-109` |

`process.js` (effects primitive) and `runtime.js` (spawn env):

| Responsibility | Lines |
|---|---|
| `execute` (spawn, timeout, 16 MB cap) | `process.js:2-18` |
| `checked` | `process.js:19-23` |
| `cliPath` (installed CLI) | `runtime.js:2` |
| `runtimeEnv` (strips Buzz keys) | `runtime.js:3-9` |
| `setup` (config defaults + dir) | `setup.js:4-9` |

Tests: `runtime/desk/test/core.test.js`, `jobs.test.js`, `opencode.test.js`
(12 tests; task-revision `package.json:17` / `Makefile:17`). Module map and
contracts: `runtime/desk/README.md:5-10`, `:12-18`.

### A.3 Adjacent npm manifests (not desk-owned; listed so "npm owns" is not overstated)

| Manifest | Responsibility | Lines |
|---|---|---|
| `site/package.json` | `dev`/`preview`/`build`/`test`/`typecheck`/`check` | `site/package.json:6-13`; deps `:15-31` |
| `plugins/telepathy/package.json` | `check`/`build`/`test` | `plugins/telepathy/package.json:10-14`; deps `:15-27` |
| `runtime/desk/package.json` | workspace package marker | `runtime/desk/package.json:1-6` |

These build TypeScript/React/OpenCode-plugin artifacts and are out of scope for
the desk→Bend move; they stay host-side.

### A.4 The non-npm entry already added (task revision, stashed)

`Makefile` (35 lines; preserved in `stash@{1}^3`):

| Target | Lines | Mirrors |
|---|---|---|
| header / `BEND`, `NODE` vars | `Makefile:1-4` | — |
| `.PHONY` | `Makefile:8` | — |
| `help` | `Makefile:10-12` | — |
| `check` = `test bend-status` | `Makefile:14` | `npm run check` |
| `test` (`node --test runtime/desk/test/*.test.js scripts/*.test.mjs`) | `Makefile:16-17` | `npm test` |
| `bend-status` (`bend runtime/ops/status.bend --check-only`) | `Makefile:19-20` | (new, non-npm) |
| `discover` (`node scripts/telepathy-discover.mjs`) | `Makefile:22-23` | `npm run discover` |
| `desk` / `doctor` / `setup` / `opencode` | `Makefile:25-26`, `:28-29`, `:31-32`, `:34-35` | the four desk scripts |

Supporting non-npm files: `scripts/telepathy-discover.mjs:1-168` (read-only
peers view; `scripts/telepathy-discover.mjs:33-46` read, `:78-90` shape
classification), `scripts/telepathy-discover.test.mjs`, and
`runtime/ops/status.bend:1-284` (pure status projection, §c).

---

## (b) Classification: move-to-Bend / stay-host / drop

### The boundary that drives every verdict

Bend Base **has**: native file I/O (`system.bend:908-924`), raw loopback TCP
only (`system.bend:1634-1635` request, `:1710` poll, `:1760` send, `:1769`
`TCP.connect("127.0.0.1", …)`), `IO.print`/`IO.die`, and pure computation/laws.

Bend Base **lacks** (cited): subprocess/spawn, Git, SHA, directory creation,
locks, atomic rename (`system.bend:863-865`); a subprocess API for automatic Git
transport (`runtime/adaptive/README.md:116-118`); TLS / arbitrary remote HTTPS —
the only network primitive is plain `TCP` to `127.0.0.1` (`system.bend:1769`);
a JavaScript parser or executor; and it has no Python host, with Git as an
external recording tool (`runtime/adaptive/README.md:6-7`). Snapshots are
single-writer, non-atomic, with no locks or globally exclusive claims
(`runtime/worker/README.md:41-44`).

`M` = move the **pure decision** into a Bend op (host may remain as a thin
writer/reader). `S` = must stay host (needs a forbidden primitive).
`D` = delete; capability is owned elsewhere or obsolete.

| Responsibility (file:line) | Verdict | Reason (cited) |
|---|---|---|
| npm script block `package.json:11-18` | **D** | Pure entry wrapper; every target is mirrored by `Makefile:14-35`. npm is not a Bend primitive (`system.bend:863-865`). |
| `npm run check` `package.json:17` | **D** | Superseded by `make check` (`Makefile:14`). |
| engines/workspaces `package.json:5-10` | **S** | `npm install`/workspace resolution is host tooling; Bend cannot install or resolve modules (`system.bend:863-865`). Runtime needs zero third-party deps (all desk/discover imports are `node:` builtins or relative), so this is convention-only. |
| npm-shaped help/docs `cli.js:12-34`, `runtime/desk/README.md:5-10` | **D** | Rewritten for `make` targets; no capability lost. |
| SQLite store/schema `core.js:19-29` | **D** | Replaced by the immutable Bend snapshot lineage (`system.bend:1042-1049`, `:1237`) plus a thin host serializer. |
| SHA-256 `core.js:8` | **S** | No SHA in Bend Base (`system.bend:864`). |
| `confined()` `core.js:13-18` | **S** | Needs `realpathSync`/relative-path semantics; Bend file I/O has no realpath (`system.bend:908-924`). |
| `get`/`list`/`put` mapping `core.js:30-46` | **M** | Pure row projection; reuse `runtime/ops/status.bend:90-91`. Host keeps only the file read. |
| artifact create/review/export `core.js:47-75` | **S** | Needs `mkdirSync` + template write + SHA (`core.js:50-55`; `system.bend:863-865`). The review digest/state gate is pure and moves. |
| `newJob` dedupe `core.js:76-85` | **M** | `source` dedupe is a pure key decision (`core.js:80-83`); becomes the dedupe op (§c.4). |
| `claim` `jobs.js:6-10` | **M** | `queued → claimed` is a pure transition; the worker already has it (`system.bend:1529`). Host keeps the atomic write (`runtime/worker/README.md:41-44`). |
| `brief` `jobs.js:11-13` | **M** | Pure string projection; no I/O. |
| worktree create `jobs.js:20-22` | **S** | Git (`system.bend:864`; `runtime/adaptive/README.md:116-118`). |
| context snapshots `jobs.js:23-27` | **S** | FS read + SHA (`system.bend:908-924`; no SHA at `:864`). |
| Codex/OpenCode dispatch `jobs.js:32-56` | **S** | Spawn (`process.js:2-18`; `system.bend:864`). Bend's connector can *submit* to an already-running server (`system.bend:1601-1603`, `:1769`) but cannot start it. |
| diff/status evidence `jobs.js:57-61` | **S** | Git. |
| `acceptJob` `jobs.js:68-74` | **M** | Pure state gate + reviewer attach; `learn` is the analogous explicit promotion (`system.bend:1566`). Host keeps write and the named human. |
| `landJob` `jobs.js:76-101` | **S** | Git apply/commit/push (`jobs.js:90-98`). |
| `buzz` transport `buzz.js:3-8` | **S** | Spawn + remote HTTPS relay; Bend reaches only `127.0.0.1` (`system.bend:864`, `:1769`). |
| outbox queue/dedupe `buzz.js:9-16` + table `core.js:26` | **M**/D | Content-digest key + state gate is pure and moves; the SQLite `outbox` table is dropped. |
| outbox send/receipt `buzz.js:17-33` | **S** | Remote delivery + receipt. |
| `ingest` `buzz.js:34-49` | **S** | Parses arbitrary relay JSON; Bend has no JSON parser (`buzz.js:40`). The allowlist/prefix/schema gate is pure and can be a precondition op. |
| `poll` cursors `buzz.js:50-70` | **M**(logic)/S(transport) | Pure: fold to latest stamp + overlap dedupe (`core.js:27`, `buzz.js:53`, `:67`) → cursor op (§c.5). Transport stays host. |
| `acceptEvents` `buzz.js:72-87` | **M** | Pure match of authorized accept to open job; no I/O. |
| `notify` `buzz.js:89-94` | **S** | Queue + send. |
| `opencode` spawn `cli.js:37-41` | **S** | Spawn. |
| `doctor` `cli.js:42-49` | **S**/M | Version probes spawn; the config-exists probe (`cli.js:43`) is one `File.open` and moves. |
| `stop` `cli.js:50-52` | **D** | No managed service; static message. |
| `new`/`list`/`show`/`review`/`export` `cli.js:55-59` | **S** | Thin driver dispatch over the effects above. |
| `run`/`accept` `cli.js:61-72` | **S** | Prefix resolution + dispatch (driver). |
| `queue*`/`send` `cli.js:73-79` | **S** | Driver over transport. |
| `poll`/`watch` loop `cli.js:80-109` | **S** | Timers/loop + effects. |
| `execute`/`checked` `process.js:2-23` | **S** | The process primitive itself. |
| `cliPath`/`runtimeEnv` `runtime.js:2-9` | **S** | Env hygiene at spawn. |
| `setup` `setup.js:4-9` | **S**(mkdir)/M(text) | Default config text (`setup.js:7`) is a pure write; `mkdir` (`setup.js:5`) is not (`system.bend:863-865`). |
| desk tests `Makefile:17` | **S** | `node --test` is the driver; Bend cannot run tests. |
| `site/`, `plugins/` builds `site/package.json:6-13`, `plugins/telepathy/package.json:10-14` | **S** | Unrelated Node/TS toolchains. |
| Makefile targets `Makefile:14-35` | **S** | Thin non-npm entry; each line invokes a host primitive. |
| `telepathy-discover.mjs` `scripts/telepathy-discover.mjs:33-46` | **S** | FS read; the shape classification (`:78-90`) is pure and can become a Bend op. |
| status projection `runtime/ops/status.bend:90-91` | **M** | Already pure; see §c.2. |

Nothing moves **wholly** into Bend, because Bend can neither spawn a process,
run Git, hash, nor reach remote HTTPS (`system.bend:863-865`,
`runtime/adaptive/README.md:116-118`). What moves is the **pure decision**:
projection, state gates, dedupe, ordering, cursor folding, evidence verdicts and
retrieval ranking.

---

## (c) General memory ops in Bend

An **op** is one self-contained Bend file: a total, pure function from a
declared typed input to a declared typed output, with compiler-checked named
laws (`docs/drafts/meta/ops-as-bend.md:15-34`, `op-dispatch-convention.md:23-38`).
Gate: `bend <op>.bend --check-only` → `All terms check.`; fixture: bare-file run.

### c.0 Baseline (already in the worker; not re-authored)

`remember`, `learn`, `correct`, `history` are the memory core in
`runtime/worker/system.bend`: `lorenz_remember` `:1392`, `lorenz_learn` `:1566`,
`lorenz_correct` `:1409`, `history` dispatch `:1829`; the pure validity/append
half is `lorenz_valid :1209` and `lorenz_append :1049`, with laws
`lorenz_append_preserves_history_length` `:1056`,
`lorenz_no_implicit_retention` `:1218`,
`lorenz_correction_invalidates_transitive_dependency` `:1976`,
`lorenz_report_not_automatically_memory` `:2121`. Guarantee: append-only history,
invalidation of dependents on correction, learning is explicit-only. Typed
contract: `LorenzEvent{kind,id,conversation,dependency,supersedes,actor,origin,
text,detail,owner}` (`system.bend:1039`). Pure: only the `IO` wrappers touch
files; the transition decision is pure and the file has no spawn/Git/net
(`system.bend:863-865`).

### c.1–c.5 The extension set

Every op below is **pure**: no process spawn, no Git, no network. Verified at
`system.bend:863-865`, `runtime/ops/status.bend:10-11`, `runtime/ops/fold.bend:21-25`,
`runtime/worker/diffusion.bend:1-37`, `runtime/worker/history.bend:1-6` (the last two
preserved in `stash@{1}^3`),
`runtime/programs/retrieval/graph.bend:17`, `rank.bend:20`,

| # | Op | Reuses | Guarantee | Typed contract |
|---|---|---|---|---|
| c.1 | **record / evidence** | `system.bend:860`, `:927-974` | Idempotent record; identical decoded text reuses; changed/unrelated text fails closed; missing ≠ unreadable | `evidence_verdict(expected: String, previous: Maybe<String>) -> Verdict{Record\|Reuse\|Mismatch}` |
| c.2 | **status projection** | `runtime/ops/status.bend:90-91` | Total: one row per record for any list; canonical order by event id; order-independent; malformed rejected | `Record -> Row`, `project : +List<Record> -> +List<Row>` (`status.bend:32`, `:35`, `:90`) |
| c.3 | **dedupe + ordering** | `status.bend:66-91`, `system.bend:1042-1049` | Canonical total order by monotonic id; dedupe idempotent by key; stable | `dedupe_order : +List<Record> -> +List<Record>` (keys unique, ascending `event`) |
| c.4 | **cursor / ledger-as-memory** | `runtime/ops/fold.bend:29-72` | Monotone cursor = associative fold over stamps; chunk partials combine; idempotent on overlap | `Op is Data: Add{}\|Max{}` (`fold.bend:29-31`); `fold : (+Op, +List<Nat>) -> Nat` (`:49`); `FoldInput{op,values}` (`:66`), `run` (`:69`) |
| c.5 | **retrieval** | `diffusion.bend`, `retrieval/{graph,rank,route}.bend` | Reranks only caller-admitted in-scope nodes; abstain is first-class; bounded rounds; deterministic tie-break; no provenance leak | `Graph{count,offsets,nbrs,kinds}` (`graph.bend:26-28`); `diffuse : (Nat,+Graph,+List<Nat>,+List<Nat>,Nat,Nat,Nat)->+List<Nat>` (`rank.bend:157`); `route : (+List<Nat>,Nat,Nat)->Route` (`route.bend:115`) |

Per-op detail and why each is pure:

- **c.1 record/evidence.** The worker already separates the decision from I/O:
  `store_text_equal` (`system.bend:860`) and the match/record/replay selectors
  (`store_match :927-932`, `store_record_existing :942-945`,
  `store_replay_existing :966-974`) are pure; only `store_read :908` /
  `store_write :920` touch the filesystem. Guarantee cites the documented
  contract: records are untrusted single-writer files; missing, changed,
  malformed and oversized records fail closed (`runtime/adaptive/README.md:39-45`).
  New op wraps the pure verdict; the host owns the file.
- **c.2 status projection.** Already a pure kernel; its only effect is `IO.print`
  in `main` (`status.bend:278-284`); the header note states "No file reads, no
  network, no process spawn, no writes" (`status.bend:10-11`). Laws:
  `status_one_row_per_record` (`:219`), `status_projection_total` (`:231`),
  `status_order_independent` (`:256`), `status_malformed_rejected` (`:263`).
  An `init`-only snapshot is the `external-unbound` session row (session identity
  is external, `bend-state-view.md:65-68`).
- **c.3 dedupe + ordering.** `insert_row`/`sort_rows` (`status.bend:73-91`)
  give a canonical ascending-`event` order; worker ids are `1 + size`
  (`system.bend:1042`, `:1049`), so ordering is closed under append
  (`lorenz_append_preserves_history_length :1056`). Dedupe by key is a pure
  equality filter; no I/O in these defs.
- **c.4 cursor / ledger-as-memory.** The desk cursor is a SQLite `INTEGER`
  (`core.js:27`) advanced with `Math.max` over page timestamps and re-read with
  overlap (`buzz.js:53`, `:65-67`). Its pure content is exactly a `Max` fold:
  `cursor(prev, stamps) = fold(Max{}, prev :: stamps)`. `fold.bend` proves
  `fold_identity` (`:155`), `fold_singleton` (`:162`), `fold_chunk` (`:174`) and
  the supporting associativity laws (`:82`, `:119`), so a coordinator may chunk
  the stamp list and combine partials. Host only persists the resulting `Nat`.
- **c.5 retrieval.** `runtime/worker/diffusion.bend` is a pure task-scoped kernel:
  no I/O/clock/network/subprocess/hashing; it re-ranks only caller-admitted
  in-scope nodes and filters out-of-scope before top-K (`diffusion.bend:1-37`).
  `route.bend` fuses lexical + diffusion heat and makes `Abstain` a first-class
  verdict (`route.bend:5-15`, `:23-25`), with a no-provenance-leak predicate
  (`route.bend:120-127`). `graph.bend:17` and `rank.bend:20` state purity
  explicitly. The shell owns slug mapping, schema validation, sha256 and
  publication; Bend owns only the ranking decision.

Optional seventh kernel: `runtime/worker/history.bend` (pure Buzz-event →
daily state-of-work; header `history.bend:1-6`, types `:29-37`) supplies
ledger-as-memory history without a clock.

None of c.1–c.5 opens a socket. Even the loopback connector is unrelated: it is
restricted to `TCP.connect("127.0.0.1", …)` (`system.bend:1769`) and validates a
204 only (`system.bend:1601-1603`); the memory ops never call it.

---

## (d) The neater stack layering

```text
LAYER 3  non-npm entry        Makefile:14,19-20,22-23,25-35   (thin, host)
LAYER 2  thin host driver     process.js / jobs.js git / buzz.js transport /
                              core.js fs+hash / cli.js dispatch / discover
LAYER 1  Bend memory+ops      worker/system.bend (memory & protocol) ·
                              ops/status.bend · ops/fold.bend ·
                              worker/history.bend · worker/diffusion.bend ·
                              retrieval/{graph,rank,route}.bend
LAYER 0  external effects     process, git, remote HTTPS, SHA, mkdir
```

One concern, one owner:

| Concern | Layer | Evidence |
|---|---|---|
| Memory lineage, transitions, evidence verdict, dedupe, ordering, cursor, retrieval ranking | 1 (pure) | `system.bend:1049`, `:1209`; `status.bend:90`; `fold.bend:49`; `diffusion.bend:1-37` |
| Process spawn, git worktree/diff/land, remote Buzz, JSON parse, SHA, mkdir, env hygiene | 2 (driver) | `process.js:2-18`; `jobs.js:20-22`, `:76-101`; `buzz.js:3-8`, `:40`; `core.js:8`, `:50-55`; `runtime.js:3-9` |
| Non-npm invocation | 3 | `Makefile:14-35` |

### What disappears

- The whole npm script surface `package.json:11-18` — replaced by
  `Makefile:14-35`. `npm run check` (`package.json:17`) → `make check`
  (`Makefile:14`).
- The desk SQLite ledger `core.js:19-29` — replaced by the immutable Bend
  snapshot lineage (`system.bend:1042-1049`, `:1237`) plus a thin host
  serializer.
- The desk `outbox` table `core.js:26` and its draft/sending/sent/uncertain
  machine `buzz.js:9-33` — replaced by a pure dedupe-key op plus Buzz-native
  send.
- Desk's read view `desk list`/`show` (`cli.js:56-57`) as the canonical state
  view — replaced by the pure status projection (`status.bend:90-91`) driven by
  `make bend-status` (`Makefile:19-20`).
- `stop` (`cli.js:50-52`) and npm-shaped help/docs (`cli.js:12-34`,
  `runtime/desk/README.md:5-10`).

### What remains as the thin driver

Only effects that Bend provably cannot perform
(`system.bend:863-865`, `runtime/adaptive/README.md:116-118`):

- spawn/timeout/env: `process.js:2-23`, `runtime.js:2-9`, `cli.js:37-41`;
- git worktree/diff/land: `jobs.js:20-22`, `:57-61`, `:76-101`;
- remote Buzz transport + relay JSON parse: `buzz.js:3-8`, `:17-33`, `:40`,
  `:89-94`;
- FS/hash/mkdir/config: `core.js:8`, `:13-18`, `:19-29`, `setup.js:4-9`;
- read-only discover view: `scripts/telepathy-discover.mjs:33-46`;
- test driver: `Makefile:16-17`;
- dispatch: `cli.js:55-109`.

Desk is reduced, not deleted: it becomes the host driver for worktrees, git
landing and Buzz, while its records/state logic moves into Layer 1.

---

## (e) Migration boundary and the smallest atomic first step

**Never moves (needs a forbidden primitive):** spawn (`process.js:2-18`), Git
(`jobs.js:20-22`, `:90-98`), SHA (`core.js:8`), mkdir/file overwrite
(`core.js:50-55`), remote HTTPS/Buzz (`buzz.js:3-8`; Bend reaches only
`127.0.0.1`, `system.bend:1769`), and JSON parsing of arbitrary relay payloads
(`buzz.js:40`).

**Moves to Layer 1:** the pure decisions of §c — projection, state gates,
dedupe/ordering, cursor fold, evidence verdict, retrieval.

**Smallest atomic first step (removes one real dependency, keeps the
capability):** delete the root `package.json` script surface
(`package.json:11-18`) so **npm is no longer the operational entry**, and route
every capability through the already-present Makefile targets
(`Makefile:14-35`). Every capability is preserved because each target is a
one-to-one mirror: `make setup|doctor|desk|opencode` (`Makefile:25-35`),
`make discover` (`:22-23`), `make test` (`:16-17`), `make check` (`:14`). The
`npm install` workspace declaration (`package.json:8-10`) is removed in the same
change only after confirming no third-party runtime import — verified: every
import under `runtime/desk/src/` and `scripts/telepathy-discover.mjs` is a
`node:` builtin or a relative path, so no module resolution is needed at
runtime.

- **Atomicity:** it touches one manifest's `scripts` block; no Bend source, no
  store, no desk logic, no Makefile change.
- **Dependency removed:** npm as the entry for run/check/discover
  (`package.json:11-18`), including `npm run check` (`package.json:17`).
- **Capability kept:** identical test invocation (`Makefile:17` equals the
  task-revision `package.json:17`) plus the Bend status gate
  (`Makefile:19-20`).
- **Named check:** `make check` → `All terms check.` after 12 desk tests (and 15
  total when `scripts/*.test.mjs` is present). This was run in-session; output
  recorded in §Verification. Secondary check: `make bend-status` →
  `All terms check.`
- **Precondition:** the task-revision `Makefile`, `runtime/ops/status.bend` and
  `scripts/telepathy-discover.mjs` are currently in `stash@{1}^3`, not the
  working tree; restore them (by the operator, outside this task) before landing
  this step, or `make` will not exist.

A clearly-scoped **second** step, for the desk dimension, is to wire the desk
read view to the status op: replace `desk list`/`show` (`cli.js:56-57`) as the
canonical entity view with `make bend-status` (`Makefile:19-20`) over a snapshot
the host serializes into `Record`s. That removal is deliberately not the first
step because it needs the host serializer and therefore is not atomic.

---

## Verification commands run for this draft

```sh
cd /Users/a3fckx/Desktop/Attri/telepathy-shared-learning
export BEND_NO_TELEMETRY=1
~/.bend/bin/bend version                                                     # bend 2.0.21
shasum -a 256 runtime/worker/system.bend                                     # 6e224e26…9d74 (matches runtime/worker/README.md:5)
~/.bend/bin/bend runtime/worker/system.bend --check-only                     # All terms check.  exit 0
~/.bend/bin/bend runtime/ops/fold.bend --check-only                          # All terms check.  exit 0
git show "stash@{1}^3:runtime/ops/status.bend" > "$TMP/status.bend"
~/.bend/bin/bend "$TMP/status.bend" --check-only                             # All terms check.  exit 0
~/.bend/bin/bend "$TMP/status.bend"                                          # 6-row canonical view (5 valid + 1 malformed)  exit 0
node --test runtime/desk/test/*.test.js                                      # tests 12  pass 12  fail 0
make check                                                                   # tests 15  pass 15  fail 0; All terms check.  (ran at ~13:0x, before the concurrent stash)
```

Observed: `make check` ran successfully in-session against the task revision
(15/15 tests and `All terms check.`). It can no longer be re-run from the
working tree because the Makefile was stashed by the concurrent writer
(§0). `runtime/ops/status.bend` was verified read-only from `stash@{1}^3`
without restoring it. `runtime/worker/system.bend` and `runtime/ops/fold.bend`
still check in the working tree now (both `All terms check.`).

Note: `--help`/`--help`-style flags are not always accepted; `bend version`
(not `--version`) reports the toolchain, and `bend FILE --check-only` is the
check form (`runtime/adaptive/META.md:38`).

---

## Outstanding work and risks

- **Concurrent mutation (blocking for landing).** `Makefile`,
  `runtime/ops/status.bend` and `scripts/telepathy-discover.mjs[.test.mjs]` are
  in `stash@{1}^3`, not the working tree, and `package.json` reverted to HEAD.
  The first step in §e cannot land until the operator restores them. This task
  did not restore, pop or edit the stash (no external effect).
- **Proposal, not a decision.** The five-entity set and state vocabulary remain
  an unreviewed proposal (`docs/drafts/meta/one-file-bend-command.md:245-269`,
  `:305-308`); this draft maps onto it without renaming any store.
- **No code, store or manifest was changed.** No npm removal, no op was added,
  no desk file edited; `package.json:11-18` removal is a recommendation only.
- **The status op is a pure projection, not a live reader.** `runtime/ops/status.bend`
  reads no live store (`status.bend:10-11`); a host serializer is required
  before it can replace `desk list`/`show` (second step, §e).
- **Session identity stays external** (`external-unbound`), so no durable
  artifact cross-references a runtime session id.
- A reported worker result and an explicitly learned finding are **not** a
  verified code bundle and **not** human acceptance. `learn` is attributed
  memory (`runtime/worker/README.md:41-44`, `runtime/adaptive/META.md:110-111`).
  Only Shubham reviewing this exact revision resolves the work; nothing is
  committed, merged, pushed, published or sent.
- Coordinator evidence for this run lives only in a private, gitignored
  single-writer snapshot lineage; raw prompts, receipts and session identifiers
  are not reproduced here.
