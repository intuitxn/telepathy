import Base
import ./graph.bend as G
import ./rank.bend as Rank

# ---- route.bend: lexical vs diffusion fusion + confidence + abstain ---------
# The shell (host) owns keyword counting over context snapshots (jobs.js
# brief/context) and hands in lexical scores as plain Nat counts; Bend owns
# only the pure fusion decision. Diffusion heat is normalized to percent of
# total mass so the two signals share a scale, then fused linearly:
#   fused = wl * lex + wd * pct
# Routing: the top fused node wins iff it clears `threshold` AND its margin
# over the runner-up clears `min_margin`; otherwise Abstain (code 0n =
# under threshold, 1n = margin too small). Abstention is a first-class
# verdict, never a silent guess.
# No-leak construction (nudge-simplify §2.8 host.output_excludes): the
# public Route carries a node index + confidence only — no sourceIds, no
# receipt ids, no transcript text. Diffusion scores may steer ranking but
# cannot surface provenance. Law 4 pins this.

type Best is Data:
  Best{top: Nat, idx: Nat, second: Nat}

type Route is Data:
  Answer{doc: Nat, confidence: Nat}
  Abstain{code: Nat}

# shell keyword-overlap counts per node (host-owned measurement, task data)
def demo_lex() -> +List<Nat>:
  [9n, 2n, 7n, 8n, 6n, 1n]

def lex_weight() -> Nat:
  1n

def dif_weight() -> Nat:
  2n

def demo_threshold() -> Nat:
  30n

def demo_margin() -> Nat:
  3n

def pct_go(+hs: +List<Nat>, +total: Nat) -> +List<Nat>:
  match hs:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      ((h * 100n : Nat) / total : Nat) <> pct_go(t, total)

def zeros_like(+hs: +List<Nat>) -> +List<Nat>:
  match hs:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      0n <> zeros_like(t)

def pct_branch(empty: Bool, +hs: +List<Nat>, +total: Nat) -> +List<Nat>:
  match empty:
    case True{}:
      zeros_like(hs)
    case False{}:
      pct_go(hs, total)

# heat -> percent of total mass (zero total maps to all-zero, never traps)
def pct_each(+hs: +List<Nat>, +total: Nat) -> +List<Nat>:
  pct_branch(Nat.is_eq(total, 0n), hs, total)

def fuse(lex: Nat, pct: Nat, wl: Nat, wd: Nat) -> Nat:
  ((wl * lex : Nat) + (wd * pct : Nat) : Nat)

def fuse_each(+ls: +List<Nat>, +ps: +List<Nat>, +wl: Nat, +wd: Nat) -> +List<Nat>:
  match ls:
    case Nil{}:
      Nil{}
    case Con{l, t}:
      match ps:
        case Nil{}:
          fuse(l, 0n, wl, wd) <> fuse_each(t, Nil{}, wl, wd)
        case Con{p, u}:
          fuse(l, p, wl, wd) <> fuse_each(t, u, wl, wd)

# top-two scan; strict > keeps the FIRST max on ties (deterministic).
# Single def: per-element update is pure value selection via Bool.pick
# (no control flow, no mutual roles), then one structural recursion.
def best_two(+ss: +List<Nat>, +idx: Nat, +top: Nat, +idx_top: Nat, +second: Nat) -> Best:
  match ss:
    case Nil{}:
      Best{top, idx_top, second}
    case Con{s, t}:
      +gt = Nat.is_gt(s, top)
      +top2 = Bool.pick(Nat, gt, s, top)
      +itop2 = Bool.pick(Nat, gt, idx, idx_top)
      +sec2 = Bool.pick(Nat, gt, top, Bool.pick(Nat, Nat.is_gt(s, second), s, second))
      best_two(t, 1n+idx, top2, itop2, sec2)

def route_margin(wide: Bool, +i: Nat, +margin: Nat) -> Route:
  match wide:
    case True{}:
      Answer{i, margin}
    case False{}:
      Abstain{1n}

def route_cell(strong: Bool, +t: Nat, +i: Nat, +s: Nat, +min_margin: Nat) -> Route:
  match strong:
    case True{}:
      route_margin(Nat.is_ge(G.nsub(t, s), min_margin), i, G.nsub(t, s))
    case False{}:
      Abstain{0n}

def route_after(+b: Best, +threshold: Nat, +min_margin: Nat) -> Route:
  match b:
    case Best{t, i, s}:
      route_cell(Nat.is_ge(t, threshold), t, i, s, min_margin)

def route(+scores: +List<Nat>, +threshold: Nat, +min_margin: Nat) -> Route:
  route_after(best_two(scores, 0n, 0n, 0n, 0n), threshold, min_margin)

# no-leak witness: every public verdict maps to False (no provenance field
# exists to leak; cf. LAWS.bend law 4)
def exposes_source(+r: Route) -> Bool:
  match r:
    case Answer{d, c}:
      False{}
    case Abstain{e}:
      False{}

# demo: lex [9,2,7,8,6,1] fused with rank pct [39,10,10,12,16,10] at 1:2
# gives [87,22,27,32,38,21] -> Answer{doc 0, confidence 49} (oracle REPORT.md §3)
def demo_fused() -> +List<Nat>:
  +r = Rank.demo_rank()
  fuse_each(demo_lex(), pct_each(r, Rank.heat_sum(r)), lex_weight(), dif_weight())

def demo_route() -> Route:
  route(demo_fused(), demo_threshold(), demo_margin())

def main() -> Route:
  demo_route()
