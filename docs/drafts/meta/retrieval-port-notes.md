# DRAFT — retrieval port to Bend 2.0.21 + reconciliation with diffusion.bend

Status: **draft, agent-authored · 2026-09-22 · not published, not committed,
not accepted.** A passing checker is never acceptance. Only a named human
reviewing this exact revision resolves the job. This note authorizes no merge,
tag, publish, send, or engram write.

Scope of this pass: ported `runtime/programs/retrieval/{graph,rank,route,LAWS,PROOF}.bend`
from Bend 2.0.5 to 2.0.21 and wrote this one note. Nothing else was modified.
`runtime/programs/retrieval/REPORT.md` was read, not edited.

Bend pinned: **2.0.21** (`bend version` → `bend 2.0.21`), telemetry off
(`BEND_NO_TELEMETRY=1`), absolute binary `/Users/a3fckx/.bend/bin/bend`.
All commands below were run with cwd
`/Users/a3fckx/Desktop/Attri/telepathy-shared-learning/runtime/programs/retrieval`.

---

## 0. Blocker reproduced exactly (before the port)

```
$ BEND_NO_TELEMETRY=1 /Users/a3fckx/.bend/bin/bend graph.bend --check-only
Error:
- message  : a type for this operator (write (a + b : Nat))
Location:
59 |     case Con{h, t}:
60>|       list_sum(t, acc + h)
61 |
Note: we broke this after launch, sorry. Until 2.0.16 a bare operator meant Nat.
That was a bug: operators demand annotation. Wrap the expression and it'll work again.
EXIT=1
```

Root cause: since 2.0.16 a bare infix operator (`+`, `*`, `/`) in a def body
**or in a proof-type annotation** must carry its type, e.g. `(a + b : Nat)`.

---

## 1. Per-file checker evidence (final revision)

| File | Exact command | Exact output | Exit | Result |
|---|---|---|---|---|
| `graph.bend` | `BEND_NO_TELEMETRY=1 /Users/a3fckx/.bend/bin/bend graph.bend --check-only` | `All terms check.` | 0 | **PASS** |
| `rank.bend` | `BEND_NO_TELEMETRY=1 /Users/a3fckx/.bend/bin/bend rank.bend --check-only` | `All terms check.` | 0 | **PASS** |
| `route.bend` | `BEND_NO_TELEMETRY=1 /Users/a3fckx/.bend/bin/bend route.bend --check-only` | `All terms check.` | 0 | **PASS** |
| `LAWS.bend` | `BEND_NO_TELEMETRY=1 /Users/a3fckx/.bend/bin/bend LAWS.bend --check-only` | `Error: 5 TODOs found.`<br>`The code is incomplete, and not a valid proof yet.` | 1 | **expected — see note** |
| `PROOF.bend` | `BEND_NO_TELEMETRY=1 /Users/a3fckx/.bend/bin/bend PROOF.bend --check-only` | `All terms check.` | 0 | **PASS (the gate)** |

Note on `LAWS.bend`: it is the human-owned law *statements*; a law with no
same-named proof def is reported as an unfinished proof (`TODO`). This is the
intended house split (identical behaviour to
`runtime/programs/bend-laws/LAWS.bend`, which also reports `5 TODOs found.`
alone). The laws are discharged in `PROOF.bend`; the gate
`bend PROOF.bend --check-only` checks `LAWS.bend` as an import and passes.
**This is not a port regression** — the file is byte-identical to its 2.0.5
revision (`LAWS.bend` diff is empty).

### 1a. Demo entry points (bare-file form runs `main`)

| Command | Exact output | Exit |
|---|---|---|
| `BEND_NO_TELEMETRY=1 /Users/a3fckx/.bend/bin/bend graph.bend` | `4n` | 0 |
| `BEND_NO_TELEMETRY=1 /Users/a3fckx/.bend/bin/bend rank.bend` | `1200n` | 0 |
| `BEND_NO_TELEMETRY=1 /Users/a3fckx/.bend/bin/bend route.bend` | `Answer{0n, 49n}` | 0 |
| `BEND_NO_TELEMETRY=1 /Users/a3fckx/.bend/bin/bend PROOF.bend` | `All terms check.` | 0 |

These match the recorded oracle in `REPORT.md` §3b/§3c exactly
(graph out-degree 4; rank sum 1200; route `Answer{0,49}`).

---

## 2. Negative mutations (one per law; scratch copies, owned files untouched)

Copies of the five files were mutated in
`/var/folders/…/opencode/retr-port/neg/` and checked with
`BEND_NO_TELEMETRY=1 /Users/a3fckx/.bend/bin/bend PROOF.bend --check-only`.
Each fails at the mutated law's proof, exit 1; restoring the file returns exit 0.
(Expected/observed terms are elided for length; the `Location` is exact.)

| # | Mutation | Checker result |
|---|---|---|
| NEG-M1 | `fuel_zero_identity`: fuel `0n` → `1n` | `Error:` … `Location: LAWS.fuel_zero_identity` (exit 1) |
| NEG-M2 | `mass_conservation`: fuel `0n` → `1n` | `Error:` … `Location: LAWS.mass_conservation` (exit 1) |
| NEG-M3 | `route_deterministic`: RHS route inputs changed | `Error:` … `Location: LAWS.route_deterministic` (exit 1) |
| NEG-M4 | `no_leak`: `exposes_source(Answer)` `False{}` → `True{}` | `Error:` … `Location: LAWS.no_leak` (exit 1) |
| NEG-M5 | `step_preserves_heat`: `Nil{}` → `Rank.demo_heat()` | `Error:` … `Location: LAWS.step_preserves_heat` (exit 1) |

Restored copy: `All terms check.` (exit 0). The laws are non-vacuous.

---

## 3. What changed (only operator annotations; no semantics)

Diff vs the 2.0.5 revision:

- `graph.bend` — 2 lines: `acc + h`, `h + v` wrapped as `(… : Nat)`.
- `rank.bend` — 8 lines: `n / 2n`, `(h * num) / den`, `(h + k)`,
  `(h / d) * d`, `h / d`, `(b + share)`, `(b + share + (1n+u))`,
  `pool / s`, `share * s` wrapped as `(… : Nat)`.
- `route.bend` — 2 lines: `(h * 100n) / total`, `(wl*lex)+(wd*pct)` wrapped.
- `LAWS.bend` — **no change** (byte-identical to the 2.0.5 revision).
- `PROOF.bend` — 24 lines: every formerly-bare `a + b` in a proof-type
  annotation or a `%`-rewrite argument wrapped as `(a + b : Nat)`. All helper
  lemmas (`add_zero` … `node_four`, `add_at_sum`, `spread_gain`) preserved and
  checking. A short `PORT NOTE` header comment was added.

No law statement, no proof obligation, and no function semantics changed.

---

## 4. Laws: preserved / not preserved

**All 5 laws preserved exactly; none weakened.** `LAWS.bend` is unchanged and
`PROOF.bend` discharges the same honest fragments as before:

| # | Law | Status after port |
|---|---|---|
| 1 | `mass_conservation` | proven for the fuel-0 base case (`{==}`); general claim stays oracle-verified (`REPORT.md` §3b) |
| 2 | `fuel_zero_identity` | proven (`{==}`) |
| 3 | `route_deterministic` | proven (reflexivity) |
| 4 | `no_leak` | proven (case analysis, both arms `False{}`) |
| 5 | `step_preserves_heat` | proven for `Nil{}` (`{==}`); general claim stays oracle-verified |

No law had to be dropped for 2.0.21. The two general claims (any-fuel mass
conservation, any-vector one-step preservation) were already *not* machine-
proven on 2.0.5 and remain oracle-verified only — that limitation is unchanged
and is recorded in the `PROOF.bend` header, not introduced here.

---

## 5. Reconciliation: `retrieval/` spike vs `runtime/worker/diffusion.bend`

Both are pure, integer-only, no-IO Bend retrieval kernels. They are **not the
same design**:

| Concern | `runtime/programs/retrieval/` (this port) | `runtime/worker/diffusion.bend` |
|---|---|---|
| Adjacency | explicit **CSR** (`offsets`/`nbrs`, typed `Job/Post/Artifact`) | flat edge list, **O(E) scan per round** (no index) |
| Dynamics | exact integer-particle PageRank + **personalized teleport**; **mass conserved exactly** | fixed-point activation with saturating cap (`amax`) and node budget; **mass not conserved** |
| Signals | lexical + diffusion **fusion**, threshold/margin, first-class **Abstain**, `exposes_source` no-leak witness | scope gate + top-K; no lexical fusion, no abstain verdict |
| Safety gates | `host.output_excludes` no-leak law | **scope gate before top-K**, **node budget**, **quarantine** (empty/absent anchors), **provenance reachability** |
| Laws | 5 (mass conservation, determinism, no-leak, …) | 35 (well-formedness, budgets, determinism, ranking, scope, provenance, counterexamples, gate) |
| Integration | **wired**: `ops/loops/bend-forge-loop.sh` gates it; `docs/designs/SYSTEM.md` §Retrieval and `docs/designs/score-lane.md` cite it | **not wired**: no code/doc references it; standalone draft |

**Canonical kernel (operational):** `runtime/programs/retrieval/`. It is the
only retrieval kernel wired into an active gate and cited by `SYSTEM.md`
("CSR graph … PPR/heat diffusion in Bend with fuel, `host.output_excludes`
guard") and `score-lane.md`. `diffusion.bend` is the newer replacement design
for bounded lexical matching (`runtime/adaptive/LEARNING.md:86-88`), but it is
not referenced by any consumer and its own design doc (`§9.7`) leaves
"which is authoritative?" open.

**What the ported programs add that `diffusion.bend` does not:** exact mass
conservation, personalized teleport (PPR), lexical+diffusion fusion with a
threshold/margin **Abstain** verdict, a no-leak output witness, and an explicit
CSR adjacency index.

**What `diffusion.bend` adds that the ported programs do not:** a hard
**scope gate** (out-of-scope nodes activated internally but never returned), a
bounded **node budget** (no full-graph carry-forward), **quarantine** of
malformed tasks, provenance **reachability**, relation-labelled edges, and a
broader 35-law set with a 7-bit gate.

**Recommendation (human decision required):** **keep** the ported programs as
the gated canonical kernel for now; treat `diffusion.bend` as the intended
superset and plan a **fold**, not a silent replacement. The fold should port
`diffusion.bend`'s scope gate + node budget + quarantine + provenance into the
canonical path, and port the retrieval spike's mass conservation + teleport +
lexical fusion + Abstain + no-leak into `diffusion.bend`; then retire the
duplicate once the gate is re-pointed. Do **not** retire `retrieval/` now: it
is the only wired, cited kernel, and retiring it would leave the active gate
with no target. Do **not** fold by agent action — re-pointing the gate is a
human/owner decision.

---

## 6. Explicit non-claims (what the shell/human must still verify)

Bend proves only the pure decision over handed-in Nat counts. The shell still
owns, and this note does **not** claim: CSR bytes / sha256 / hex-decode / byte
scans; context-snapshot text and keyword-overlap counts; slug↔Nat mapping and
identity roster; schema validation; commits, tags, merges, reviewer≠worker;
`host.output_excludes` enforcement on the shell side; SQLite projection and
brief assembly. `PROOF.bend`'s `{==}` terms are proofs of the *narrowed*
fragments named in §4, not of the general conservation claims.

## 7. Hand-off flags (outside the owned files — for the human)

1. **Toolchain pin mismatch.** `ops/loops/bend-forge-loop.sh` hard-pins
   `bend 2.0.5` and marks anything else `VERDICT RED toolchain-pin`. On this
   host it will report RED for the pin while the two `PROOF.bend` gates now
   pass. The pin needs a human/owner update to 2.0.21 (the loop file is not
   owned by this pass).
2. **`runtime/worker/diffusion.bend` is absent at hand-off.** It was present
   and checked clean at the start of this pass
   (`All terms check.`, exit 0). It is **untracked** by git and was removed
   from `runtime/worker/` at ~13:05 by a process outside this pass; this pass
   wrote only under `runtime/programs/retrieval/` and the scratch dir. The
   same 35-law kernel is recorded in `.local/engram/diffusion-retrieval-kernel.md`
   with sha256 `3c1aaba806664e6a2e0d9b43c50501b54d7c2989c8861fdd47cfdaa396c61851`
   (copied from that engram note, not recomputed here since the file is gone).
3. **`runtime/programs/retrieval/parallel/diffuse_par.bend`** is cited in
   `docs/drafts/buzz-agent-setup/local-work-inventory.md:38` but does not
   exist on disk (stale reference).

## 8. Digests of the ported revision (observed via `shasum -a 256`)

```
bee5ededb450b6fe08ba6a56ffaf660e379e55b9ccb17bd0e1f3abd663b20b67  graph.bend
e2db9f94bf7b208a383fdfca10ad614a629eeee03b699acd4723025c2372ad73  rank.bend
b5d9222f9ef03155d6339ed7520e114c9b423c708f76a29e92baa9aa3c4b47a0  route.bend
6368cc3e04abefa327425ee10c7a1dcda78e2c4cc2585652cfb7801bd73a9e48  LAWS.bend
c7b471f340082085401b61a79377a53f966c2f86fbb2e45e9498103f26c79c58  PROOF.bend
```

These are computed from the files on disk (not hand-written). A named human
should re-run the §1 commands against these exact revisions before accepting.
