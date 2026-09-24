# Meta kernel operation log: op format, compare/negotiate, conflicts

**Status: SPEC — draft for human review. No implementation authorized.**
**Date:** 2026-09-24 · **Owner:** Shubham
**Companion to:** `2026-09-24-decentralized-mesh.md` (transport/phases), `2026-09-24-routing-brain.md` (θ/beliefs/lessons), `2026-09-24-recursive-seeding.md` (seeds/bundles).

---

## 1. Op format (every kernel transition emits one)

```
op = {
  id:       sha256(parents + lamport + node + kind + delta),
  parents:  [digest, …],          # causal predecessors (empty only for init)
  lamport:  (C, node),            # Lamport stamp at emit; C = max(local, seen)+1
  kind:     init|capture|work|worker|claim|packet|return|learn|correct
            | dir | job | lesson | seed | bundle | conflict | resolve,
  delta:    {…},                  # type-specific payload (small; never full state)
  result:   digest,               # content hash of post-transition snapshot
  mono:     int_micros,           # LOCAL stopwatch only: pacing/TTL, never ordered, never compared
}
```

Rules: `parents` non-empty except `init` (lineage is always traceable); `lamport` advances on every local emit and merges (`max+1`) on every receive; `delta` carries effect-only (full state is reconstructible by replay, never shipped); `mono` is expiry/pacing metadata a replica keeps to itself. jj change-ID semantics: an op's *identity* (`id`) survives transport/rebroadcast; its *content* hash pins what happened.

## 2. Compare / negotiate (fetch-style, on the existing `/sync` tick)

No replica ships state blind. Exchange is digest-first, deltas-only:

```
1. HELLO   A → B:  {digest: head_digest(A), vv: version_vector(A), root: merkle_root(A)}
2. DIFF    B:      compare heads → equal? done (O(1)).
                   else walk vv/Merkle → set D = ops B lacks (O(log n) locate).
3. WANT    B → A:  {want: D}                       # only missing op ids
4. DELTA   A → B:  ops in D, topologically sorted  # causal order preserved
5. JOIN    B:      verify hashes → join per-op by kind law → advance HEAD
```

Version vectors are per-node Lamport maxima (`{node: max_C_seen}`) — compact liveness-cum-causality summary, gossiped cheaply every tick; Merkle roots over the op DAG give `O(1)` equality and `O(log n)` divergence location when vectors disagree. Transitive forward unchanged (a node forwards ops it merged, which is what makes healing `O(log n)` rounds, not per-pair).

## 3. Merge tiers (join → conflict → arbitrate, in that order)

| Tier | When | Mechanism | Example |
|---|---|---|---|
| **join automatically** | laws cover (records, logs, maps, tombstones) | LWW by `(lamport, node)`; union for G-sets; TTL-expiry for fast maps | directory record, observation log, kind map, load |
| **conflict explicitly** | concurrent incompatible ops, no covering law | typed conflict record (below), routed, never silent, never blocks unrelated merges | two claims same job + side effects; two bundles, same scope, different policy; lesson contradicting standing law |
| **arbitrate deterministically** | policy needs a pick without understanding | `(lamport, node)` total order; logged as arbitrary | tie-breaks only; never mistaken for judgment |

**Conflict record type:**

```
conflict = {
  id:       sha256(...),
  kind:     "conflict",
  sides:    [op_id, op_id, …],     # the incompatible ops, by digest (content-pinned)
  scope:    "job:<id>" | "policy:<path>" | "bundle:<digest>" | …,
  stamps:   [(C, node), …],        # one per side, for causal reading
  routes_to: "policy" | "human",   # standing rule decides; default human on charter touch
  status:   open | resolved,       # resolution is itself an op (resolve) referencing this id
  lamport:  (C, node),
}
```

Routing: `policy` = the standing policy's conflict table (e.g., duplicate-claim → winner-keeps-row + loser-aborts-and-logs; lesson-vs-law → steward drafts revision); `human` = charter conflicts, scope expansions, anything touching identity/credentials/spend. Resolution appends a `resolve` op pointing at the conflict id — history shows the disagreement *and* its settlement. Unrelated merges proceed while a conflict is open; nothing global blocks.

## 4. jj integration (one store, two readers)

jj remains the local object store + operation log + undo: kernel snapshots persist as jj operations, content-addressed, rewritable locally with stable change IDs. The kernel adds what jj lacks and reads what jj keeps:

- kernel writes ops (with Lamport stamps) → persisted through jj;
- kernel compares via digests/vectors/Merkle (§2), jj supplies objects + history walk;
- kernel never reimplements storage, GC policy, or working-copy mechanics — jj owns those;
- causal order comes from stamps, not DAG position: two replicas with no shared history still order shared ops identically.

No second store, no parallel lineage. `jj log` shows what happened locally; op stamps show what happened causally mesh-wide.

## 5. Acceptance

1. **Equality is O(1):** two converged replicas prove it with one digest compare (no full-state ship).
2. **Healing is delta-only:** partition, diverge N ops, heal — transferred bytes ≈ N op deltas, located in `O(log n)`; zero duplicate-effects (idempotent joins verified by replay test).
3. **Causality without shared history:** two replicas with disjoint pasts order a shared op identically (stamp rule), verified by cross-partition merge test.
4. **Conflicts surface typed:** concurrent incompatible claims produce exactly one `conflict` record with both sides pinned; unrelated merges proceed; resolution appends `resolve` (no silent picks, no global stalls).
5. **Pacing never orders:** audit shows zero cross-node wall/`mono` comparisons in merge paths; all timeouts/TTLs use local monotonic only.
6. **jj round-trips:** kernel ops persist as jj ops and back (restart, undo, rebase-local all preserve stamps and lineage; change IDs stable across local rewrites).
