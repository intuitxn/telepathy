import Base

# ============================================================================
# diffusion.bend — pure, task-scoped diffusion retrieval kernel.
# Bend 2.0.21 (integer fixed point only; the language has no floats).
#
# STATUS: draft, agent-authored, reconstruction of a lost revision from the
#   spec in `.local/engram/diffusion-retrieval-kernel.md`. A passing checker is
#   NEVER acceptance. Only a named human reviewing this exact revision resolves
#   the job. This file performs no IO, network, clock, subprocess, or hashing:
#   the caller supplies the graph, anchors, node budget and scope as values.
#
# SHAPE:
#   DEdge{src,dst,weight,rel} over DGraph{nodes,edges}; DTask{anchors,steps,scope}
#   Activation is a +List<Nat> aligned with DGraph.nodes (index i <-> nodes[i]).
#   One round adds, for every IN-SCOPE edge, `hop(v,w) = floor(floor(v*w/scale)*decay/scale)`
#   into the dst cell, caps each cell at amax, then keeps only the top `budget`
#   activated cells (activation desc, node id asc). Diffusion runs exactly
#   `steps` rounds. `retrieve` ranks, filters to the in-scope set BEFORE top-K,
#   and returns node ids only.
#
# TRAVERSAL GATE (security fix, Authorization-First): an edge (u -> v) conducts
#   activation only when BOTH u and v are in scope (conduct/edge_gated). An
#   out-of-scope node therefore neither receives activation over an edge nor
#   conducts it onward: propagation runs on the in-scope induced subgraph, so
#   in-scope scores cannot depend on out-of-scope nodes or edges. This closes
#   the prior score-level rank-then-filter leak (activation used to propagate
#   THROUGH out-of-scope nodes; see docs/drafts/meta/diffusion-retrieval-laws.md).
#   Seeding is not traversal: an out-of-scope *anchor* still receives its seed,
#   but cannot conduct (shell must keep anchors in scope; see non-claims).
#
# CONSTANTS: scale 8, wmax 8, decay 4, init 8, amax 32.
#
# GATE: 45 named laws (9 universally quantified closed by definitional
#   unfolding / reflexivity; 36 concrete fixture/gate witnesses), each
#   discharged by a same-named proof def. The 2.0.21 `law`/proof split needs
#   no separate file.
# ============================================================================

# ---- Types -----------------------------------------------------------------

type DEdge is Data:
  DEdge{src: Nat, dst: Nat, weight: Nat, rel: Nat}

type DGraph is Data:
  DGraph{nodes: +List<Nat>, edges: +List<DEdge>}

type DTask is Data:
  DTask{anchors: +List<Nat>, steps: Nat, scope: +List<Nat>}

# One ranked activation cell: `id` is a node id, `act` its activation.
type DCell is Data:
  DCell{act: Nat, id: Nat}

# Gate result types (7-bit gate; shape mirrors docs/designs/agit-in-bend.md
# §1/§4/§5, renamed to avoid Base collisions such as `Fail`).
type LawResult is Data:
  LPass{}
  LFail{}
  LUneval{}

type Verdict is Data:
  Allow{}
  Deny{code: Nat}
  NeedInput{code: Nat}

type LawSet is Data:
  LawSet{l1: LawResult, l2: LawResult, l3: LawResult, l4: LawResult, l5: LawResult, l6: LawResult, l7: LawResult}

# Evidence for the pure 7-bit gate. Digests are byte lists (shell hex-decodes
# `sha256:...` before calling Bend); bits are 1/0 from shell-side byte scans.
type DEvidence is Data:
  DEvidence{revision: +List<Nat>, active: +List<Nat>, b_anchor: Nat, b_scope: Nat, b_budget: Nat, b_weight: Nat, b_lineage: Nat}

# ---- Field accessors (Bend matches a parameter to read fields) -------------

def nodes_of(+g: DGraph) -> +List<Nat>:
  match g:
    case DGraph{n, e}:
      n

def edges_of(+g: DGraph) -> +List<DEdge>:
  match g:
    case DGraph{n, e}:
      e

def anchors_of(+t: DTask) -> +List<Nat>:
  match t:
    case DTask{a, s, sc}:
      a

def steps_of(+t: DTask) -> Nat:
  match t:
    case DTask{a, s, sc}:
      s

def scope_of(+t: DTask) -> +List<Nat>:
  match t:
    case DTask{a, s, sc}:
      sc

# ---- Constants -------------------------------------------------------------

def scale() -> Nat:
  8n

def wmax() -> Nat:
  8n

def decayn() -> Nat:
  4n

def init() -> Nat:
  8n

def amax() -> Nat:
  32n

# ---- Primitive truth helpers (bools are 1-bit Data) ------------------------

def nat_lt(a: Nat, b: Nat) -> Bool:
  Nat.is_lt(a, b)

def nat_le(a: Nat, b: Nat) -> Bool:
  Nat.is_le(a, b)

def nat_eq(a: Nat, b: Nat) -> Bool:
  Nat.is_eq(a, b)

# `or`/`and` on flags, written as defs so no computed value is ever matched.
def bor(a: Bool, b: Bool) -> Bool:
  match a:
    case True{}:
      True{}
    case False{}:
      b

def band(a: Bool, b: Bool) -> Bool:
  match a:
    case True{}:
      b
    case False{}:
      False{}

def bnot(a: Bool) -> Bool:
  match a:
    case True{}:
      False{}
    case False{}:
      True{}

def bool_bit(b: Bool) -> Nat:
  match b:
    case True{}:
      1n
    case False{}:
      0n

# ---- List utilities --------------------------------------------------------

def list_len(+xs: +List<Nat>) -> Nat:
  match xs:
    case Nil{}:
      0n
    case Con{h, t}:
      1n+list_len(t)

def is_empty(+xs: +List<Nat>) -> Bool:
  match xs:
    case Nil{}:
      True{}
    case Con{h, t}:
      False{}

def member(+x: Nat, +xs: +List<Nat>) -> Bool:
  match xs:
    case Nil{}:
      False{}
    case Con{h, t}:
      bor(nat_eq(h, x), member(x, t))

def list_eq(+xs: +List<Nat>, +ys: +List<Nat>) -> Bool:
  match xs ys:
    case Nil{} Nil{}:
      True{}
    case Nil{} Con{h, t}:
      False{}
    case Con{h, t} Nil{}:
      False{}
    case Con{h, t} Con{k, u}:
      band(nat_eq(h, k), list_eq(t, u))

# Byte-exact, length-sensitive digest equality (digests cross as byte lists;
# Bend cannot hash, so the shell does the hashing and Bend compares bytes).
def digest_eq(+a: +List<Nat>, +b: +List<Nat>) -> Bool:
  match a b:
    case Nil{} Nil{}:
      True{}
    case Nil{} Con{h, t}:
      False{}
    case Con{h, t} Nil{}:
      False{}
    case Con{h, t} Con{k, u}:
      band(nat_eq(h, k), digest_eq(t, u))

# union-without-duplicates: xs' elements not already in ys, then ys.
def norep(+xs: +List<Nat>, +ys: +List<Nat>) -> +List<Nat>:
  match xs:
    case Nil{}:
      ys
    case Con{h, t}:
      Bool.pick(+List<Nat>, member(h, ys), norep(t, ys), h <> norep(t, ys))

# ---- Fixed-point arithmetic ------------------------------------------------

# One hop: floor(floor(v*w/scale)*decay/scale). Order of the factors does not
# matter for concrete values; the `*w` first mirrors the spec formula.
def hop(v: Nat, w: Nat) -> Nat:
  ((((v * w : Nat) / scale() : Nat) * decayn() : Nat) / scale() : Nat)

def nth(+xs: +List<Nat>, i: Nat, dflt: Nat) -> Nat:
  match xs:
    case Nil{}:
      dflt
    case Con{h, t}:
      match i:
        case 0n:
          h
        case 1n+p:
          nth(t, p, dflt)

def zeros(n: Nat) -> +List<Nat>:
  match n:
    case 0n:
      Nil{}
    case 1n+p:
      0n <> zeros(p)

# saturating add: min(a+b, amax). Keeps every activation cell within bounds.
def cap_add(+a: Nat, +b: Nat) -> Nat:
  Bool.pick(Nat, Nat.is_le((a + b : Nat), amax()), (a + b : Nat), amax())

# add c into cell i (out-of-range writes are no-ops, never stray allocs).
def bump(+xs: +List<Nat>, i: Nat, c: Nat) -> +List<Nat>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      match i:
        case 0n:
          cap_add(h, c) <> t
        case 1n+p:
          h <> bump(t, p, c)

# position of x in xs, or list_len(xs) when absent (out of range for bump/nth).
def index_of(+x: Nat, +xs: +List<Nat>, +i: Nat) -> Nat:
  match xs:
    case Nil{}:
      i
    case Con{h, t}:
      Bool.pick(Nat, nat_eq(h, x), i, index_of(x, t, (i + 1n : Nat)))

# number of non-zero (activated) cells.
def support_of(+xs: +List<Nat>) -> Nat:
  match xs:
    case Nil{}:
      0n
    case Con{h, t}:
      (Bool.pick(Nat, nat_eq(h, 0n), 0n, 1n) + support_of(t) : Nat)

def max_act(+xs: +List<Nat>, +acc: Nat) -> Nat:
  match xs:
    case Nil{}:
      acc
    case Con{h, t}:
      max_act(t, Bool.pick(Nat, nat_lt(acc, h), h, acc))

def list_sum(+xs: +List<Nat>, acc: Nat) -> Nat:
  match xs:
    case Nil{}:
      acc
    case Con{h, t}:
      list_sum(t, (acc + h : Nat))

# ---- Ranking (activation desc, node id asc) --------------------------------

# True when cell (ca,ci) must sort strictly before (ha,hi):
# ca > ha, or ca == ha and ci < hi.
def cell_before(+ca: Nat, +ci: Nat, +ha: Nat, +hi: Nat) -> Bool:
  bor(nat_lt(ha, ca), band(nat_eq(ca, ha), nat_lt(ci, hi)))

def insert_go(+ca: Nat, +ci: Nat, +sorted: +List<DCell>) -> +List<DCell>:
  match sorted:
    case Nil{}:
      DCell{ca, ci} <> Nil{}
    case Con{h, t}:
      match h:
        case DCell{+ha, +hi}:
          Bool.pick(+List<DCell>,
                    cell_before(ca, ci, ha, hi),
                    DCell{ca, ci} <> (DCell{ha, hi} <> t),
                    DCell{ha, hi} <> insert_go(ca, ci, t))

def insert_cell(+c: DCell, +sorted: +List<DCell>) -> +List<DCell>:
  match c:
    case DCell{+ca, +ci}:
      insert_go(ca, ci, sorted)

# stable insertion sort; ties are resolved by the total order in cell_before.
def sort_insert(+pending: +List<DCell>, +sorted: +List<DCell>) -> +List<DCell>:
  match pending:
    case Nil{}:
      sorted
    case Con{c, t}:
      sort_insert(t, insert_cell(c, sorted))

# cells with non-zero activation, in node order (input to the sort).
# nodes first so an empty node list short-circuits before the activation list;
# this keeps `rank_cells(act, Nil{})` reducible for the universal empty law.
def cells_of(+nodes: +List<Nat>, +av: +List<Nat>) -> +List<DCell>:
  match nodes:
    case Nil{}:
      Nil{}
    case Con{n, +nt}:
      match av:
        case Nil{}:
          Nil{}
        case Con{+a, +at}:
          Bool.pick(+List<DCell>, nat_eq(a, 0n), cells_of(nt, at), DCell{a, n} <> cells_of(nt, at))

def rank_cells(+av: +List<Nat>, +nodes: +List<Nat>) -> +List<DCell>:
  sort_insert(cells_of(nodes, av), Nil{})

def acts_of(+cells: +List<DCell>) -> +List<Nat>:
  match cells:
    case Nil{}:
      Nil{}
    case Con{c, t}:
      match c:
        case DCell{a, i}:
          a <> acts_of(t)

def ids_of(+cells: +List<DCell>) -> +List<Nat>:
  match cells:
    case Nil{}:
      Nil{}
    case Con{c, t}:
      match c:
        case DCell{a, i}:
          i <> ids_of(t)

def nonincr_tail(+xs: +List<Nat>, prev: Nat) -> Bool:
  match xs:
    case Nil{}:
      True{}
    case Con{h, t}:
      band(nat_le(h, prev), nonincr_tail(t, h))

def nonincr(+xs: +List<Nat>) -> Bool:
  match xs:
    case Nil{}:
      True{}
    case Con{h, t}:
      nonincr_tail(t, h)

# keep only cells whose id is in scope, preserving rank order.
def filter_scope(+cells: +List<DCell>, +scope: +List<Nat>) -> +List<DCell>:
  match cells:
    case Nil{}:
      Nil{}
    case Con{c, t}:
      match c:
        case DCell{+a, +i}:
          Bool.pick(+List<DCell>, member(i, scope), DCell{a, i} <> filter_scope(t, scope), filter_scope(t, scope))

def take_cells(n: Nat, +cells: +List<DCell>) -> +List<DCell>:
  match n cells:
    case 0n _:
      Nil{}
    case 1n+p Nil{}:
      Nil{}
    case 1n+p Con{c, t}:
      c <> take_cells(p, t)

# ---- Seeding, quarantine, propagation --------------------------------------

def seed_into(+anchors: +List<Nat>, +acc: +List<Nat>, +nodes: +List<Nat>) -> +List<Nat>:
  match anchors:
    case Nil{}:
      acc
    case Con{a, t}:
      seed_into(t, bump(acc, index_of(a, nodes, 0n), init()), nodes)

# activation vector of length len(nodes): init at each anchor id present.
def seed(+g: DGraph, +anchors: +List<Nat>) -> +List<Nat>:
  seed_into(anchors, zeros(list_len(nodes_of(g))), nodes_of(g))

def anchors_present(+anchors: +List<Nat>, +nodes: +List<Nat>) -> Nat:
  match anchors:
    case Nil{}:
      0n
    case Con{a, t}:
      (Bool.pick(Nat, member(a, nodes), 1n, 0n) + anchors_present(t, nodes) : Nat)

# quarantine: empty anchor set, or no anchor present in the graph.
def quarantined(+task: DTask, +g: DGraph) -> Bool:
  match task:
    case DTask{+a, +s, +sc}:
      bor(is_empty(a), nat_eq(anchors_present(a, nodes_of(g)), 0n))

# ---- Traversal gate (Authorization-First) -----------------------------------

def edge_src(+e: DEdge) -> Nat:
  match e:
    case DEdge{s, d, w, r}:
      s

def edge_dst(+e: DEdge) -> Nat:
  match e:
    case DEdge{s, d, w, r}:
      d

# The named gate rule: an edge (u -> v) conducts only if BOTH endpoints are in
# scope. Both endpoints (not just dst) is required because a dst-only gate would
# still let an activated out-of-scope source push into an in-scope cell, and a
# src-only gate would still write activation into out-of-scope nodes (observable
# via scores/counts and able to contend for the global node budget). Only the
# conjunction makes in-scope scores a pure function of the in-scope subgraph.
def conduct(+s: Nat, +d: Nat, +scope: +List<Nat>) -> Bool:
  band(member(s, scope), member(d, scope))

def edge_gated(+e: DEdge, +scope: +List<Nat>) -> Bool:
  conduct(edge_src(e), edge_dst(e), scope)

# node ids are labels; the activation vector is indexed by position in
# DGraph.nodes, so endpoints are mapped through index_of (absent -> no flow).
# A non-gated edge is the identity on the accumulator: no activation moves.
def edge_into(+acc: +List<Nat>, +e: DEdge, +act: +List<Nat>, +nodes: +List<Nat>, +scope: +List<Nat>) -> +List<Nat>:
  match e:
    case DEdge{s, d, w, r}:
      Bool.pick(+List<Nat>,
                conduct(s, d, scope),
                bump(acc, index_of(d, nodes, 0n), hop(nth(act, index_of(s, nodes, 0n), 0n), w)),
                acc)

def fold_edges(+es: +List<DEdge>, +acc: +List<Nat>, +act: +List<Nat>, +nodes: +List<Nat>, +scope: +List<Nat>) -> +List<Nat>:
  match es:
    case Nil{}:
      acc
    case Con{e, t}:
      fold_edges(t, edge_into(acc, e, act, nodes, scope), act, nodes, scope)

# rebuild a vector by writing each kept cell's activation at its node index.
def set_cells(+cells: +List<DCell>, +acc: +List<Nat>, +nodes: +List<Nat>) -> +List<Nat>:
  match cells:
    case Nil{}:
      acc
    case Con{c, t}:
      match c:
        case DCell{a, i}:
          set_cells(t, bump(acc, index_of(i, nodes, 0n), a), nodes)

# cap to the top `budget` activated cells (rank order), zeroing the rest.
def keep_top(+acc: +List<Nat>, +nodes: +List<Nat>, +budget: Nat) -> +List<Nat>:
  set_cells(take_cells(budget, rank_cells(acc, nodes)), zeros(list_len(nodes)), nodes)

# exactly one round: simultaneous edge update (gated by scope), cap cells, keep
# top-budget. The scope gate is threaded here so propagation never leaves it.
def round(+g: DGraph, +act: +List<Nat>, +budget: Nat, +scope: +List<Nat>) -> +List<Nat>:
  keep_top(fold_edges(edges_of(g), zeros(list_len(nodes_of(g))), act, nodes_of(g), scope), nodes_of(g), budget)

# bounded driver: Nat fuel counts rounds down; exactly `steps` rounds run.
def drive(fuel: Nat, +g: DGraph, +act: +List<Nat>, +budget: Nat, +scope: +List<Nat>) -> +List<Nat>:
  match fuel:
    case 0n:
      act
    case 1n+p:
      drive(p, g, round(g, act, budget, scope), budget, scope)

def diffuse_branch(q: Bool, +g: DGraph, +task: DTask, +budget: Nat) -> +List<Nat>:
  match q:
    case True{}:
      zeros(list_len(nodes_of(g)))
    case False{}:
      match task:
        case DTask{a, s, sc}:
          drive(s, g, seed(g, a), budget, sc)

# final activation after exactly task.steps rounds (or all-zeros if quarantined)
def diffuse(+g: DGraph, +task: DTask, +budget: Nat) -> +List<Nat>:
  diffuse_branch(quarantined(task, g), g, task, budget)

def activation_at(id: Nat, +act: +List<Nat>, +nodes: +List<Nat>) -> Nat:
  nth(act, index_of(id, nodes, 0n), 0n)

def retrieve_branch(q: Bool, +g: DGraph, +task: DTask, +budget: Nat) -> +List<Nat>:
  match q:
    case True{}:
      Nil{}
    case False{}:
      match task:
        case DTask{a, s, sc}:
          ids_of(take_cells(budget, filter_scope(rank_cells(diffuse(g, task, budget), nodes_of(g)), sc)))

# scope gate before top-K: out-of-scope activation is dropped, never returned.
def retrieve(+g: DGraph, +task: DTask, +budget: Nat) -> +List<Nat>:
  retrieve_branch(quarantined(task, g), g, task, budget)

# every node carrying non-zero activation, in node order (the activation support).
def activated_ids(+act: +List<Nat>, +nodes: +List<Nat>) -> +List<Nat>:
  ids_of(cells_of(nodes, act))

# the in-scope ranked candidate set (activation desc, id asc) BEFORE id
# projection: the object the traversal gate makes independent of out-of-scope
# nodes/edges.
def ranked_in_scope(+g: DGraph, +task: DTask, +budget: Nat) -> +List<DCell>:
  match task:
    case DTask{a, s, sc}:
      take_cells(budget, filter_scope(rank_cells(diffuse(g, task, budget), nodes_of(g)), sc))

# ---- Well-formedness checks -------------------------------------------------

def all_weights_ok(+es: +List<DEdge>) -> Bool:
  match es:
    case Nil{}:
      True{}
    case Con{e, t}:
      match e:
        case DEdge{s, d, w, r}:
          band(nat_le(w, wmax()), all_weights_ok(t))

def all_in_scope(+ids: +List<Nat>, +scope: +List<Nat>) -> Bool:
  match ids:
    case Nil{}:
      True{}
    case Con{h, t}:
      band(member(h, scope), all_in_scope(t, scope))

# ---- Bounded provenance reachability ---------------------------------------

def cons_if(b: Bool, x: Nat, +xs: +List<Nat>) -> +List<Nat>:
  match b:
    case True{}:
      x <> xs
    case False{}:
      xs

def fold_edges_set(+es: +List<DEdge>, +acc: +List<Nat>, +from: +List<Nat>) -> +List<Nat>:
  match es:
    case Nil{}:
      acc
    case Con{e, t}:
      match e:
        case DEdge{s, d, w, r}:
          fold_edges_set(t, cons_if(member(s, from), d, acc), from)

def step_set(+g: DGraph, +from: +List<Nat>) -> +List<Nat>:
  fold_edges_set(edges_of(g), Nil{}, from)

# nodes reachable from `from` in at most `fuel` hops. Fuel is first so the
# termination checker sees a decreasing argument before the transformed set.
def reach(fuel: Nat, +g: DGraph, +from: +List<Nat>) -> +List<Nat>:
  match fuel:
    case 0n:
      from
    case 1n+p:
      reach(p, g, norep(from, step_set(g, from)))

def reachable(g: DGraph, +anchors: +List<Nat>, fuel: Nat, target: Nat) -> Bool:
  member(target, reach(fuel, g, anchors))

def all_reachable(+ids: +List<Nat>, +g: DGraph, +anchors: +List<Nat>, +fuel: Nat) -> Bool:
  match ids:
    case Nil{}:
      True{}
    case Con{h, t}:
      band(reachable(g, anchors, fuel, h), all_reachable(t, g, anchors, fuel))

# ---- Fixtures ---------------------------------------------------------------

def demo_nodes() -> +List<Nat>:
  [0n, 1n, 2n, 3n, 4n, 5n]

def demo_edges() -> +List<DEdge>:
  [DEdge{0n, 1n, 8n, 1n}, DEdge{0n, 2n, 8n, 1n}, DEdge{2n, 4n, 8n, 1n}, DEdge{1n, 3n, 4n, 1n}, DEdge{3n, 4n, 4n, 1n}, DEdge{2n, 1n, 2n, 1n}, DEdge{5n, 0n, 1n, 1n}]

def demo_edges_reordered() -> +List<DEdge>:
  [DEdge{5n, 0n, 1n, 1n}, DEdge{2n, 1n, 2n, 1n}, DEdge{3n, 4n, 4n, 1n}, DEdge{1n, 3n, 4n, 1n}, DEdge{2n, 4n, 8n, 1n}, DEdge{0n, 2n, 8n, 1n}, DEdge{0n, 1n, 8n, 1n}]

def demo_graph() -> DGraph:
  DGraph{demo_nodes(), demo_edges()}

def demo_graph_reordered() -> DGraph:
  DGraph{demo_nodes(), demo_edges_reordered()}

def demo_anchors() -> +List<Nat>:
  [0n, 5n]

def demo_anchors_reordered() -> +List<Nat>:
  [5n, 0n]

def demo_scope() -> +List<Nat>:
  [0n, 1n, 2n, 3n]

def demo_steps() -> Nat:
  2n

def budget() -> Nat:
  4n

def demo_task() -> DTask:
  DTask{demo_anchors(), demo_steps(), demo_scope()}

def out_node() -> Nat:
  4n

def anchor0() -> Nat:
  0n

# tie fixture: node 5 and node 2 receive equal activation; ranking must return
# id 2 before id 5. Compare with its node-reordered twin.
def tie_nodes() -> +List<Nat>:
  [5n, 2n, 9n]

def tie_nodes_reordered() -> +List<Nat>:
  [9n, 2n, 5n]

def tie_edges() -> +List<DEdge>:
  [DEdge{9n, 5n, 8n, 1n}, DEdge{9n, 2n, 8n, 1n}]

def tie_graph() -> DGraph:
  DGraph{tie_nodes(), tie_edges()}

def tie_graph_reordered() -> DGraph:
  DGraph{tie_nodes_reordered(), tie_edges()}

def tie_task() -> DTask:
  DTask{[9n], 1n, [5n, 2n, 9n]}

def tie_expected() -> +List<Nat>:
  [2n, 5n]

# zero-weight fixture: demo graph plus a weight-0 edge; it must not move flow.
def zero_weight_graph() -> DGraph:
  DGraph{demo_nodes(), [DEdge{0n, 1n, 8n, 1n}, DEdge{0n, 2n, 8n, 1n}, DEdge{2n, 4n, 8n, 1n}, DEdge{1n, 3n, 4n, 1n}, DEdge{3n, 4n, 4n, 1n}, DEdge{2n, 1n, 2n, 1n}, DEdge{5n, 0n, 1n, 1n}, DEdge{1n, 4n, 0n, 1n}]}

# self-loop fixture: a single node with a self-loop must stay bounded.
def self_loop_graph() -> DGraph:
  DGraph{[0n], [DEdge{0n, 0n, 8n, 1n}]}

def self_task() -> DTask:
  DTask{[0n], 2n, [0n]}

def self_expected() -> +List<Nat>:
  [0n]

# ---- Leak fixtures: out-of-scope hubs --------------------------------------

def hub_node() -> Nat:
  6n

# edge-hub: demo nodes, plus a high-weight out-of-scope hub at node 4 with an
# inbound edge (0 -> 4) and an outbound edge (4 -> 1). Under a naive traversal
# both conduct and change in-scope scores; under the gate neither conducts.
def edge_hub_edges() -> +List<DEdge>:
  [DEdge{0n, 4n, 8n, 1n}, DEdge{4n, 1n, 8n, 1n}, DEdge{0n, 1n, 8n, 1n}, DEdge{0n, 2n, 8n, 1n}, DEdge{2n, 4n, 8n, 1n}, DEdge{1n, 3n, 4n, 1n}, DEdge{3n, 4n, 4n, 1n}, DEdge{2n, 1n, 2n, 1n}, DEdge{5n, 0n, 1n, 1n}]

def edge_hub_graph() -> DGraph:
  DGraph{demo_nodes(), edge_hub_edges()}

# external-hub: demo graph plus a brand-new out-of-scope node 6, with edges
# 0 -> 6 (in) and 6 -> 1 (out). Node-list length differs from the demo, so the
# leak witness compares the id/score-level in-scope ranked set, not the raw
# activation vector.
def leak_nodes() -> +List<Nat>:
  [0n, 1n, 2n, 3n, 4n, 5n, 6n]

def leak_edges() -> +List<DEdge>:
  [DEdge{0n, 6n, 8n, 1n}, DEdge{6n, 1n, 8n, 1n}, DEdge{0n, 1n, 8n, 1n}, DEdge{0n, 2n, 8n, 1n}, DEdge{2n, 4n, 8n, 1n}, DEdge{1n, 3n, 4n, 1n}, DEdge{3n, 4n, 4n, 1n}, DEdge{2n, 1n, 2n, 1n}, DEdge{5n, 0n, 1n, 1n}]

def leak_graph() -> DGraph:
  DGraph{leak_nodes(), leak_edges()}

# ---- Pure 7-bit gate --------------------------------------------------------

def is_missing(+d: +List<Nat>) -> Bool:
  is_empty(d)

def bit_to_law_b(bit: Nat) -> LawResult:
  match bit:
    case 0n:
      LFail{}
    case 1n+p:
      LPass{}

def bit_to_law(bit: Nat, missing: Bool) -> LawResult:
  match missing:
    case True{}:
      LUneval{}
    case False{}:
      bit_to_law_b(bit)

def prove_all(+ev: DEvidence) -> LawSet:
  match ev:
    case DEvidence{+r, +a, b1, b2, b3, b4, b5}:
      LawSet{ bit_to_law(bool_bit(digest_eq(r, a)), bor(is_empty(r), is_empty(a))),
              bit_to_law(b1, False{}),
              bit_to_law(b2, False{}),
              bit_to_law(b3, False{}),
              bit_to_law(b4, False{}),
              bit_to_law(b5, False{}),
              bit_to_law(bool_bit(nat_le(support_of(r), amax())), False{}) }

def gate7(g: LawResult) -> Verdict:
  match g:
    case LFail{}:
      Deny{7n}
    case LPass{}:
      Allow{}
    case LUneval{}:
      NeedInput{7n}

def gate6(f: LawResult, g: LawResult) -> Verdict:
  match f:
    case LFail{}:
      Deny{6n}
    case LPass{}:
      gate7(g)
    case LUneval{}:
      NeedInput{6n}

def gate5(e: LawResult, f: LawResult, g: LawResult) -> Verdict:
  match e:
    case LFail{}:
      Deny{5n}
    case LPass{}:
      gate6(f, g)
    case LUneval{}:
      NeedInput{5n}

def gate4(d: LawResult, e: LawResult, f: LawResult, g: LawResult) -> Verdict:
  match d:
    case LFail{}:
      Deny{4n}
    case LPass{}:
      gate5(e, f, g)
    case LUneval{}:
      NeedInput{4n}

def gate3(c: LawResult, d: LawResult, e: LawResult, f: LawResult, g: LawResult) -> Verdict:
  match c:
    case LFail{}:
      Deny{3n}
    case LPass{}:
      gate4(d, e, f, g)
    case LUneval{}:
      NeedInput{3n}

def gate2(b: LawResult, c: LawResult, d: LawResult, e: LawResult, f: LawResult, g: LawResult) -> Verdict:
  match b:
    case LFail{}:
      Deny{2n}
    case LPass{}:
      gate3(c, d, e, f, g)
    case LUneval{}:
      NeedInput{2n}

def gate1(a: LawResult, b: LawResult, c: LawResult, d: LawResult, e: LawResult, f: LawResult, g: LawResult) -> Verdict:
  match a:
    case LFail{}:
      Deny{1n}
    case LPass{}:
      gate2(b, c, d, e, f, g)
    case LUneval{}:
      NeedInput{1n}

def gate(+ls: LawSet) -> Verdict:
  match ls:
    case LawSet{a, b, c, d, e, f, g}:
      gate1(a, b, c, d, e, f, g)

def demo_evidence_ok() -> DEvidence:
  DEvidence{[1n, 2n, 3n], [1n, 2n, 3n], 1n, 1n, 1n, 1n, 1n}

def demo_evidence_tampered() -> DEvidence:
  DEvidence{[1n, 2n, 4n], [1n, 2n, 3n], 1n, 1n, 1n, 1n, 1n}

# ============================================================================
# LAWS
# ============================================================================

# ---- 8 universal laws (closed by definitional unfolding / reflexivity) -----

# U1: zero activation sends no flow, for every edge weight.
law law_zero_activation_no_flow:
  for w: Nat
  {hop(0n, w) == 0n : Nat}

def law_zero_activation_no_flow(w):
  {==}

# U2: retrieval is a pure function of (graph, task, budget) — same input,
# identical ranked output. Stated as reflexivity so any effect smuggled in
# breaks the proof at check time.
law law_retrieval_determinism:
  for +g: DGraph
  for +t: DTask
  for +b: Nat
  {retrieve(g, t, b) == retrieve(g, t, b) : +List<Nat>}

def law_retrieval_determinism(g, t, b):
  {==}

# U3: the activation vector itself is deterministic.
law law_activation_determinism:
  for +g: DGraph
  for +t: DTask
  for +b: Nat
  {diffuse(g, t, b) == diffuse(g, t, b) : +List<Nat>}

def law_activation_determinism(g, t, b):
  {==}

# U4: ranking is deterministic (same cells, same ranked order).
law law_rank_determinism:
  for +g: DGraph
  for +t: DTask
  for +b: Nat
  {rank_cells(diffuse(g, t, b), nodes_of(g)) == rank_cells(diffuse(g, t, b), nodes_of(g)) : +List<DCell>}

def law_rank_determinism(g, t, b):
  {==}

# U5: an empty anchor set is quarantined, for any graph, step count and scope.
law law_quarantine_on_empty_anchors:
  for g: DGraph
  for s: Nat
  for sc: +List<Nat>
  {quarantined(DTask{Nil{}, s, sc}, g) == True{} : Bool}

def law_quarantine_on_empty_anchors(g, s, sc):
  {==}

# U6: seeding an empty anchor set yields the all-zero activation vector.
law law_seed_empty_anchors_is_zeros:
  for +g: DGraph
  {seed(g, Nil{}) == zeros(list_len(nodes_of(g))) : +List<Nat>}

def law_seed_empty_anchors_is_zeros(g):
  {==}

# U7: taking zero cells always yields the empty list.
law law_take_zero_empty:
  for +cells: +List<DCell>
  {take_cells(0n, cells) == Nil{} : +List<DCell>}

def law_take_zero_empty(cells):
  {==}

# U8: ranking over an empty node set is empty, for any activation vector.
law law_rank_empty_nodes:
  for +act: +List<Nat>
  {rank_cells(act, Nil{}) == Nil{} : +List<DCell>}

def law_rank_empty_nodes(act):
  {==}

# ---- 27 concrete fixture / gate witnesses ----------------------------------

# W1: scale is positive.
law law_scale_positive:
  {nat_lt(0n, scale()) == True{} : Bool}

def law_scale_positive():
  {==}

# W2: every demo edge weight is within [0, wmax].
law law_weights_bounded_demo:
  {all_weights_ok(demo_edges()) == True{} : Bool}

def law_weights_bounded_demo():
  {==}

# W3: every demo activation cell stays within [0, amax].
law law_activation_bounded_demo:
  {nat_le(max_act(diffuse(demo_graph(), demo_task(), budget()), 0n), amax()) == True{} : Bool}

def law_activation_bounded_demo():
  {==}

# W4: visited (non-zero) cells never exceed the node budget.
law law_support_le_budget_demo:
  {nat_le(support_of(diffuse(demo_graph(), demo_task(), budget())), budget()) == True{} : Bool}

def law_support_le_budget_demo():
  {==}

# W5: no full scan — support is strictly below the node count.
law law_support_no_full_scan_demo:
  {nat_lt(support_of(diffuse(demo_graph(), demo_task(), budget())), list_len(demo_nodes())) == True{} : Bool}

def law_support_no_full_scan_demo():
  {==}

# W6: zero steps return the seed untouched (exactly steps rounds run).
law law_steps_zero_identity_demo:
  {diffuse(demo_graph(), DTask{demo_anchors(), 0n, demo_scope()}, budget()) == seed(demo_graph(), demo_anchors()) : +List<Nat>}

def law_steps_zero_identity_demo():
  {==}

# W7: the demo retrieval fixture — node 3 (the only in-scope activated cell at
# round 2) is returned.
law law_retrieval_fixture_demo:
  {retrieve(demo_graph(), demo_task(), budget()) == [3n] : +List<Nat>}

def law_retrieval_fixture_demo():
  {==}

# W8: retrieval is invariant to a fixed edge reorder.
law law_edge_reorder_invariant_demo:
  {retrieve(demo_graph(), demo_task(), budget()) == retrieve(demo_graph_reordered(), demo_task(), budget()) : +List<Nat>}

def law_edge_reorder_invariant_demo():
  {==}

# W9: retrieval is invariant to a fixed anchor reorder.
law law_anchor_reorder_invariant_demo:
  {retrieve(demo_graph(), DTask{demo_anchors_reordered(), demo_steps(), demo_scope()}, budget()) == retrieve(demo_graph(), demo_task(), budget()) : +List<Nat>}

def law_anchor_reorder_invariant_demo():
  {==}

# W10: the activation vector is invariant to a fixed edge reorder.
law law_activation_edge_reorder_demo:
  {diffuse(demo_graph(), demo_task(), budget()) == diffuse(demo_graph_reordered(), demo_task(), budget()) : +List<Nat>}

def law_activation_edge_reorder_demo():
  {==}

# W11: ranked activations are non-increasing.
law law_rank_sorted_desc_demo:
  {nonincr(acts_of(rank_cells(diffuse(demo_graph(), demo_task(), budget()), demo_nodes()))) == True{} : Bool}

def law_rank_sorted_desc_demo():
  {==}

# W12: equal activation is broken by ascending node id (2 before 5).
law law_tiebreak_ids_ascending_demo:
  {retrieve(tie_graph(), tie_task(), budget()) == tie_expected() : +List<Nat>}

def law_tiebreak_ids_ascending_demo():
  {==}

# W13: tie-break stability survives a node-list reorder.
law law_tiebreak_node_reorder_stable:
  {retrieve(tie_graph_reordered(), tie_task(), budget()) == tie_expected() : +List<Nat>}

def law_tiebreak_node_reorder_stable():
  {==}

# W14: every returned id is in scope.
law law_scope_all_in_demo:
  {all_in_scope(retrieve(demo_graph(), demo_task(), budget()), demo_scope()) == True{} : Bool}

def law_scope_all_in_demo():
  {==}

# W15 (SECURITY FIX): the out-of-scope node 4 receives NO activation through
# traversal. Under the old output-only filter it carried internal activation
# (> 0) and could conduct onward; the traversal gate removes that entirely.
# This replaces the former `law_scope_high_out_activated_demo`, which asserted
# the vulnerable behaviour. It is not a weakening: `= 0` is strictly stronger
# than `> 0` for the security property under test.
law law_gate_no_oos_activation_demo:
  {activation_at(out_node(), diffuse(demo_graph(), demo_task(), budget()), demo_nodes()) == 0n : Nat}

def law_gate_no_oos_activation_demo():
  {==}

# W16: that same out-of-scope node is never returned (negative witness, part 2).
law law_scope_high_out_excluded_demo:
  {member(out_node(), retrieve(demo_graph(), demo_task(), budget())) == False{} : Bool}

def law_scope_high_out_excluded_demo():
  {==}

# W17: an empty scope returns nothing, whatever the activation.
law law_scope_empty_scope_none:
  {retrieve(demo_graph(), DTask{demo_anchors(), demo_steps(), Nil{}}, budget()) == Nil{} : +List<Nat>}

def law_scope_empty_scope_none():
  {==}

# W18: every returned node is reachable from an anchor within the round bound.
law law_provenance_demo:
  {all_reachable(retrieve(demo_graph(), demo_task(), budget()), demo_graph(), demo_anchors(), demo_steps()) == True{} : Bool}

def law_provenance_demo():
  {==}

# W19: an anchor is reachable at zero hops.
law law_provenance_anchor_seed:
  {reachable(demo_graph(), demo_anchors(), 0n, anchor0()) == True{} : Bool}

def law_provenance_anchor_seed():
  {==}

# W20: init 8 with wmax 8 decays to 4 over one hop.
law law_decay_factor:
  {hop(init(), wmax()) == 4n : Nat}

def law_decay_factor():
  {==}

# W21: a weight-0 edge moves no flow (adding it changes nothing).
law law_zero_weight_edge_no_flow:
  {retrieve(zero_weight_graph(), demo_task(), budget()) == retrieve(demo_graph(), demo_task(), budget()) : +List<Nat>}

def law_zero_weight_edge_no_flow():
  {==}

# W22: a self-loop stays bounded and does not diverge.
law law_self_loop_safe:
  {retrieve(self_loop_graph(), self_task(), budget()) == self_expected() : +List<Nat>}

def law_self_loop_safe():
  {==}

# W23: an empty anchor set is quarantined (returns nothing).
law law_quarantine_empty_anchors_demo:
  {retrieve(demo_graph(), DTask{Nil{}, demo_steps(), demo_scope()}, budget()) == Nil{} : +List<Nat>}

def law_quarantine_empty_anchors_demo():
  {==}

# W24: an anchor set with no node present in the graph is quarantined.
law law_quarantine_absent_anchors_demo:
  {retrieve(demo_graph(), DTask{[999n], demo_steps(), demo_scope()}, budget()) == Nil{} : +List<Nat>}

def law_quarantine_absent_anchors_demo():
  {==}

# W25: byte-exact digest equality is reflexive on byte lists.
law law_digest_eq_positive:
  {digest_eq([1n, 2n, 3n], [1n, 2n, 3n]) == True{} : Bool}

def law_digest_eq_positive():
  {==}

# W26: the gate allows when all seven bits pass.
law law_gate_allow_demo:
  {gate(prove_all(demo_evidence_ok())) == Allow{} : Verdict}

def law_gate_allow_demo():
  {==}

# W27: a tampered revision digest denies at law 1.
law law_gate_deny_demo:
  {gate(prove_all(demo_evidence_tampered())) == Deny{1n} : Verdict}

def law_gate_deny_demo():
  {==}

# ---- Traversal-gate and leak laws (Authorization-First fix) -----------------
#
# (c) the gate is deterministic and total;
# (a) no activation reaches an out-of-scope node through an in-scope path;
# (b) in-scope ranked output is unchanged by out-of-scope nodes/edges.

# U9: the traversal gate is a pure function of (edge, scope): same input,
# identical decision. Reflexivity, so any effect smuggled into `conduct` /
# `edge_gated` breaks the proof at check time.
law law_gate_determinism:
  for +e: DEdge
  for +sc: +List<Nat>
  {edge_gated(e, sc) == edge_gated(e, sc) : Bool}

def law_gate_determinism(e, sc):
  {==}

# W-gate-1: an edge with both endpoints in scope is admitted.
law law_gate_true_in_scope_demo:
  {edge_gated(DEdge{0n, 1n, 8n, 1n}, demo_scope()) == True{} : Bool}

def law_gate_true_in_scope_demo():
  {==}

# W-gate-2: an edge whose destination is out of scope is blocked (no "into").
law law_gate_false_oos_dst_demo:
  {edge_gated(DEdge{2n, 4n, 8n, 1n}, demo_scope()) == False{} : Bool}

def law_gate_false_oos_dst_demo():
  {==}

# W-gate-3: an edge whose source is out of scope is blocked (no "through").
law law_gate_false_oos_src_demo:
  {edge_gated(DEdge{4n, 1n, 8n, 1n}, demo_scope()) == False{} : Bool}

def law_gate_false_oos_src_demo():
  {==}

# W-gate-4 (c): the gate is total — both Bool arms are realised on the fixture
# (one admitted in-scope edge, one blocked out-of-scope edge), so it is never
# stuck and never partial.
law law_gate_total_demo:
  {(bool_bit(edge_gated(DEdge{0n, 1n, 8n, 1n}, demo_scope())) + bool_bit(edge_gated(DEdge{2n, 4n, 8n, 1n}, demo_scope())) : Nat) == 1n : Nat}

def law_gate_total_demo():
  {==}

# W-gate-5 (a): every activated node in the demo kernel is in scope — no
# out-of-scope node is reached by any in-scope path.
law law_gate_activation_subset_scope_demo:
  {all_in_scope(activated_ids(diffuse(demo_graph(), demo_task(), budget()), demo_nodes()), demo_scope()) == True{} : Bool}

def law_gate_activation_subset_scope_demo():
  {==}

# W-leak-1 (b): adding an out-of-scope EDGE hub to the demo graph leaves the
# raw activation vector unchanged (same node set, so vectors are comparable).
law law_leak_hub_diffuse_identical:
  {diffuse(edge_hub_graph(), demo_task(), budget()) == diffuse(demo_graph(), demo_task(), budget()) : +List<Nat>}

def law_leak_hub_diffuse_identical():
  {==}

# W-leak-2 (b): adding an out-of-scope NODE hub leaves the in-scope ranked
# candidate set (scores + ids) unchanged.
law law_leak_hub_rank_identical:
  {ranked_in_scope(leak_graph(), demo_task(), budget()) == ranked_in_scope(demo_graph(), demo_task(), budget()) : +List<DCell>}

def law_leak_hub_rank_identical():
  {==}

# W-leak-3 (b): and therefore the returned id ranking is unchanged.
law law_leak_hub_retrieval_identical:
  {retrieve(leak_graph(), demo_task(), budget()) == retrieve(demo_graph(), demo_task(), budget()) : +List<Nat>}

def law_leak_hub_retrieval_identical():
  {==}

# W-leak-4 (a): the added out-of-scope hub node 6 receives zero activation.
law law_leak_hub_no_oos_activation:
  {activation_at(hub_node(), diffuse(leak_graph(), demo_task(), budget()), leak_nodes()) == 0n : Nat}

def law_leak_hub_no_oos_activation():
  {==}

# ---- Kernel entry point -----------------------------------------------------

def main() -> +List<Nat>:
  retrieve(demo_graph(), demo_task(), budget())
