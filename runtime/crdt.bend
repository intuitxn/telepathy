import Base

# ===========================================================================
# runtime/crdt.bend — smallest checkable convergent LWW map.
#
# PURPOSE: the math later proposals and transports will use. Pure core only.
#   Entries keyed by slug-like String keys carrying (digest, timestamp, actor).
#   Timestamps are supplied by the caller (host clock); the kernel is pure
#   and never reads a clock, never does IO.
#
# TIE-BREAK (total, exact order): larger timestamp wins; if equal, larger
#   actor wins (String.is_gt lexicographic); if equal, larger digest wins
#   (String.is_gt lexicographic). If all three equal the entries are equal.
#   pick(a,b) == pick(b,a) always (same winner regardless of arg order).
#
# SHAPE CHOICE: String-keyed entries, no registry. String ordering IS
#   available in Bend 2.0.21 (Base has String.cmp/order/is_le/is_gt/eq, used
#   by runtime/memory.bend which checks). So we use String keys directly;
#   Nat-keyed + registry fallback was not needed. Do NOT fight the toolchain.
#
# PROVEN vs DESIGNED:
#   PROVEN (checker): the 18 laws below, each with a same-named proof def.
#     `bend runtime/crdt.bend --check-only` must print `All terms check.`
#   DESIGNED (not proven): host clock supply, digest hashing, slug validity,
#     transport/wiring/merging over the network. Transport/wiring is a
#     separate deferred step, not claimed here.
#
# PERFORMANCE (observed defects, kept fast):
#   * Bind shared recursive tails once; never put a recursive call in both
#     Bool.pick arms (Bool.pick is strict). Recursive defs use `match`
#     branching with the rec bound once (insert/merge_acc/crdt_get pattern).
#   * Direct recursion only, shrinking one List at a time; no mutual recursion.
#   * Bool.pick used only with non-recursive arms (pick winner selection).
# ===========================================================================

type CrdtEntry is Data:
  CrdtEntry{key: String, digest: String, ts: Nat, actor: String}

def entry_key(e: CrdtEntry) -> String:
  match e:
    case CrdtEntry{k, d, t, a}:
      k

def entry_digest(e: CrdtEntry) -> String:
  match e:
    case CrdtEntry{k, d, t, a}:
      d

def entry_ts(e: CrdtEntry) -> Nat:
  match e:
    case CrdtEntry{k, d, t, a}:
      t

def entry_actor(e: CrdtEntry) -> String:
  match e:
    case CrdtEntry{k, d, t, a}:
      a

# ---- winner: larger ts, then larger actor, then larger digest (total) -----
# Leaf first: pick_if, then actor, ts_go, ts, pick.

def pick_if(c: Bool, +a: CrdtEntry, +b: CrdtEntry) -> CrdtEntry:
  match c:
    case True{}:
      a
    case False{}:
      b

def pick_actor_go(eq: Bool, gt: Bool, +a: CrdtEntry, +b: CrdtEntry) -> CrdtEntry:
  match eq:
    case True{}:
      pick_if(String.is_gt(entry_digest(a), entry_digest(b)), a, b)
    case False{}:
      pick_if(gt, a, b)

def pick_ts_go(gt_ba: Bool, eq_a: Bool, gt_a: Bool, +a: CrdtEntry, +b: CrdtEntry) -> CrdtEntry:
  match gt_ba:
    case True{}:
      b
    case False{}:
      pick_actor_go(eq_a, gt_a, a, b)

def pick_ts(gt_ab: Bool, gt_ba: Bool, eq_a: Bool, gt_a: Bool, +a: CrdtEntry, +b: CrdtEntry) -> CrdtEntry:
  match gt_ab:
    case True{}:
      a
    case False{}:
      pick_ts_go(gt_ba, eq_a, gt_a, a, b)

def pick(+a: CrdtEntry, +b: CrdtEntry) -> CrdtEntry:
  pick_ts(Nat.is_gt(entry_ts(a), entry_ts(b)), Nat.is_gt(entry_ts(b), entry_ts(a)), String.eq(entry_actor(a), entry_actor(b)), String.is_gt(entry_actor(a), entry_actor(b)), a, b)

# ---- key equality / order (sorted map, one entry per key) -----------------

def key_eq(+a: CrdtEntry, +b: CrdtEntry) -> Bool:
  String.eq(entry_key(a), entry_key(b))

def key_le(+a: CrdtEntry, +b: CrdtEntry) -> Bool:
  String.is_le(entry_key(a), entry_key(b))

# ---- sorted insert with LWW replace (bind rec once, match branch) ---------
# Leaf first: insert_le, then branch, then insert.

def insert_le(le: Bool, +e: CrdtEntry, +h: CrdtEntry, +t: +List<CrdtEntry>, +rec: +List<CrdtEntry>) -> +List<CrdtEntry>:
  match le:
    case True{}:
      e <> (h <> t)
    case False{}:
      h <> rec

def insert_branch(eq: Bool, le: Bool, +e: CrdtEntry, +h: CrdtEntry, +t: +List<CrdtEntry>, +rec: +List<CrdtEntry>) -> +List<CrdtEntry>:
  match eq:
    case True{}:
      pick(e, h) <> t
    case False{}:
      insert_le(le, e, h, t, rec)

def insert(+e: CrdtEntry, +m: +List<CrdtEntry>) -> +List<CrdtEntry>:
  match m:
    case Nil{}:
      [e]
    case Con{+h, +t}:
      insert_branch(key_eq(e, h), key_le(e, h), e, h, t, insert(e, t))

# ---- merge: fold all of b into a (rem shrinks first) ----------------------

def merge_acc(+rem: +List<CrdtEntry>, +acc: +List<CrdtEntry>) -> +List<CrdtEntry>:
  match rem:
    case Nil{}:
      acc
    case Con{+h, +t}:
      merge_acc(t, insert(h, acc))

def merge(+a: +List<CrdtEntry>, +b: +List<CrdtEntry>) -> +List<CrdtEntry>:
  merge_acc(b, a)

def empty_map() -> +List<CrdtEntry>:
  Nil{}

def put(+m: +List<CrdtEntry>, +e: CrdtEntry) -> +List<CrdtEntry>:
  insert(e, m)

# ---- lookup (explicit Some/None) + length ---------------------------------
# Leaf first: find_or, then get_entry.

def find_or(hit: Bool, +e: CrdtEntry, rest: Maybe<&2, CrdtEntry>) -> Maybe<&2, CrdtEntry>:
  match hit:
    case True{}:
      Some{e}
    case False{}:
      rest

def get_entry(+m: +List<CrdtEntry>, +key: String) -> Maybe<&2, CrdtEntry>:
  match m:
    case Nil{}:
      None{}
    case Con{+h, +t}:
      find_or(String.eq(entry_key(h), key), h, get_entry(t, key))

def map_len(+m: +List<CrdtEntry>) -> Nat:
  match m:
    case Nil{}:
      0n
    case Con{h, t}:
      1n+map_len(t)

# ===========================================================================
# FIXTURES
# ===========================================================================

def e_a_old() -> CrdtEntry:
  CrdtEntry{"a", "d1", 1n, "n1"}

def e_a_new() -> CrdtEntry:
  CrdtEntry{"a", "d2", 2n, "n1"}

def e_b_one() -> CrdtEntry:
  CrdtEntry{"b", "d3", 1n, "n1"}

def e_b_two() -> CrdtEntry:
  CrdtEntry{"b", "d4", 1n, "n2"}

def e_c() -> CrdtEntry:
  CrdtEntry{"c", "d5", 5n, "n1"}

def e_d() -> CrdtEntry:
  CrdtEntry{"d", "d6", 1n, "n1"}

def e_a_big_actor() -> CrdtEntry:
  CrdtEntry{"a", "d9", 1n, "n9"}

def rep_a() -> +List<CrdtEntry>:
  [e_a_old(), e_b_one()]

def rep_b() -> +List<CrdtEntry>:
  [e_a_new(), e_c()]

def rep_c() -> +List<CrdtEntry>:
  [e_b_two(), e_d()]

def work_map() -> +List<CrdtEntry>:
  [CrdtEntry{"k00", "d00", 1n, "n1"}, CrdtEntry{"k01", "d01", 1n, "n1"}, CrdtEntry{"k02", "d02", 1n, "n1"}, CrdtEntry{"k03", "d03", 1n, "n1"}, CrdtEntry{"k04", "d04", 1n, "n1"}, CrdtEntry{"k05", "d05", 1n, "n1"}, CrdtEntry{"k06", "d06", 1n, "n1"}, CrdtEntry{"k07", "d07", 1n, "n1"}, CrdtEntry{"k08", "d08", 1n, "n1"}, CrdtEntry{"k09", "d09", 1n, "n1"}, CrdtEntry{"k10", "d10", 1n, "n1"}, CrdtEntry{"k11", "d11", 1n, "n1"}, CrdtEntry{"k12", "d12", 1n, "n1"}, CrdtEntry{"k13", "d13", 1n, "n1"}, CrdtEntry{"k14", "d14", 1n, "n1"}, CrdtEntry{"k15", "d15", 1n, "n1"}, CrdtEntry{"k16", "d16", 1n, "n1"}, CrdtEntry{"k17", "d17", 1n, "n1"}, CrdtEntry{"k18", "d18", 1n, "n1"}, CrdtEntry{"k19", "d19", 1n, "n1"}]

# ===========================================================================
# LAWS (18) + PROOFS (same name). Concrete witnesses compute to equal terms;
# determinism is reflexivity. All proofs are `{==}`.
# ===========================================================================

# 1. merge commutativity (witness)
law crdt_merge_comm:
  {merge(rep_a(), rep_b()) == merge(rep_b(), rep_a()) : +List<CrdtEntry>}

def crdt_merge_comm():
  {==}

# 2. merge associativity (witness)
law crdt_merge_assoc:
  {merge(merge(rep_a(), rep_b()), rep_c()) == merge(rep_a(), merge(rep_b(), rep_c())) : +List<CrdtEntry>}

def crdt_merge_assoc():
  {==}

# 3. merge idempotence (witness)
law crdt_merge_idem:
  {merge(rep_a(), rep_a()) == rep_a() : +List<CrdtEntry>}

def crdt_merge_idem():
  {==}

# 4. convergence: concurrent replicas merge to the identical value both ways
law crdt_converge:
  {merge([e_a_old()], [e_a_new()]) == merge([e_a_new()], [e_a_old()]) : +List<CrdtEntry>}

def crdt_converge():
  {==}

# 5. determinism (general, reflexivity)
law crdt_merge_deterministic:
  for +a: +List<CrdtEntry>
  for +b: +List<CrdtEntry>
  {merge(a, b) == merge(a, b) : +List<CrdtEntry>}

def crdt_merge_deterministic(a, b):
  {==}

# 6. total tie-break: same winner regardless of arg order
law crdt_tie_total:
  {pick(e_b_one(), e_b_two()) == pick(e_b_two(), e_b_one()) : CrdtEntry}

def crdt_tie_total():
  {==}

# 7. empty left identity
law crdt_empty_left:
  {merge(empty_map(), rep_a()) == rep_a() : +List<CrdtEntry>}

def crdt_empty_left():
  {==}

# 8. empty right identity
law crdt_empty_right:
  {merge(rep_a(), empty_map()) == rep_a() : +List<CrdtEntry>}

def crdt_empty_right():
  {==}

# 9. put-then-merge
law crdt_put_then_merge:
  {merge(put(empty_map(), e_a_old()), put(empty_map(), e_b_one())) == [e_a_old(), e_b_one()] : +List<CrdtEntry>}

def crdt_put_then_merge():
  {==}

# 10. counterexample: equal timestamps, different actors -> larger actor wins
law crdt_counter_equal_ts:
  {pick(e_b_one(), e_b_two()) == e_b_two() : CrdtEntry}

def crdt_counter_equal_ts():
  {==}

# 11. counterexample: empty vs empty
law crdt_counter_empty_empty:
  {merge(empty_map(), empty_map()) == empty_map() : +List<CrdtEntry>}

def crdt_counter_empty_empty():
  {==}

# 12. counterexample: duplicate puts collapse to one
law crdt_counter_dup_put:
  {put(put(empty_map(), e_a_old()), e_a_old()) == put(empty_map(), e_a_old()) : +List<CrdtEntry>}

def crdt_counter_dup_put():
  {==}

# 13. counterexample: three-way concurrent merge converges regardless of order
law crdt_counter_three_way:
  {merge(merge([e_a_old()], [e_a_new()]), [e_b_one()]) == merge(merge([e_b_one()], [e_a_new()]), [e_a_old()]) : +List<CrdtEntry>}

def crdt_counter_three_way():
  {==}

# 14. one entry per key in the output
law crdt_one_entry_per_key:
  {map_len(merge([e_a_old()], [e_a_new()])) == 1n : Nat}

def crdt_one_entry_per_key():
  {==}

# 15. lookup hits an existing key
law crdt_get_hit:
  {get_entry([e_a_old(), e_b_one()], "a") == Some{e_a_old()} : Maybe<&2, CrdtEntry>}

def crdt_get_hit():
  {==}

# 16. lookup of an absent key is explicit None
law crdt_get_miss:
  {get_entry([e_a_old()], "zzz") == None{} : Maybe<&2, CrdtEntry>}

def crdt_get_miss():
  {==}

# 17. work bound: 20 entries merge to 20 (no silent exponential)
law crdt_work_bound:
  {map_len(merge(empty_map(), work_map())) == 20n : Nat}

def crdt_work_bound():
  {==}

# 18. timestamp dominates actor (larger ts wins even with smaller actor)
law crdt_ts_wins:
  {pick(e_a_new(), e_a_big_actor()) == e_a_new() : CrdtEntry}

def crdt_ts_wins():
  {==}
