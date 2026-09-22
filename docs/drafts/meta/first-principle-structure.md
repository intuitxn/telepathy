# DRAFT — first-principle structure: a Bend command surface over state directories

Status: draft, agent-authored · Updated: 2026-09-22 · **Not published, not sent,
not committed. No external effect; no publication authority.** Written for human
review. Sole owner of this file: the coordinator. A named human accepts the exact
revision; nothing here is acceptance.

Human intent (verbatim): *"every command in the kernel can be executable in
certain manner and in the directory as per the state to which changes happen.
first principle structure."*

Three answers:

- **What changed.** The kernel is specified, from Bend Base primitives upward, as
  a **command surface**: one Bend file that dispatches a `verb` over **state
  directories**, reading the directory of the state it starts from and writing the
  directory of the state it produces.
- **Why it matters.** Deriving the surface from the primitives we actually have
  (not from convention) makes every command executable, inspectable, replayable,
  and checkable — and it draws a hard line between the pure core that carries the
  laws and the effectful shell that does IO.
- **What is needed.** A human owner/reviewer, and resolutions to the numbered
  open decisions in §8 (directory derivation, idempotence policy, and the verb
  set). No code is changed by this draft.

Legend: **[V]** verified by read-only check in this session (2026-09-22) ·
**[D]** designed here, not implemented · **[U]** unverified / prior artifact.

---

## 1. The model

A **kernel** is one Bend file. It is a **command surface**:

```text
bend <kernel>.bend -- <verb> <args...>
```

- A **state** is a directory. A **command** is a state transition: it reads the
  directory of the state it starts from and writes the directory of the state it
  produces.
- The **target directory is derived** from the transition — `verb_dir(state, verb)`
  — **not hardcoded**. The pure core returns the next state; the shell turns the
  state + verb into a path.
- The **pure core** (decision logic) carries the laws. The **effectful shell**
  (`main` + `File.*` / `IO.*`) performs IO. **Nothing impure carries a law.**

Flow:

```text
argv ──IO.args──▶ [ verb , args... ]
                      │
                      ▼
        verb_dir(state, verb) ──── pure ────▶  D'  (next state directory)
                      │
   File.open("<D>/<file>", "r") ── effectful ──▶  raw bytes
                      │
                      ▼
        pure core:  decide(verb, state)  ──── carries the laws ────▶  next state
                      │
   File.open("D'/<file>", "w") ── effectful ──▶  bytes on disk
                      │
                      ▼
                   IO.print
```

This is the same boundary already stated for ops: "Bend owns only the pure
decision over handed-in values. It cannot spawn a process, reach the network,
create a directory, or compute a hash"
(`docs/drafts/meta/op-dispatch-convention.md:82-99`). The structure below makes
that boundary the *shape* of the kernel, not an afterthought.

---

## 2. Why first-principle

Derive the structure from the primitives that exist, not from convention. Bend
Base (`~/.bend/bend2/base.bend`, tested `bend 2.0.21` **[V]**) exposes exactly:

| Primitive | base.bend line | Used by the command surface for |
|---|---|---|
| `IO.args()` | `base.bend:190` | the `[verb, args...]` vector |
| `File.open(path, mode)` | `base.bend:257-258` | opening `<dir>/<file>` for `"r"` / `"w"` |
| `File.read(file, max)` | `base.bend:262` | reading a state file |
| `File.size(file)` | `base.bend:277` | bounded-read guard |
| `File.write(file, data)` | `base.bend:282` | writing the next state file |
| `File.close(file)` | `base.bend:292` | closing the handle |
| `IO.print(text)` | `base.bend:174` | the command's stdout result |
| `IO.print_err(text)` | `base.bend:182` | diagnostics on stderr |
| `IO.die(code, msg)` | `base.bend:194` | explicit refusal / bad usage |
| `IO.spawn(act)` | `base.bend:211` | parallel check fan-out (optional) |
| `IO.fork(act)` / `IO.join(chan)` | `base.bend:244` / `base.bend:254` | join a forked result |

What is **absent** is as important as what is present: "No native subprocess,
Git, SHA, directory creation, locks or atomic rename are available in this Bend
Base. Caller creates a private directory." (`runtime/worker/system.bend:863-865`
[V]). So the kernel can address only files **inside directories that already
exist**.

Given exactly those primitives, a command surface over directories is the
**minimum** structure that is:

| Property | Why this structure supplies it |
|---|---|
| Executable | `IO.args` → `match` on the verb → `File.open`/`write`/`print` (`system.bend:1935-1950` is a working instance [V]) |
| Inspectable | a state is bytes on disk under a named directory; a human or the host reads it directly |
| Replayable | same input directory + same verb ⇒ same output bytes (the core is pure; see §5) |
| Checkable | the pure core's laws are proven by `--check-only`; impure code carries no law |

**Contrast with the Python driver it replaces.** The incumbent host wrapper is
`runtime/programs/cli.py` (21 KB): `argparse`, `asyncio`, `hashlib`, `fcntl`,
`tempfile`, `uuid`, `urllib`, and a literal role table
`REGISTRY = {...}` (`runtime/programs/cli.py:29`), default model at
`:30`. It "compiles the Nudge `nudge.transaction/v1.1` source files … and
executes one typed transaction with the real oc2 binary"
(`runtime/programs/README.md:1-20` [V]).

| Axis | Python driver (`cli.py`) | Bend command surface |
|---|---|---|
| Decision logic | inside the host process | pure core, compiler-checked laws |
| State | SQLite/JSON under `.local/` | directories of plain files |
| Failure mode | runtime exception after start | type/law failure before execution |
| Verification | host tests (`test_programs.py`) | `--check-only` + named laws |
| Effects it can do | spawn, network, fs, hash | only `File.*`/`IO.*` on existing dirs |

The honest scope: the Python driver **owns the effects Bend cannot** (process
spawn, network, hashing, identity). The kernel owns the **pure decision**. This
draft does not claim the driver is deleted; see open decision 11.

---

## 3. The state directory

### 3.1 What a state directory contains

Proposed layout **[D]** — one directory per state, holding named plain files:

| File | Holds | Source of truth today |
|---|---|---|
| `state` | the canonical current-state header (lineage id + ordinal) | derived; today implicit in the snapshot |
| `task` | the retained task/request only | the `capture` event (`system.bend:1374`) |
| `plan` | the delegation plan from `plan` | **[D]** no `plan` verb today |
| `evidence` | returned evidence (reported result + references) | the `return` event (`system.bend:1546`) |
| `verdict` | one `GREEN`/`YELLOW`/`RED` line per check + summary | `ops/runs/<run>/verdict` (`op-dispatch-convention.md:127-135`) |
| `history` | append-only event lineage (the current snapshot) | the immutable snapshot file [V] |

### 3.2 Naming / derivation rule

Proposed, pure and total **[D]**:

```text
verb_dir(state, verb) = "<root>/" ++ verb ++ "-" ++ Nat.show(1 + lorenz_size(history(state)))
```

The ordinal mirrors the existing event-id rule `n = 1 + lorenz_size(xs)`
(`runtime/worker/system.bend:1212` [V]). Because `lorenz_size` and `concat` are
pure, `verb_dir` is a **pure function of (state, verb)** — never of clock, env or
randomness. The exact format is open decision 2; the property "derived, not
hardcoded" is not.

**Constraint:** the target directory must already exist, because Bend cannot
create one (`runtime/worker/system.bend:863-865` [V]). Directory creation is
host-side. See open decision 3.

### 3.3 Lineage map

The verb vocabulary is `runtime/adaptive/META.md`: sequence at `META.md:59-65`
(`init → capture → work → worker → claim → packet`), `return` at `META.md:99`,
`learn` at `META.md:107`, corrections at `META.md:112`. The full help line lists
every verb (`runtime/worker/system.bend:1828-1829` [V]).

| Step | Verb | Input dir | Output dir | Files written | Pure core | Present? |
|---|---|---|---|---|---|---|
| init | `init` | (none) | `init-0` | `history=[]`, `state` | `[]` | [V] `system.bend:1914` |
| capture | `capture` | `init-0` | `capture-1` | `task`, `history` | event kind 1 | [V] `system.bend:1374` |
| plan | `plan` | `capture-1` | `plan-2` | `plan`, `history` | `plan(Task) -> Plan` (§6) | [D] not present |
| work | `work` | `plan-2` | `work-3` | `history` (kind 4) | event kind 4 | [V] `system.bend:1445` |
| register | `worker` | `work-3` | `work-3` | `history` (kind 5) | event kind 5 | [V] `system.bend:1512` |
| claim | `claim` | `work-3` | `claim-4` | `state`, `history` | kind 6 guard | [V] `system.bend:1529` |
| packet | `packet` | `claim-4` | (none; print) | — | read-only projection | [V] `system.bend:1595` |
| return | `return` | `claim-4` | `return-5` | `evidence`, `history` | event kind 7 | [V] `system.bend:1546` |
| learn | `learn` | `return-5` | `learn-6` | `verdict` ref, `history` | event kind 8 | [V] `system.bend:1566` |
| correct | `correct` | any `history` dir | `correct-n` | `history` (kind 3) | dependent invalidation | [V] `system.bend:1409` |

`META.md` interposes `worker` between `work` and `claim` (`META.md:62-63`); the
table keeps it explicit. `history` (`system.bend:1363`) and `memory`
(`system.bend:1918`) are **read-only** projections — no output directory.

---

## 4. The command table

`purity` names the **decision**; the surrounding `File.*`/`IO.*` write/print is
always the effectful shell and never carries a law. `present` cites today's
dispatch.

| Verb | Args | Reads | Writes | State transition | Purity (core) | Present? |
|---|---|---|---|---|---|---|
| `help` | — | — | stdout | none | pure string | [V] `system.bend:1828-1829`, `:1938` |
| `init` | `OUT` | — | `history=[]` | ∅ → S₀ | pure `[]` | [V] `system.bend:1914` |
| `capture` | `IN OUT retain ACTOR ORIGIN TEXT` | `IN` | `OUT` | S → capture(S) | pure event | [V] `system.bend:1374` |
| `plan` | `IN OUT …` | `IN`/`task` | `OUT/plan` | S → plan(S) | pure `Plan` (§6) | [D] absent |
| `work` | `IN OUT CONV ACTOR OWNER ACCEPTANCE` | `IN` | `OUT` | S → work(S) | pure event | [V] `system.bend:1445` |
| `claim` | `IN OUT WORK WORKER ACTOR` | `IN` | `OUT` | S → claim(S) | pure guard | [V] `system.bend:1529` |
| `packet` | `IN WORK` | `IN` | stdout | read-only | pure `String` | [V] `system.bend:1595` |
| `return` | `IN OUT WORK WORKER ACTOR RESULT EVIDENCE` | `IN` | `OUT` | S → return(S) | pure event | [V] `system.bend:1546` |
| `learn` | `IN OUT RESULT DEP ACTOR TEXT` | `IN` | `OUT` | S → learn(S) | pure event | [V] `system.bend:1566` |
| `correct` | `IN OUT MEM DEP ACTOR REASON TEXT` | `IN` | `OUT` | S → correct(S) | pure invalidation | [V] `system.bend:1409` |
| `retrieve` | `IN ANCHOR … SCOPE BUDGET` | `IN` | stdout | read-only ranking | pure ranked list | [D] `mundus-runtime-proposal.md:46` |
| `status` | `IN` | `IN` | stdout | read-only projection | pure `Row` list | [D] proposal; pure half in `runtime/ops/status.bend` [V check] |
| `op` | `OP IN` | `OP` file + `IN` | stdout / run dir | dispatch to op core | pure op | [D] `op-dispatch-convention.md:159-181`; `runtime/ops/fold.bend` [V check] |

Read-only verbs (`help`, `packet`, `retrieve`, `status`, `explain`, `history`,
`memory`) take **no `OUT`** and have no output path to write.

---

## 5. Idempotence and replay

Rule **[D]** (built on existing precedent [V]):

1. If the target directory does **not** exist → write it; this is the normal
   forward transition.
2. If the target directory **already exists** → the second run must be either
   **byte-identical** (an idempotent no-op, exit 0, no write) or an **explicit
   refusal** (`IO.die`, nonzero). It must never silently overwrite diverging
   content.

This mirrors what already ships:

| Precedent | Behavior | Cite |
|---|---|---|
| `record` / `replay` | "An identical record is idempotent; different existing content is rejected." | `runtime/adaptive/README.md:31-37` [V] |
| `lorenz_save_existing` / `lorenz_save_size` | existing content compared as decoded text; mismatch rejected | `runtime/worker/system.bend:1312-1332` [V] |
| "Every OUT must be new" | the lineage is single-writer; do not race | `runtime/adaptive/META.md:67-68` [V] |

The check: recompute the pure core on the input state, serialize deterministically
(byte-stable ordering, fixed-width fields), compare to the existing output file.
Equal ⇒ no-op; differ ⇒ refusal. `replay` is the same read path with the write
disabled, so its stdout must be byte-identical across two runs (the `status`
determinism argument at `docs/drafts/meta/bend-state-view.md:158-161` [V]).

Caveat [V]: writes are **not atomic**; there are no locks or rename, and the
caller creates directories (`runtime/worker/system.bend:863-865`;
`runtime/worker/README.md:41-44`). Idempotence is therefore a single-writer
discipline, not a concurrency guarantee.

| Case | Behavior | Exit |
|---|---|---|
| output dir absent | deterministic write | 0 |
| output dir present, identical bytes | no-op | 0 |
| output dir present, different bytes | `IO.die` explicit refusal | nonzero |
| input dir missing/unreadable | `IO.die` (never treated as empty) | nonzero |
| bad arity / unknown verb | fall through to `help` + die | nonzero (`system.bend:1949-1950` [V]) |

---

## 6. RLM-like delegation: `plan(Task) -> Plan`

**Designed [D].** `plan` is a **pure recursive decision**. One invocation returns
**one level** of the plan; the **host recurses** (applies the plan, then calls
`plan` again per child). Keeping it to one level keeps the core total and pure and
puts the loop in the shell.

```text
type Task is Data: Task{ goal: String, budget: Nat, depth: Nat, cap: Nat }
type Plan is Data:
  Leaf{ task: Task }
  Split{ parent: Task, children: +List<Task> }   # 0 < len(children) <= cap

def plan(t: Task) -> Plan:
  if t.budget < leaf_threshold or t.depth >= max_depth:
    Leaf{t}
  else:
    Split{t, partition(t)}     # children disjoint, sub-budgeted, depth+1
```

**Invariants (named laws — each must have a falsifying mutant):**

| Invariant | Claim | Falsified if… |
|---|---|---|
| Budget conservation | `sum(child.budget for child in children) <= parent.budget` | a split allocates more than the parent held |
| Termination | `max_depth` finite **and** `child.budget < parent.budget` on every split | repeated splits never reach `Leaf` |
| Independence | children declare **disjoint write targets** | two children name the same target |
| Proportionality | child budget is monotone non-decreasing in that child's estimated work | a larger subtask receives a smaller budget |

**`fold_verdicts` is RED-dominant.** The verdict domain reuses the loop
vocabulary verbatim (`op-dispatch-convention.md:142-157`; GREEN = proven,
YELLOW = informational, RED = anything else, and any RED → nonzero):

| `fold_verdicts` | GREEN | YELLOW | RED |
|---|---|---|---|
| **GREEN** | GREEN | YELLOW | RED |
| **YELLOW** | YELLOW | YELLOW | RED |
| **RED** | RED | RED | RED |

Identity = `GREEN`; associativity holds; a single RED at any leaf makes the whole
fold RED. This is a monoid, so a coordinator may fold per-child verdicts in any
order — the same homomorphism argument used for `fold` (`runtime/ops/fold.bend`
[V check]).

---

## 7. Boundaries

**The kernel may:**

- read and write files inside its state directories (`File.open` `"r"`/`"w"`,
  `base.bend:257`);
- print to stdout/stderr (`IO.print`, `IO.print_err`; `base.bend:174`, `:182`);
- read `IO.args()` (`base.bend:190`) and `IO.get_env` (`base.bend:186`);
- optionally fork/join pure checks (`IO.fork`/`IO.join`; `base.bend:244`, `:254`).

**The kernel mustNot:**

- accept, merge, push, publish, send, or resolve anything
  (`runtime/adaptive/META.md:102-112`; `op-dispatch-convention.md:193-203`);
- self-accept, or treat a GREEN check as acceptance
  (`op-dispatch-convention.md:154-157`);
- carry secrets, session transcripts, receipts or credentials in args or files
  (`AGENTS.md`; `docs/drafts/meta/mundus-runtime-proposal.md:72-80`);
- create directories, spawn a process, hash, or lock — none is a Base primitive
  (`runtime/worker/system.bend:863-865`).

**Host-side (out of the kernel):**

| Effect | Owner | Cite |
|---|---|---|
| Directory creation | host | `system.bend:863-865` |
| Spawn `bend`, git, `opencode`, `buzz` | host | `one-file-bend-command.md:111-118` |
| Network / loopback delivery | host | `system.bend:1601-1603` |
| Identity, receipts, signer | host / owner signer | `runtime/worker/BUZZ.md` |
| Human acceptance of the exact revision | named human | `op-dispatch-convention.md:154-157` |

---

## 8. Acceptance criteria and open owner decisions

### 8.1 Checkable acceptance criteria

`bend` = `BEND_NO_TELEMETRY=1 ~/.bend/bin/bend` (tested 2.0.21 **[V]**).

| # | Criterion | Check |
|---|---|---|
| AC1 | Every kernel checks clean | `bend <kernel>.bend --check-only` → `All terms check.` exit 0, for each kernel |
| AC2 | Each verb's decision carries a law | a named law per `decide` function + a mutant copy that fails (exit 1) |
| AC3 | `verb_dir` is pure, total, deterministic | a law asserts `verb_dir(fixture, verb)` equals a fixed literal; a mutant derivation fails the check |
| AC4 | No hardcoded target dir | grep shows the only path source is argv + `verb_dir`; no output literal in the pure core |
| AC5 | Idempotence | run a verb twice on the same input dir: second run is byte-identical no-op or explicit refusal, defined exit codes |
| AC6 | Replay | `replay`/read path on one input dir yields byte-identical stdout across two runs |
| AC7 | Purity boundary | no `File.*`/`IO.*` in the pure core module; law set type-checks with no IO |
| AC8 | Plan invariants | named laws for budget conservation, termination, independence, proportionality; `fold_verdicts` RED-dominance law with a RED negative fixture |
| AC9 | No forbidden effects | no `TCP.*` or `IO.spawn` reachable from verb dispatch |
| AC10 | Lineage round-trip | a fixture lineage writes each named file in each step's directory and re-reads identically |

AC1 is already green today for `runtime/worker/system.bend`,
`runtime/ops/fold.bend`, `runtime/ops/status.bend` **[V]**; AC2–AC10 are **[D]**.

### 8.2 Open owner decisions (unresolved)

1. **Owner and independent reviewer** of this structure — a named human.
2. **Directory derivation:** the exact `verb_dir` format and the ordinal source
   (global event id vs per-verb counter).
3. **Directory creation / pre-existence:** must the target dir pre-exist (Bend
   cannot `mkdir`), and who creates it?
4. **State unit:** keep the current single immutable snapshot file, or add the
   directory layer and migrate?
5. **Idempotence policy:** silent no-op on identical bytes vs explicit refusal;
   the exact exit codes.
6. **Canonical verb set and names:** adopt `plan`/`retrieve`/`status`/`op`; keep
   `worker`/`remember`; and whether the legacy `lorenz`-prefixed aliases
   (`system.bend:1952-1961`) are deprecated.
7. **`plan` thresholds:** leaf budget threshold, `max_depth`, reserve factor, and
   the child-budget split rule (proportionality).
8. **`fold_verdicts` domain:** exactly `{GREEN, YELLOW, RED}` with identity
   `GREEN`, or does it also aggregate a complexity cost?
9. **History authority:** is the immutable file lineage still the unit of
   identity, or does the directory become the unit?
10. **`status`/`retrieve`:** stay fixture-only pure kernels, or become real
    file-reading verbs wired into the worker (`mundus-runtime-proposal.md:123`)?
11. **The Python driver** (`runtime/programs/cli.py`): retire, keep, or reduce to
    the effectful shell only?

---

## 9. DESIGNED vs VERIFIED

| Claim | Status | Evidence |
|---|---|---|
| `bend 2.0.21` at `~/.bend/bin/bend` | **[V]** | `bend version` this session |
| Base exposes `IO.args`/`File.*`/`IO.print`/`IO.die`/spawn/fork/join | **[V]** | `base.bend:174-292` |
| Base has **no** subprocess/Git/SHA/mkdir/lock/rename | **[V]** | `system.bend:863-865` |
| Verb dispatch exists (`init`…`learn`, `packet`, `help`, `record`) | **[V]** | `system.bend:1935-1950`, `:1828-1829` |
| Existing kernels check clean | **[V]** | `--check-only` → `All terms check.` for worker, `ops/fold.bend`, `ops/status.bend` |
| "A state is a directory" (today a single file) | **[D]** | directory model proposed here |
| `verb_dir(state, verb)` derived, not hardcoded | **[D]** | rule at §3.2 |
| `plan(Task) -> Plan` and `fold_verdicts` | **[D]** | §6; no `plan`/`fold_verdicts` symbol exists in the repo |
| `retrieve` / `status` / `op` as real verbs | **[D]** | `mundus-runtime-proposal.md:46`; `bend-state-view.md`; `op-dispatch-convention.md` |
| Idempotence = no-op-or-refuse | **[D]** | built on `adaptive/README.md:31-37`, `system.bend:1312-1332` |
| A GREEN check or a learned finding is human acceptance | **must not be claimed** | `runtime/adaptive/META.md:102-112`; GREEN ≠ acceptance |

## Verification commands run for this draft

```sh
export BEND_NO_TELEMETRY=1
~/.bend/bin/bend version
~/.bend/bin/bend runtime/worker/system.bend --check-only   # All terms check.
~/.bend/bin/bend runtime/ops/fold.bend --check-only        # All terms check.
~/.bend/bin/bend runtime/ops/status.bend --check-only      # All terms check.
```

Observed: `bend 2.0.21`; all three kernels `All terms check.` (exit 0). **No
`.bend` file and no store was modified; this document is the only file written.**

## Outstanding work (by design)

- This is a **structure specification**; no kernel was edited.
- The verb set (`plan`/`retrieve`/`status`/`op`) and the directory layout are
  proposals requiring review before any code change.
- Human acceptance of this exact revision is required. Nothing is merged, pushed,
  published, or sent.
