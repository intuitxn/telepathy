# Memory ingest: identity, gating, dynamics

**Status: DRAFT for human review. No implementation authorized.**
**Date:** 2026-09-24 · **Owner:** Shubham
**Companion to:** `2026-09-24-routing-brain.md` (θ / beliefs / lessons vocabulary reused below)
**Ground truth:** `runtime/ops/mem-*.bend` — 12 memory ops, each a pure typed Input→Output with checked laws (`bend --check-only` → `All terms check`). Convention: kernel owns pure decisions, host does effects.

Existing ops: `mem-slug`, `mem-scope`, `mem-identity`, `mem-pubkey`, `mem-agentset`, `mem-merge`, `mem-ordered`, `mem-projection`, `mem-listproj`, `mem-fetch`, `mem-freshness`, `mem-commit`.

---

## 1. Identity basis (jj semantics as network identity)

Every memory / node / seed carries a triple:

- **stable id** — survives rewrites (like a jj change ID). All references use this.
- **content digest** — verifies bytes (like a commit ID). Equal hashes ⟺ identical state.
- **`(lamport, node)` stamp** — orders across replicas with no shared history. Winner = max lexicographic (same rule as routing-brain §1 LWW-map).

State rule: **address by stable id, verify by digest, order by stamp.**

- Rewrite (reword, re-embed, re-chunk) keeps the stable id, changes the digest, bumps the stamp.
- Replica conflict on the same stable id settles by stamp; digest proves what won.
- Directory keys (`node` names, §5) and lesson entries (`L`) carry the same triple.

## 2. Tagging (public-default, labels only)

Mesh traffic is public to the mesh. Tailnet = perimeter. No separate private store.

- Labels are plain tags on records: `scope:*`, `kind:*`, `secret`, `mesh-only`.
- Reads take an optional label filter; unfiltered reads see public.
- The `secret` tag is enforced at exactly three boundaries — **export, share, projection** — and nowhere else.
- The never-share list lives as tags on records, not as a separate store. Strip or refuse at the three boundaries; pass through everywhere inside.
- `mem-projection` / `mem-listproj` own the pure projection decision (which labels survive a projection); file/network effects stay host.

## 3. Ingest job contract (one agent, one writer)

Input = **accepted outcomes + evidence ONLY**. Nothing unaccepted enters. (`accept(x)` means: passed the standing-policy verifier — tests / critic / exec / human — never self-scored; cf. routing-brain §3 option (b).)

Pipeline, each step mapped to an existing op:

| Step | Op(s) | Pure decision |
|---|---|---|
| fetch | `mem-fetch` | what candidate records arrive |
| gate | `mem-slug` / `mem-scope` / `mem-identity` / `mem-pubkey` / `mem-agentset` | shape ∧ scope ∧ identity ∧ key ∧ agent-set admit |
| freshness filter | `mem-freshness` | drop stale (TTL / superseded-stamp) before merge |
| merge / order | `mem-merge` / `mem-ordered` | CRDT join + deterministic order |
| submit | `mem-commit` | digest + count + index |

Rules:

- **Single writer.** One ingest agent holds the kernel lock per ingest round. No concurrent committers.
- **Idempotent.** Dedup (`mem-commit` law `commit_dedups`) makes re-ingest a no-op: same input set → same digest, same count.
- **Output = commit digest.** The digest names the new memory state (§1).
- **Trigger:** on-accept (every accepted outcome queues one ingest round) + scheduled sweep (periodic re-fetch/gate/freshness pass over queued evidence).

## 4. Dynamics equations (six new ops to specify — contracts + laws only)

Gate composes existing ops (§3). The six new ops below are specified here, not implemented. Each gets a `runtime/ops/mem-<name>.bend` file later with the typed contract, fixtures, and named laws shown. Vocabulary: agent state `s = (c, b, θ)`; `b` beliefs (shared CRDT); `θ` policy params; `L` lessons G-set; `τ_int` / `τ_ext` per routing-brain §§3–4.

### 4.0 Gate (composed, no new op)

```
enter(x) = accept(x) ∧ novel(x) ∧ in_scope(x)
```

- `accept(x)`: standing-policy verifier passes (existing gate ops).
- `novel(x)`: digest not already in index (decided by `mem-commit` dedup shape).
- `in_scope(x)`: `mem-scope` admits.
- Law shape: `enter` rejects an unaccepted / duplicate / out-of-scope fixture; accepts a fixture passing all three. Counterexample fixture per conjunct.

### 4.1 `mem-strength` — Hebbian strength (new)

```
S ← S + η·r    on each accepted use/return of m
```

- Contract: `StrengthInput{m: Nat, S: Nat, eta: Nat, r: Nat} → StrengthOutput{S: Nat}` (fixed-point Nats; scaling fixed at spec time).
- Fixtures: zero-reward use leaves `S` unchanged; positive `r` strictly increases `S`; zero `S` + positive `r` yields positive `S`.
- Laws: `strength_no_reward_fixed` (r=0 → S unchanged); `strength_monotone` (r>0 → output > input); `strength_additive` (two updates = one summed update — order-independent).
- `S` lives in `b` (shared belief, gossiped versioned delta); `r = quality − cost` per routing-brain §3.

### 4.2 `mem-decay` — Ebbinghaus decay (new)

```
R(t) = e^(−t/S)    forgetting as lawful capacity control
```

- Contract: `DecayInput{S: Nat, t: Nat} → DecayOutput{R: Nat}` (scaled fixed-point; `R` in (0, scale]).
- Fixtures: `t=0` → full recall; large `t` / small `S` → floor; large `S` decays slower than small `S` at equal `t`.
- Laws: `decay_full_at_zero` (R(0) = max); `decay_monotone_time` (larger t → smaller R); `decay_monotone_strength` (larger S → larger R at fixed t>0).
- Decay is pure computation at read time; stored `S` never mutated by time passing. Host clocks stay out of the kernel: `t` is handed in.

### 4.3 `mem-retrieval` — attention retrieval (new)

```
score(q,m) = sim(q,m) · R(t) · trust(m)    top-K above threshold τ, budgeted
```

- Contract: `RetrievalInput{q: Nat, ms: +List<Nat>, K: Nat, tau: Nat, budget: Nat} → RetrievalOutput{top: +List<Nat>}`.
- Fixtures: empty candidate list → empty; all-below-τ → empty; over-budget candidate set truncated to K; distractor with high `sim` but floored `R(t)` loses to fresher match.
- Laws: `retrieval_empty`; `retrieval_threshold` (below-τ never returned); `retrieval_bounded` (output length ≤ K and ≤ budget); `retrieval_ranks` (returned list sorted by score descending).
- `sim` is handed in (host-computed); kernel owns threshold / top-K / budget / ordering. Retrieval feeds `τ_int` candidate sets; `τ_ext` outcomes return as `L` lessons.

### 4.4 `mem-consolidation` — trace → seed deltas (new)

Distill episodic traces → semantic seed deltas, **on accept only**.

- Contract: `ConsolidationInput{traces: +List<Nat>, standing: Nat} → ConsolidationOutput{delta: +List<Nat>}`.
- Fixtures: contradictory-trace input → empty delta + conflict flag (routes to §4.6, never silent overwrite); ablation fixture (drop one trace → delta shrinks or holds, never invents).
- Laws: `consolidation_accept_only` (unaccepted trace set → empty delta); `consolidation_ablation` (delta of subset ⊆ delta of full set); `consolidation_no_invention` (every delta element derives from some input trace — checked as membership).
- Retention is ablation-tested: a consolidated seed ships with the trace subset whose removal breaks it.

### 4.5 `mem-eviction` — bounded memory (new)

Bounded `K`. Evict lowest `S·R(t)`. Pinned exclusions: charter / standing policy never evicted.

- Contract: `EvictionInput{entries: +List<Nat>, K: Nat, pinned: +List<Nat>} → EvictionOutput{kept: +List<Nat>, evicted: +List<Nat>}`.
- Fixtures: under-capacity → nothing evicted; over-capacity → lowest `S·R(t)` evicted first; pinned entry with lowest score survives.
- Laws: `eviction_bounded` (kept ≤ K); `eviction_pinned_survive` (pinned ⊆ kept); `eviction_lowest_first` (every evicted scores ≤ every unpinned kept); `eviction_partition` (kept ∪ evicted = input, disjoint).
- Eviction is the only deleter. No growth without accept (§3 gate precedes every insert).

### 4.6 `mem-interference` — typed conflicts (new)

Contradicting entry vs standing law → typed conflict record. Never silent overwrite.

- Contract: `InterferenceInput{entry: Nat, standing: Nat} → InterferenceOutput{conflict: Nat, route: Nat}` (route ∈ {quarantine, escalate-human, prefer-standing}).
- Fixtures: agreeing entry → no-conflict marker; contradicting entry → conflict record naming both digests (§1); standing-law contradiction → `escalate-human`.
- Laws: `interference_agree_silent` (agreement emits no record); `interference_conflict_typed` (contradiction emits record carrying both digests); `interference_standing_wins_route` (vs-standing routes to escalate, entry held in quarantine).
- Conflict records are `L` entries (G-set union, gossiped); resolution is a later accept, ingested via §3.

## 5. Machine naming with properties

`name{prop,…}` convention. Examples: `a3fckx-mini{agent,serve}`; aspirational SSH-tier shape: `gpu-box{ml.embed,ml.train,gpu,ssh-only}` (no GPU hardware live — demonstrates the form, not a member).

- **Name = stable identity** (§1), resolved via the directory. Rename = new node record; old name tombstones (`offers:["gone"]`, routing-brain §1).
- **Properties = mutable capability offers**, gossiped, versioned (LWW per `(lamport, node)`; same merge as routing-brain §1).
- Routing matches `needs ⊆ properties` (subset, routing-brain §2). Access mechanism follows the record's `access` field.
- A memory entry may cite its origin machine as `name@digest`; the name resolves liveness, the digest verifies bytes.

## 6. Acceptance

1. **check-only green:** all 12 existing ops plus the six new op specs pass `bend --check-only` (`All terms check`).
2. **replay-identical digests:** re-ingest of a fixed accepted set on two replicas yields identical commit digests.
3. **seeded sessions meet sufficiency:** a seeded session (fixed seed, fixed inputs) reproduces the committed index exactly.
4. **memory bounded:** over-capacity ingest evicts (lowest `S·R(t)` gone, pinned survive); sustained ingest without accept shows zero growth.
5. **conflicts typed and routed:** every contradiction fixture yields a conflict record with both digests and a route; zero silent overwrites under audit.

---

DRAFT — human reviews; nothing executes until approved.
