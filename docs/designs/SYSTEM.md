# System + project design: provable agentic workspace

Status: accepted direction per owner 2026-09-18 (thin Nudge, Bend-native algorithms, agit state store, no legacy). Toolchain: `bend 2.0.5` only.

## 1. What Bend 2.0.5 is (verified hands-on, not brochure)

- **Affine dependent type theory.** Every variable used at most once unless `Data` + `+`. Functions/arrays/IO are `Type` (move-only). This kills aliasing bugs agents love to write — by construction, not review.
- **Laws are claims, defs are proofs.** `law name: for x: T {prop}` in human-owned `LAWS.bend`; `def Laws.name(..)` in AI-owned `PROOF.bend`. Gate is bare `bend PROOF.bend → All terms check.` (`TOOLCHAIN.md`). No tactics; `{==}` = both sides compute equal; `%e : P` rewrites; recursion = induction.
- **Termination mandatory.** Recursive calls must shrink a matched input; `Nat` fuel (`case 1n+p`) bounds open-ended loops. `@unsafe` opts out — and opts out of proof. Mutual recursion forbidden (encode as one def + selector arg).
- **Parallelism is syntax.** `a b = f(x) g(y)` fork-joins; `f!(x)` sends the call tree to GPU. Same C file compiles for CPU/GPU; unified memory = zero-copy on Apple silicon. Pure + affine makes independence automatic; balance is the programmer's job.
- **Effects fenced in `IO`.** `do IO<T>:` blocks, annotated binds, affine handles. Proofs/termination/GPU never touch host code. Foreign effects via paired `.c`/`.js` twins.
- **Checker is fast.** Seconds, not Lean-minutes — an agent can gate every change.
- **Learned the hard way:** proof bodies must qualify imported constructors (`Laws.Job{}`); `Nat.is_le` reduces via `cmp` so abstract comparisons need an extra structural split; `match` = ADTs only, scrutinee must be a parameter/binder; `bend check <file>` does not exist in 2.0.5.

## 2. System architecture

```
human intent
  → Nudge thin transaction (1 model call, typed I/O, digest)   [outer]
  → Bend kernels (algorithm + laws + proofs, fuel-bounded)      [inner]
  → agit git-state (hash-chained orientation, human accept)     [record]
  → diffusion retrieval + metacognitive router over that graph  [memory]
```

- **Nudge** (`programs/*.nudge.md`, `nudge.transaction/v1.1`): typed `inputs/outputs`, two prompt fences plus optional `bend-law`/`bend-proof`, limits-as-defaults, dual digests. No loops, no auth, no approval. Single-run v1.1 only — legacy rejected; see `nudge-simplify.md` for design history.
- **Bend kernels** (`runtime/programs/bend-laws/`, `runtime/programs/retrieval/`): small recursive blocks, each with signature + complexity + termination measure + laws. Canonical boundary laws 1–5 gated.
- **agit** (`docs/designs/agentic-git.md`, `agit-in-bend.md`): every transition a git object with `Bundle-Digest/Proof-Digest/Candidate-Digest/Reviewer` trailers + `refs/notes/agit-*`. Orientation `O=(stage, laws_passed, fresh)` monotone; SQLite is rebuildable cache.
- **Retrieval**: CSR graph over Job/timeline/artifact/digest nodes (`job-contract.md`), PPR/heat diffusion in Bend with fuel, `host.output_excludes` guard outside the model.
- **Metacognition**: strategies as Bend defs (lexical/diffusion/fusion/confidence/abstain); router choice + scores recorded per transition. Model text never counts as evidence.
- **bend-forge** (`plugins/telepathy-meta-agents/bend-specialist.md`, `.opencode/agents/bend-forge.md`, registry entry): the one agent perfect in Bend. Writes defs/laws/proofs, runs gates + negative controls, never self-accepts/merges/touches network. Spawns per job.

## 3. Kernel catalog (each: complexity + laws)

| Kernel | Complexity | Laws |
|---|---|---|
| `accept` / `stage_rank` / `rank_le` | O(1) | 1–4 (effect-free, resolves, idempotent, monotone) |
| `advance` / `used` | O(1), ≤1 step/fuel | 5 (fuel_bound) |
| `digest_eq` (byte-list) | O(n) | determinism, tamper-fails-closed |
| `transition` (7-state) | O(1) | totality, terminal-absorbing |
| `prove_all` fan-out | O(laws), parallel | all-pass ⇔ Allow |
| `rank_sources` (diffusion) | O(fuel × edges), GPU `!` for dense | mass conservation, determinism, no-leak |
| `route` (strategy router) | O(strategies) | abstain-when-unsure, choice recorded |

Rule: no kernel lands without stated complexity, fuel threading, law set, and a failing negative control.

## 4. Project plan

- **P0 (done):** thin-Nudge spec, agit design, agit-in-Bend kernel, bend-forge role, 2.0.5 toolchain, laws 1–5 gated, legacy + pilot removed.
- **P1 (done):** v1.1 compiler (`v11.py`, 46 tests); `source`/`parentDigest` one-release exception documented + enforced; `agit` CLI live-fired; bend-forge + relay-keeper wired in registry.
- **P2:** diffusion spike lands (`retrieval/`), `orientation` + `fuel` triples recorded per transition; router strategies as laws.
- **P3:** multi-job causal graph queries (lineage, stale-digest blast radius); measured retrieval quality vs incumbent concat baseline.

## 5. Verification bar

`bend PROOF.bend` green + negative control red, `test_v11.py` + `test_programs.py` green (71 total, stdlib-only, zero skips), `bend-gate`/`gen-runner` live, one live run per program with digests logged, human accept on exact revision. Nothing else counts.
