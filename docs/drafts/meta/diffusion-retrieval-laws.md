# Diffusion retrieval kernel — laws and design

Draft · agent-authored · 2026-09-22 · **not published, not committed, not accepted.**
A passing checker is never acceptance. Only a named human reviewing this exact
revision resolves the job. This note authorizes no merge, tag, publish or send.

- Kernel: `runtime/worker/diffusion.bend` (Bend 2.0.21; sha256 in §6).
- Checker: `BEND_NO_TELEMETRY=1 /Users/a3fckx/.bend/bin/bend runtime/worker/diffusion.bend --check-only`.

**Change in this revision (security fix):** the kernel used to filter to the
in-scope set only *before top-K* (output-only gating) while activation still
propagated **through out-of-scope nodes** — a score-level rank-then-filter that
leaks existence/count/timing (Wang et al. 2017; Namboothiri 2026,
"Authorization-First Retrieval"). This revision gates the **traversal**: an
edge conducts activation only when **both endpoints are in scope**, so
propagation runs on the in-scope induced subgraph. See §4, §5.1 (U9/W28–W36),
§6 (leak witness + falsification) and §7.

---

## 1. What it is

A **pure** kernel for task-scoped, diffusion-style memory retrieval. It performs
no IO, network, clock, subprocess or hashing; the caller supplies every value.
All arithmetic is integer fixed point (Bend 2.0.21 has no floats). Propagation
is confined to the in-scope induced subgraph (§4.2); the kernel returns **node
ids only**.

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
  gated on (see §10, open questions).
- `anchors` — seed node ids. `steps` — exact number of rounds. `scope` — the
  allow-list of traversable/returnable ids.
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

## 4. Traversal gate, ranking and retrieval pipeline

### 4.1 The gate rule (named)

```bend
def conduct(s, d, scope) -> Bool:            # an edge (s -> d) may conduct ...
  band(member(s, scope), member(d, scope))   # ... iff BOTH endpoints are in scope
def edge_gated(e, scope) -> Bool:
  conduct(edge_src(e), edge_dst(e), scope)
```

**Both endpoints, not just one.** A *dst-only* gate would still let an activated
out-of-scope source push activation into an in-scope cell (out-of-scope data
shapes in-scope scores → leak). A *src-only* gate would still write activation
into out-of-scope nodes (observable via scores/counts, and able to contend for
the global node budget). Only the conjunction makes in-scope scores a pure
function of the in-scope subgraph. This is the Authorization-First rule:
authorization constrains the candidate set **before** any aggregating component
consumes it.

### 4.2 Pipeline

1. `seed` — zeros of length `len(nodes)`, `init` at each anchor present.
2. `round(g, act, budget, scope)` — for every **gated** edge, add
   `hop(activation(src), weight)` to `dst` (saturating at `amax`); a non-gated
   edge is the identity on the accumulator. Then `keep_top` retains the top
   `budget` activated cells (**activation descending, node id ascending**),
   zeroing the rest. The seed is consumed in round 1's fold; activation lives on
   edges, so an out-of-scope anchor does not survive round 1.
3. `drive` — runs exactly `task.steps` rounds (Nat fuel, one level per round).
4. `rank_cells` — `DCell`s with non-zero activation, insertion-sorted by the
   total order `cell_before(ca,ci,ha,hi) = ca>ha ∨ (ca=ha ∧ ci<hi)`.
5. `ranked_in_scope` — `rank_cells → filter_scope → take_cells(budget)`; the
   in-scope ranked candidate set (scores + ids) before id projection.
6. `retrieve` — `ids_of` of that set. The scope filter is retained as
   defense-in-depth even though the traversal gate already keeps activation in
   scope.

## 5. Laws (45: 9 universal by unfolding/reflexivity, 36 concrete witnesses)

All 45 are discharged by a same-named proof def; `--check-only` verifies each.

### 5.1 Universal — closed by definitional unfolding / reflexivity

| # | law | one-line statement |
|---|---|---|
| U1 | `law_zero_activation_no_flow` | `hop(0, w) = 0` for every weight `w`. |
| U2 | `law_retrieval_determinism` | `retrieve(g,t,b) = retrieve(g,t,b)`. |
| U3 | `law_activation_determinism` | `diffuse(g,t,b) = diffuse(g,t,b)`. |
| U4 | `law_rank_determinism` | `rank_cells(diffuse …)` is one fixed value. |
| U5 | `law_quarantine_on_empty_anchors` | empty anchors ⇒ `quarantined = True` for any graph/scope. |
| U6 | `law_seed_empty_anchors_is_zeros` | `seed(g, ∅) = zeros(len(nodes))`. |
| U7 | `law_take_zero_empty` | `take_cells(0, cells) = ∅`. |
| U8 | `law_rank_empty_nodes` | `rank_cells(act, ∅) = ∅`. |
| **U9** | **`law_gate_determinism`** | **the gate is a pure function: `edge_gated(e,sc) = edge_gated(e,sc)` (law c, deterministic).** |

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
| W8 | `law_edge_reorder_invariant_demo` | retrieval invariant to a fixed edge reorder. |
| W9 | `law_anchor_reorder_invariant_demo` | retrieval invariant to a fixed anchor reorder. |
| W10 | `law_activation_edge_reorder_demo` | activation invariant to a fixed edge reorder. |
| W11 | `law_rank_sorted_desc_demo` | ranked activations are non-increasing. |
| W12 | `law_tiebreak_ids_ascending_demo` | equal activation breaks by ascending id. |
| W13 | `law_tiebreak_node_reorder_stable` | tie-break survives a node-list reorder. |
| W14 | `law_scope_all_in_demo` | every returned id is in scope. |
| **W15** | **`law_gate_no_oos_activation_demo`** | **out-of-scope node 4 receives ZERO activation (a). Replaces the former `law_scope_high_out_activated_demo`, which asserted the vulnerable behaviour (> 0); `= 0` is strictly stronger, not a weakening.** |
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
| **W28** | **`law_gate_true_in_scope_demo`** | **an edge with both endpoints in scope is admitted.** |
| **W29** | **`law_gate_false_oos_dst_demo`** | **an edge whose destination is out of scope is blocked ("into").** |
| **W30** | **`law_gate_false_oos_src_demo`** | **an edge whose source is out of scope is blocked ("through").** |
| **W31** | **`law_gate_total_demo`** | **the gate realises both Bool arms on the fixture ⇒ total (law c).** |
| **W32** | **`law_gate_activation_subset_scope_demo`** | **every activated node is in scope (a).** |
| **W33** | **`law_leak_hub_diffuse_identical`** | **adding an out-of-scope EDGE hub leaves the raw activation vector unchanged (b).** |
| **W34** | **`law_leak_hub_rank_identical`** | **adding an out-of-scope NODE hub leaves the in-scope ranked set (scores + ids) unchanged (b).** |
| **W35** | **`law_leak_hub_retrieval_identical`** | **and therefore the returned id ranking is unchanged (b).** |
| **W36** | **`law_leak_hub_no_oos_activation`** | **the added out-of-scope hub node 6 receives zero activation (a).** |

### 5.3 Leak fixtures

- `edge_hub_graph` — demo nodes plus a high-weight out-of-scope hub at node 4:
  inbound `0 -> 4` and outbound `4 -> 1` (w 8). Exercises both "into" (W29) and
  "through" (W30).
- `leak_graph` — demo graph plus a **new out-of-scope node 6** with `0 -> 6`
  (in) and `6 -> 1` (out) (w 8). Node-list length differs, so the witness
  compares the id/score-level in-scope ranked set (W34/W35), not the raw vector.

## 6. Reproduction evidence (observed, not claimed)

```
$ BEND_NO_TELEMETRY=1 /Users/a3fckx/.bend/bin/bend runtime/worker/diffusion.bend --check-only
All terms check.                                            # exit 0

$ BEND_NO_TELEMETRY=1 /Users/a3fckx/.bend/bin/bend runtime/worker/diffusion.bend
[3n]                                                        # exit 0
```

Leak witness (scratch runners outside the repo; each imports the kernel at its
absolute path). With the hub vs without the hub, the in-scope ranked output is
identical:

```
# WITHOUT hub
$ bend <scratch>/repo_demo.bend
[3n]
# WITH out-of-scope hub
$ bend <scratch>/repo_leak.bend
[3n]

# in-scope ranked ids: WITHOUT hub / WITH hub
[3n]
[3n]

# equality assertion [retrieve, rank-ids, rank-acts]  (1 == equal)
$ bend <scratch>/repo_assert.bend
[1n, 1n, 1n]
```

Non-vacuity (pre-fix revision, scratch copy `old_leak.bend`): the same fixture
**did** leak — the out-of-scope hub's activation reached in-scope node 1 and
changed the result:

```
# pre-fix: WITHOUT hub / WITH hub
[3n]
[1n, 3n]        # leak: out-of-scope activation shaped in-scope ranking
```

Falsification (scratch copy outside the repo; gate mutated by removing the
scope condition: `conduct(s,d,scope) = band(True{}, True{})`):

```
$ BEND_NO_TELEMETRY=1 /Users/a3fckx/.bend/bin/bend <scratch>/mutant_ungated.bend --check-only
Error:
- expected : 2n
- observed : 0n
Location: law_gate_no_oos_activation_demo
exit 1
```

The mutation is caught by the new law: with the condition removed, out-of-scope
node 4 receives activation `2n` instead of `0n`. A laws-stripped semantic mutant
confirms the leak law itself: `retrieve(leak)=[1n,3n]` vs `retrieve(demo)=[3n]`,
equality bit `[0n]` (where `law_leak_hub_retrieval_identical` requires `1`).

The pre-fix falsifiers on the retained laws still fire as before (fixture mutant
`law_retrieval_fixture_demo` RHS `[3n] -> [4n]`; universal mutant
`law_zero_activation_no_flow` RHS `0n -> 1n`), reported in the prior revision.

- Named laws: **45** (9 universal + 36 concrete). Lines: **1153**. Bend: **2.0.21**.
- sha256: `cbbe54a17f871a62ac81b1dc0082ca850062567cf42bd93fc52b13b6300098cb`.

## 7. PROVEN vs DESIGNED

**PROVEN (machine-checked for this exact revision):** the 45 laws above — the
universal identities by unfolding/reflexivity (including gate determinism, U9),
the concrete witnesses by computation over fixtures, the gate rule's admission
and both blocking directions (W28–W30), gate totality (W31), activation ⊆ scope
(W32), and the leak-invariance witnesses at score and id level (W33–W36). The
falsification above shows the gate is load-bearing: removing the scope condition
fails `law_gate_no_oos_activation_demo`.

**DESIGNED, not proven:**
- the *universal* statement that in-scope scores are a pure function of the
  in-scope induced subgraph for **all** graphs (only fixtures are witnessed);
- universal attenuation (`hop(v,w) ≤ v` for all `v,w`);
- universal support ≤ budget / provenance invariants (only fixtures witnessed);
- cost: an O(E) scan per round, no CSR index;
- mass is **not** conserved (this is a bounded decayed walk, not PPR);
- structural digest equality only (no sha256 in Bend);
- `rel` is carried but not used for relation-label gating.

**Changed law (not weakened):** W15 was `law_scope_high_out_activated_demo`,
asserting an out-of-scope node carried internal activation — i.e. it witnessed
the leak. It is incompatible with any gate that blocks edges into out-of-scope
nodes, so it is replaced by `law_gate_no_oos_activation_demo` (`= 0`), a
strictly stronger claim for the security property. W16 and all other prior laws
are unchanged and still pass.

## 8. Counterexamples and handling

| hazard | handling |
|---|---|
| out-of-scope node with high activation | **traversal gate**: it never receives activation over an edge and cannot conduct (W15/W32); dropped by `filter_scope` as defense-in-depth (W16). |
| out-of-scope hub bridging two in-scope nodes | both its inbound and outbound edges are blocked; in-scope scores/ids unchanged (W33–W36). |
| edges into / through out-of-scope nodes | blocked: `conduct` requires both endpoints in scope (W29/W30). |
| out-of-scope anchor | seeded, but never conducts; consumed in round 1's fold, so it does not survive `steps ≥ 1` and is filtered from output. Shell must keep anchors in scope (§9). |
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
decision over handed-in values. **Additionally:** the traversal gate assumes the
caller supplies `anchors ⊆ scope`; an out-of-scope anchor is only reachable as a
`steps = 0` seed and is never returned, but the shell should still validate the
anchor roster. The gate proves properties over the values handed in; it does not
authenticate scope membership or freshness.

## 10. Open questions

1. Constant approval: are 8/8/4/8/32 the intended fixed point, or should
   `amax`/`decay` stay per-call parameters?
2. Should the node budget be scoped to the in-scope set per round, or stay
   global? The current global budget is harmless under the gate (out-of-scope
   cells are never activated), but scoping it would make the Authorization-First
   story explicit.
3. Is a CSR index needed, or is O(E)-per-round acceptable at target graph sizes?
4. Relation-label gating: should `rel` restrict edges **in addition to** scope
   before propagation?
5. Decay form: is `floor(floor(v*w/s)*d/s)` the intended attenuation, or a
   single fused `floor(v*w*d/(s*s))`?
6. Provenance strength: "reachable within bound" vs "reachable on a gated path
   that actually carried activation".
7. The stronger universal claims (§7) need induction proofs (add/mul lemmas,
   support bounds) that this pass did not discharge.
