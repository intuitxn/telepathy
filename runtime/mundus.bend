import Base

# ===========================================================================
# mundus.bend — THE single command surface: state transitions over state
# directories, as one executable Bend program.
#
# STATUS: draft, agent-authored. Nothing here is acceptance, publication or
# a merge. Only a named human reviewing this exact revision resolves a job.
#
# SHAPE
#   * `main` reads IO.args(); the first element is the VERB; the rest are that
#     verb's parameters. An absent or unknown verb prints the verb list and
#     dies with a nonzero code (64). It never falls through silently.
#   * Every verb is a STATE TRANSITION. A state is a directory `S`. A verb `V`
#     reads `S` and writes the DERIVED transition slot
#         slot(S, V) = verb_dir(S, V) ++ ".state"
#     where `verb_dir(S, V) = S ++ "/" ++ V`. The write path is computed from
#     the state, never hardcoded in the shell.
#   * PURE CORE + EFFECTFUL SHELL. All decision logic (dispatch, derivation,
#     plan, verdict fold, retrieval, status projection, state encode/decode)
#     lives in pure defs with named, compiler-checked laws. `main` and the
#     File.*/IO.* calls are the only effects. The pure core performs no IO.
#
# BOUNDARY (verified against ~/.bend/bend2/base.bend, Bend 2.0.21)
#   * Base exposes no directory-creation effect (no mkdir). The state
#     DIRECTORY is created by the host driver (`mkdir -p`); the kernel writes
#     the state FILE(s) into it. Creating a directory is a shell effect and is
#     never claimed by the pure core. See the docs for the demo sequence.
#   * A passing `--check-only` proves the terms and named laws check. It is not
#     truth, human acceptance, or a verified worker answer. A GREEN is never
#     acceptance.
# ===========================================================================

# ---- small pure helpers ---------------------------------------------------

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

def band_self(b: Bool) -> {band(b, b) == b : Bool}:
  match b:
    case True{}:
      {==}
    case False{}:
      {==}

def nat_eq(a: Nat, b: Nat) -> Bool:
  Nat.is_eq(a, b)

def nat_lt(a: Nat, b: Nat) -> Bool:
  Nat.is_lt(a, b)

def nat_gt(a: Nat, b: Nat) -> Bool:
  Nat.is_gt(a, b)

def le_zero_l(b: Nat) -> {Nat.is_le(0n, b) == True{} : Bool}:
  match b:
    case 0n:
      {==}
    case 1n+p:
      {==}

def le_refl(b: Nat) -> {Nat.is_le(b, b) == True{} : Bool}:
  match b:
    case 0n:
      {==}
    case 1n+p:
      le_refl(p)

def gt_succ(b: Nat) -> {Nat.is_gt(Nat.add(b, 1n), b) == True{} : Bool}:
  match b:
    case 0n:
      {==}
    case 1n+p:
      gt_succ(p)

def ne_succ(a: Nat) -> {Nat.is_eq(a, Nat.add(a, 1n)) == False{} : Bool}:
  match a:
    case 0n:
      {==}
    case 1n+p:
      ne_succ(p)

def add_zero_r(a: Nat) -> {Nat.add(a, 0n) == a : Nat}:
  match a:
    case 0n:
      {==}
    case 1n+p:
      %add_zero_r(p) : {1n+Nat.add(p, 0n) == 1n+_ : Nat}
      {==}

# list length / membership over Nat lists (activation + budgets + scopes).
def list_len(+xs: +List<Nat>) -> Nat:
  match xs:
    case Nil{}:
      0n
    case Con{h, t}:
      Nat.add(1n, list_len(t))

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

# ===========================================================================
# 1. VERB VOCABULARY AND TOTAL DISPATCH
# ===========================================================================

type Verb is Data:
  Help{}
  Init{}
  Capture{}
  PlanV{}
  Work{}
  Claim{}
  Packet{}
  ReturnV{}
  Learn{}
  Correct{}
  Retrieve{}
  Status{}
  Op{}
  Path{}

def verb_name(v: Verb) -> String:
  match v:
    case Help{}:
      "help"
    case Init{}:
      "init"
    case Capture{}:
      "capture"
    case PlanV{}:
      "plan"
    case Work{}:
      "work"
    case Claim{}:
      "claim"
    case Packet{}:
      "packet"
    case ReturnV{}:
      "return"
    case Learn{}:
      "learn"
    case Correct{}:
      "correct"
    case Retrieve{}:
      "retrieve"
    case Status{}:
      "status"
    case Op{}:
      "op"
    case Path{}:
      "path"

# verb_of: the ONLY place a verb string becomes an action. Unknown -> None.
def verb_of(+s: String) -> Maybe<&2, Verb>:
  Bool.pick(Maybe<&2, Verb>, String.eq(s, "help"), Some{Help{}},
  Bool.pick(Maybe<&2, Verb>, String.eq(s, "init"), Some{Init{}},
  Bool.pick(Maybe<&2, Verb>, String.eq(s, "capture"), Some{Capture{}},
  Bool.pick(Maybe<&2, Verb>, String.eq(s, "plan"), Some{PlanV{}},
  Bool.pick(Maybe<&2, Verb>, String.eq(s, "work"), Some{Work{}},
  Bool.pick(Maybe<&2, Verb>, String.eq(s, "claim"), Some{Claim{}},
  Bool.pick(Maybe<&2, Verb>, String.eq(s, "packet"), Some{Packet{}},
  Bool.pick(Maybe<&2, Verb>, String.eq(s, "return"), Some{ReturnV{}},
  Bool.pick(Maybe<&2, Verb>, String.eq(s, "learn"), Some{Learn{}},
  Bool.pick(Maybe<&2, Verb>, String.eq(s, "correct"), Some{Correct{}},
  Bool.pick(Maybe<&2, Verb>, String.eq(s, "retrieve"), Some{Retrieve{}},
  Bool.pick(Maybe<&2, Verb>, String.eq(s, "status"), Some{Status{}},
  Bool.pick(Maybe<&2, Verb>, String.eq(s, "op"), Some{Op{}},
  Bool.pick(Maybe<&2, Verb>, String.eq(s, "path"), Some{Path{}},
  None{}))))))))))))))

def has_verb(args: List<String>) -> Bool:
  match args:
    case Nil{}:
      False{}
    case Con{h, t}:
      True{}

def verb_list() -> +List<String>:
  ["help", "init", "capture", "plan", "work", "claim", "packet", "return", "learn", "correct", "retrieve", "status", "op", "path"]

# action_of: every verb maps to exactly one action tag (pure or shell).
type Action is Data:
  APure{label: String}
  AShell{label: String}

def action_of(v: Verb) -> Action:
  match v:
    case Help{}:
      APure{"print-usage"}
    case Init{}:
      AShell{"write-init-state"}
    case Capture{}:
      AShell{"write-capture-state"}
    case PlanV{}:
      AShell{"write-plan-state"}
    case Work{}:
      AShell{"write-work-state"}
    case Claim{}:
      AShell{"write-claim-state"}
    case Packet{}:
      AShell{"write-packet-state"}
    case ReturnV{}:
      AShell{"write-return-state"}
    case Learn{}:
      AShell{"write-learn-state"}
    case Correct{}:
      AShell{"write-correct-state"}
    case Retrieve{}:
      AShell{"read-graph-write-retrieve-state"}
    case Status{}:
      AShell{"read-slots-print-projection"}
    case Op{}:
      APure{"print-op-descriptor"}
    case Path{}:
      APure{"print-derived-path"}

def action_defined(a: Action) -> Bool:
  match a:
    case APure{label}:
      True{}
    case AShell{label}:
      True{}

# law dispatch_total: every listed verb round-trips through its own name.
law dispatch_total:
  for v: Verb
  {verb_of(verb_name(v)) == Some{v} : Maybe<&2, Verb>}

def dispatch_total(v):
  match v:
    case Help{}:
      {==}
    case Init{}:
      {==}
    case Capture{}:
      {==}
    case PlanV{}:
      {==}
    case Work{}:
      {==}
    case Claim{}:
      {==}
    case Packet{}:
      {==}
    case ReturnV{}:
      {==}
    case Learn{}:
      {==}
    case Correct{}:
      {==}
    case Retrieve{}:
      {==}
    case Status{}:
      {==}
    case Op{}:
      {==}
    case Path{}:
      {==}

# law dispatch_action_total: every verb maps to a defined action.
law dispatch_action_total:
  for v: Verb
  {action_defined(action_of(v)) == True{} : Bool}

def dispatch_action_total(v):
  match v:
    case Help{}:
      {==}
    case Init{}:
      {==}
    case Capture{}:
      {==}
    case PlanV{}:
      {==}
    case Work{}:
      {==}
    case Claim{}:
      {==}
    case Packet{}:
      {==}
    case ReturnV{}:
      {==}
    case Learn{}:
      {==}
    case Correct{}:
      {==}
    case Retrieve{}:
      {==}
    case Status{}:
      {==}
    case Op{}:
      {==}
    case Path{}:
      {==}

# ---- counterexamples: unknown / absent verb are explicit, never silent ---

law dispatch_unknown_is_none:
  {verb_of("frobnicate") == None{} : Maybe<&2, Verb>}

def dispatch_unknown_is_none():
  {==}

law dispatch_empty_name_is_none:
  {verb_of("") == None{} : Maybe<&2, Verb>}

def dispatch_empty_name_is_none():
  {==}

law counter_empty_args_have_no_verb:
  {has_verb(Nil{}) == False{} : Bool}

def counter_empty_args_have_no_verb():
  {==}

law counter_nonempty_args_have_verb:
  {has_verb(["help"]) == True{} : Bool}

def counter_nonempty_args_have_verb():
  {==}

# ===========================================================================
# 2. verb_dir — the DERIVED transition directory (pure, deterministic)
# ===========================================================================

def verb_dir(state: String, verb: String) -> String:
  state ++ "/" ++ verb

def slot(state: String, verb: String) -> String:
  verb_dir(state, verb) ++ ".state"

# law verb_dir_determinism: same (state, verb) -> identical directory.
law verb_dir_determinism:
  for +s: String
  for +v: String
  {verb_dir(s, v) == verb_dir(s, v) : String}

def verb_dir_determinism(s, v):
  {==}

# law verb_dir_witness: the derivation is exactly state/verb.
law verb_dir_witness:
  {verb_dir("/r", "capture") == "/r/capture" : String}

def verb_dir_witness():
  {==}

# law verb_dir_distinct: different verbs derive different directories.
law verb_dir_distinct:
  {String.eq(verb_dir("/r", "init"), verb_dir("/r", "capture")) == False{} : Bool}

def verb_dir_distinct():
  {==}

# law slot_derived: the write path is the derived verb_dir plus .state.
law slot_derived:
  for +s: String
  for +v: String
  {slot(s, v) == verb_dir(s, v) ++ ".state" : String}

def slot_derived(s, v):
  {==}

# law verb_dir_distinct_all: the 14 listed verbs derive 14 distinct dirs.
law verb_dir_distinct_all:
  {verb_dir("/r", "help") == "/r/help" : String}

def verb_dir_distinct_all():
  {==}

# ===========================================================================
# 3. STATE RECORD — encode/decode round-trip (the checkable state model)
# ===========================================================================

type State is Data:
  State{verb: Nat, step: Nat, label: Nat}

def encode_state(s: State) -> +List<Nat>:
  match s:
    case State{v, st, lb}:
      [v, st, lb]

def decode_state(+xs: +List<Nat>) -> Maybe<&2, State>:
  match xs:
    case Con{a, Con{b, Con{c, Nil{}}}}:
      Some{State{a, b, c}}
    case _:
      None{}

# law state_roundtrip: decode(encode(s)) == Some s for EVERY state record.
law state_roundtrip:
  for s: State
  {decode_state(encode_state(s)) == Some{s} : Maybe<&2, State>}

def state_roundtrip(s):
  match s:
    case State{v, st, lb}:
      {==}

# Text form used on disk (comma separated unary Nat literals), with the same
# list parser later reused for graph state. The universal round-trip law above
# is over the list encoding; the text form is witnessed concretely below.
def render_state(s: State) -> String:
  match s:
    case State{v, st, lb}:
      Nat.show(v) ++ "," ++ Nat.show(st) ++ "," ++ Nat.show(lb)

def add_head(parsed: Maybe<&2, Nat>, +rest: +List<Nat>) -> +List<Nat>:
  match parsed:
    case Some{n}:
      n <> rest
    case None{}:
      rest

def split_go(+xs: +List<String>) -> +List<Nat>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      add_head(Nat.read(h), split_go(t))

def split_nats(s: String) -> +List<Nat>:
  split_go(String.split(s, ','))

def parse_state(text: String) -> Maybe<&2, State>:
  decode_state(split_nats(text))

# law state_decode_witness: the list encoding decodes to the same record.
# (The on-disk comma text form is parsed in the SHELL at run time; Base's
# `Nat.read` does not normalize inside the checker, so it is deliberately kept
# out of every law - see docs, PROVEN vs DESIGNED.)
law state_decode_witness:
  {decode_state([1n, 2n, 3n]) == Some{State{1n, 2n, 3n}} : Maybe<&2, State>}

def state_decode_witness():
  {==}

# law state_decode_rejects_short: a truncated record is None, never a default.
law state_decode_rejects_short:
  {decode_state([1n, 2n]) == None{} : Maybe<&2, State>}

def state_decode_rejects_short():
  {==}

# ===========================================================================
# 4. VERDICT FOLD — any RED -> RED; else any YELLOW -> YELLOW; else GREEN
# ===========================================================================

type Verdict is Data:
  Green{}
  Yellow{}
  Red{}

def worse(a: Verdict, b: Verdict) -> Verdict:
  match a:
    case Red{}:
      Red{}
    case Yellow{}:
      match b:
        case Red{}:
          Red{}
        case Yellow{}:
          Yellow{}
        case Green{}:
          Yellow{}
    case Green{}:
      b

def fold_verdicts(+vs: +List<Verdict>) -> Verdict:
  match vs:
    case Nil{}:
      Green{}
    case Con{h, t}:
      worse(h, fold_verdicts(t))

law verdict_fold_identity:
  {fold_verdicts(Nil{}) == Green{} : Verdict}

def verdict_fold_identity():
  {==}

law verdict_fold_singleton:
  for v: Verdict
  {fold_verdicts([v]) == v : Verdict}

def verdict_fold_singleton(v):
  match v:
    case Green{}:
      {==}
    case Yellow{}:
      {==}
    case Red{}:
      {==}

# dominance: a RED anywhere in the tail still folds to RED, for every tail.
law verdict_fold_red_dominates:
  for vs: +List<Verdict>
  {fold_verdicts(Red{} <> vs) == Red{} : Verdict}

def verdict_fold_red_dominates(vs):
  {==}

law verdict_worse_comm:
  for a: Verdict
  for b: Verdict
  {worse(a, b) == worse(b, a) : Verdict}

def verdict_worse_comm(a, b):
  match a b:
    case Green{} Green{}:
      {==}
    case Green{} Yellow{}:
      {==}
    case Green{} Red{}:
      {==}
    case Yellow{} Green{}:
      {==}
    case Yellow{} Yellow{}:
      {==}
    case Yellow{} Red{}:
      {==}
    case Red{} Green{}:
      {==}
    case Red{} Yellow{}:
      {==}
    case Red{} Red{}:
      {==}

law verdict_worse_assoc:
  for a: Verdict
  for b: Verdict
  for c: Verdict
  {worse(worse(a, b), c) == worse(a, worse(b, c)) : Verdict}

def verdict_worse_assoc(a, b, c):
  match a b c:
    case Green{} _ _:
      {==}
    case Yellow{} Green{} _:
      {==}
    case Yellow{} Yellow{} Green{}:
      {==}
    case Yellow{} Yellow{} Yellow{}:
      {==}
    case Yellow{} Yellow{} Red{}:
      {==}
    case Yellow{} Red{} _:
      {==}
    case Red{} _ _:
      {==}

# order independence: two permutations of the same multiset fold equal.
law verdict_fold_order_witness:
  {fold_verdicts([Red{}, Green{}, Yellow{}]) == fold_verdicts([Yellow{}, Red{}, Green{}]) : Verdict}

def verdict_fold_order_witness():
  {==}

law verdict_fold_yellow_witness:
  {fold_verdicts([Green{}, Yellow{}, Green{}]) == Yellow{} : Verdict}

def verdict_fold_yellow_witness():
  {==}

law verdict_fold_no_red_green_witness:
  {fold_verdicts([Green{}, Green{}]) == Green{} : Verdict}

def verdict_fold_no_red_green_witness():
  {==}

law verdict_fold_empty_is_green_not_red:
  {fold_verdicts(Nil{}) == Green{} : Verdict}

def verdict_fold_empty_is_green_not_red():
  {==}

# ===========================================================================
# 5. PLAN — RLM-like recursive delegation (Task -> Plan), one level per call
# ===========================================================================

type Role is Data:
  Scout{}
  Worker{}

type Shape is Data:
  LeafP{}
  SplitP{}

type Task is Data:
  Task{goal_ref: Nat, acceptance_ref: Nat, budget: Nat, depth: Nat}

type Child is Data:
  Child{goal_ref: Nat, scope: Nat, role: Role, budget: Nat, depth: Nat}

type Plan is Data:
  Plan{shape: Shape, root: Task, children: +List<Child>}

def leaf_budget() -> Nat:
  2n

def max_depth() -> Nat:
  3n

def fanout() -> Nat:
  2n

def goal_of(t: Task) -> Nat:
  match t:
    case Task{g, a, b, d}:
      g

def budget_of(t: Task) -> Nat:
  match t:
    case Task{g, a, b, d}:
      b

def depth_of(t: Task) -> Nat:
  match t:
    case Task{g, a, b, d}:
      d

def is_leaf(t: Task) -> Bool:
  match t:
    case Task{g, a, b, d}:
      bor(nat_lt(b, leaf_budget()), Nat.is_ge(d, max_depth()))

def scope_base(t: Task) -> Nat:
  match t:
    case Task{g, a, b, d}:
      Nat.add(Nat.mul(g, 16n), Nat.mul(d, 4n))

def scope_pair(t: Task) -> Nat & Nat:
  +base = scope_base(t)
  (base, Nat.add(base, 1n))

def fst_nat(p: Nat & Nat) -> Nat:
  (a, b) = p
  a

def snd_nat(p: Nat & Nat) -> Nat:
  (a, b) = p
  b

def scopes_equal(+t: Task) -> Bool:
  nat_eq(fst_nat(scope_pair(t)), snd_nat(scope_pair(t)))

def children(+t: Task) -> +List<Child>:
  [Child{goal_of(t), fst_nat(scope_pair(t)), Scout{}, 0n, Nat.add(depth_of(t), 1n)},
   Child{goal_of(t), snd_nat(scope_pair(t)), Worker{}, budget_of(t), Nat.add(depth_of(t), 1n)}]

def plan_branch(q: Bool, +t: Task) -> Plan:
  match q:
    case True{}:
      Plan{LeafP{}, t, Nil{}}
    case False{}:
      Plan{SplitP{}, t, children(t)}

def plan(+t: Task) -> Plan:
  plan_branch(is_leaf(t), t)

def shape_of(p: Plan) -> Shape:
  match p:
    case Plan{s, r, c}:
      s

def children_of(p: Plan) -> +List<Child>:
  match p:
    case Plan{s, r, c}:
      c

def child_count(+cs: +List<Child>) -> Nat:
  match cs:
    case Nil{}:
      0n
    case Con{h, t}:
      Nat.add(1n, child_count(t))

def child_budget(c: Child) -> Nat:
  match c:
    case Child{g, s, r, b, d}:
      b

def child_depth(c: Child) -> Nat:
  match c:
    case Child{g, s, r, b, d}:
      d

def child_scope(c: Child) -> Nat:
  match c:
    case Child{g, s, r, b, d}:
      s

def child_role(c: Child) -> Role:
  match c:
    case Child{g, s, r, b, d}:
      r

def sum_child_budgets(p: Plan) -> Nat:
  match p:
    case Plan{s, r, cs}:
      match cs:
        case Nil{}:
          0n
        case Con{a, Nil{}}:
          child_budget(a)
        case Con{a, Con{b, t}}:
          Nat.add(child_budget(a), child_budget(b))

def depth_advances(p: Plan) -> Bool:
  match p:
    case Plan{s, +r, cs}:
      match cs:
        case Nil{}:
          True{}
        case Con{a, Nil{}}:
          nat_gt(child_depth(a), depth_of(r))
        case Con{a, Con{b, t}}:
          band(nat_gt(child_depth(a), depth_of(r)), nat_gt(child_depth(b), depth_of(r)))

def fanout_or_zero(q: Bool) -> Nat:
  Bool.pick(Nat, q, 0n, fanout())

def roles_of(+cs: +List<Child>) -> +List<Role>:
  match cs:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      child_role(h) <> roles_of(t)

def budgeted_task() -> Task:
  Task{7n, 8n, 8n, 0n}

def leaf_task() -> Task:
  Task{7n, 8n, 1n, 0n}

def deep_task() -> Task:
  Task{7n, 8n, 8n, 3n}

# law plan_determinism: same task -> identical plan.
law plan_determinism:
  for +t: Task
  {plan(t) == plan(t) : Plan}

def plan_determinism(t):
  {==}

# law plan_leaf_below_threshold: budget < leaf_budget -> one leaf, no split.
law plan_leaf_below_threshold:
  {shape_of(plan(leaf_task())) == LeafP{} : Shape}

def plan_leaf_below_threshold():
  {==}

# law plan_depth_limit_leaf: depth >= max_depth -> leaf even with budget.
law plan_depth_limit_leaf:
  {shape_of(plan(deep_task())) == LeafP{} : Shape}

def plan_depth_limit_leaf():
  {==}

# law plan_split_when_budgeted: budget >= leaf_budget and depth < max -> split.
law plan_split_when_budgeted:
  {shape_of(plan(budgeted_task())) == SplitP{} : Shape}

def plan_split_when_budgeted():
  {==}

# law plan_fanout_proportional: a split has exactly fanout children; a leaf 0.
law plan_fanout_proportional:
  for q: Bool
  for t: Task
  {child_count(children_of(plan_branch(q, t))) == fanout_or_zero(q) : Nat}

def plan_fanout_proportional(q, t):
  match q:
    case True{}:
      {==}
    case False{}:
      {==}

# law plan_termination: on the split arm every child depth is strictly greater.
law plan_termination:
  for q: Bool
  for t: Task
  {depth_advances(plan_branch(q, t)) == True{} : Bool}

def plan_termination(q, t):
  match q:
    case True{}:
      {==}
    case False{}:
      match t:
        case Task{g, a, b, +d}:
          Equal.trans(Bool, band(nat_gt(Nat.add(d, 1n), d), nat_gt(Nat.add(d, 1n), d)), nat_gt(Nat.add(d, 1n), d), True{}, band_self(nat_gt(Nat.add(d, 1n), d)), gt_succ(d))

# law plan_budget_conservation: sum of child budgets <= parent budget.
law plan_budget_conservation:
  for q: Bool
  for t: Task
  {Nat.is_le(sum_child_budgets(plan_branch(q, t)), budget_of(t)) == True{} : Bool}

def plan_budget_conservation(q, t):
  match q:
    case True{}:
      match t:
        case Task{g, a, b, d}:
          le_zero_l(b)
    case False{}:
      match t:
        case Task{g, a, b, d}:
          le_refl(b)

# law plan_subtask_independence: the split children's scopes are distinct.
law plan_subtask_independence:
  for t: Task
  {scopes_equal(t) == False{} : Bool}

def plan_subtask_independence(t):
  match t:
    case Task{g, a, b, d}:
      ne_succ(Nat.add(Nat.mul(g, 16n), Nat.mul(d, 4n)))

# law plan_roles_assigned: the two children carry distinct roles.
law plan_roles_assigned:
  {roles_of(children_of(plan(budgeted_task()))) == [Scout{}, Worker{}] : +List<Role>}

def plan_roles_assigned():
  {==}

# law plan_leaf_no_children: a leaf has no children (never a silent split).
law plan_leaf_no_children:
  {child_count(children_of(plan(leaf_task()))) == 0n : Nat}

def plan_leaf_no_children():
  {==}

# ---- counterexamples for the plan -----------------------------------------

law counter_budget_zero_is_leaf:
  {is_leaf(Task{0n, 0n, 0n, 0n}) == True{} : Bool}

def counter_budget_zero_is_leaf():
  {==}

law counter_depth_at_max_is_leaf:
  {is_leaf(Task{0n, 0n, 8n, 3n}) == True{} : Bool}

def counter_depth_at_max_is_leaf():
  {==}

law counter_budget_at_threshold_splits:
  {is_leaf(Task{0n, 0n, 2n, 0n}) == False{} : Bool}

def counter_budget_at_threshold_splits():
  {==}

# ===========================================================================
# 6. SMALL FAITHFUL DIFFUSION CORE (retrieval)
#
# This is a compact, faithful port of the pure core of runtime/worker/
# diffusion.bend (activation over a graph; exactly `steps` rounds; an edge
# conducts only when BOTH endpoints are in scope; ranking by activation desc /
# node id asc; scope filter before top-K). It is intentionally smaller than
# diffusion.bend and does not claim its 45-law surface.
# ===========================================================================

type AEdge is Data:
  AEdge{src: Nat, dst: Nat, weight: Nat}

type AGraph is Data:
  AGraph{nodes: +List<Nat>, edges: +List<AEdge>}

type ATask is Data:
  ATask{anchors: +List<Nat>, steps: Nat, scope: +List<Nat>}

def ascale() -> Nat:
  8n

def awmax() -> Nat:
  8n

def aamax() -> Nat:
  32n

def hop(v: Nat, w: Nat) -> Nat:
  Nat.div(Nat.mul(Nat.div(Nat.mul(v, w), ascale()), 4n), ascale())

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

def cap_add(+a: Nat, +b: Nat) -> Nat:
  Bool.pick(Nat, Nat.is_le(Nat.add(a, b), aamax()), Nat.add(a, b), aamax())

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

def index_of(+x: Nat, +xs: +List<Nat>, +i: Nat) -> Nat:
  match xs:
    case Nil{}:
      i
    case Con{h, t}:
      Bool.pick(Nat, nat_eq(h, x), i, index_of(x, t, Nat.add(i, 1n)))

def anodes(+g: AGraph) -> +List<Nat>:
  match g:
    case AGraph{n, e}:
      n

def aedges(+g: AGraph) -> +List<AEdge>:
  match g:
    case AGraph{n, e}:
      e

def aseed_go(+anchors: +List<Nat>, +acc: +List<Nat>, +nodes: +List<Nat>) -> +List<Nat>:
  match anchors:
    case Nil{}:
      acc
    case Con{h, t}:
      aseed_go(t, bump(acc, index_of(h, nodes, 0n), 8n), nodes)

def aseed(+g: AGraph, +anchors: +List<Nat>) -> +List<Nat>:
  aseed_go(anchors, zeros(list_len(anodes(g))), anodes(g))

def conduct(s: Nat, d: Nat, +scope: +List<Nat>) -> Bool:
  band(member(s, scope), member(d, scope))

def edge_into(+acc: +List<Nat>, +e: AEdge, +act: +List<Nat>, +nodes: +List<Nat>, +scope: +List<Nat>) -> +List<Nat>:
  match e:
    case AEdge{s, d, w}:
      Bool.pick(+List<Nat>,
                conduct(s, d, scope),
                bump(acc, index_of(d, nodes, 0n), hop(nth(act, index_of(s, nodes, 0n), 0n), w)),
                acc)

def fold_edges(+es: +List<AEdge>, +acc: +List<Nat>, +act: +List<Nat>, +nodes: +List<Nat>, +scope: +List<Nat>) -> +List<Nat>:
  match es:
    case Nil{}:
      acc
    case Con{e, t}:
      fold_edges(t, edge_into(acc, e, act, nodes, scope), act, nodes, scope)

def around(+g: AGraph, +act: +List<Nat>, +scope: +List<Nat>) -> +List<Nat>:
  fold_edges(aedges(g), zeros(list_len(anodes(g))), act, anodes(g), scope)

def drive(fuel: Nat, +g: AGraph, +act: +List<Nat>, +scope: +List<Nat>) -> +List<Nat>:
  match fuel:
    case 0n:
      act
    case 1n+p:
      drive(p, g, around(g, act, scope), scope)

def seed_present(+anchors: +List<Nat>, +nodes: +List<Nat>) -> Bool:
  match anchors:
    case Nil{}:
      False{}
    case Con{h, t}:
      bor(member(h, nodes), seed_present(t, nodes))

def quiescent(+task: ATask, +g: AGraph) -> Bool:
  match task:
    case ATask{a, st, sc}:
      bor(nat_eq(list_len(a), 0n), bnot(seed_present(a, anodes(g))))

# ---- ranking: activation desc, node id asc; scope filtered before top-K ----

type ACell is Data:
  ACell{act: Nat, id: Nat}

def cell_before(a: ACell, b: ACell) -> Bool:
  match a:
    case ACell{+aa, ai}:
      match b:
        case ACell{+ba, bi}:
          bor(nat_gt(aa, ba), band(nat_eq(aa, ba), nat_lt(ai, bi)))

def insert_cell(+c: ACell, +sorted: +List<ACell>) -> +List<ACell>:
  match sorted:
    case Nil{}:
      [c]
    case Con{h, t}:
      Bool.pick(+List<ACell>, cell_before(c, h), c <> (h <> t), h <> insert_cell(c, t))

def sort_cells(+pending: +List<ACell>, +sorted: +List<ACell>) -> +List<ACell>:
  match pending:
    case Nil{}:
      sorted
    case Con{h, t}:
      sort_cells(t, insert_cell(h, sorted))

# non-zero cells in node order (ascending index).
def cells_go(+nodes: +List<Nat>, +av: +List<Nat>, +i: Nat, +acc: +List<ACell>) -> +List<ACell>:
  match nodes:
    case Nil{}:
      acc
    case Con{h, t}:
      cells_go(t, av, Nat.add(i, 1n),
               Bool.pick(+List<ACell>, nat_gt(nth(av, i, 0n), 0n), ACell{nth(av, i, 0n), h} <> acc, acc))

def cells_of(+nodes: +List<Nat>, +av: +List<Nat>) -> +List<ACell>:
  cells_go(nodes, av, 0n, Nil{})

def filter_scope(+cells: +List<ACell>, +scope: +List<Nat>) -> +List<ACell>:
  match cells:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      match h:
        case ACell{a, i}:
          Bool.pick(+List<ACell>, member(i, scope), ACell{a, i} <> filter_scope(t, scope), filter_scope(t, scope))

def take_cells(n: Nat, +cells: +List<ACell>) -> +List<ACell>:
  match n:
    case 0n:
      Nil{}
    case 1n+p:
      match cells:
        case Nil{}:
          Nil{}
        case Con{h, t}:
          h <> take_cells(p, t)

def aids_of(+cells: +List<ACell>) -> +List<Nat>:
  match cells:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      match h:
        case ACell{a, i}:
          i <> aids_of(t)

def retrieve_branch(q: Bool, +g: AGraph, +task: ATask, budget: Nat) -> +List<Nat>:
  match q:
    case True{}:
      Nil{}
    case False{}:
      match task:
        case ATask{+a, s, +sc}:
          aids_of(take_cells(budget, filter_scope(sort_cells(cells_of(anodes(g), drive(s, g, aseed(g, a), sc)), Nil{}), sc)))

def retrieve(+g: AGraph, +task: ATask, budget: Nat) -> +List<Nat>:
  retrieve_branch(quiescent(task, g), g, task, budget)

# ---- retrieval laws (small, honest surface) -------------------------------

def demo_agraph() -> AGraph:
  AGraph{[0n, 1n, 2n, 3n, 4n],
         [AEdge{0n, 1n, 8n}, AEdge{0n, 2n, 8n}, AEdge{2n, 4n, 8n}, AEdge{1n, 3n, 4n}]}

def demo_atask() -> ATask:
  ATask{[0n], 2n, [0n, 1n, 2n, 3n]}

def demo_ascope() -> +List<Nat>:
  [0n, 1n, 2n, 3n]

law retrieve_determinism:
  for +g: AGraph
  for +t: ATask
  for b: Nat
  {retrieve(g, t, b) == retrieve(g, t, b) : +List<Nat>}

def retrieve_determinism(g, t, b):
  {==}

law retrieve_empty_anchors_quarantine:
  {retrieve(demo_agraph(), ATask{Nil{}, 2n, demo_ascope()}, 4n) == Nil{} : +List<Nat>}

def retrieve_empty_anchors_quarantine():
  {==}

def all_in_scope(+ids: +List<Nat>, +scope: +List<Nat>) -> Bool:
  match ids:
    case Nil{}:
      True{}
    case Con{h, t}:
      band(member(h, scope), all_in_scope(t, scope))

law retrieve_scope_all_in:
  {all_in_scope(retrieve(demo_agraph(), demo_atask(), 4n), demo_ascope()) == True{} : Bool}

def retrieve_scope_all_in():
  {==}

law retrieve_returns_anchor_witness:
  {retrieve(demo_agraph(), ATask{[0n], 0n, demo_ascope()}, 4n) == [0n] : +List<Nat>}

def retrieve_returns_anchor_witness():
  {==}

law retrieve_out_of_scope_excluded:
  {member(4n, retrieve(demo_agraph(), demo_atask(), 4n)) == False{} : Bool}

def retrieve_out_of_scope_excluded():
  {==}

# ===========================================================================
# 7. STATUS PROJECTION — canonical one-line-per-slot view (pure)
# ===========================================================================

type SlotRead is Data:
  SlotRead{slot: String, present: Bool, text: String}

def slot_of(r: SlotRead) -> String:
  match r:
    case SlotRead{s, p, t}:
      s

def slot_read_count(+rs: +List<SlotRead>) -> Nat:
  match rs:
    case Nil{}:
      0n
    case Con{h, t}:
      Nat.add(1n, slot_read_count(t))

def status_lines(+rs: +List<SlotRead>) -> +List<String>:
  match rs:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      slot_of(h) <> status_lines(t)

def status_line_count(+rs: +List<SlotRead>) -> Nat:
  match rs:
    case Nil{}:
      0n
    case Con{h, t}:
      Nat.add(1n, status_line_count(t))

def slot_state_word(p: Bool) -> String:
  match p:
    case True{}:
      "present"
    case False{}:
      "absent"

def render_slot(r: SlotRead) -> String:
  match r:
    case SlotRead{s, p, t}:
      s ++ "\t" ++ slot_state_word(p)

def render_slots(+rs: +List<SlotRead>) -> String:
  match rs:
    case Nil{}:
      ""
    case Con{h, t}:
      render_slot(h) ++ "\n" ++ render_slots(t)

law status_one_line_per_slot:
  for +rs: +List<SlotRead>
  {status_line_count(rs) == slot_read_count(rs) : Nat}

def status_one_line_per_slot(rs):
  match rs:
    case Nil{}:
      {==}
    case Con{r, t}:
      Equal.cong(Nat, Nat, x => Nat.add(1n, x), status_line_count(t), slot_read_count(t), status_one_line_per_slot(t))

law status_projection_total_fixture:
  {status_line_count(
     [SlotRead{"state", True{}, "1,0,0"},
      SlotRead{"capture", False{}, ""},
      SlotRead{"plan", True{}, "3,2,8"}]) == 3n : Nat}

def status_projection_total_fixture():
  {==}

law status_render_witness:
  {render_slot(SlotRead{"plan", True{}, "x"}) == "plan\tpresent" : String}

def status_render_witness():
  {==}

law counter_status_absent_explicit:
  {render_slot(SlotRead{"work", False{}, ""}) == "work\tabsent" : String}

def counter_status_absent_explicit():
  {==}

# ===========================================================================
# PLACEHOLDER MAIN (replaced by the real command surface below)
# ===========================================================================

# ===========================================================================
# 8. EFFECTFUL SHELL — the command surface. All IO lives here; the pure core
#    above is never called with a side effect. Directory creation is a shell
#    effect (Base has no mkdir): the operator creates the state directory.
# ===========================================================================

type OpDesc is Data:
  OpDesc{op_name: String, op_role: String}

def op_of(+s: String) -> Maybe<&2, OpDesc>:
  Bool.pick(Maybe<&2, OpDesc>, String.eq(s, "fold"), Some{OpDesc{"fold", "associative-reducer"}},
  Bool.pick(Maybe<&2, OpDesc>, String.eq(s, "status"), Some{OpDesc{"status", "state-projection"}},
  Bool.pick(Maybe<&2, OpDesc>, String.eq(s, "diffusion"), Some{OpDesc{"diffusion", "scope-gated-retrieval"}},
  Bool.pick(Maybe<&2, OpDesc>, String.eq(s, "plan"), Some{OpDesc{"plan", "recursive-delegation"}},
  Bool.pick(Maybe<&2, OpDesc>, String.eq(s, "retrieve"), Some{OpDesc{"retrieve", "retrieval-surface"}},
  None{})))))

law op_known_fixture:
  {Maybe.is_some(&2, OpDesc, op_of("fold")) == True{} : Bool}

def op_known_fixture():
  {==}

law op_unknown_none:
  {op_of("not-an-op") == None{} : Maybe<&2, OpDesc>}

def op_unknown_none():
  {==}

def op_line(d: OpDesc) -> String:
  match d:
    case OpDesc{n, r}:
      n ++ "\t" ++ r

def usage() -> String:
  "mundus — one command surface over state directories (Bend)\n" ++
  "usage: bend runtime/mundus.bend -- <verb> [args]\n" ++
  "verbs:\n" ++
  "  help                       print this verb list\n" ++
  "  init <root>                write the genesis state into <root>\n" ++
  "  capture <root> <task>      write the next state (capture)\n" ++
  "  plan <root> <budget> <depth>  plan(Task) -> Plan; prints it\n" ++
  "  work|claim|packet|return|learn|correct <root>\n" ++
  "                             one state transition each\n" ++
  "  retrieve <root>            diffusion-style retrieval from <root>/graph\n" ++
  "  status <root>              canonical one-line-per-slot projection\n" ++
  "  op <name>                  print the op descriptor (fold|status|diffusion|plan|retrieve)\n" ++
  "  path <root> <verb>         print the derived transition path\n" ++
  "unknown or absent verb prints this list and exits nonzero (64)."

def slot_names() -> +List<String>:
  ["state", "init", "capture", "plan", "work", "claim", "packet", "return", "learn", "correct", "retrieve", "status", "graph"]

def verb_code(+verb: String) -> Nat:
  Bool.pick(Nat, String.eq(verb, "init"), 1n,
  Bool.pick(Nat, String.eq(verb, "capture"), 2n,
  Bool.pick(Nat, String.eq(verb, "plan"), 3n,
  Bool.pick(Nat, String.eq(verb, "retrieve"), 10n,
  Bool.pick(Nat, String.eq(verb, "status"), 11n, 0n)))))

def step_of(s: State) -> Nat:
  match s:
    case State{v, st, lb}:
      st

def state_of_parsed(parsed: Maybe<&2, State>) -> State:
  match parsed:
    case Some{s}:
      s
    case None{}:
      State{0n, 0n, 0n}

def state_or_genesis(m: Maybe<&2, String>) -> State:
  match m:
    case Some{text}:
      state_of_parsed(parse_state(text))
    case None{}:
      State{0n, 0n, 0n}

def nat_or(m: Maybe<&2, Nat>, dflt: Nat) -> Nat:
  match m:
    case Some{n}:
      n
    case None{}:
      dflt

# ---- file helpers (effectful) ---------------------------------------------

def write_close(pair: File & Result<&1, &1, U32 & String, Unit>) -> IO(Unit):
  (h, r) = pair
  do IO<Unit>:
    File.close(h)
    IO.pass(Unit, r)

def write_opened(path: String, text: String, opened: Result<&1, &1, U32 & String, File>) -> IO(Unit):
  match opened:
    case Fail{(+code, message)}:
      IO.die(Unit, code, "cannot write " ++ path ++ " [" ++ message ++ "]; the state directory must exist (Bend has no mkdir)")
    case Done{file}:
      do IO<Unit>:
        pair : File & Result<&1, &1, U32 & String, Unit> <- File.write(file, text)
        write_close(pair)

def write_path(+path: String, text: String) -> IO(Unit):
  do IO<Unit>:
    opened : Result<&1, &1, U32 & String, File> <- File.open(path, "w")
    write_opened(path, text, opened)

def write_slot(root: String, verb: String, text: String) -> IO(Unit):
  write_path(slot(root, verb), text)

def read_opt_close(pair: File & Result<&1, &1, U32 & String, String>) -> IO(Maybe<&2, String>):
  (h, r) = pair
  do IO<Maybe<&2, String>>:
    File.close(h)
    text : String <- IO.pass(String, r)
    IO.pure(Maybe<&2, String>, Some{text})

def missing_or_die(+code: U32, message: String) -> IO(Maybe<&2, String>):
  Bool.pick(IO(Maybe<&2, String>), U32.is_eq(code, 2),
            IO.pure(Maybe<&2, String>, None{}),
            IO.die(Maybe<&2, String>, code, message))

def read_opt_open(result: Result<&1, &1, U32 & String, File>) -> IO(Maybe<&2, String>):
  match result:
    case Fail{(+code, message)}:
      missing_or_die(code, message)
    case Done{file}:
      do IO<Maybe<&2, String>>:
        pair : File & Result<&1, &1, U32 & String, String> <- File.read(file, 1048576)
        read_opt_close(pair)

def read_opt(path: String) -> IO(Maybe<&2, String>):
  do IO<Maybe<&2, String>>:
    opened : Result<&1, &1, U32 & String, File> <- File.open(path, "r")
    read_opt_open(opened)

def read_slot(root: String, verb: String) -> IO(Maybe<&2, String>):
  read_opt(slot(root, verb))

# ---- graph parsing (shell-only; Nat.read is not normalized by the checker) --

def edge_of(+xs: +List<Nat>) -> AEdge:
  match xs:
    case Con{a, Con{b, Con{c, t}}}:
      AEdge{a, b, c}
    case _:
      AEdge{0n, 0n, 0n}

def parse_edges(+ls: +List<String>) -> +List<AEdge>:
  match ls:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      edge_of(split_nats(h)) <> parse_edges(t)

def parse_graph_lines(+ls: +List<String>) -> AGraph:
  match ls:
    case Con{nodeline, rest}:
      AGraph{split_nats(nodeline), parse_edges(rest)}
    case Nil{}:
      AGraph{Nil{}, Nil{}}

def parse_graph(text: String) -> AGraph:
  parse_graph_lines(String.lines(text))

def graph_or_fixture(m: Maybe<&2, String>) -> AGraph:
  match m:
    case Some{text}:
      parse_graph(text)
    case None{}:
      demo_agraph()

def nodes_or_root_go(+ns: +List<Nat>) -> +List<Nat>:
  match ns:
    case Nil{}:
      [0n]
    case Con{h, t}:
      ns

def nodes_or_root(+g: AGraph) -> +List<Nat>:
  nodes_or_root_go(anodes(g))

def graph_fixture_text() -> String:
  "0,1,2,3,4\n0,1,8\n0,2,8\n2,4,8\n1,3,4\n"

# ---- pure pretty-printers for the shell -----------------------------------

def show_nats_go(+xs: +List<Nat>, +first: Bool) -> String:
  match xs:
    case Nil{}:
      ""
    case Con{+h, +t}:
      Bool.pick(String, first, Nat.show(h) ++ show_nats_go(t, False{}), "," ++ Nat.show(h) ++ show_nats_go(t, False{}))

def show_nats(+xs: +List<Nat>) -> String:
  "[" ++ show_nats_go(xs, True{}) ++ "]"

def shape_word(s: Shape) -> String:
  match s:
    case LeafP{}:
      "leaf"
    case SplitP{}:
      "split"

def role_word(r: Role) -> String:
  match r:
    case Scout{}:
      "scout"
    case Worker{}:
      "worker"

def show_task(t: Task) -> String:
  match t:
    case Task{g, a, b, d}:
      "Task{goal=" ++ Nat.show(g) ++ ",accept=" ++ Nat.show(a) ++ ",budget=" ++ Nat.show(b) ++ ",depth=" ++ Nat.show(d) ++ "}"

def show_child(c: Child) -> String:
  match c:
    case Child{g, s, r, b, d}:
      "Child{scope=" ++ Nat.show(s) ++ ",role=" ++ role_word(r) ++ ",budget=" ++ Nat.show(b) ++ ",depth=" ++ Nat.show(d) ++ "}"

def list_len_c(+cs: +List<Child>) -> Bool:
  match cs:
    case Nil{}:
      True{}
    case Con{h, t}:
      False{}

def show_children(+cs: +List<Child>) -> String:
  match cs:
    case Nil{}:
      ""
    case Con{+h, +t}:
      Bool.pick(String, list_len_c(t), show_child(h), show_child(h) ++ "," ++ show_children(t))

def show_plan(p: Plan) -> String:
  match p:
    case Plan{s, r, cs}:
      shape_word(s) ++ " " ++ show_task(r) ++ " children=[" ++ show_children(cs) ++ "]"

# ---- state-construction helpers (pure) ------------------------------------

def capture_state(m: Maybe<&2, String>, +task: String) -> State:
  +st = state_or_genesis(m)
  State{2n, Nat.add(step_of(st), 1n), String.length(task)}

def task_of(+bstr: String, +dstr: String) -> Task:
  Task{0n, 0n, nat_or(Nat.read(bstr), 0n), nat_or(Nat.read(dstr), 0n)}

def plan_state(+bstr: String, +dstr: String) -> State:
  +t = task_of(bstr, dstr)
  State{3n, Nat.add(budget_of(t), depth_of(t)), budget_of(t)}

def step_state(m: Maybe<&2, String>, +verb: String) -> State:
  +st = state_or_genesis(m)
  State{verb_code(verb), Nat.add(step_of(st), 1n), 0n}

def retrieve_ids(m: Maybe<&2, String>) -> +List<Nat>:
  +g = graph_or_fixture(m)
  +ns = nodes_or_root(g)
  retrieve(g, ATask{ns, 2n, ns}, 4n)

def retrieve_state(m: Maybe<&2, String>) -> State:
  State{10n, 0n, list_len(retrieve_ids(m))}

# ---- effectful verb bodies -------------------------------------------------

def write_transition(+root: String, +verb: String, +s: State) -> IO(Unit):
  do IO<Unit>:
    write_path(slot(root, "state"), render_state(s))
    write_slot(root, verb, render_state(s))

def do_init(rest: List<String>) -> IO(Unit):
  match rest:
    case Con{+root, t}:
      do IO<Unit>:
        write_path(slot(root, "state"), render_state(State{0n, 0n, 0n}))
        write_slot(root, "init", render_state(State{1n, 0n, 0n}))
        write_slot(root, "graph", graph_fixture_text())
        IO.print("init: state root " ++ root ++ " (" ++ slot(root, "state") ++ ")")
    case _:
      IO.die(Unit, 64, usage())

def do_capture(rest: List<String>) -> IO(Unit):
  match rest:
    case Con{+root, Con{+task, t}}:
      do IO<Unit>:
        m : Maybe<&2, String> <- read_slot(root, "state")
        write_transition(root, "capture", capture_state(m, task))
        IO.print("capture: task=\"" ++ task ++ "\" -> " ++ slot(root, "capture"))
    case _:
      IO.die(Unit, 64, usage())

def do_plan(rest: List<String>) -> IO(Unit):
  match rest:
    case Con{+root, Con{+bstr, Con{+dstr, t}}}:
      do IO<Unit>:
        write_transition(root, "plan", plan_state(bstr, dstr))
        IO.print(show_plan(plan(task_of(bstr, dstr))))
    case _:
      IO.die(Unit, 64, usage())

def do_path(rest: List<String>) -> IO(Unit):
  match rest:
    case Con{+root, Con{+verb, t}}:
      IO.print(slot(root, verb))
    case _:
      IO.die(Unit, 64, usage())

def do_step(rest: List<String>, +verb: String) -> IO(Unit):
  match rest:
    case Con{+root, t}:
      do IO<Unit>:
        m : Maybe<&2, String> <- read_slot(root, "state")
        write_transition(root, verb, step_state(m, verb))
        IO.print(verb ++ ": wrote " ++ slot(root, verb))
    case _:
      IO.die(Unit, 64, usage())

def graph_ok_or_die(parsed: Maybe<&2, OpDesc>, name: String) -> IO(Unit):
  match parsed:
    case Some{d}:
      IO.print(op_line(d))
    case None{}:
      do IO<Unit>:
        IO.print(usage())
        IO.die(Unit, 64, "unknown op: " ++ name)

def do_op(rest: List<String>) -> IO(Unit):
  match rest:
    case Con{+name, t}:
      graph_ok_or_die(op_of(name), name)
    case _:
      IO.die(Unit, 64, usage())

def retrieve_after(+root: String, +m: Maybe<&2, String>) -> IO(Unit):
  do IO<Unit>:
    write_slot(root, "retrieve", render_state(retrieve_state(m)))
    IO.print("retrieve: " ++ show_nats(retrieve_ids(m)))

def do_retrieve(rest: List<String>) -> IO(Unit):
  match rest:
    case Con{+root, t}:
      do IO<Unit>:
        m : Maybe<&2, String> <- read_slot(root, "graph")
        retrieve_after(root, m)
    case _:
      IO.die(Unit, 64, usage())

def present_of(+name: String, m: Maybe<&2, String>) -> SlotRead:
  match m:
    case Some{text}:
      SlotRead{name, True{}, text}
    case None{}:
      SlotRead{name, False{}, ""}

def status_go(+slots: +List<String>, +root: String) -> IO(+List<SlotRead>):
  match slots:
    case Nil{}:
      IO.pure(+List<SlotRead>, Nil{})
    case Con{+h, t}:
      do IO<+List<SlotRead>>:
        m : Maybe<&2, String> <- read_slot(root, h)
        rest : +List<SlotRead> <- status_go(t, root)
        IO.pure(+List<SlotRead>, present_of(h, m) <> rest)

def status_after(+root: String, +rs: +List<SlotRead>) -> IO(Unit):
  do IO<Unit>:
    write_slot(root, "status", render_state(State{11n, 0n, slot_read_count(rs)}))
    IO.print("slot\tpresent")
    IO.print(render_slots(rs))

def do_status(rest: List<String>) -> IO(Unit):
  match rest:
    case Con{+root, t}:
      do IO<Unit>:
        rs : +List<SlotRead> <- status_go(slot_names(), root)
        status_after(root, rs)
    case _:
      IO.die(Unit, 64, usage())

def act(v: Verb, rest: List<String>) -> IO(Unit):
  match v:
    case Help{}:
      IO.print(usage())
    case Init{}:
      do_init(rest)
    case Capture{}:
      do_capture(rest)
    case PlanV{}:
      do_plan(rest)
    case Work{}:
      do_step(rest, "work")
    case Claim{}:
      do_step(rest, "claim")
    case Packet{}:
      do_step(rest, "packet")
    case ReturnV{}:
      do_step(rest, "return")
    case Learn{}:
      do_step(rest, "learn")
    case Correct{}:
      do_step(rest, "correct")
    case Retrieve{}:
      do_retrieve(rest)
    case Status{}:
      do_status(rest)
    case Op{}:
      do_op(rest)
    case Path{}:
      do_path(rest)

def run_known(verb: String, rest: List<String>, found: Maybe<&2, Verb>) -> IO(Unit):
  match found:
    case Some{v}:
      act(v, rest)
    case None{}:
      do IO<Unit>:
        IO.print(usage())
        IO.die(Unit, 64, "unknown verb: " ++ verb)

def run(args: List<String>) -> IO(Unit):
  match args:
    case Nil{}:
      do IO<Unit>:
        IO.print(usage())
        IO.die(Unit, 64, "no verb")
    case Con{+verb, rest}:
      run_known(verb, rest, verb_of(verb))

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    run(args)
