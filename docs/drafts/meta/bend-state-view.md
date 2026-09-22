# DRAFT — the canonical Bend state view, smallest first step (`status IN`)

Status: draft, agent-authored · Updated: 2026-09-22 · **Not published, not sent,
not committed.** This document creates no external effect and authorizes no
publication. It is written for review, not as an announcement. It defines a
design and a test plan; it does not modify any `.bend` file.

Question under examination: *what is the smallest first step toward one
Bend-owned canonical state view?*

Answer: **a read-only `status IN` transition that projects one existing Lorenz
snapshot lineage into a normalized table of the five canonical entities.** No
writes, no subprocess, no Git, no server, no network. This is the atomic step
proposed at
[`docs/drafts/meta/one-file-bend-command.md:289-303`](one-file-bend-command.md).

Privacy: this draft contains no credentials, no raw session identifiers, no
receipts, no transcripts, no prompts and no tool-call records. Session stores are
named by path only; their contents stay private.

## 0. Resolution and evidence base

| Item | Value | Evidence |
|---|---|---|
| Checkout | `/Users/a3fckx/Desktop/Attri/telepathy-shared-learning` | `~/.config/opencode/commands/meta.md` → `.opencode/commands/meta.md` (symlink) |
| Meta instructions | `runtime/adaptive/META.md` | read in full (`runtime/adaptive/META.md:17-25`) |
| Prior draft | `docs/drafts/meta/one-file-bend-command.md` | read in full |
| Worker source | `runtime/worker/system.bend` | resolves per `runtime/adaptive/META.md:18-25`; `runtime/worker/README.md:2-9` |
| Source digest | sha256 `6e224e26d47c56d3601b26b55ae77497ab4680cacda89846640380a1d9e69d74` | `shasum -a 256`; matches `runtime/worker/README.md:5` |
| Toolchain | Bend 2.0.21, `~/.bend/bin/bend` | `bend version` |
| Checker | `runtime/worker/system.bend --check-only` → `All terms check.` | run in this session, exit 0 |
| Help terms | `help` output contains `worker`, `claim`, `packet`, `return`, `learn` | `bend … -- help`, run in this session; help text at `system.bend:1828-1829` |

No shared-registry Lorenz core is used: `runtime/lorenz/system.bend` is **not**
the worker source. The worker advertised in `runtime/worker/README.md:2-9` is the
one-file Lorenz protocol that satisfies the `META.md:20-24` help-term test.

---

## (a) The canonical five entities

Source of the enumeration: the "Minimal canonical set (proposal)" at
`docs/drafts/meta/one-file-bend-command.md:245-269`, merged from the full entity
table at `one-file-bend-command.md:188-198`. Each field below is populated; the
final column cites the draft and the underlying store.

| Entity | Identity / key | Lifecycle states | Store | Durability | Sources (draft + store) |
|---|---|---|---|---|---|
| **Agent** | role/interface `id` (catalog) + charter path `agentFile`; registry also carries `name`, `label`, `status` | `declared → planned → active → retired` | charters `.opencode/agents/*.md`; catalog `plugins/telepathy-meta-agents/registry.json` | Durable (Git) | draft `one-file-bend-command.md:190`, `:249`; `registry.json:1-27` (`id`/`name`/`status`/`agentFile`) |
| **Session** | runtime-issued session id; telepathy peer keyed by `sessionID` (display `<agent>:<id8>`) | `created → live → idle → ended`; peer `status=active` | OpenCode server `run/` + `logs/`; `~/.config/opencode/telepathy/peers.json` (path only; contents private) | Ephemeral / disposable | draft `one-file-bend-command.md:191`, `:250-251`; `AGENT_DIRECTORY.md:116-119`, `:121-130`, `:132-141` |
| **Job** | `id` (randomUUID) with dedupe key `source` UNIQUE; Bend equivalent is `(lineage dir, event id = 1 + lorenz_size)`; canonical merge also carries `evidence_ref` to the Bend lineage + event id | canonical enum `queued → claimed → reported → reviewed → accepted \| rejected \| needs_attention` (a *proposal*); today: desk `queued/running/needs_review/needs_attention/resolved`; Bend derivable `queued/claimed/reported` | `.local/desk.sqlite` table `jobs` + `.local/jobs/<id>/`; Bend work/worker/claim/return events in a private snapshot | Ledger durable; worktree ephemeral; Bend snapshot durable, single writer | draft `one-file-bend-command.md:192`, `:252-258`; `core.js:24`, `:76-85`; `jobs.js:6-10`, `:14-15`, `:57-61`, `:68-73`; `system.bend:1436` (work), `:1515`, `:1520`, `:1537` |
| **Memory** | Bend local `event id` (kinds 2/3/8) | local Bend `active → needs-review → superseded`; Buzz scope `local \| published`; engram `present → tombstoned` | Bend immutable snapshot lineage; published store = Buzz engram (owner-signed) | Durable; Bend single writer, no atomic writes | draft `one-file-bend-command.md:194`, `:259-261`; `system.bend:1383` (kind 2), `:1400` (kind 3), `:1554` (kind 8), status logic `:1344-1347`; `BUZZ.md:71-79` |
| **Evidence** | immutable record identity: Bend `event id` in a lineage; artifact `id` + `digest`; historical registry bundle id | append-only `recorded`; revisions retained (`superseded`, not deleted); `draft → reviewed → exported` for a review snapshot | Bend `LorenzEvent` snapshot files; `.local/artifacts/<id>/<digest>.md`; historical registry Git branch (not migrated) | Durable, read-only record | draft `one-file-bend-command.md:195`, `:262-264`; `system.bend:1039-1040`, record/replay `:1005-1022`; `core.js:57-63`; `runtime/adaptive/HARNESS.md:27-35` |

### What the canonical enum is, and is not

- The five-entity set is a **proposal** requiring review before any code or
  mapping change (`one-file-bend-command.md:305-308`). Part (b) therefore
  projects into it without renaming any existing store.
- `outbox` is dropped as a separate entity (a projection of a Job message),
  `registry run` becomes historical Evidence, and the product object names are
  views of Job/Memory (`one-file-bend-command.md:266-267`).
- One writer per entity; ordering by monotonic id; dedupe by `source` (Job) and
  content digest (Message/Evidence) (`one-file-bend-command.md:268-269`).
- **Session is not recoverable from a Bend snapshot.** Session identity is
  supplied by an external runtime (`AGENT_DIRECTORY.md:116-119`). The `status`
  view therefore emits an explicit `external-unbound` placeholder rather than
  inventing an identity. This locality is the whole point of part (b).

---

## (b) DRAFT design for `status IN` (read-only)

> This is a specification. **No `.bend` file was edited** to produce it. Adding
> the subcommand is the proposed future change; the smallest testable increment
> is the pure projection plus one named law described in part (c).

### Invocation and arguments

```
bend <worker-source> -- status SNAPSHOT
```

- `status` — command word (literal).
- `SNAPSHOT` — exactly one existing immutable Lorenz snapshot file, as written
  by `init`/`capture`/`work`/`worker`/`claim`/`return`/`learn`/`correct`.
- Total argument count: **two** (`status`, `SNAPSHOT`), no `OUT`, no optional
  flags. This maps onto the existing two-positional dispatch case
  `Con{command, Con{path, Nil{}}}` at `system.bend:1939-1940`, alongside
  `init`/`history`/`memory` (`system.bend:1911-1920`). No new arity is needed.

### Read path (all existing functions)

1. `lorenz_load(SNAPSHOT)` — `system.bend:1306-1310` → `store_read`
   `system.bend:908-911`.
2. Parse/validate via `lorenz_loaded` — `system.bend:1300-1304`.
3. Pure projection over `+List<LorenzEvent>` using `lorenz_status`
   `system.bend:1344-1347` and `lorenz_describe` `system.bend:1349-1352`.
4. Emit with `IO.print` (same pattern as `lorenz_query`
   `system.bend:1363-1366` and `lorenz_display` `system.bend:1354-1361`).

No `lorenz_save` (`system.bend:1330-1332`), no `store_write`
(`system.bend:920-924`), no `lorenz_commit` (`system.bend:1341-1342`) is
reachable from this path. The snapshot is opened `"r"` only
(`system.bend:910`).

### Output columns

One fixed header line, then one row per projected entity, ordered by ascending
event id. Columns are space-padded to a fixed width so the output is
byte-stable:

```
entity    key              state          event_id  reference  source                 durability
```

| Column | Meaning | Derivation |
|---|---|---|
| `entity` | canonical entity name: `agent`, `job`, `memory`, `evidence`, `session` | event kind → entity map |
| `key` | entity key: Agent = `label`; Job = work event id (conversation in `reference`); Memory/Evidence = event id; Session = `-` | from `LorenzEvent` fields `system.bend:1040` |
| `state` | `lorenz_status` for the event | `system.bend:1344-1347` |
| `event_id` | the event's numeric id `n` | `system.bend:1040` |
| `reference` | conversation / work id the event points at (`conversation` field) | `system.bend:1040` |
| `source` | supplied origin/label (`origin`, or worker `label`) | `system.bend:1040`, `:1515` |
| `durability` | fixed per entity: `snapshot-single-writer` (Agent/Job/Memory/Evidence), `external-unbound` (Session) | `runtime/worker/README.md:41-44`; `AGENT_DIRECTORY.md:116-119` |

Kind → entity map (from the protocol comment at `system.bend:1140-1146`):

| kind | protocol | canonical entity | Bend-derivable state (`lorenz_status`, `:1344-1347`) |
|---|---|---|---|
| 1 | conversation | Evidence (context record) | `conversation` |
| 2,3,8 | memory / correction / learn | Memory | `active` / `needs-review` / `superseded` |
| 4 | work | Job | `queued` / `claimed` / `reported` |
| 5 | worker | Agent | `worker` |
| 6 | claim | Job | `claimed` |
| 7 | return | Job | `reported` |

Fixed layout example for one lineage (illustrative only, built from the checked
fixture `system.bend:1970-1971`; not a claim about real data):

```
entity    key        state       event_id  reference  source              durability
agent     worker-a   worker      6         0          local-worker        snapshot-single-writer
job       5          claimed     7         5          conversation:example snapshot-single-writer
evidence  1          conversation 1        0          operator            snapshot-single-writer
session   -          external-unbound 0    0          -                   external-unbound
```

### Read-only guarantee

- `status` takes no `OUT`; there is no output path to write.
- It is dispatched on the same two-positional shape as `history`/`memory`
  (`system.bend:1939-1940`), which are read-only (`lorenz_query`,
  `system.bend:1363-1366`).
- The only effects are `File.open(path, "r")` (`system.bend:910`) and
  `IO.print` (`system.bend:1319` pattern). No `File.open(path, "w")`
  (`system.bend:922`), no `store_write`, no `lorenz_save`, no `lorenz_commit`,
  no TCP (`system.bend:1601-1603`), no subprocess (`system.bend:863-865`).
- Determinism: the projection is a pure function of the parsed event list; no
  clock, environment, random source or network is consulted. Running it twice on
  the same snapshot yields byte-identical output.

### Error cases (explicit)

| Case | Behavior | Exit | Cite |
|---|---|---|---|
| `status` with no path, or wrong arity | falls through to help | 1 | `system.bend:1936-1938`, `:1949-1950` |
| unknown command word | falls through to help | 1 | `system.bend:1949-1950` |
| snapshot path missing | `lorenz_invalid_snapshot` (via `store_read_failed`, code 2 = missing) | 1 | `system.bend:869-874`, `:1300-1304` |
| snapshot read error (unreadable) | read-error code propagated; never treated as empty | 1 | `system.bend:869-874` |
| snapshot too large / partial read | `evidence_too_large_or_partial_read` | 1 | `system.bend:877-882` |
| snapshot malformed | `lorenz_invalid_snapshot` | 1 | `system.bend:1300-1304` |
| empty but valid snapshot (`init` only) | prints header, zero rows | 0 | `system.bend:1356-1357` |

### Why this is the smallest step

It adds one command word and one pure projection, reusing `lorenz_load`,
`lorenz_status`, `lorenz_display` and `IO.print`. It creates no store, no
directory, no lock, no rename, no spawn and no socket — exactly inside the
capability envelope stated at `system.bend:863-865`.

---

## (c) Test plan

All three gates are local and deterministic. None needs a host, network, Git,
subprocess or server.

### 1. Deterministic-table check (named law over a fixed fixture)

Add one named law (matching the fixture style at `system.bend:1970-1974` and
`system.bend:2097-2101`, law style at `system.bend:1976-2004`) that asserts the
pure projection of the checked fixture equals a fixed literal string:

```
law lorenz_status_view_deterministic:
  {lorenz_status_view(lorenz_fixture()) == "<exact expected table>" : String}

def lorenz_status_view_deterministic():
  {==}
```

- The projection function must be the pure part (`+List<LorenzEvent> -> String`);
  the file-reading `status` command wraps it. The law therefore proves totality
  and determinism over a fixed input with no IO.
- This is a *definitional equality* check (`{==}`), so `--check-only` fails if
  the output string ever changes. That is the regression gate for the view.
- It is evidence about authored kernels and fixtures, not about arbitrary worker
  answers (`runtime/worker/README.md:8-9`).

### 2. Exact `--check-only` gate

```sh
export BEND_NO_TELEMETRY=1
"$HOME/.bend/bin/bend" \
  "/Users/a3fckx/Desktop/Attri/telepathy-shared-learning/runtime/worker/system.bend" \
  --check-only
```

Required result: **exit 0** and the literal line

```
All terms check.
```

The file precedes `--check-only`; `bend check FILE` is not supported
(`runtime/adaptive/META.md:38`; `runtime/worker/README.md:11-14`). Running this
on the **unmodified** source (as done in this session) already returns
`All terms check.`; it must still do so after the projection and law are added.

### 3. Manual read-only run + determinism diff (after the subcommand exists)

```sh
OUT=/private/dir/empty-snapshot
"$HOME/.bend/bin/bend" "$WORKER_SOURCE" -- init "$OUT"
"$HOME/.bend/bin/bend" "$WORKER_SOURCE" -- status "$OUT" > status.1
"$HOME/.bend/bin/bend" "$WORKER_SOURCE" -- status "$OUT" > status.2
diff status.1 status.2
```

Expected: identical files (`diff` empty); an `init`-only snapshot prints header
plus zero rows. This exercises the real file-read path with only Bend's native
File IO.

### What proves the first step works *(without a host or network)*

1. `--check-only → All terms check.` proves the projection and its law
   type-check in the actual compiler (Bend 2.0.21).
2. The named deterministic law proves the projection is a pure, total,
   reproducible function of the snapshot — no IO, clock, env or network.
3. The manual run over an `init` snapshot proves the read-only command executes
   using only `File.open("r")` + `IO.print` locally.
4. Two identical runs prove determinism at the byte level.

Failure of (3) with a *missing* snapshot must return `lorenz_invalid_snapshot`
(exit 1), and with a *malformed* snapshot likewise — the error table in part (b).

---

## (d) Boundary confirmation

**This step can show:** that one immutable snapshot can be read and projected,
read-only, into the canonical five-entity table; that the projection is
deterministic and total; that no new write path, store, directory, lock or
rename is introduced; and that the entity *overlaps* named in
`one-file-bend-command.md:209-243` are visible and testable before any store is
changed.

**This step cannot show (and must not be read as showing):**

- **No subprocess.** Bend Base has no spawn/exec (`system.bend:863-865`); it
  cannot run `node`, `npm`, `git`, `opencode`, `buzz`, or `bend` itself.
- **No Git.** No worktree/diff/commit/push and no independent SHA-256
  (`system.bend:863-865`; `runtime/adaptive/README.md:112-114`).
- **No server / network.** The loopback connector reaches an *already running*
  OpenCode server over plain TCP and only validates HTTP 204
  (`system.bend:1601-1603`, `:1634-1635`); `status` does not use it at all.
- **No cross-store reconcile.** `.local/desk.sqlite` (SQLite), artifact
  digests, Buzz engrams and the retired registry bundle are not Bend Base
  primitives and are not read here. Session identity is external and shown only
  as `external-unbound`.
- **No truth or acceptance.** A projected `reported` Job or `active` Memory is
  protocol state, not correctness, not human acceptance, and not an executable
  admission (`runtime/worker/README.md:41-44`; `META.md:110-112`).
- **No validated canonical enum.** The five-entity set and its state enum remain
  a proposal (`one-file-bend-command.md:252-258`, `:305-308`).

**Standing caution:** a reported worker result and an explicitly learned finding
are not a verified code bundle. `learn` is attributed memory, not executable
admission; `--check-only` passing proves the terms check, not worker-answer
correctness.

---

## Verification commands run for this draft

```sh
shasum -a 256 runtime/worker/system.bend
BEND_NO_TELEMETRY=1 ~/.bend/bin/bend runtime/worker/system.bend --check-only
BEND_NO_TELEMETRY=1 ~/.bend/bin/bend runtime/worker/system.bend -- help
```

Observed: digest matches `runtime/worker/README.md:5`; `All terms check.` (exit
0); help advertises `worker`, `claim`, `packet`, `return`, `learn`
(`system.bend:1828-1829`). No `.bend` file, shared doc, `INDEX.md` or store was
edited; no commit or external effect was produced.

## Outstanding work (not done here, by design)

- `status IN` is a **design only**; `runtime/worker/system.bend` is unchanged.
  Implementing the projection function, the `status` dispatch branch and the
  named law is the next authorized step.
- The canonical five-entity enum and its state vocabulary require review before
  any mapping or store change (`one-file-bend-command.md:305-308`).
- No cross-store reconcile, plugin hook, Git or network path is implemented or
  re-enabled; the retired JavaScript stack and shared-registry core stay
  retired.
- No store migration, no `node_modules`/manifest change, no publication, no
  Buzz/relay write, no commit.
