import Base

# ---- graph.bend: CSR adjacency over Job / Post / Artifact nodes ------------
# Causal nodes come from docs/designs/job-contract.md:
#   Job      — execution truth (Proposed..Resolved | Cancelled), e.g. 5046e555
#   Post     — one typed timeline event (job.proposed .. job.resolved); the
#              unit the host feeds to ranking as retrievable text
#   Artifact — Candidate | Accepted file revision attached to a Post
# Directed edges:
#   Job -> Post       owns event            Post -> Job       backlink
#   Post -> Artifact  attaches candidate    Artifact -> Artifact  lineage
#   Artifact -> Job   resolves              Job -> Job        parent/follow-up
#
# Layout is CSR: offsets has count+1 entries; the out-neighbours of node i
# are nbrs[offsets[i] .. offsets[i+1]]. Lists keep the spec checkable; the
# host may mirror the same order into Array<U32> at runtime.
# All defs are total and pure: no IO, no network, no credentials.
# Termination: every recursion shrinks a List or Nat obtained by pattern
# matching; accumulators sit AFTER the shrinking parameter.

type NodeKind is Data:
  Job{}
  Post{}
  Artifact{}

type Graph is Data:
  Graph{count: Nat, offsets: +List<Nat>, nbrs: +List<Nat>, kinds: +List<NodeKind>}

# Demo graph (6 nodes). Index -> meaning (see REPORT.md for the full table):
#   0 Job 5046e555   1 Job follow-up   2 Post job.proposed
#   3 Post job.review_requested   4 Artifact ag-map-01 Candidate
#   5 Artifact ag-map-01 Accepted
def demo_graph() -> Graph:
  Graph{6n, [0n, 4n, 5n, 7n, 9n, 11n, 12n], [1n, 2n, 3n, 4n, 0n, 0n, 3n, 4n, 5n, 0n, 5n, 0n], [Job{}, Job{}, Post{}, Post{}, Artifact{}, Artifact{}]}

# saturating subtraction: total on Nat, no underflow trap
def nsub(a: Nat, b: Nat) -> Nat:
  match a:
    case 0n:
      0n
    case 1n+q:
      match b:
        case 0n:
          1n+q
        case 1n+p:
          nsub(q, p)

def list_len(+xs: +List<Nat>) -> Nat:
  match xs:
    case Nil{}:
      0n
    case Con{h, t}:
      1n+list_len(t)

def list_sum(+xs: +List<Nat>, acc: Nat) -> Nat:
  match xs:
    case Nil{}:
      acc
    case Con{h, t}:
      list_sum(t, acc + h)

# nth with default: out-of-range reads yield dflt, never trap
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

def kind_nth(+xs: +List<NodeKind>, i: Nat) -> NodeKind:
  match xs:
    case Nil{}:
      Post{}
    case Con{h, t}:
      match i:
        case 0n:
          h
        case 1n+p:
          kind_nth(t, p)

def take(k: Nat, +xs: +List<Nat>) -> +List<Nat>:
  match k:
    case 0n:
      Nil{}
    case 1n+p:
      match xs:
        case Nil{}:
          Nil{}
        case Con{h, t}:
          h <> take(p, t)

def drop(k: Nat, +xs: +List<Nat>) -> +List<Nat>:
  match k:
    case 0n:
      xs
    case 1n+p:
      match xs:
        case Nil{}:
          Nil{}
        case Con{h, t}:
          drop(p, t)

def zeros(n: Nat) -> +List<Nat>:
  match n:
    case 0n:
      Nil{}
    case 1n+p:
      0n <> zeros(p)

# point update: add v at index i (rebuilds spine; total; past-the-end is Nil)
def add_at(+xs: +List<Nat>, i: Nat, v: Nat) -> +List<Nat>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      match i:
        case 0n:
          (h + v) <> t
        case 1n+p:
          h <> add_at(t, p, v)

# pad short vectors with 0n up to length n (longer inputs kept as-is)
def pad_to(+hs: +List<Nat>, n: Nat) -> +List<Nat>:
  match hs:
    case Nil{}:
      zeros(n)
    case Con{h, t}:
      match n:
        case 0n:
          h <> t
        case 1n+p:
          h <> pad_to(t, p)

def count_of(+g: Graph) -> Nat:
  match g:
    case Graph{c, _, _, _}:
      c

def nbrs_of(+g: Graph) -> +List<Nat>:
  match g:
    case Graph{_, _, n, _}:
      n

def out_begin(+g: Graph, i: Nat) -> Nat:
  match g:
    case Graph{_, o, _, _}:
      nth(o, i, 0n)

def out_end(+g: Graph, i: Nat) -> Nat:
  match g:
    case Graph{_, o, _, _}:
      nth(o, 1n+i, 0n)

def out_degree(+g: Graph, +i: Nat) -> Nat:
  nsub(out_end(g, i), out_begin(g, i))

def neighbors_of(+g: Graph, +i: Nat) -> +List<Nat>:
  take(nsub(out_end(g, i), out_begin(g, i)), drop(out_begin(g, i), nbrs_of(g)))

def kind_of(+g: Graph, i: Nat) -> NodeKind:
  match g:
    case Graph{_, _, _, k}:
      kind_nth(k, i)

# checker demo: out-degree of job 5046e555 (node 0) is 4
def main() -> Nat:
  out_degree(demo_graph(), 0n)
