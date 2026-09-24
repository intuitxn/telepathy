# DRAFT — CRDT LWW map: convergent core for later proposals/transports

Status: draft, agent-authored · Bend `2.0.21`.
**Not published, not sent, not merged. No external effect.** Human review only.
Kernel: `runtime/crdt.bend` (pure, no IO, no clock).
Checker: `BEND_NO_TELEMETRY=1 ~/.bend/bin/bend runtime/crdt.bend --check-only`
→ `All terms check.`

## Shape choice

String-keyed entries (`key: String`), no registry. String ordering **is**
available in Bend 2.0.21 (`String.cmp/order/is_le/is_gt/eq`, used by
`runtime/memory.bend`). Nat-keyed + registry fallback was not needed.
Entry: `CrdtEntry{key: String, digest: String, ts: Nat, actor: String}`.
Map: `+List<CrdtEntry>` sorted by key, one entry per key. `ts` supplied by
caller (host clock); kernel never reads a clock.

## Tie-break (total, exact order)

For same key: **larger `ts` wins; if equal, larger `actor` wins
(`String.is_gt` lexicographic); if equal, larger `digest` wins
(`String.is_gt` lexicographic).** All-equal ⇒ entries equal.
`pick(a,b) == pick(b,a)` always (same winner either order).

## Laws (18, each with same-named proof def)

1. `crdt_merge_comm` — commutativity witness
2. `crdt_merge_assoc` — associativity witness
3. `crdt_merge_idem` — idempotence witness
4. `crdt_converge` — `merge(a,b)==merge(b,a)` as a value (concurrent writes)
5. `crdt_merge_deterministic` — general reflexivity
6. `crdt_tie_total` — no two distinct winners (`pick` order-independent)
7. `crdt_empty_left` — `merge(empty,a)==a`
8. `crdt_empty_right` — `merge(a,empty)==a`
9. `crdt_put_then_merge` — two singleton puts merge to sorted pair
10. `crdt_counter_equal_ts` — equal ts, different actors ⇒ larger actor wins
11. `crdt_counter_empty_empty` — `merge(empty,empty)==empty`
12. `crdt_counter_dup_put` — duplicate puts collapse
13. `crdt_counter_three_way` — three-way concurrent merge converges
14. `crdt_one_entry_per_key` — same-key merge has length 1
15. `crdt_get_hit` — lookup hits
16. `crdt_get_miss` — absent lookup is explicit `None`
17. `crdt_work_bound` — `merge(empty,work)` has length 20
18. `crdt_ts_wins` — larger ts wins even with smaller actor

Counterexamples (explicit): equal-ts/different-actor; empty-vs-empty;
duplicate puts; three-way concurrent merge (laws 10–13).

## PROVEN vs DESIGNED

PROVEN (checker): the 18 laws above.
DESIGNED (not proven): host clock supply, digest hashing, slug validity,
clock skew handling. Transport/wiring/merging over the network is a separate
deferred step, not claimed here.

## Verification

Checker + scratch demo (two replicas merge identical, both printed) +
one falsification mutation (tie-break flip fails its law). See task return.
