import Base
import ./graph.bend as G

# ---- rank.bend: personalized heat diffusion over the retrieval graph --------
# Personalized PageRank with integer particles (exact mass conservation, no
# floats): heat is a +List<Nat> of particle counts, one slot per node.
# One step = diffuse_phase then teleport:
#   diffuse_phase: node i of degree d sends q = h/d to EACH out-neighbour
#     and keeps h - d*q (exact remainder via G.nsub); dangling nodes keep all.
#   teleport: takes (h*num)/den from every node into a pool, returns
#     share = pool/s plus the remainder to the seed nodes (personalization:
#     the query's seed set, e.g. the job under review). Empty seed set means
#     no teleport (identity) so the step still conserves.
# Vectors are padded up front to the graph count, so conservation holds for
# ANY input length, not just well-formed ones (see LAWS.bend law 1).
# Boundeddriver: Nat fuel counts rounds down (agit-in-bend §6 pattern).
# Fork-join: each round splits the node range in halves, scatters each half
# into its own zero vector with a parallel let, then zip_adds the partials.
# Shell/Bend boundary (agit-in-bend §7): the shell owns CSR bytes, sha256,
# and byte scans; Bend owns only this pure decision over handed-in values.

def demo_heat() -> +List<Nat>:
  [1200n, 0n, 0n, 0n, 0n, 0n]

# personalization: teleport home is job 5046e555 (node 0, the job in review)
def demo_seed() -> +List<Nat>:
  [1n, 0n, 0n, 0n, 0n, 0n]

def seed_count() -> Nat:
  1n

def alpha_num() -> Nat:
  150n

def alpha_den() -> Nat:
  1000n

def heat_sum(+h: +List<Nat>) -> Nat:
  G.list_sum(h, 0n)

def half_count(n: Nat) -> Nat:
  (n / 2n : Nat)

# elementwise (h*num)/den takes, in node order
def take_each(+hs: +List<Nat>, +num: Nat, +den: Nat) -> +List<Nat>:
  match hs:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      ((h * num : Nat) / den : Nat) <> take_each(t, num, den)

def zip_add(+xs: +List<Nat>, +ys: +List<Nat>) -> +List<Nat>:
  match xs:
    case Nil{}:
      ys
    case Con{h, t}:
      match ys:
        case Nil{}:
          h <> t
        case Con{k, u}:
          (h + k : Nat) <> zip_add(t, u)

def zip_sub(+xs: +List<Nat>, +ys: +List<Nat>) -> +List<Nat>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{x, t}:
      match ys:
        case Nil{}:
          x <> zip_sub(t, Nil{})
        case Con{y, u}:
          G.nsub(x, y) <> zip_sub(t, u)

# add q to every node of the neighbour slice (slice shrinks first)
def spread(+ns: +List<Nat>, +acc: +List<Nat>, +q: Nat) -> +List<Nat>:
  match ns:
    case Nil{}:
      acc
    case Con{j, t}:
      spread(t, G.add_at(acc, j, q), q)

def scatter_branch(dangling: Bool, +acc: +List<Nat>, +ns: +List<Nat>, +i: Nat, +h: Nat, +d: Nat) -> +List<Nat>:
  match dangling:
    case True{}:
      G.add_at(acc, i, h)
    case False{}:
      spread(ns, G.add_at(acc, i, G.nsub(h, ((h / d : Nat) * d : Nat))), (h / d : Nat))

def scatter_one(+acc: +List<Nat>, +ns: +List<Nat>, +i: Nat, +h: Nat, +d: Nat) -> +List<Nat>:
  scatter_branch(Nat.is_eq(d, 0n), acc, ns, i, h, d)

def scatter_node(+g: G.Graph, +acc: +List<Nat>, +idx: Nat, +h: Nat) -> +List<Nat>:
  scatter_one(acc, G.neighbors_of(g, idx), idx, h, G.out_degree(g, idx))

# scatter a node sublist (heat order) into acc; the sublist shrinks first
def scatter_all(+hs: +List<Nat>, +g: G.Graph, +acc: +List<Nat>, +idx: Nat) -> +List<Nat>:
  match hs:
    case Nil{}:
      acc
    case Con{h, t}:
      scatter_all(t, g, scatter_node(g, acc, idx, h), 1n+idx)

# one diffusion round, fork-join over node halves
def diffuse_phase(+g: G.Graph, +h: +List<Nat>) -> +List<Nat>:
  +padded = G.pad_to(h, G.count_of(g))
  +n = G.list_len(padded)
  +m = half_count(n)
  lo = G.take(m, padded)
  hi = G.drop(m, padded)
  acc_lo acc_hi = scatter_all(lo, g, G.zeros(n), 0n) scatter_all(hi, g, G.zeros(n), m)
  zip_add(acc_lo, acc_hi)

# return share to each seed flag; the first seed also takes the remainder.
# Single def (Bend forbids mutual recursion): rem is matched before f to
# respect binder order. Flags are 0/1 by construction (host measurement);
# any nonzero flag counts as seed.
def give_back(+base: +List<Nat>, +flags: +List<Nat>, +share: Nat, +rem: Nat) -> +List<Nat>:
  match base flags:
    case Nil{} _:
      Nil{}
    case Con{b, bt} Nil{}:
      b <> give_back(bt, Nil{}, share, rem)
    case Con{b, bt} Con{f, ft}:
      match f:
        case 0n:
          match rem:
            case 0n:
              b <> give_back(bt, ft, share, 0n)
            case 1n+u:
              b <> give_back(bt, ft, share, 1n+u)
        case 1n+w:
          match rem:
            case 0n:
              (b + share : Nat) <> give_back(bt, ft, share, 0n)
            case 1n+u:
              (b + share + (1n+u) : Nat) <> give_back(bt, ft, share, 0n)

def teleport_branch(noseed: Bool, +h: +List<Nat>, +seed: +List<Nat>, +s: Nat, +num: Nat, +den: Nat) -> +List<Nat>:
  match noseed:
    case True{}:
      h
    case False{}:
      +takes = take_each(h, num, den)
      +pool = heat_sum(takes)
      base = zip_sub(h, takes)
      +share = (pool / s : Nat)
      rem = G.nsub(pool, (share * s : Nat))
      give_back(base, seed, share, rem)

def teleport(+h: +List<Nat>, +seed: +List<Nat>, +s: Nat, +num: Nat, +den: Nat) -> +List<Nat>:
  teleport_branch(Nat.is_eq(s, 0n), h, seed, s, num, den)

def step(+g: G.Graph, +h: +List<Nat>, +seed: +List<Nat>, +s: Nat, +num: Nat, +den: Nat) -> +List<Nat>:
  teleport(diffuse_phase(g, h), seed, s, num, den)

# bounded driver: fuel counts rounds down (fuel first, so it shrinks first)
def diffuse(fuel: Nat, +g: G.Graph, +h: +List<Nat>, +seed: +List<Nat>, +s: Nat, +num: Nat, +den: Nat) -> +List<Nat>:
  match fuel:
    case 0n:
      h
    case 1n+p:
      diffuse(p, g, step(g, h, seed, s, num, den), seed, s, num, den)

# demo: 3 rounds from 1200 particles on job 5046e555.
# python oracle (REPORT.md §3): [474, 130, 130, 147, 193, 126], sum 1200.
def demo_rank() -> +List<Nat>:
  diffuse(3n, G.demo_graph(), demo_heat(), demo_seed(), seed_count(), alpha_num(), alpha_den())

# checker demo: total heat after 3 rounds is still 1200
def main() -> Nat:
  heat_sum(demo_rank())
