# Diffusion retrieval kernel — laws and design

Draft · agent-authored · 2026-09-22 · **not published, not committed, not accepted.**
A passing checker is never acceptance. Only a named human reviewing this exact
revision resolves the job. This note authorizes no merge, tag, publish or send.

- Kernel: `runtime/worker/diffusion.bend` (Bend 2.0.21; sha256 in §6).
- Checker: `BEND_NO_TELEMETRY=1 /Users/a3fckx/.bend/bin/bend runtime/worker/diffusion.bend --check-only`.

---

## 1. What it is

A **pure** kernel for task-scoped, diffusion-style memory retrieval. It performs
no IO, network, clock, subprocess or hashing; the caller supplies every value.
All arithmetic is integer fixed point (Bend 2.0.21 has no floats). The kernel
returns **node ids only**; an out-of-scope node may carry internal activation but
is never returned.

## 2. Schema

```bend
type DEdge   is Data: DEdge{src: Nat, dst: Nat, weight: Nat, rel: Nat}
type DGraph  is Data: DGraph{nodes: +List<Nat>, edges: +List<DEdge>}
type DTask   is Data: DTask{anchors: +List<Nat>, steps: Nat, scope: +List<Nat>}
type DCell   is Data: DCell{act: Nat, id: Nat}      # one ranked activation cell
```

- `nodes` — node ids (slugs mapped to Nats by the shell). **Position in this
  list is the activation index**; edge endpoints (`src`/`dst`) are ids resolved
  through `index_of`, so a non-contiguous id set is fine and an absent endpoint
  contributes nothing (no crash, no stray allocation).
- `edges` — directed, weighted, relation-labelled. `rel` is carried but not yet
  gated on (see §7 open questions).
- `anchors` — seed node ids. `steps` — exact number of rounds. `scope` — the
  allow-list of returnable ids.
- Activation is a `+List<Nat>` aligned with `nodes`.

## 3. Integer fixed point (why)

Bend 2.0.21 has no floating point and big integer literals overflow, so the
kernel uses small Nat constants and exact integer division:

| constant | value | role |
|---|---|---|
| `scale` | 8 | fixed-point denominator |
| `wmax` | 8 | max edge weight (bounds check) |
| `decay` | 4 | per-hop decay numerator |
| `init` | 8 | anchor seed activation |
| `amax` | 32 | per-cell saturation cap |

Per hop: `hop(v, w) = floor(floor(v*w / scale) * decay / scale)`, implemented as
`((((v * w : Nat) / scale()) * decayn() : Nat) / scale())`. Every cell is
saturated at `amax` by `cap_add`. Determinism is exact: no rounding mode, no
FP ordering, no platform variance.

## 4. Ranking and retrieval pipeline

1. `seed` — zeros of length `len(nodes)`, `init` at each anchor present.
2. `round` — for every edge, add `hop(activation(src), weight)` to `dst`
   (saturating at `amax`); then `keep_top` retains the top `budget` activated
   cells (**activation descending, node id ascending**), zeroing the rest.
3. `drive` — runs exactly `task.steps` rounds (Nat fuel, one level per round).
4. `rank_cells` — `DCell`s with non-zero activation, insertion-sorted by the
   total order `cell_before(ca,ci,ha,hi) = ca>ha ∨ (ca=ha ∧ ci<hi)`.
5. `retrieve` — `rank_cells → filter_scope → take_cells(budget) → ids`. The
   **scope filter runs before top-K**, so an out-of-scope node is dropped even
   if it out-ranks every in-scope node.

## 5. Laws (35: 8 universal by unfolding, 27 concrete witnesses)

All 35 are discharged by a same-named proof def; `--check-only` verifies each.

### 5.1 Universal — closed by definitional unfolding / reflexivity

| # | law | one-line statement |
|---|---|---|
| U1 | `law_zero_activation_no_flow` | `hop(0, w) = 0` for every weight `w`. |
| U2 | `law_retrieval_determinism` | `retrieve(g,t,b) = retrieve(g,t,b)` (identical output for identical input). |
| U3 | `law_activation_determinism` | `diffuse(g,t,b) = diffuse(g,t,b)`. |
| U4 | `law_rank_determinism` | `rank_cells(diffuse …)` is one fixed value. |
| U5 | `law_quarantine_on_empty_anchors` | empty anchors ⇒ `quarantined = True` for any graph/scope. |
| U6 | `law_seed_empty_anchors_is_zeros` | `seed(g, ∅) = zeros(len(nodes))`. |
| U7 | `law_take_zero_empty` | `take_cells(0, cells) = ∅`. |
| U8 | `law_rank_empty_nodes` | `rank_cells(act, ∅) = ∅`. |

### 5.2 Concrete fixture / gate witnesses

| # | law | one-line statement |
|---|---|---|
| W1 | `law_scale_positive` | `scale > 0`. |
| W2 | `law_weights_bounded_demo` | every demo edge weight ∈ [0, `wmax`]. |
| W3 | `law_activation_bounded_demo` | every demo cell ∈ [0, `amax`]. |
| W4 | `law_support_le_budget_demo` | visited cells ≤ node budget. |
| W5 | `law_support_no_full_scan_demo` | visited cells < node count (no full scan). |
| W6 | `law_steps_zero_identity_demo` | zero steps return the seed untouched. |
| W7 | `law_retrieval_fixture_demo` | demo retrieval returns `[3]`. |
| W8 | `law_edge_reorder_invariant_demo` | retrieval is invariant to a fixed edge reorder. |
| W9 | `law_anchor_reorder_invariant_demo` | retrieval is invariant to a fixed anchor reorder. |
| W10 | `law_activation_edge_reorder_demo` | activation is invariant to a fixed edge reorder. |
| W11 | `law_rank_sorted_desc_demo` | ranked activations are non-increasing. |
| W12 | `law_tiebreak_ids_ascending_demo` | equal activation breaks by ascending id. |
| W13 | `law_tiebreak_node_reorder_stable` | tie-break survives a node-list reorder. |
| W14 | `law_scope_all_in_demo` | every returned id is in scope. |
| W15 | `law_scope_high_out_activated_demo` | an out-of-scope node is internally activated (>0). |
| W16 | `law_scope_high_out_excluded_demo` | that same out-of-scope node is never returned. |
| W17 | `law_scope_empty_scope_none` | empty scope returns nothing. |
| W18 | `law_provenance_demo` | every returned node is reachable from an anchor within the bound. |
| W19 | `law_provenance_anchor_seed` | an anchor is reachable at 0 hops. |
| W20 | `law_decay_factor` | `hop(init, wmax) = 4` (decay witness). |
| W21 | `law_zero_weight_edge_no_flow` | a weight-0 edge changes no flow. |
| W22 | `law_self_loop_safe` | a self-loop stays bounded and does not diverge. |
| W23 | `law_quarantine_empty_anchors_demo` | empty anchors ⇒ no result. |
| W24 | `law_quarantine_absent_anchors_demo` | anchors absent from the graph ⇒ no result. |
| W25 | `law_digest_eq_positive` | byte-exact digest equality is reflexive on byte lists. |
| W26 | `law_gate_allow_demo` | the 7-bit gate allows when all bits pass. |
| W27 | `law_gate_deny_demo` | a tampered revision digest denies at law 1. |

## 6. Reproduction evidence (observed, not claimed)

```
$ BEND_NO_TELEMETRY=1 /Users/a3fckx/.bend/bin/bend runtime/worker/diffusion.bend --check-only
All terms check.                                            # exit 0

$ BEND_NO_TELEMETRY=1 /Users/a3fckx/.bend/bin/bend runtime/worker/diffusion.bend
[3n]                                                        # exit 0
```

Falsification (scratch copies outside the repo):

```
# fixture mutant: law_retrieval_fixture_demo RHS [3n] -> [4n]
Error: - expected : [3n]  - observed : [4n]   Location: law_retrieval_fixture_demo   exit 1
# universal mutant: law_zero_activation_no_flow RHS 0n -> 1n
Error: - expected : 0n   - observed : 1n      Location: law_zero_activation_no_flow  exit 1
# original restored
All terms check.                                            # exit 0
```

- Named laws: **35** (8 universal + 27 concrete).
- Lines: **979**. Bend: **2.0.21**. sha256:
  `92227b4486be67c237741656a8ff5f9c638d300cec40809528a7c8e19068acc9`.

## 7. PROVEN vs DESIGNED

**PROVEN (machine-checked for this exact revision):** the 35 laws above — the
universal identities by unfolding/reflexivity, the concrete witnesses by
computation over fixtures.

**DESIGNED, not proven:**
- universal attenuation (`hop(v,w) ≤ v` for all `v,w`);
- universal support ≤ budget / provenance / scope invariants (only the demo
  fixture is witnessed);
- cost: an O(E) scan per round, and no CSR index;
- mass is **not** conserved (this kernel is bounded lexical matching, not
  personalized PageRank);
- structural digest equality only (no sha256 in Bend);
- `rel` is carried but not used for relation-label gating.

## 8. Counterexamples and handling

| hazard | handling |
|---|---|
| out-of-scope node with high activation | dropped by `filter_scope` before top-K (W15/W16). |
| empty or absent anchor set | quarantined → all-zeros activation, empty result (U5, W23/W24). |
| weight-0 edge | contributes exactly 0 (W21). |
| self-loop | one bounded hop; no divergence (W22). |
| over-cap activation | saturated at `amax` by `cap_add` (W3). |
| over-budget propagation | trimmed to top `budget` cells per round (W4/W5). |
| reordered edges / anchors / nodes | retrieval and activation unchanged (W8/W9/W10/W13). |
| endpoint id absent from `nodes` | `index_of` returns out-of-range, contributes 0. |
| tie in activation | deterministic ascending-id tie-break (W12/W13). |

## 9. Non-claims (shell still owns)

CSR bytes, sha256/hex-decode/byte scans, context-snapshot text and keyword
counts, slug↔Nat mapping and identity roster, schema validation, `rel` label
semantics, commits/tags/merges/reviewer≠worker. Bend proves only the pure
decision over handed-in values.

## 10. Open questions

1. Constant approval: are 8/8/4/8/32 the intended fixed point, or should
   `amax`/`decay` stay per-call parameters?
2. Overflow/underflow policy: drop stray cells silently (current) vs quarantine
   the whole task.
3. Is a CSR index needed, or is O(E)-per-round acceptable at target graph sizes?
4. Relation-label gating: should `rel` filter edges before propagation?
5. Decay form: is `floor(floor(v*w/s)*d/s)` the intended attenuation, or a
   single fused `floor(v*w*d/(s*s))`?
6. Provenance strength: "reachable within bound" vs "reachable on a path that
   actually carried activation".
7. The stronger universal claims (§7) need induction proofs (add/mul lemmas,
   support bounds) that this pass did not discharge.
