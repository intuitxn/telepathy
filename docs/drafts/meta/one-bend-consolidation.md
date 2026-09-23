# DRAFT — one Bend consolidation + Python removal scope

Status: **draft, agent-authored · 2026-09-22 · not published, not sent, not
committed, not accepted.** No external effect and no publication authority. A
named human must review this exact revision. This is a decision proposal, not a
job and not an authorization to delete anything.

Worktree: `/Users/a3fckx/Desktop/Attri/telepathy-mundus` @ `db4447d` (clean tree;
`git status --porcelain` empty at drafting time). Note: most repo docs cite
sibling checkouts `Attri/telepathy` or `Attri/telepathy-shared-learning`; paths
below are given as in-repo relative paths, which match this worktree.

Human intent (verbatim): **"remove the py files and have only one single bend".**

Three answers:

| Question | Answer |
|---|---|
| What changed | Nothing yet. This draft fixes what "one single Bend" means, enumerates the real Python surface, and specifies the host contract. No file was added or removed except this draft. |
| Why it matters | A literal reading ("one physical `.bend` file", "delete every `.py`") would collapse a 14-file, per-concern, law-checked Bend surface into one unreviewable file and delete hosts that keep the live workspace service, the Nudge program path, and the git state store running. |
| What is needed | One owner decision on the meaning of "one Bend" (OC-1), one on the canonical entry point (OC-2/OC-3), one on Python removal authority (OC-4), and one on retrieval authority (OC-5/OC-6). Nothing else blocks. |

The crux is resolved by evidence, not assumption: **Bend 2.0.21 does support
cross-file imports**, so "one Bend" does not require one physical file
(§1.2). This refutes the premise in the task that "Bend has no imports across
files".

---

## 0. Evidence base (all observed in this worktree, 2026-09-22)

| Item | Value | How observed |
|---|---|---|
| Toolchain | `bend 2.0.21` at `/Users/a3fckx/.bend/bin/bend` | `bend --help` prints `Bend 2.0.21` |
| `--help` claim (crux) | `bend <file.bend> --check-only` = "check the file and **its imports**; run nothing" | `bend --help` usage text |
| Cross-file gate | `bend runtime/programs/retrieval/PROOF.bend --check-only` → `All terms check.` (exit 0) with 3 relative imports + `import Base` | run this session |
| Kernel gates | `--check-only` → `All terms check.` for `worker/system.bend`, `worker/diffusion.bend`, `worker/history.bend`, `ops/fold.bend`, `ops/status.bend`, `adaptive/system.bend`, `lorenz/system.bend`, `programs/bend-laws/PROOF.bend`, `programs/retrieval/PROOF.bend` | run this session |
| Expected negative | `programs/retrieval/LAWS.bend` alone → `Error: 5 TODOs found` (laws stated, proof file separate) | run this session |
| Legacy toolchain | `bend 2.0.5` rows and `bend check FILE` in `runtime/programs/bend-laws/TOOLCHAIN.md` are historical; that subcommand does not exist in 2.0.21 | `TOOLCHAIN.md:2,59-90` vs `bend --help` |
| Parallel change during drafting | `runtime/ops/driver.py` deleted, `runtime/ops/README.md` modified, `runtime/ops/run.sh` added (POSIX-shell op driver, 406 lines) | `git status --porcelain` observed at drafting time |

Stale local notes to be aware of (do not cite as current): the two engram
notes disagree with the file on disk for `diffusion.bend` — `924 lines /
sha256 3c1aaba8…` (`mundus-runtime-2026-09-22.md`) vs present `979 lines /
sha256 92227b44…`. `kernels-diffusion.md` matches the file. The
`mundus-runtime-2026-09-22.md` "KNOWN GAP: retrieval/* fails on 2.0.21" is now
false (port done; `retrieval-port-notes.md:1-15`).

---

## 1. What "one single Bend" means

### 1.1 Enumerated Bend surface in this worktree

The task enumerated 12 files (including `runtime/agent.bend`). The actual
surface is **14 checked `.bend` files plus one in-progress file**; three were
omitted from the task list and one does not exist yet:

| Path | Lines | Laws (`^law`) | Role | `--check-only` | sha256 (first 8) |
|---|---|---|---|---|---|
| `runtime/worker/system.bend` | 2154 | 78 | Canonical Lorenz worker protocol (the resolved worker source per `runtime/adaptive/META.md:17-25`) | `All terms check.` | `6e224e26` |
| `runtime/worker/diffusion.bend` | 979 | 35 | Task-scoped diffusion retrieval kernel (draft) | `All terms check.` | `92227b44` |
| `runtime/worker/history.bend` | 466 | 23 | Buzz-event history kernel | `All terms check.` | `85d0fdf6` |
| `runtime/ops/fold.bend` | 192 | 7 | Op: associative reduction | `All terms check.` | `841f37ed` |
| `runtime/ops/status.bend` | 284 | 6 | Op: canonical status projection | `All terms check.` | `b6d7139a` |
| `runtime/programs/retrieval/graph.bend` | 171 | — | CSR adjacency types + demo graph | (via PROOF) | — |
| `runtime/programs/retrieval/rank.bend` | 171 | — | Integer-particle PPR (teleport 0.15) | (via PROOF) | — |
| `runtime/programs/retrieval/route.bend` | 137 | — | Lexical+diffusion fusion, first-class Abstain | (via PROOF) | — |
| `runtime/programs/retrieval/LAWS.bend` | 67 | 5 | Human-owned retrieval laws | fails alone (5 TODOs, expected) | — |
| `runtime/programs/retrieval/PROOF.bend` | 362 | — | AI-owned proofs; entry point for the gate | `All terms check.` | `c7b471f3` |
| `runtime/programs/bend-laws/LAWS.bend` | 99 | 5 | Human-owned harness laws | part of gate below | — |
| `runtime/programs/bend-laws/PROOF.bend` | 54 | — | AI-owned harness proofs (the gate) | `All terms check.` | — |
| `runtime/adaptive/system.bend` | 1033 | 42 | One-file adaptive system + record/replay | `All terms check.` | `7bda501e` |
| `runtime/lorenz/system.bend` | 644 | 17 | Historical/reserved; `META.md:24` says never substitute it | `All terms check.` | — |
| `runtime/agent.bend` | — | — | **ABSENT/in-progress**; not on disk at `db4447d` | n/a | n/a |

Total checked lines ≈ 6,900. The task's list omitted `runtime/adaptive/system.bend`,
`runtime/lorenz/system.bend`, and `runtime/programs/bend-laws/*` — all three are
part of the "one Bend" decision.

### 1.2 The import crux (verified)

| Claim | Status |
|---|---|
| `import Base` is used by every checked kernel | verified (line 1 of each) |
| Relative imports exist and are used: `import ./graph.bend as G`, `./rank.bend as Rank`, `./route.bend as Route`, `./LAWS.bend as Laws` | verified in `rank.bend:2`, `route.bend:2-3`, `retrieval/LAWS.bend:2-4`, `retrieval/PROOF.bend:2-5`, `bend-laws/PROOF.bend:2` |
| `--check-only` checks the file **and its imports** as one program | verified from `bend --help` |
| A file with 3 relative imports checks clean as a unit | verified: `retrieval/PROOF.bend` → `All terms check.` |
| `--publish` publishes "the file and its imports" (Bend's program unit = file + imports) | verified from `bend --help` |

**Consequence.** Cross-file reuse **is** possible. "One Bend" can mean *one
entry-point file* whose imports make it one Bend program — without physically
merging text. Bend's own unit is the file plus its imports, not the file alone.

### 1.3 Options

| Option | Definition | Satisfies "one physical file" | Keeps per-concern gates | Reviewability | Effort/risk |
|---|---|---|---|---|---|
| (a) One agent kernel that dispatches to op files | `runtime/agent.bend` owns `main`/dispatch; `ops/fold.bend`, `ops/status.bend` stay separate | No | Yes | High | Low |
| (b) Literally fold every kernel into one file | Concatenate worker + diffusion + history + ops + retrieval + laws into one `.bend`, no imports | **Yes** | No — one `--check-only` bit replaces 9 gates | Low (~7k lines, one revision) | High; destroys the human-owned-`LAWS` / AI-owned-`PROOF` split |
| (c) One file per concern + exactly one entry-point kernel | `runtime/agent.bend` imports concern kernels; one canonical worker; duplicate `system.bend` copies collapsed | No (but one Bend *program*) | Yes | High | Medium |

**Recommendation: (c).** Reasons, each tied to an observed fact:

1. Imports work (§1.2), so (c) delivers a single invoked program without the cost of (b).
2. The acceptance model depends on per-concern gates: `bend-laws/LAWS.bend` is
   human-owned and `PROOF.bend` is AI-owned (`retrieval/LAWS.bend:5-6`,
   `bend-laws/PROOF.bend:1-2`). Folding removes the separate-file boundary that
   makes that split auditable.
3. `--check-only` returns one result per program; 14 small gates localize a
   failure; one 7k-line file returns one bit.
4. The worker source resolution in `runtime/adaptive/META.md:17-25` and the loop
   gate in `ops/loops/bend-forge-loop.sh:88-89` both name individual files; (c)
   preserves those references, (b) rewrites all of them.

**Tradeoff, stated honestly.** (c) does **not** satisfy a literal "only one file
exists on disk" reading. If the owner's intent is literally one file, only (b)
satisfies it, and the cost above must be accepted explicitly — that is OC-1.

**Recommended target shape (for owner approval, not implemented here):**

```text
runtime/agent.bend                    # NEW/in-progress: single entry point + dispatch
  import ./worker/system.bend         # canonical Lorenz worker (verbs: init/capture/work/...)
  import ./worker/diffusion.bend      # retrieval concern (or retrieval/*, see §4)
  import ./worker/history.bend
  import ./ops/fold.bend
  import ./ops/status.bend
```

Retire/archive candidates (owner decision, OC-3): `runtime/adaptive/system.bend`,
`runtime/lorenz/system.bend`. `META.md:24` already forbids substituting
`lorenz/system.bend`; `.gitignore` already reserves `.archive/`.

---

## 2. Python removal scope

All `.py` in the repo (verified by glob, excluding `node_modules`/`.git`). The
task named 5; there are **10**.

| Path | Lines | Role | In active runtime path? | Referenced by | Classification |
|---|---|---|---|---|---|
| `runtime/ops/driver.py` | 341 | Op driver: gates op, runs fixture, writes `ops/runs/<op>-<id>/{brief,candidate.patch,evidence,verdict}` | Yes (op dispatch) | `runtime/ops/README.md:1-3,68-70`; `docs/drafts/meta/op-dispatch-convention.md:18-27` | **Deleted during drafting** by the parallel agent; replacement `runtime/ops/run.sh` present (verified, read). Confirm it covers fixtures + `git diff` + sha256 + run dirs. |
| `runtime/programs/cli.py` | 450 | Nudge v1.1 host integration + oc2 adapter; holds `REGISTRY` (`cli.py:29`) | Yes (programs path + loops) | `runtime/programs/telepathy-program:7-14`; `scripts/telepathy-program:8`; `ops/loops/bend-forge-loop.sh:96,107`; workspace server (`TELEPATHY_PROGRAM_PYTHON`) | **Needs a decision.** Live: `telepathy-program bend-gate` is a loop gate. Remove only if the whole Nudge programs path is retired. |
| `runtime/programs/v11.py` | 662 | `nudge.transaction/v1.1` compiler | Yes (via `cli.py`) | `cli.py:24`; `test_programs.py`; `test_v11.py` | **Needs a decision** — bundled with `cli.py`. |
| `runtime/programs/test_programs.py` | 269 | Host harness contract tests | Test-only | `OPERATE.md:60`; `docs/designs/SYSTEM.md:56` | **Keep** while `cli.py`/`v11.py` live. |
| `runtime/programs/test_v11.py` | 474 | v1.1 compiler tests | Test-only | same as above | **Keep** while `v11.py` lives. |
| `scripts/agit.py` | 1423 | `git` as state store for agentic jobs; proof gate + acceptance | Yes (documented operator walk) | `OPERATE.md:62-67`; `docs/designs/agentic-git.md`; `docs/designs/agit-in-bend.md:293-299` | **Keep (legacy-active).** It is the documented operator path, not dead code. |
| `scripts/render-report.py` | 110 | One-off Markdown→page renderer | No | no active reference found (only itself); imports `PIL` (non-stdlib) | **Keep (legacy, out of runtime path).** Safe to remove later; needs an owner decision because it is a named artifact renderer. |
| `scripts/workspace-service.py` | 110 | Install/check the shared Telepathy service (launchd) | Yes (live infra) | `ops/loops/relay-keeper-loop.sh:58-60`; `docs/SHARED_RELEASE.md:27`; `OPERATE.md:89`; relay-keeper agent | **Keep.** Live service control. |
| `runtime/workspace/server.py` | 342 | Workspace HTTP service (SQLite, invite/session) | Yes (live service) | launched by `workspace-service.py`; `runtime/workspace/README.md:6-9` | **Keep.** |
| `runtime/workspace/test_server.py` | 89 | Workspace service tests | Test-only | same README | **Keep** while `server.py` lives. |

Not a file, but Python **inside the active path** — "remove the py files" does
not remove these:

| Inline Python | Path:s |
|---|---|
| `python3 -c` JSON probing | `scripts/setup-programs.sh:37,55`; `ops/loops/bend-forge-loop.sh:98` |
| `python3 -c` keychain JSON read | `scripts/desk-watch.sh:10`; `scripts/refresh-notes.sh:10` |
| `python3 -c` loopback/public HTTP probes | `ops/loops/relay-keeper-loop.sh:120,142` |
| `python3 "$ROOT/scripts/workspace-service.py" status` | `ops/loops/relay-keeper-loop.sh:60` |

Docs mention `runtime/programs/retrieval/eval.py` (`docs/designs/score-lane.md:80`),
but **no such file exists** — do not treat it as a removal target.

**Removal summary:** only `runtime/ops/driver.py` is a clear *remove-now-once-replaced*.
Four files (`cli.py`, `v11.py`, both tests) and two infra files
(`workspace-service.py`, `workspace/server.py` + test) require owner authority;
`agit.py` and `render-report.py` are legacy but still referenced.

---

## 3. The host-driver contract that replaces Python

### 3.1 Corrected purity statement (important)

The task states "Bend is pure (no IO/subprocess/hashing/network)". That is
**only partly true** and must not be written into the job as-is. Verified from
`runtime/worker/system.bend`:

| Capability | Bend Base | Evidence |
|---|---|---|
| `IO.print` / `IO.die` (stdout / stderr + nonzero exit) | **has** | `system.bend:930, 1008, 1719` |
| Native file I/O (`File.open/read/write/close`) | **has** | `system.bend:908-924` |
| Raw loopback TCP (`TCP.connect/send/poll`, `Socket.close`) | **has** | `system.bend:1710, 1760, 1769, 1726` |
| `IO.args()` (argv) | **has** | `system.bend:2153`; `adaptive/system.bend:1030-1031` |
| Subprocess/spawn, Git, SHA, directory creation, locks, atomic rename | **lacks** | comment at `system.bend:862-865` |
| TLS / any HTTP beyond loopback | **lacks** | connector is plain TCP to `127.0.0.1:port` (`system.bend:1769`) |

So the exact contract is: **Bend owns the pure decision plus the declared local
effects it can express (`IO.print`, single-file read/write, loopback POST). The
host owns every other effect.**

### 3.2 Effect ownership

| Effect | Owner | Never |
|---|---|---|
| Process/worktree lifecycle, agent launch | host | inside a kernel |
| `git` (diff, commit, worktree, merge, tag) | host | inside a kernel |
| sha256, byte scans, hex-decode, schema validation | host | inside a kernel |
| Directory creation, locks, atomic rename | host | Bend cannot |
| Credentials, identity, receipts, publication | host/owner signer | inside a kernel |
| Pure ranking/decision over handed-in values; `IO.print` of one verdict/report | Bend | — |

This mirrors `docs/designs/agit-in-bend.md:293-299` ("Bend has no hashing, no
regex, no IO; it decides over values handed in") with the correction that Base
does have `IO` and file/TCP primitives.

**Observed replacement in the tree.** The parallel agent added
`runtime/ops/run.sh` — POSIX `sh`, no Python — which implements exactly this
ownership for ops: it gates (`BEND_NO_TELEMETRY=1 "$BEND" "$OP_PATH" --check-only`,
`run.sh:238`), runs the bare-file fixture (`run.sh:240`), records `git diff HEAD`
(`run.sh:279`), computes sha256 via `shasum`/`sha256sum` (`run.sh:48-56,272-273`),
and writes one run dir `ops/runs/<op>-<id>/{brief,candidate.patch,evidence,verdict}`
(`run.sh:312-331`). This is the pattern the consolidation should generalize to
`cli.py`'s effects if that path is retired (OC-7). It was read, not reviewed or
accepted.

### 3.3 How one Bend file is invoked with args, and how stdout is redirected

Canonical form (from `runtime/adaptive/META.md:58-65`, confirmed by worker help):

```sh
BEND_NO_TELEMETRY=1 "$BEND" "$FILE" -- <verb> <arg> [<arg> ...]
```

- The `--` separates the Bend launcher from program args; `main` reads them with
  `IO.args()` and dispatches by `match` (worker: `system.bend:2151-2154`; adaptive:
  `store_dispatch` `adaptive/system.bend:1014-1022`).
- Verb examples for the canonical worker (help output, `system.bend` `-- help`):
  `init OUT`, `capture IN OUT retain ACTOR ORIGIN TEXT`, `work IN OUT CONVERSATION
  ACTOR OWNER ACCEPTANCE`, `worker IN OUT ACTOR LABEL RUNTIME`, `claim IN OUT WORK
  WORKER ACTOR`, `packet IN WORK`, `return IN OUT WORK WORKER ACTOR RESULT
  EVIDENCE`, `learn IN OUT RESULT DEPENDENCY ACTOR TEXT`, `opencode IN WORK PORT
  SESSION RECEIPT`, `record FILE SOURCE`, `replay FILE SOURCE`, plus
  `history`/`memory`/`explain`.
- Gate: `"$BEND" "$FILE" --check-only` (file before the flag; there is no
  `bend check FILE` in 2.0.21).
- Fixture run: the bare-file form runs `main` (e.g. `ops/fold.bend` prints
  `fixture 14` / `fixture_max 5`).
- **stdout → file:** the host shell redirects, `... >"$OUT" 2>&1`; the working
  pattern already exists at `ops/loops/bend-forge-loop.sh:96` and writes into
  `ops/runs/` (git-ignored). Bend's `IO.print` is stdout; `IO.die` is stderr with
  a nonzero exit.

---

## 4. Retrieval authority

Two pure, no-IO, integer-only retrieval kernels exist and are **different
designs**. The reconciliation is already drafted in
`docs/drafts/meta/retrieval-port-notes.md:129-175` and
`docs/drafts/meta/diffusion-foundations.md:127-142,244-263`; this section adopts
and restates it for the consolidation decision.

| Concern | `runtime/programs/retrieval/*` | `runtime/worker/diffusion.bend` |
|---|---|---|
| Adjacency | CSR index (`graph.bend:1-31`) | flat edge list, O(E) scan/round |
| Dynamics | exact integer-particle **PPR**, teleport 0.15, mass conserved (`rank.bend:3-15`) | decayed walk, retain ≤ 0.5/hop, capped, mass not conserved (`diffusion.bend:1-31`) |
| Signals | lexical+diffusion fusion + threshold/margin **Abstain** (`route.bend:1-14`) | scope gate + top-K; no fusion, no abstain |
| Safety | `no_leak`/`exposes_source` (`retrieval/LAWS.bend:50-57`) | scope-before-top-K, node budget, quarantine, provenance reachability |
| Laws | 5 (LAWS) + PROOF | 35 |
| Wiring | **wired**: `ops/loops/bend-forge-loop.sh:88-89` gates `retrieval/PROOF.bend`; cited by `docs/designs/SYSTEM.md`, `score-lane.md` | **not wired**: no loop/doc consumer; standalone draft |

Cited conclusion (`diffusion-foundations.md:326-333,355-372`,
`retrieval-port-notes.md:146-163`):

- **Operational canonical today = `runtime/programs/retrieval/*`** (only gated,
  only cited). Do not retire it now; that would leave the active gate with no
  target.
- `diffusion.bend` is a truncated decayed walk, **not** PPR, unless it re-injects
  seed mass. Its scope filter is at the **output**; activation still diffuses
  through out-of-scope nodes → score-level rank-then-filter, a security gap
  (`diffusion-foundations.md:244-263`; `.local/engram/diffusion-findings.md`).
- **Recommendation:** keep `retrieval/*` canonical, fix the traversal gating first,
  then **fold** the two into one retrieval concern — not a silent replacement, and
  not by agent action. The PPR-vs-decayed-walk choice is an owner decision (OC-5)
  and the fold is OC-6.

---

## 5. Risks and rollback

| Action | What breaks | Must stay / mitigation |
|---|---|---|
| Remove `runtime/ops/driver.py` before a replacement | Op fixture execution, the `ops/runs/*` evidence dirs (git-ignored, local-only), and the falsification RED path are lost | Replacement present: `runtime/ops/run.sh` (fixture + `git diff` + sha256 + run dirs). The `ops/runs/` evidence already written is local-only, not committed |
| Remove `cli.py`/`v11.py` | `runtime/programs/telepathy-program`, `scripts/telepathy-program`, the workspace server's program binding, and the loop's `bend-gate` all stop | Owner must retire the whole programs path, or keep the files |
| Remove `test_programs.py`/`test_v11.py` | The only executable evidence for `cli.py`/`v11.py` disappears | Keep while those live |
| Remove `scripts/workspace-service.py` / `runtime/workspace/server.py` | The live `telepathy.intuitxn.com` service and relay-keeper health checks break | Keep; these are live infra |
| Remove `scripts/agit.py` | The documented operator walk (`OPERATE.md:62-67`) and the git-state-store design break | Keep, or port to the host contract |
| Remove `runtime/lorenz/system.bend` | `META.md:24` explicitly forbids substituting it, but it is not the active worker | Archiving is safe; do not repoint any reference to it |
| Fold all kernels physically | Per-concern gates, the human-`LAWS`/AI-`PROOF` split, and every file reference in loops/docs | Prefer at least (c); if (b), rewrite `META.md`, `ops/loops/*`, `README`s in the same revision |

**Rollback.** This worktree is a git checkout at `db4447d` with a clean tree.
Committed changes are revertible by `git revert` / resetting to a prior revision;
untracked deletions are **not** recoverable from git. Before any removal run
`scripts/durability-guard.sh check` (must exit 0) and
`scripts/durability-guard.sh snapshot` (writes to
`$HOME/.local/share/mundus-snapshots/`; see `.local/engram/ops-driver-durability.md`).
`ops/loops/README.md:59-66` documents the loop/rollback discipline: no silent
history rewrite.

---

## 6. Acceptance criteria (for the consolidation job, once approved)

| # | Criterion | Check |
|---|---|---|
| A1 | Exactly one entry-point Bend file exists | `bend runtime/agent.bend --check-only` → `All terms check.` (exit 0) |
| A2 | The entry point is the only invoked source | `bend runtime/agent.bend -- help` lists the full verb set; no other file is cited as the worker in `META.md`/loops |
| A3 | Every retained concern kernel still checks individually | `--check-only` → `All terms check.` for each file in §1.1 that is retained |
| A4 | No law was weakened or dropped | `git diff` shows no deleted `law`/proof defs except for files explicitly archived |
| A5 | Imports are real, not dead | mutate one law in an imported kernel; the entry point `--check-only` fails exit 1 |
| A6 | Python removal is explicit | every `.py` in §2 is removed with a named replacement, or retained with an owner classification; inline `python3 -c` occurrences are classified |
| A7 | No unrecoverable deletion | `scripts/durability-guard.sh check` exit 0 and a fresh `snapshot` exists before removal |
| A8 | Docs reflect reality | `runtime/adaptive/META.md`, `runtime/ops/README.md`, `runtime/worker/README.md`, `docs/HARNESS_STATE.md` updated in the same revision |
| A9 | Authority preserved | a GREEN check is never acceptance; a named human accepts the exact revision |

---

## 7. Numbered OPEN OWNER DECISIONS

1. **OC-1 — Meaning of "one Bend".** One physical file on disk (option b), or one
   Bend program = one entry point + imports (option c, recommended)? Only (b)
   satisfies a literal single-file reading, at the stated cost.
2. **OC-2 — Canonical entry point.** Is `runtime/agent.bend` the single entry, and
   does it *replace* `runtime/worker/system.bend` as the invoked source or *wrap*
   it via `import`? (Recommend: wrap; keep the worker's 78-law gate.)
3. **OC-3 — Duplicate `system.bend` copies.** Keep `worker/system.bend` canonical
   and archive `adaptive/system.bend` (record/replay) and `lorenz/system.bend`
   (historical), or keep all three? Note `META.md:24` forbids substituting lorenz.
4. **OC-4 — Python removal authority.** Confirm REMOVE NOW = `runtime/ops/driver.py`
   only (after replacement); KEEP = `cli.py`, `v11.py`, `test_programs.py`,
   `test_v11.py`, `scripts/agit.py`, `scripts/workspace-service.py`,
   `runtime/workspace/server.py`, `runtime/workspace/test_server.py`,
   `scripts/render-report.py` (legacy). Or authorize a broader retirement of the
   Nudge programs path.
5. **OC-5 — Retrieval object.** PPR (then `retrieval/rank.bend` is canonical) or
   truncated decayed walk (then `diffusion.bend` is canonical and all docs must
   stop calling it PPR). This cannot be decided by an agent.
6. **OC-6 — Retrieval fold.** Fold `retrieval/*` and `diffusion.bend` into one
   concern now, or only after the traversal-gating (filter-before-rank) fix?
   Recommend: after.
7. **OC-7 — Host owner.** Which host performs the effects that `driver.py` and
   `cli.py` perform today — an OpenCode agent step, a shell script, or the
   optional Desk engine (`runtime/desk`)? Name it before removing Python.
   *Observed answer for ops:* `runtime/ops/run.sh` (POSIX shell). Confirm it is
   the accepted pattern, and whether `cli.py`'s effects port to the same shape.
8. **OC-8 — Owner and independent reviewer** for the consolidation, by name.
   (Repo drafts name Shubham; **UNVERIFIED for this specific job** — no accepted
   record found in this worktree.)
9. **OC-9 — Retention policy** for removed files: git history only, or a tracked
   `.archive/` (`.gitignore` already reserves `.archive/`)?
10. **OC-10 — Desk scope.** The intent names only `.py`, but `runtime/desk`
    (JS) overlaps the same job lifecycle described in `docs/HARNESS_STATE.md:37-44`.
    Is the legacy Desk engine in scope for this consolidation, out of scope, or a
    separate later job?

---

## 8. Proposed job spec (draft toward the Desk job; not created, not sent)

| Field | Value |
|---|---|
| owner | *UNVERIFIED — OC-8* |
| repository | `/Users/a3fckx/Desktop/Attri/telepathy-mundus` (absolute; resolution from `.local/config.json` is not present in this worktree — `cat .local/config.json` → no such file) |
| runtime | `opencode` (host shell/agent owns effects; Bend owns kernels) |
| request | Consolidate the Bend surface to one entry-point program per OC-1/OC-2/OC-3 and remove only the Python files approved in OC-4, with the host contract in §3 replacing `runtime/ops/driver.py`. Do not delete anything before a `durability-guard snapshot` exists. |
| acceptance | §6 A1–A9 |
| context | `runtime/agent.bend` (in-progress), `docs/drafts/meta/one-bend-consolidation.md`, `docs/drafts/meta/retrieval-port-notes.md`, `docs/drafts/meta/op-dispatch-convention.md`, `runtime/adaptive/META.md`, `runtime/programs/bend-laws/TOOLCHAIN.md` |

---

## 9. Unverified items (do not treat as fact)

- Owner/reviewer identity for this job (OC-8).
- Whether the team wants PPR or a decayed walk (OC-5).
- Whether "one single Bend" means one physical file or one program (OC-1).
- Whether `runtime/adaptive/system.bend`'s record/replay is still required after
  `runtime/worker/system.bend` became the resolved worker (`META.md:17-25`).
- The engram notes' line-count/sha for `diffusion.bend` and `history.bend` are
  stale relative to the files on disk; the values in §1.1 are from the files.
- Whether `scripts/agit.py` is still intended as the operator path or is
  superseded by Bend snapshots + Buzz memory (no accepted record found).

*Prepared as a review-only draft for human review. Not published, not sent, not
accepted, and no file other than this one was written.*
