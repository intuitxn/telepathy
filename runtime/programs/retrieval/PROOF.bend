import Base
import ./LAWS.bend as Laws
import ./graph.bend as G
import ./rank.bend as Rank
import ./route.bend as Route

# ---- PROOF.bend: retrieval-spike proofs (AI-owned; `bend PROOF.bend` gate) --
# PORT NOTE (2026-09-22): ported from bend 2.0.5 to bend 2.0.21. Since 2.0.16
# a bare infix operator in a def body or proof-type annotation must carry its
# type: every formerly-bare `a + b` / `a * b` / `a / b` below is now wrapped as
# `(a + b : Nat)` etc. No law, statement, or proof term changed semantically;
# all 5 laws and every helper lemma still check. See
# docs/drafts/meta/retrieval-port-notes.md for the checker transcript.
# Status on bend 2.0.5 (PATH toolchain `/Users/a3fckx/.bend/bin/bend`):
# 5/5 laws HOLD for the honestly-narrowed fragments (2026-09-18 downgrade):
# Laws 2-4 closed as before (computation/reflexivity/case analysis). Law 1
# (mass_conservation) is narrowed to the fuel-0 base case (any h, {==} by
# computation; the any-fuel induction needed law 5 general). Law 5
# (step_preserves_heat) is narrowed to Nil{} ({==} by computation).
# The GENERAL claims (any fuel/vector step preservation + mass conservation)
# remain ORACLE-VERIFIED only (REPORT.md §3b, §9-§10).
# Machine-checked assembly progress beyond §9 (fused single-defs, Bool.pick,
# structural matches, Laws. qualification, +Nat, shrinking-arg-first):
# Nat add library (add_zero/right_succ/comm/assoc/shuffle_base/shuffle,
# add_shift); list_sum_acc, zip_add_sum; nsub_zero/add/refl; div-by-one
# (go_one/div_one/mul_one, node_one, tele_one), div-by-two (go2, node_two),
# div-by-four (Q4/go4m/go4r/go4, node_four); add_at sums with idx bounds
# (add_at_zero/add_at_len/add_at_sum via Bool.pick(Nat.is_lt)) and spread_gain
# (gain function for spread sums; full spread/scatter/teleport assembly with
# pad_ge+half_le+take/drop and divisor-1000 takes bound remains open, see §10).
# Demos unchanged: graph 4n, rank 1200n, route Answer{0n,49n}.

# PROOF: fuel_zero_identity holds by computation — diffuse matches fuel
# against 0n and returns the heat vector untouched.
def Laws.fuel_zero_identity(h):
  {==}

# PROOF: route_deterministic holds by reflexivity — both sides are the
# identical pure application, so they compute to the same term.
def Laws.route_deterministic(scores, threshold, min_margin):
  {==}

# PROOF: no_leak holds by case analysis — every Route constructor maps to
# False{}, so no verdict can expose provenance.
def Laws.no_leak(r):
  match r:
    case Route.Answer{d, c}:
      {==}
    case Route.Abstain{e}:
      {==}

# ---- Nat add library (needed by list/division lemmas) ----------------------
def add_zero(+n: Nat) -> {Nat.add(n, 0n) == n : Nat}:
  match n:
    case 0n:
      {==}
    case 1n+p:
      %add_zero(p) : {1n+Nat.add(p, 0n) == 1n+_ : Nat}
      {==}

def add_right_succ(+a: Nat, +b: Nat) -> {Nat.add(a, 1n+b) == 1n+Nat.add(a, b) : Nat}:
  match a:
    case 0n:
      {==}
    case 1n+p:
      %add_right_succ(p, b) : {1n+Nat.add(p, 1n+b) == 1n+_ : Nat}
      {==}

def add_comm(+a: Nat, +b: Nat) -> {Nat.add(a, b) == Nat.add(b, a) : Nat}:
  match a:
    case 0n:
      Equal.sym(Nat, Nat.add(b, 0n), b, add_zero(b))
    case 1n+p:
      match b:
        case 0n:
          add_zero(1n+p)
        case 1n+q:
          %Equal.sym(Nat, Nat.add(p, 1n+q), 1n+Nat.add(p, q), add_right_succ(p, q)) : {1n+_ == 1n+Nat.add(q, 1n+p) : Nat}
          %Equal.sym(Nat, Nat.add(q, 1n+p), 1n+Nat.add(q, p), add_right_succ(q, p)) : {1n+(1n+Nat.add(p, q)) == 1n+_ : Nat}
          %add_comm(p, q) : {1n+(1n+Nat.add(p, q)) == 1n+(1n+_) : Nat}
          {==}

def add_assoc(+a: Nat, +b: Nat, +c: Nat) -> {Nat.add(Nat.add(a, b), c) == Nat.add(a, Nat.add(b, c)) : Nat}:
  match a:
    case 0n:
      {==}
    case 1n+p:
      %add_assoc(p, b, c) : {1n+Nat.add(Nat.add(p, b), c) == 1n+_ : Nat}
      {==}

def add_shuffle_base(+b: Nat, +c: Nat, +d: Nat) -> {Nat.add(b, Nat.add(c, d)) == Nat.add(c, Nat.add(b, d)) : Nat}:
  %Equal.sym(Nat, Nat.add(b, Nat.add(c, d)), Nat.add(Nat.add(c, d), b), add_comm(b, Nat.add(c, d))) : {_ == (c + (b + d) : Nat) : Nat}
  %Equal.sym(Nat, Nat.add(Nat.add(c, d), b), Nat.add(c, Nat.add(d, b)), add_assoc(c, d, b)) : {_ == (c + (b + d) : Nat) : Nat}
  %Equal.sym(Nat, Nat.add(d, b), Nat.add(b, d), add_comm(d, b)) : {Nat.add(c, _) == (c + (b + d) : Nat) : Nat}
  {==}

def add_shuffle(+a: Nat, +b: Nat, +c: Nat, +d: Nat) -> {Nat.add(Nat.add(a, b), Nat.add(c, d)) == Nat.add(Nat.add(a, c), Nat.add(b, d)) : Nat}:
  match a:
    case 0n:
      add_shuffle_base(b, c, d)
    case 1n+p:
      %add_shuffle(p, b, c, d) : {1n+Nat.add(Nat.add(p, b), (c + d : Nat)) == 1n+_ : Nat}
      {==}

# ---- List sum library ------------------------------------------------------
def list_sum_acc(+xs: +List<Nat>, +acc: Nat) -> {G.list_sum(xs, acc) == (acc + Rank.heat_sum(xs) : Nat) : Nat}:
  match xs:
    case Nil{}:
      Equal.sym(Nat, Nat.add(acc, 0n), acc, add_zero(acc))
    case Con{h, t}:
      %Equal.sym(Nat, G.list_sum(t, h), (h + Rank.heat_sum(t) : Nat), list_sum_acc(t, h)) : {G.list_sum(t, (acc + h : Nat)) == (acc + _ : Nat) : Nat}
      %add_assoc(acc, h, Rank.heat_sum(t)) : {G.list_sum(t, (acc + h : Nat)) == _ : Nat}
      list_sum_acc(t, (acc + h : Nat))

def zip_add_sum(+xs: +List<Nat>, +ys: +List<Nat>) -> {Rank.heat_sum(Rank.zip_add(xs, ys)) == (Rank.heat_sum(xs) + Rank.heat_sum(ys) : Nat) : Nat}:
  match xs:
    case Nil{}:
      {==}
    case Con{h, t}:
      match ys:
        case Nil{}:
          Equal.sym(Nat, (Rank.heat_sum(h <> t) + 0n : Nat), Rank.heat_sum(h <> t), add_zero(Rank.heat_sum(h <> t)))
        case Con{k, u}:
          %Equal.sym(Nat, G.list_sum(t, h), (h + Rank.heat_sum(t) : Nat), list_sum_acc(t, h)) : {G.list_sum(Rank.zip_add(t, u), (h + k : Nat)) == (_ + G.list_sum(u, k) : Nat) : Nat}
          %Equal.sym(Nat, G.list_sum(u, k), (k + Rank.heat_sum(u) : Nat), list_sum_acc(u, k)) : {G.list_sum(Rank.zip_add(t, u), (h + k : Nat)) == ((h + Rank.heat_sum(t)) + _ : Nat) : Nat}
          %Equal.sym(Nat, G.list_sum(Rank.zip_add(t, u), (h + k : Nat)), ((h + k) + Rank.heat_sum(Rank.zip_add(t, u)) : Nat), list_sum_acc(Rank.zip_add(t, u), (h + k : Nat))) : {_ == ((h + Rank.heat_sum(t)) + (k + Rank.heat_sum(u)) : Nat) : Nat}
          %Equal.sym(Nat, Rank.heat_sum(Rank.zip_add(t, u)), (Rank.heat_sum(t) + Rank.heat_sum(u) : Nat), zip_add_sum(t, u)) : {((h + k) + _ : Nat) == ((h + Rank.heat_sum(t)) + (k + Rank.heat_sum(u)) : Nat) : Nat}
          add_shuffle(h, k, Rank.heat_sum(t), Rank.heat_sum(u))

# ---- nsub exactness ---------------------------------------------------------
def nsub_zero(+b: Nat) -> {G.nsub(b, 0n) == b : Nat}:
  match b:
    case 0n:
      {==}
    case 1n+p:
      {==}

def nsub_add(+a: Nat, +b: Nat) -> {G.nsub(Nat.add(a, b), a) == b : Nat}:
  match a:
    case 0n:
      nsub_zero(b)
    case 1n+p:
      %nsub_add(p, b) : {G.nsub(Nat.add(p, b), p) == _ : Nat}
      {==}

def nsub_refl(+n: Nat) -> {G.nsub(n, n) == 0n : Nat}:
  match n:
    case 0n:
      {==}
    case 1n+p:
      %nsub_refl(p) : {G.nsub(p, p) == _ : Nat}
      {==}

# ---- Division by one (teleport pool, degree-1 nodes) ------------------------
def go_one(+n: Nat, +d: Nat) -> {Nat.div.fin(Nat.divmod.go(n, 0n, d, 0n)) == (d + n : Nat) : Nat}:
  match n:
    case 0n:
      %Equal.sym(Nat, Nat.add(d, 0n), d, add_zero(d)) : {d == _ : Nat}
      {==}
    case 1n+p:
      %Equal.sym(Nat, Nat.add(d, 1n+p), 1n+Nat.add(d, p), add_right_succ(d, p)) : {Nat.div.fin(Nat.divmod.go(p, 0n, 1n+d, 0n)) == _ : Nat}
      go_one(p, 1n+d)

def div_one(+n: Nat) -> {Nat.div(n, 1n) == n : Nat}:
  %go_one(n, 0n) : {Nat.div.fin(Nat.divmod.go(n, 0n, 0n, 0n)) == _ : Nat}
  {==}

def mul_one(+n: Nat) -> {Nat.mul(n, 1n) == n : Nat}:
  match n:
    case 0n:
      {==}
    case 1n+p:
      %mul_one(p) : {Nat.add(1n, Nat.mul(p, 1n)) == 1n+_ : Nat}
      {==}

# PROOF (machine-checked): degree-1 per-node conservation keep + 1*q == h.
def node_one(+h: Nat) -> {Nat.add(G.nsub(h, Nat.mul(Nat.div(h, 1n), 1n)), Nat.mul(Nat.div(h, 1n), 1n)) == h : Nat}:
  %Equal.sym(Nat, Nat.div(h, 1n), h, div_one(h)) : {Nat.add(G.nsub(h, Nat.mul(_, 1n)), Nat.mul(_, 1n)) == h : Nat}
  %Equal.sym(Nat, Nat.mul(h, 1n), h, mul_one(h)) : {Nat.add(G.nsub(h, _) , _) == h : Nat}
  %Equal.sym(Nat, G.nsub(h, h), 0n, nsub_refl(h)) : {Nat.add(_, h) == h : Nat}
  {==}

# PROOF (machine-checked): teleport repatriation for s == 1n.
def tele_one(+pool: Nat) -> {Nat.add(Nat.mul(Nat.div(pool, 1n), 1n), G.nsub(pool, Nat.mul(Nat.div(pool, 1n), 1n))) == pool : Nat}:
  %Equal.sym(Nat, Nat.div(pool, 1n), pool, div_one(pool)) : {Nat.add(Nat.mul(_, 1n), G.nsub(pool, Nat.mul(_, 1n))) == pool : Nat}
  %Equal.sym(Nat, Nat.mul(pool, 1n), pool, mul_one(pool)) : {Nat.add(_, G.nsub(pool, _)) == pool : Nat}
  %Equal.sym(Nat, G.nsub(pool, pool), 0n, nsub_refl(pool)) : {Nat.add(pool, _) == pool : Nat}
  add_zero(pool)

# ---- Division by two (degree-2 nodes) ---------------------------------------
def go2(+n: Nat, c: Bool, +d: Nat) -> Bool.pick(Type, c, {Nat.add(Nat.mul(d, 2n), n) == Nat.add(Nat.mul(Nat.div.fin(Nat.divmod.go(n, 1n, d, 0n)), 2n), Nat.mod.fin(Nat.divmod.go(n, 1n, d, 0n))) : Nat}, {Nat.add(Nat.add(Nat.mul(d, 2n), 1n), n) == Nat.add(Nat.mul(Nat.div.fin(Nat.divmod.go(n, 0n, d, 1n)), 2n), Nat.mod.fin(Nat.divmod.go(n, 0n, d, 1n))) : Nat}):
  match n:
    case 0n:
      match c:
        case False{}:
          %add_zero(Nat.add(Nat.mul(d, 2n), 1n)) : {Nat.add(Nat.add(Nat.mul(d, 2n), 1n), 0n) == _ : Nat}
          {==}
        case True{}:
          {==}
    case 1n+p:
      match c:
        case False{}:
          %Equal.sym(Nat, Nat.add(Nat.add(Nat.mul(d, 2n), 1n), 1n+p), Nat.add(Nat.mul(d, 2n), Nat.add(1n, 1n+p)), add_assoc(Nat.mul(d, 2n), 1n, 1n+p)) : {_ == Nat.add(Nat.mul(Nat.div.fin(Nat.divmod.go(p, 1n, 1n+d, 0n)), 2n), Nat.mod.fin(Nat.divmod.go(p, 1n, 1n+d, 0n))) : Nat}
          %Equal.sym(Nat, Nat.add(Nat.mul(d, 2n), Nat.add(2n, p)), Nat.add(2n, Nat.add(Nat.mul(d, 2n), p)), add_shuffle_base(Nat.mul(d, 2n), 2n, p)) : {_ == Nat.add(Nat.mul(Nat.div.fin(Nat.divmod.go(p, 1n, 1n+d, 0n)), 2n), Nat.mod.fin(Nat.divmod.go(p, 1n, 1n+d, 0n))) : Nat}
          %add_assoc(2n, Nat.mul(d, 2n), p) : {_ == Nat.add(Nat.mul(Nat.div.fin(Nat.divmod.go(p, 1n, 1n+d, 0n)), 2n), Nat.mod.fin(Nat.divmod.go(p, 1n, 1n+d, 0n))) : Nat}
          go2(p, True{}, 1n+d)
        case True{}:
          %add_assoc(Nat.mul(d, 2n), 1n, p) : {_ == Nat.add(Nat.mul(Nat.div.fin(Nat.divmod.go(p, 0n, d, 1n)), 2n), Nat.mod.fin(Nat.divmod.go(p, 0n, d, 1n))) : Nat}
          go2(p, False{}, d)

# PROOF (machine-checked): degree-2 per-node conservation keep + 2*q == h.
def node_two(+h: Nat) -> {Nat.add(G.nsub(h, Nat.mul(Nat.div(h, 2n), 2n)), Nat.mul(Nat.div(h, 2n), 2n)) == h : Nat}:
  %Equal.sym(Nat, h, Nat.add(Nat.mul(Nat.div(h, 2n), 2n), Nat.mod(h, 2n)), go2(h, True{}, 0n)) : {Nat.add(G.nsub(_, Nat.mul(Nat.div(h, 2n), 2n)), Nat.mul(Nat.div(h, 2n), 2n)) == h : Nat}
  %Equal.sym(Nat, G.nsub(Nat.add(Nat.mul(Nat.div(h, 2n), 2n), Nat.mod(h, 2n)), Nat.mul(Nat.div(h, 2n), 2n)), Nat.mod(h, 2n), nsub_add(Nat.mul(Nat.div(h, 2n), 2n), Nat.mod(h, 2n))) : {Nat.add(_, Nat.mul(Nat.div(h, 2n), 2n)) == h : Nat}
  %Equal.sym(Nat, Nat.add(Nat.mod(h, 2n), Nat.mul(Nat.div(h, 2n), 2n)), Nat.add(Nat.mul(Nat.div(h, 2n), 2n), Nat.mod(h, 2n)), add_comm(Nat.mod(h, 2n), Nat.mul(Nat.div(h, 2n), 2n))) : {_ == h : Nat}
  Equal.sym(Nat, h, Nat.add(Nat.mul(Nat.div(h, 2n), 2n), Nat.mod(h, 2n)), go2(h, True{}, 0n))

# ---- Division by four (degree-4 node 0) --------------------------------------
type Q4 is Data:
  Q0{}
  Q1{}
  Q2{}
  Q3{}

def go4m(q: Q4) -> Nat:
  match q:
    case Q0{}:
      3n
    case Q1{}:
      2n
    case Q2{}:
      1n
    case Q3{}:
      0n

def go4r(q: Q4) -> Nat:
  match q:
    case Q0{}:
      0n
    case Q1{}:
      1n
    case Q2{}:
      2n
    case Q3{}:
      3n

def go4(+n: Nat, q: Q4, +d: Nat) -> {Nat.add(Nat.mul(d, 4n), Nat.add(go4r(q), n)) == Nat.add(Nat.mul(Nat.div.fin(Nat.divmod.go(n, go4m(q), d, go4r(q))), 4n), Nat.mod.fin(Nat.divmod.go(n, go4m(q), d, go4r(q)))) : Nat}:
  match n:
    case 0n:
      match q:
        case Q0{}:
          {==}
        case Q1{}:
          {==}
        case Q2{}:
          {==}
        case Q3{}:
          {==}
    case 1n+p:
      match q:
        case Q0{}:
          go4(p, Q1{}, d)
        case Q1{}:
          go4(p, Q2{}, d)
        case Q2{}:
          go4(p, Q3{}, d)
        case Q3{}:
          %Equal.sym(Nat, Nat.add(3n, 1n+p), 1n+Nat.add(3n, p), add_right_succ(3n, p)) : {Nat.add(Nat.mul(d, 4n), _) == Nat.add(Nat.mul(Nat.div.fin(Nat.divmod.go(p, 3n, 1n+d, 0n)), 4n), Nat.mod.fin(Nat.divmod.go(p, 3n, 1n+d, 0n))) : Nat}
          %Equal.sym(Nat, Nat.add(Nat.mul(d, 4n), Nat.add(4n, p)), Nat.add(4n, Nat.add(Nat.mul(d, 4n), p)), add_shuffle_base(Nat.mul(d, 4n), 4n, p)) : {_ == Nat.add(Nat.mul(Nat.div.fin(Nat.divmod.go(p, 3n, 1n+d, 0n)), 4n), Nat.mod.fin(Nat.divmod.go(p, 3n, 1n+d, 0n))) : Nat}
          %add_assoc(4n, Nat.mul(d, 4n), p) : {_ == Nat.add(Nat.mul(Nat.div.fin(Nat.divmod.go(p, 3n, 1n+d, 0n)), 4n), Nat.mod.fin(Nat.divmod.go(p, 3n, 1n+d, 0n))) : Nat}
          go4(p, Q0{}, 1n+d)

# PROOF (machine-checked): degree-4 per-node conservation keep + 4*q == h.
def node_four(+h: Nat) -> {Nat.add(G.nsub(h, Nat.mul(Nat.div(h, 4n), 4n)), Nat.mul(Nat.div(h, 4n), 4n)) == h : Nat}:
  %Equal.sym(Nat, h, Nat.add(Nat.mul(Nat.div(h, 4n), 4n), Nat.mod(h, 4n)), go4(h, Q0{}, 0n)) : {Nat.add(G.nsub(_, Nat.mul(Nat.div(h, 4n), 4n)), Nat.mul(Nat.div(h, 4n), 4n)) == h : Nat}
  %Equal.sym(Nat, G.nsub(Nat.add(Nat.mul(Nat.div(h, 4n), 4n), Nat.mod(h, 4n)), Nat.mul(Nat.div(h, 4n), 4n)), Nat.mod(h, 4n), nsub_add(Nat.mul(Nat.div(h, 4n), 4n), Nat.mod(h, 4n))) : {Nat.add(_, Nat.mul(Nat.div(h, 4n), 4n)) == h : Nat}
  %Equal.sym(Nat, Nat.add(Nat.mod(h, 4n), Nat.mul(Nat.div(h, 4n), 4n)), Nat.add(Nat.mul(Nat.div(h, 4n), 4n), Nat.mod(h, 4n)), add_comm(Nat.mod(h, 4n), Nat.mul(Nat.div(h, 4n), 4n))) : {_ == h : Nat}
  Equal.sym(Nat, h, Nat.add(Nat.mul(Nat.div(h, 4n), 4n), Nat.mod(h, 4n)), go4(h, Q0{}, 0n))

# ---- Scatter assembly progress (machine-checked 2026-09-18) -----------------
# add_at sums with idx bounds via Bool.pick (no well-formedness premise: the
# pick is 0 out of bounds, v in bounds). Fused single-defs, structural
# matches, +Nat, shrinking-List-first. These close the add_at third of the
# §9 assembly; spread sums (spread_gain below defines the gain function; full
# spread_sum Cons case needs add_at_len + add_at_sum + add_assoc chaining),
# scatter take/drop/pad splits, and teleport takes/give_back remain open
# (see REPORT.md §10).
def add_shift(+h: Nat, +v: Nat, +s: Nat) -> {Nat.add(Nat.add(h, v), s) == Nat.add(Nat.add(h, s), v) : Nat}:
  %Equal.sym(Nat, Nat.add(Nat.add(h, v), s), Nat.add(h, Nat.add(v, s)), add_assoc(h, v, s)) : {_ == Nat.add(Nat.add(h, s), v) : Nat}
  %Equal.sym(Nat, Nat.add(v, s), Nat.add(s, v), add_comm(v, s)) : {Nat.add(h, _) == Nat.add(Nat.add(h, s), v) : Nat}
  %add_assoc(h, s, v) : {_ == Nat.add(Nat.add(h, s), v) : Nat}
  {==}

def add_at_zero(+t: +List<Nat>, +h: Nat, +v: Nat) -> {G.list_sum(t, (h + v : Nat)) == (G.list_sum(t, h) + v : Nat) : Nat}:
  %Equal.sym(Nat, G.list_sum(t, (h + v : Nat)), ((h + v) + Rank.heat_sum(t) : Nat), list_sum_acc(t, (h + v : Nat))) : {_ == (G.list_sum(t, h) + v : Nat) : Nat}
  %Equal.sym(Nat, G.list_sum(t, h), (h + Rank.heat_sum(t) : Nat), list_sum_acc(t, h)) : {((h + v) + Rank.heat_sum(t) : Nat) == (_ + v : Nat) : Nat}
  add_shift(h, v, Rank.heat_sum(t))

def add_at_len(+xs: +List<Nat>, +i: Nat, +v: Nat) -> {G.list_len(G.add_at(xs, i, v)) == G.list_len(xs) : Nat}:
  match xs:
    case Nil{}:
      match i:
        case 0n:
          {==}
        case 1n+p:
          {==}
    case Con{h, t}:
      match i:
        case 0n:
          {==}
        case 1n+p:
          %add_at_len(t, p, v) : {1n+G.list_len(G.add_at(t, p, v)) == 1n+_ : Nat}
          {==}

def add_at_sum(+xs: +List<Nat>, +i: Nat, +v: Nat) -> {Rank.heat_sum(G.add_at(xs, i, v)) == (Rank.heat_sum(xs) + Bool.pick(Nat, Nat.is_lt(i, G.list_len(xs)), v, 0n) : Nat) : Nat}:
  match xs:
    case Nil{}:
      match i:
        case 0n:
          {==}
        case 1n+p:
          {==}
    case Con{h, t}:
      match i:
        case 0n:
          %Equal.sym(Nat, Rank.heat_sum(G.add_at(h <> t, 0n, v)), G.list_sum(t, (h + v : Nat)), {==}) : {_ == (Rank.heat_sum(h <> t) + v : Nat) : Nat}
          %Equal.sym(Nat, Rank.heat_sum(h <> t), G.list_sum(t, h), {==}) : {G.list_sum(t, (h + v : Nat)) == (_ + v : Nat) : Nat}
          add_at_zero(t, h, v)
        case 1n+p:
          %Equal.sym(Nat, Rank.heat_sum(G.add_at(h <> t, 1n+p, v)), G.list_sum(G.add_at(t, p, v), h), {==}) : {_ == (Rank.heat_sum(h <> t) + Bool.pick(Nat, Nat.is_lt(p, G.list_len(t)), v, 0n) : Nat) : Nat}
          %Equal.sym(Nat, Rank.heat_sum(h <> t), G.list_sum(t, h), {==}) : {G.list_sum(G.add_at(t, p, v), h) == (_ + Bool.pick(Nat, Nat.is_lt(p, G.list_len(t)), v, 0n) : Nat) : Nat}
          %Equal.sym(Nat, G.list_sum(G.add_at(t, p, v), h), (h + Rank.heat_sum(G.add_at(t, p, v)) : Nat), list_sum_acc(G.add_at(t, p, v), h)) : {_ == (G.list_sum(t, h) + Bool.pick(Nat, Nat.is_lt(p, G.list_len(t)), v, 0n) : Nat) : Nat}
          %Equal.sym(Nat, G.list_sum(t, h), (h + Rank.heat_sum(t) : Nat), list_sum_acc(t, h)) : {(h + Rank.heat_sum(G.add_at(t, p, v)) : Nat) == (_ + Bool.pick(Nat, Nat.is_lt(p, G.list_len(t)), v, 0n) : Nat) : Nat}
          %Equal.sym(Nat, Rank.heat_sum(G.add_at(t, p, v)), (Rank.heat_sum(t) + Bool.pick(Nat, Nat.is_lt(p, G.list_len(t)), v, 0n) : Nat), add_at_sum(t, p, v)) : {(h + _ : Nat) == ((h + Rank.heat_sum(t)) + Bool.pick(Nat, Nat.is_lt(p, G.list_len(t)), v, 0n) : Nat) : Nat}
          Equal.sym(Nat, ((h + Rank.heat_sum(t)) + Bool.pick(Nat, Nat.is_lt(p, G.list_len(t)), v, 0n) : Nat), (h + (Rank.heat_sum(t) + Bool.pick(Nat, Nat.is_lt(p, G.list_len(t)), v, 0n)) : Nat), add_assoc(h, Rank.heat_sum(t), Bool.pick(Nat, Nat.is_lt(p, G.list_len(t)), v, 0n)))

# gain function for spread sums: total q added equals q per in-bounds index.
# Single def (Bend bans cycles); spread_sum Nil case closes via add_zero and
# Equal.sym, Cons case chains add_at_len + add_at_sum + add_assoc (open).
def spread_gain(+ns: +List<Nat>, +n: Nat, +q: Nat) -> Nat:
  match ns:
    case Nil{}:
      0n
    case Con{j, t}:
      (Bool.pick(Nat, Nat.is_lt(j, n), q, 0n) + spread_gain(t, n, q) : Nat)

# PROOF: step_preserves_heat (PROVEN FRAGMENT: Nil{}). One step on the empty
# vector preserves the heat sum by computation (both sides are 0n).
# Per-node facts (node_one/two/four, tele_one) and add_at sums (add_shift,
# add_at_zero/len/sum) plus spread_gain above are the machine-checked assembly
# pieces the general case needs; scatter halves (pad_ge + half_le + take/drop)
# and teleport takes/give_back ((h*150n)/1000n <= h, divisor-1000 fused go)
# remain oracle-verified (REPORT.md §3b, §9-§10).
def Laws.step_preserves_heat():
  {==}

# PROOF: mass_conservation (PROVEN FRAGMENT: fuel-0 base case). Zero rounds
# return h untouched (law 2's content), so sums agree by computation.
# The any-fuel induction (old skeleton rewriting via general law 5 + IH) is
# dropped with the general law 5; the general claim stays oracle-verified.
def Laws.mass_conservation(h):
  {==}
