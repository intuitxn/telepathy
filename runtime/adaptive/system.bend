import Base

# Agent-authored prototype specifications, not owner-approved requirements.
# Trusted boundary: the external Bend checker/compiler and Base library.
# All experiment computation is in this file; only named laws are proved.
# No external observations, persistent model state or publication is involved.
# A task is nonempty by construction: head plus tail. Policy 0 is intentionally
# fallible; positive policies use exact maximum. No model weights are trained.

def maximum(+xs: +List<Nat>) -> Nat:
  match xs:
    case Nil{}:
      0n
    case Con{h, t}:
      Nat.max(h, maximum(t))

def solve(policy: Nat, +head: Nat, +tail: +List<Nat>) -> Nat:
  match policy:
    case 0n:
      head
    case 1n+p:
      Nat.max(head, maximum(tail))

def visits(xs: +List<Nat>) -> Nat:
  match xs:
    case Nil{}:
      0n
    case Con{h, t}:
      1n+visits(t)

# Instrumentation counts elements visited, not CPU time or unary Nat work.
def cost(policy: Nat, head: Nat, tail: +List<Nat>) -> Nat:
  match policy:
    case 0n:
      1n
    case 1n+p:
      1n+visits(tail)

def all_bounded(+xs: +List<Nat>, +bound: Nat) -> Bool:
  match xs:
    case Nil{}:
      True{}
    case Con{h, t}:
      Nat.is_ge(bound, h) && all_bounded(t, bound)

law ge_trans:
  for +a: Nat
  for +b: Nat
  for +c: Nat
  for ab: {Nat.is_ge(a, b) == True{} : Bool}
  for bc: {Nat.is_ge(b, c) == True{} : Bool}
  {Nat.is_ge(a, c) == True{} : Bool}

def bool_true(b: Bool) -> Type:
  match b:
    case False{}:
      Unit
    case True{}:
      Empty

def impossible(e: {False{} == True{} : Bool}) -> Empty:
  %e : bool_true(_)
  Unit{}

def absurd(-T: Type, e: Empty) -> T:
  match e:

def ge_trans(a, b, c, ab, bc):
  match a b c:
    case 0n 0n 0n:
      {==}
    case 0n 0n 1n+cp:
      absurd({Nat.is_ge(a, c) == True{} : Bool}, impossible(bc))
    case 0n 1n+bp _:
      absurd({Nat.is_ge(a, c) == True{} : Bool}, impossible(ab))
    case 1n+ap 0n 0n:
      {==}
    case 1n+ap 0n 1n+cp:
      absurd({Nat.is_ge(a, c) == True{} : Bool}, impossible(bc))
    case 1n+ap 1n+bp 0n:
      {==}
    case 1n+ap 1n+bp 1n+cp:
      ge_trans(ap, bp, cp, ab, bc)

law bound_weaken:
  for +xs: +List<Nat>
  for +a: Nat
  for +b: Nat
  for +e: {all_bounded(xs, a) == True{} : Bool}
  for +ab: {Nat.is_ge(b, a) == True{} : Bool}
  {all_bounded(xs, b) == True{} : Bool}

# Split boolean conjunction evidence without trusting the host.
def and_left(+a: Bool, +b: Bool, e: {a && b == True{} : Bool}) -> {a == True{} : Bool}:
  match a:
    case False{}:
      absurd({a == True{} : Bool}, impossible(e))
    case True{}:
      {==}

def and_right(+a: Bool, +b: Bool, e: {a && b == True{} : Bool}) -> {b == True{} : Bool}:
  match a:
    case False{}:
      absurd({b == True{} : Bool}, impossible(e))
    case True{}:
      e

def bound_weaken(xs, a, b, e, ab):
  match xs:
    case Nil{}:
      {==}
    case Con{h, t}:
      %Equal.sym(Bool, Nat.is_ge(b, h), True{}, ge_trans(b, a, h, ab, and_left(Nat.is_ge(a, h), all_bounded(t, a), e))) : {_ && all_bounded(t, b) == True{} : Bool}
      bound_weaken(t, a, b, and_right(Nat.is_ge(a, h), all_bounded(t, a), e), ab)

law maximum_bounds_all:
  for +xs: +List<Nat>
  {all_bounded(xs, maximum(xs)) == True{} : Bool}

def maximum_bounds_all(xs):
  match xs:
    case Nil{}:
      {==}
    case Con{h, t}:
      %Equal.sym(Bool, Nat.is_ge(Nat.max(h, maximum(t)), h), True{}, Nat.max_ge_l(h, maximum(t))) : {_ && all_bounded(t, Nat.max(h, maximum(t))) == True{} : Bool}
      bound_weaken(t, maximum(t), Nat.max(h, maximum(t)), maximum_bounds_all(t), Nat.max_ge_r(h, maximum(t)))

law exact_bounds_all:
  for +head: Nat
  for +tail: +List<Nat>
  {all_bounded(head <> tail, solve(1n, head, tail)) == True{} : Bool}

def exact_bounds_all(head, tail):
  maximum_bounds_all(head <> tail)

# Pure admission predicate consumes evidence flags computed below. These
# Boolean laws alone do not certify evidence quality or task usefulness.
def adopt(checked: Bool, improved: Bool) -> Nat:
  match checked improved:
    case True{} True{}:
      1n
    case _ _:
      0n

law unchecked_never_adopted:
  for improved: Bool
  {adopt(False{}, improved) == 0n : Nat}

def unchecked_never_adopted(improved):
  {==}

law no_improvement_never_adopted:
  for checked: Bool
  {adopt(checked, False{}) == 0n : Nat}

def no_improvement_never_adopted(checked):
  match checked:
    case False{}:
      {==}
    case True{}:
      {==}

law shortcut_counterexample:
  {solve(0n, 1n, [2n]) == 1n : Nat}

def shortcut_counterexample():
  {==}

# Least-upper-bound property excludes returning an arbitrary oversized value.
law max_within_bound:
  for +a: Nat
  for +b: Nat
  for +bound: Nat
  for ah: {Nat.is_ge(bound, a) == True{} : Bool}
  for bh: {Nat.is_ge(bound, b) == True{} : Bool}
  {Nat.is_ge(bound, Nat.max(a, b)) == True{} : Bool}

def max_within_bound(a, b, bound, ah, bh):
  match a b bound:
    case 0n _ _:
      bh
    case 1n+ap 0n _:
      ah
    case 1n+ap 1n+bp 0n:
      absurd({Nat.is_ge(bound, Nat.max(a, b)) == True{} : Bool}, impossible(ah))
    case 1n+ap 1n+bp 1n+hp:
      max_within_bound(ap, bp, hp, ah, bh)

law maximum_least_bound:
  for +xs: +List<Nat>
  for +bound: Nat
  for +e: {all_bounded(xs, bound) == True{} : Bool}
  {Nat.is_ge(bound, maximum(xs)) == True{} : Bool}

def maximum_least_bound(xs, bound, e):
  match xs:
    case Nil{}:
      match bound:
        case 0n:
          {==}
        case 1n+p:
          {==}
    case Con{h, t}:
      max_within_bound(h, maximum(t), bound, and_left(Nat.is_ge(bound, h), all_bounded(t, bound), e), maximum_least_bound(t, bound, and_right(Nat.is_ge(bound, h), all_bounded(t, bound), e)))

law exact_least_bound:
  for +head: Nat
  for +tail: +List<Nat>
  for +bound: Nat
  for +e: {all_bounded(head <> tail, bound) == True{} : Bool}
  {Nat.is_ge(bound, solve(1n, head, tail)) == True{} : Bool}

def exact_least_bound(head, tail, bound, e):
  maximum_least_bound(head <> tail, bound, e)

law adoption_bounded:
  for +checked: Bool
  for +improved: Bool
  {Nat.is_ge(1n, adopt(checked, improved)) == True{} : Bool}

def adoption_bounded(checked, improved):
  match checked improved:
    case False{} _:
      {==}
    case True{} False{}:
      {==}
    case True{} True{}:
      {==}

# Entire bounded experiment below runs in Bend. Fixtures are deliberately fixed,
# generated from disjoint seed ranges; no random sampling or LLM is involved.
# The oracle is the known maximum of each generated triple, not solve(1n).
type Task is Data:
  Task{head: Nat, tail: +List<Nat>, expected: Nat}

def task(+seed: Nat, shifted: Bool) -> Task:
  match shifted:
    case False{}:
      Task{(seed + 3n : Nat), [(seed + 2n : Nat), (seed + 1n : Nat)], (seed + 3n : Nat)}
    case True{}:
      Task{(seed + 2n : Nat), [(seed + 1n : Nat), (seed + 3n : Nat)], (seed + 3n : Nat)}

def tasks(seeds: +List<Nat>, +shifted: Bool) -> +List<Task>:
  match seeds:
    case Nil{}:
      Nil{}
    case Con{s, t}:
      task(s, shifted) <> tasks(t, shifted)

def mixed_tasks(+seeds: +List<Nat>) -> +List<Task>:
  match seeds:
    case Nil{}:
      Nil{}
    case Con{s, t}:
      task(s, False{}) <> task(s, True{}) <> mixed_tasks(t)

def task_correct(+item: Task, +policy: Nat) -> Bool:
  match item:
    case Task{h, t, expected}:
      Nat.is_eq(solve(policy, h, t), expected)

def task_cost(item: Task, policy: Nat) -> Nat:
  match item:
    case Task{h, t, expected}:
      cost(policy, h, t)

def successes(items: +List<Task>, +policy: Nat) -> Nat:
  match items:
    case Nil{}:
      0n
    case Con{h, t}:
      (Bool.pick(Nat, task_correct(h, policy), 1n, 0n) + successes(t, policy) : Nat)

def total_cost(items: +List<Task>, +policy: Nat) -> Nat:
  match items:
    case Nil{}:
      0n
    case Con{h, t}:
      (task_cost(h, policy) + total_cost(t, policy) : Nat)

def train_seeds() -> +List<Nat>:
  [1n, 5n, 9n, 13n]

def dev_seeds() -> +List<Nat>:
  [21n, 25n, 29n, 33n]

def heldout_seeds() -> +List<Nat>:
  [101n, 105n, 109n, 113n]

# Smoothed empirical training forecast is (successes + 1)/(count + 2).
# Confidence strictly exceeds 4/5; surprise means at least one failed forecast.
# This is a trigger rule, not a calibrated probabilistic model.
def forecast_num() -> Nat:
  1n+successes(tasks(train_seeds(), False{}), 0n)

def forecast_den() -> Nat:
  2n+visits(train_seeds())

def surprise(+shifted: Bool) -> Bool:
  Nat.is_gt((forecast_num() * 5n : Nat), (forecast_den() * 4n : Nat)) && Nat.is_lt(successes(tasks(dev_seeds(), shifted), 0n), visits(dev_seeds()))

# Finite pre-authored candidate set: 0=shortcut, 1=exact. Accuracy wins;
# ties retain the cheaper shortcut. Heldout does not enter this function.
def development_improved() -> Bool:
  Nat.is_gt(successes(mixed_tasks(dev_seeds()), 1n), successes(mixed_tasks(dev_seeds()), 0n))

# Each intervention changes ordering while preserving each seed's multiset.
# Count paired regressions, not just an observational association.
def pair_regression(+seed: Nat, +policy: Nat, sham: Bool) -> Nat:
  Bool.pick(Nat, task_correct(task(seed, False{}), policy) && Bool.not(task_correct(task(seed, Bool.not(sham)), policy)), 1n, 0n)

def regressions(seeds: +List<Nat>, +policy: Nat, +sham: Bool) -> Nat:
  match seeds:
    case Nil{}:
      0n
    case Con{s, t}:
      (pair_regression(s, policy, sham) + regressions(t, policy, sham) : Nat)

# Pre-authored causal hypothesis: reordering hurts the first-item shortcut,
# while the sham and exact-kernel control do not. Evidence must agree before
# selecting the exact candidate. This is bounded intervention testing, not
# open-ended hypothesis generation or discovery of a novel scientific law.
def causal_confirmed() -> Bool:
  Nat.is_eq(regressions(dev_seeds(), 0n, False{}), visits(dev_seeds())) && Nat.is_eq(regressions(dev_seeds(), 0n, True{}), 0n) && Nat.is_eq(regressions(dev_seeds(), 1n, False{}), 0n)


def choose_policy(enabled: Bool, shifted: Bool, causal_evidence: Bool) -> Nat:
  # True is justified only by external successful checking of this complete
  # source, including exact_bounds_all and exact_least_bound. No runtime
  # boolean can independently certify a program or the compiler.
  adopt(True{}, enabled && surprise(shifted) && causal_evidence && development_improved())

def select_policy(enabled: Bool, shifted: Bool) -> Nat:
  choose_policy(enabled, shifted, causal_confirmed())

def transfer_tasks() -> +List<Task>:
  [Task{7n, [], 7n}, Task{0n, [0n, 0n], 0n}, Task{2n, [8n, 8n, 1n], 8n}, Task{9n, [1n, 9n, 0n], 9n}]

# The selected policy is passed explicitly into evaluation: heldout results
# cannot affect it. No adaptation or candidate search happens in evaluation.
type Evaluation is Data:
  Evaluation{policy: Nat, correct: Nat, count: Nat, visits: Nat, transfer_correct: Nat}

def evaluate(+policy: Nat) -> Evaluation:
  Evaluation{policy, successes(mixed_tasks(heldout_seeds()), policy), (2n * visits(heldout_seeds()) : Nat), total_cost(mixed_tasks(heldout_seeds()), policy), successes(transfer_tasks(), policy)}

def experiment(enabled: Bool, shifted: Bool) -> Evaluation:
  evaluate(select_policy(enabled, shifted))

law failed_causal_evidence_rejected:
  for +enabled: Bool
  for +shifted: Bool
  {choose_policy(enabled, shifted, False{}) == 0n : Nat}

def failed_causal_evidence_rejected(enabled, shifted):
  match enabled shifted:
    case False{} _:
      {==}
    case True{} False{}:
      {==}
    case True{} True{}:
      {==}

law full_experiment_regression:
  {experiment(True{}, True{}) == Evaluation{1n, 8n, 8n, 24n, 4n} : Evaluation}

def full_experiment_regression():
  {==}

law disabled_learning_regression:
  {experiment(False{}, True{}) == Evaluation{0n, 4n, 8n, 8n, 3n} : Evaluation}

def disabled_learning_regression():
  {==}

law no_surprise_regression:
  {experiment(True{}, False{}) == Evaluation{0n, 4n, 8n, 8n, 3n} : Evaluation}

def no_surprise_regression():
  {==}

law reorder_causes_shortcut_regressions:
  {regressions(dev_seeds(), 0n, False{}) == 4n : Nat}

def reorder_causes_shortcut_regressions():
  {==}

law sham_does_not_cause_regressions:
  {regressions(dev_seeds(), 0n, True{}) == 0n : Nat}

def sham_does_not_cause_regressions():
  {==}

law exact_control_does_not_regress:
  {regressions(dev_seeds(), 1n, False{}) == 0n : Nat}

def exact_control_does_not_regress():
  {==}

# Final admission is separate from development selection. The chosen policy
# is fixed before evaluating this author-visible holdout. The finite fixture
# gate is an empirical check, not a universal improvement guarantee.
def admission_for(e: Evaluation) -> Nat:
  match e:
    case Evaluation{policy, +correct, count, spent, transfer_correct}:
      adopt(True{}, Nat.is_eq(correct, count) && Nat.is_gt(correct, successes(mixed_tasks(heldout_seeds()), 0n)))

def final_admission(enabled: Bool, shifted: Bool) -> Nat:
  admission_for(experiment(enabled, shifted))

law adaptive_is_admitted:
  {final_admission(True{}, True{}) == 1n : Nat}

def adaptive_is_admitted():
  {==}

law disabled_is_not_admitted:
  {final_admission(False{}, True{}) == 0n : Nat}

def disabled_is_not_admitted():
  {==}

law unsurprised_is_not_admitted:
  {final_admission(True{}, False{}) == 0n : Nat}

def unsurprised_is_not_admitted():
  {==}

def bool_json(b: Bool) -> String:
  match b:
    case False{}:
      "false"
    case True{}:
      "true"

def evaluation_json(e: Evaluation) -> String:
  match e:
    case Evaluation{policy, correct, count, spent, transfer_correct}:
      "{\"policy\":" ++ Nat.show(policy) ++ ",\"heldout_correct\":" ++ Nat.show(correct) ++ ",\"heldout_count\":" ++ Nat.show(count) ++ ",\"element_visits\":" ++ Nat.show(spent) ++ ",\"transfer_correct\":" ++ Nat.show(transfer_correct) ++ ",\"transfer_count\":4}"

def report() -> String:
  "{\"experiment\":\"fixed-fixture-bounded-policy-learning\",\"forecast\":{\"numerator\":" ++ Nat.show(forecast_num()) ++ ",\"denominator\":" ++ Nat.show(forecast_den()) ++ "},\"surprise\":" ++ bool_json(surprise(True{})) ++ ",\"no_shift_surprise\":" ++ bool_json(surprise(False{})) ++ ",\"causal_confirmed\":" ++ bool_json(causal_confirmed()) ++ ",\"development\":{\"baseline_correct\":" ++ Nat.show(successes(mixed_tasks(dev_seeds()), 0n)) ++ ",\"exact_correct\":" ++ Nat.show(successes(mixed_tasks(dev_seeds()), 1n)) ++ ",\"count\":" ++ Nat.show((2n * visits(dev_seeds()) : Nat)) ++ "},\"interventions\":{\"paired_count\":" ++ Nat.show(visits(dev_seeds())) ++ ",\"reorder_shortcut_regressions\":" ++ Nat.show(regressions(dev_seeds(), 0n, False{})) ++ ",\"sham_shortcut_regressions\":" ++ Nat.show(regressions(dev_seeds(), 0n, True{})) ++ ",\"reorder_exact_regressions\":" ++ Nat.show(regressions(dev_seeds(), 1n, False{})) ++ "},\"final_admission\":{\"adaptive\":" ++ Nat.show(final_admission(True{}, True{})) ++ ",\"disabled_learning\":" ++ Nat.show(final_admission(False{}, True{})) ++ ",\"no_surprise\":" ++ Nat.show(final_admission(True{}, False{})) ++ "},\"adaptive\":" ++ evaluation_json(experiment(True{}, True{})) ++ ",\"disabled_learning\":" ++ evaluation_json(experiment(False{}, True{})) ++ ",\"no_surprise_control\":" ++ evaluation_json(experiment(True{}, False{})) ++ "}"

# --- Verified algebra and a reusable change of problem representation ---
# These are agent-authored laws over natural-number maximum, not claims about
# arbitrary future tasks. The derived algorithm groups inputs into pairs,
# solves each chunk, then reduces chunk answers with the same associative op.
law max_zero_right:
  for +a: Nat
  {Nat.max(a, 0n) == a : Nat}

def max_zero_right(a):
  match a:
    case 0n:
      {==}
    case 1n+p:
      {==}

law max_comm:
  for +a: Nat
  for +b: Nat
  {Nat.max(a, b) == Nat.max(b, a) : Nat}

def max_comm(a, b):
  match a b:
    case 0n _:
      Equal.sym(Nat, Nat.max(b, 0n), b, max_zero_right(b))
    case 1n+ap 0n:
      {==}
    case 1n+ap 1n+bp:
      %max_comm(ap, bp) : {1n+Nat.max(ap, bp) == 1n+_ : Nat}
      {==}

law max_idempotent:
  for +a: Nat
  {Nat.max(a, a) == a : Nat}

def max_idempotent(a):
  match a:
    case 0n:
      {==}
    case 1n+p:
      %max_idempotent(p) : {1n+Nat.max(p, p) == 1n+_ : Nat}
      {==}

law max_assoc:
  for +a: Nat
  for +b: Nat
  for +c: Nat
  {Nat.max(Nat.max(a, b), c) == Nat.max(a, Nat.max(b, c)) : Nat}

def max_assoc(a, b, c):
  match a b c:
    case 0n _ _:
      {==}
    case 1n+ap 0n _:
      {==}
    case 1n+ap 1n+bp 0n:
      max_zero_right(1n+Nat.max(ap, bp))
    case 1n+ap 1n+bp 1n+cp:
      %max_assoc(ap, bp, cp) : {1n+Nat.max(Nat.max(ap, bp), cp) == 1n+_ : Nat}
      {==}

def append_values(xs: +List<Nat>, ys: +List<Nat>) -> +List<Nat>:
  match xs:
    case Nil{}:
      ys
    case Con{h, t}:
      h <> append_values(t, ys)

law maximum_append:
  for +xs: +List<Nat>
  for +ys: +List<Nat>
  {maximum(append_values(xs, ys)) == Nat.max(maximum(xs), maximum(ys)) : Nat}

def maximum_append(xs, ys):
  match xs:
    case Nil{}:
      {==}
    case Con{h, t}:
      %Equal.sym(Nat, maximum(append_values(t, ys)), Nat.max(maximum(t), maximum(ys)), maximum_append(t, ys)) : {Nat.max(h, _) == Nat.max(Nat.max(h, maximum(t)), maximum(ys)) : Nat}
      Equal.sym(Nat, Nat.max(Nat.max(h, maximum(t)), maximum(ys)), Nat.max(h, Nat.max(maximum(t), maximum(ys))), max_assoc(h, maximum(t), maximum(ys)))

def pair_chunks(xs: +List<Nat>) -> +List<+List<Nat>>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      match t:
        case Nil{}:
          [h] <> Nil{}
        case Con{k, rest}:
          [h, k] <> pair_chunks(rest)

def flatten_chunks(parts: +List<+List<Nat>>) -> +List<Nat>:
  match parts:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      append_values(h, flatten_chunks(t))

def reduce_chunks(parts: +List<+List<Nat>>) -> Nat:
  match parts:
    case Nil{}:
      0n
    case Con{h, t}:
      Nat.max(maximum(h), reduce_chunks(t))

law pair_chunks_roundtrip:
  for +xs: +List<Nat>
  {flatten_chunks(pair_chunks(xs)) == xs : +List<Nat>}

def pair_chunks_roundtrip(xs):
  match xs:
    case Nil{}:
      {==}
    case Con{h, t}:
      match t:
        case Nil{}:
          {==}
        case Con{k, rest}:
          %pair_chunks_roundtrip(rest) : {h <> k <> flatten_chunks(pair_chunks(rest)) == h <> k <> _ : +List<Nat>}
          {==}

# General chunk composition law applies to every partition, not just pairs.
law chunk_composition:
  for +parts: +List<+List<Nat>>
  {maximum(flatten_chunks(parts)) == reduce_chunks(parts) : Nat}

def chunk_composition(parts):
  match parts:
    case Nil{}:
      {==}
    case Con{h, t}:
      %Equal.sym(Nat, maximum(append_values(h, flatten_chunks(t))), Nat.max(maximum(h), maximum(flatten_chunks(t))), maximum_append(h, flatten_chunks(t))) : {_ == Nat.max(maximum(h), reduce_chunks(t)) : Nat}
      %chunk_composition(t) : {Nat.max(maximum(h), maximum(flatten_chunks(t))) == Nat.max(maximum(h), _) : Nat}
      {==}

def chunked_max(xs: +List<Nat>) -> Nat:
  reduce_chunks(pair_chunks(xs))

law chunked_max_correct:
  for +xs: +List<Nat>
  {chunked_max(xs) == maximum(xs) : Nat}

def chunked_max_correct(xs):
  %pair_chunks_roundtrip(xs) : {reduce_chunks(pair_chunks(xs)) == maximum(_) : Nat}
  Equal.sym(Nat, maximum(flatten_chunks(pair_chunks(xs))), reduce_chunks(pair_chunks(xs)), chunk_composition(pair_chunks(xs)))

# Typed original and reformulated problem spaces. Decoding the transformed
# problem preserves all values and their order, a stronger statement than
# preserving only the answer. Empty chunks are allowed in the general algebra.
type MaxProblem is Data:
  MaxProblem{head: Nat, tail: +List<Nat>}

type ChunkProblem is Data:
  ChunkProblem{parts: +List<+List<Nat>>}

def problem_values(problem: MaxProblem) -> +List<Nat>:
  match problem:
    case MaxProblem{head, tail}:
      head <> tail

def encode_problem(problem: MaxProblem) -> ChunkProblem:
  ChunkProblem{pair_chunks(problem_values(problem))}

def decode_problem(problem: ChunkProblem) -> +List<Nat>:
  match problem:
    case ChunkProblem{parts}:
      flatten_chunks(parts)

def solve_reformulated(problem: ChunkProblem) -> Nat:
  match problem:
    case ChunkProblem{parts}:
      reduce_chunks(parts)

law problem_roundtrip:
  for +problem: MaxProblem
  {decode_problem(encode_problem(problem)) == problem_values(problem) : +List<Nat>}

def problem_roundtrip(problem):
  pair_chunks_roundtrip(problem_values(problem))

law reformulation_transport:
  for +problem: MaxProblem
  {solve_reformulated(encode_problem(problem)) == maximum(problem_values(problem)) : Nat}

def reformulation_transport(problem):
  chunked_max_correct(problem_values(problem))

# Existing maximum contract transports through the representation change.
law reformulated_bounds_all:
  for +problem: MaxProblem
  {all_bounded(problem_values(problem), solve_reformulated(encode_problem(problem))) == True{} : Bool}

def reformulated_bounds_all(problem):
  %Equal.sym(Nat, solve_reformulated(encode_problem(problem)), maximum(problem_values(problem)), reformulation_transport(problem)) : {all_bounded(problem_values(problem), _) == True{} : Bool}
  maximum_bounds_all(problem_values(problem))

law reformulated_least_bound:
  for +problem: MaxProblem
  for +bound: Nat
  for +e: {all_bounded(problem_values(problem), bound) == True{} : Bool}
  {Nat.is_ge(bound, solve_reformulated(encode_problem(problem))) == True{} : Bool}

def reformulated_least_bound(problem, bound, e):
  %Equal.sym(Nat, solve_reformulated(encode_problem(problem)), maximum(problem_values(problem)), reformulation_transport(problem)) : {Nat.is_ge(bound, _) == True{} : Bool}
  maximum_least_bound(problem_values(problem), bound, e)

# Pure provenance/reuse model. Nat IDs are supplied labels, NOT cryptographic
# digests. The runtime must bind these labels to real artifact hashes.
type EvidenceContext is Data:
  EvidenceContext{problem: Nat, objective: Nat, evaluator: Nat, dependency: Nat}

type EvidenceRevision is Data:
  EvidenceRevision{source: Nat, context: EvidenceContext}

type EvidenceRecord is Data:
  EvidenceRecord{revision: EvidenceRevision, passed: Bool, counterexample: Nat}

def evidence_context_equal(a: EvidenceContext, b: EvidenceContext) -> Bool:
  match a b:
    case EvidenceContext{p, o, e, d} EvidenceContext{q, r, f, t}:
      Nat.is_eq(p, q) && Nat.is_eq(o, r) && Nat.is_eq(e, f) && Nat.is_eq(d, t)

# A mismatch blocks adoption independently of reported success.
def evidence_guard(compatible: Bool, source_matches: Bool, passed: Bool) -> Bool:
  compatible && source_matches && passed

def evidence_eligible(wanted: EvidenceRevision, record: EvidenceRecord) -> Bool:
  match wanted record:
    case EvidenceRevision{s, c} EvidenceRecord{EvidenceRevision{t, d}, passed, counterexample}:
      evidence_guard(evidence_context_equal(c, d), Nat.is_eq(s, t), passed)

law evidence_incompatible_never_adopted:
  for source_matches: Bool
  for passed: Bool
  {evidence_guard(False{}, source_matches, passed) == False{} : Bool}

def evidence_incompatible_never_adopted(source_matches, passed):
  {==}

law evidence_stale_source_never_adopted:
  for compatible: Bool
  for passed: Bool
  {evidence_guard(compatible, False{}, passed) == False{} : Bool}

def evidence_stale_source_never_adopted(compatible, passed):
  match compatible:
    case False{}:
      {==}
    case True{}:
      {==}

# Return a new history, leaving the old value intact; no in-place overwrite.
def evidence_append(history: +List<EvidenceRecord>, record: EvidenceRecord) -> +List<EvidenceRecord>:
  match history:
    case Nil{}:
      [record]
    case Con{h, t}:
      h <> evidence_append(t, record)

def evidence_history_size(history: +List<EvidenceRecord>) -> Nat:
  match history:
    case Nil{}:
      0n
    case Con{h, t}:
      1n+evidence_history_size(t)

def evidence_failure_count(history: +List<EvidenceRecord>) -> Nat:
  match history:
    case Nil{}:
      0n
    case Con{EvidenceRecord{revision, passed, counterexample}, t}:
      match passed:
        case True{}:
          evidence_failure_count(t)
        case False{}:
          1n+evidence_failure_count(t)

# Latest compatible accepted block; source ID 0 is reserved for no match.
def evidence_lookup_choose(compatible: Bool, source: Nat, newer: Nat) -> Nat:
  match compatible newer:
    case True{} 0n:
      source
    case False{} 0n:
      0n
    case _ 1n+n:
      1n+n

def evidence_lookup(+required: EvidenceContext, history: +List<EvidenceRecord>) -> Nat:
  match history:
    case Nil{}:
      0n
    case Con{EvidenceRecord{EvidenceRevision{source, context}, passed, counterexample}, t}:
      evidence_lookup_choose(evidence_context_equal(required, context) && passed,
                             source, evidence_lookup(required, t))



# 0: algorithm revision within the same problem/objective/evaluator/dependency.
# 1: context reformulation; improvement evidence cannot cross this boundary.
def evidence_transition_kind_result(same: Bool) -> Nat:
  match same:
    case True{}:
      0n
    case False{}:
      1n

def evidence_transition_kind(before: EvidenceContext, after: EvidenceContext) -> Nat:
  evidence_transition_kind_result(evidence_context_equal(before, after))



def evidence_context() -> EvidenceContext:
  EvidenceContext{1n, 1n, 1n, 1n}

def evidence_accepted() -> EvidenceRecord:
  EvidenceRecord{EvidenceRevision{2n, evidence_context()}, Nat.is_eq(final_admission(True{}, True{}), 1n) && Nat.is_eq(solve_reformulated(encode_problem(MaxProblem{17n, [4n, 23n, 23n, 8n]})), 23n), 0n}

def evidence_counterexample() -> Task:
  Task{1n, [2n], 2n}

# Source 3 is the executable first-item candidate; case ID 12 labels this task.
def evidence_bad_candidate(item: Task) -> Nat:
  match item:
    case Task{head, tail, expected}:
      solve(0n, head, tail)

# Candidate 3 failed on concrete case label 12, retained after acceptance.
def evidence_rejected() -> EvidenceRecord:
  EvidenceRecord{EvidenceRevision{3n, evidence_context()}, task_correct(evidence_counterexample(), 0n), 12n}

def evidence_history() -> +List<EvidenceRecord>:
  evidence_append(evidence_append([], evidence_accepted()), evidence_rejected())

law evidence_stale_problem_rejected:
  {evidence_eligible(EvidenceRevision{2n, EvidenceContext{2n, 1n, 1n, 1n}}, evidence_accepted()) == False{} : Bool}

def evidence_stale_problem_rejected():
  {==}

law evidence_stale_evaluator_rejected:
  {evidence_eligible(EvidenceRevision{2n, EvidenceContext{1n, 1n, 2n, 1n}}, evidence_accepted()) == False{} : Bool}

def evidence_stale_evaluator_rejected():
  {==}

law evidence_failed_revision_is_retained:
  {evidence_failure_count(evidence_history()) == 1n : Nat}

def evidence_failed_revision_is_retained():
  {==}

law evidence_compatible_reuse:
  {evidence_lookup(evidence_context(), evidence_history()) == 2n : Nat}

def evidence_compatible_reuse():
  {==}

law evidence_dependency_scoped_reuse:
  {evidence_lookup(EvidenceContext{1n, 1n, 1n, 2n}, evidence_history()) == 0n : Nat}

def evidence_dependency_scoped_reuse():
  {==}

# New task executes the accepted exact kernel retrieved through its contract.
# This authored source-ID dispatch is finite; it is not dynamic code loading.
def evidence_reused_task_dispatch(source: Nat) -> Nat:
  match source:
    case 0n:
      0n
    case 1n:
      0n
    case 2n:
      solve_reformulated(encode_problem(MaxProblem{17n, [4n, 23n, 23n, 8n]}))
    case 3n+s:
      0n

def evidence_reused_task() -> Nat:
  evidence_reused_task_dispatch(evidence_lookup(evidence_context(), evidence_history()))



law evidence_reused_task_correct:
  {evidence_reused_task() == 23n : Nat}

def evidence_reused_task_correct():
  {==}

def evidence_report() -> String:
  "{\"ids_are_labels_not_hashes\":true,\"history_size\":" ++ Nat.show(evidence_history_size(evidence_history())) ++ ",\"retained_failures\":" ++ Nat.show(evidence_failure_count(evidence_history())) ++ ",\"counterexample_id\":12,\"counterexample_input\":[1,2],\"counterexample_observed\":" ++ Nat.show(evidence_bad_candidate(evidence_counterexample())) ++ ",\"counterexample_expected\":2,\"reused_source_id\":" ++ Nat.show(evidence_lookup(evidence_context(), evidence_history())) ++ ",\"new_task_result\":" ++ Nat.show(evidence_reused_task()) ++ ",\"changed_dependency_reuse\":" ++ Nat.show(evidence_lookup(EvidenceContext{1n, 1n, 1n, 2n}, evidence_history())) ++ ",\"algorithm_change_kind\":" ++ Nat.show(evidence_transition_kind(evidence_context(), evidence_context())) ++ ",\"reformulation_kind\":" ++ Nat.show(evidence_transition_kind(evidence_context(), EvidenceContext{2n, 1n, 1n, 1n})) ++ "}"


law evidence_append_preserves_length:
  for +history: +List<EvidenceRecord>
  for +record: EvidenceRecord
  {evidence_history_size(evidence_append(history, record)) == 1n+evidence_history_size(history) : Nat}

def evidence_append_preserves_length(history, record):
  match history:
    case Nil{}:
      {==}
    case Con{h, t}:
      Equal.cong(Nat, Nat, x => 1n+x,
                 evidence_history_size(evidence_append(t, record)),
                 1n+evidence_history_size(t),
                 evidence_append_preserves_length(t, record))

def store_text_equal_go(a: String, b: String, same: Bool) -> Bool:
  match a b:
    case SNil{} SNil{}:
      same
    case SCon{h, t} SCon{k, u}:
      store_text_equal_go(t, u, same && Char.is_eq(h, k))
    case _ _:
      False{}

def store_text_equal(a: String, b: String) -> Bool:
  store_text_equal_go(a, b, True{})

# Native Base File IO only. One writer; storage is untrusted and mutable.
# No native subprocess, Git, SHA, directory creation, locks or atomic rename
# are available in this Bend Base. Caller creates a private directory.
# Existing records are compared as decoded text and never overwritten by us.
# Missing/read-error distinction prevents overwriting unreadable evidence.

def store_read_failed(code: U32, message: String, missing: Bool) -> IO(Maybe<&2, String>):
  match missing:
    case True{}:
      IO.pure(Maybe<&2, String>, None{})
    case False{}:
      IO.die(Maybe<&2, String>, code, message)


def store_read_limit(+text: String, ended: Bool) -> IO(Maybe<&2, String>):
  match ended:
    case True{}:
      IO.pure(Maybe<&2, String>, Some{text})
    case False{}:
      IO.die(Maybe<&2, String>, 1, "evidence_too_large_or_partial_read")

def store_read_tail(text: String, pair: File & Result<&1, &1, U32 & String, String>) -> IO(Maybe<&2, String>):
  (handle, result) = pair
  do IO<Maybe<&2, String>>:
    File.close(handle)
    tail : String <- IO.pass(String, result)
    store_read_limit(text, String.is_empty(tail))

def store_read_close(pair: File & Result<&1, &1, U32 & String, String>) -> IO(Maybe<&2, String>):
  (handle, result) = pair
  do IO<Maybe<&2, String>>:
    next : File & Result<&1, &1, U32 & String, String> <- File.read(handle, 1)
    text : String <- IO.pass(String, result)
    store_read_tail(text, next)

def store_read_open(result: Result<&1, &1, U32 & String, File>) -> IO(Maybe<&2, String>):
  match result:
    case Fail{(+code, message)}:
      store_read_failed(code, message, U32.is_eq(code, 2))
    case Done{file}:
      do IO<Maybe<&2, String>>:
        pair : File & Result<&1, &1, U32 & String, String> <- File.read(file, 1048576)
        store_read_close(pair)


def store_read(path: String) -> IO(Maybe<&2, String>):
  do IO<Maybe<&2, String>>:
    opened : Result<&1, &1, U32 & String, File> <- File.open(path, "r")
    store_read_open(opened)


def store_write_close(pair: File & Result<&1, &1, U32 & String, Unit>) -> IO(Unit):
  (handle, result) = pair
  do IO<Unit>:
    File.close(handle)
    IO.pass(Unit, result)

def store_write(path: String, text: String) -> IO(Unit):
  do IO<Unit>:
    file : File <- IO.try(File, File.open(path, "w"))
    pair : File & Result<&1, &1, U32 & String, Unit> <- File.write(file, text)
    store_write_close(pair)


def store_match(same: Bool) -> IO(Unit):
  match same:
    case True{}:
      IO.print("evidence_reused: stored text matches current computed evidence")
    case False{}:
      IO.die(Unit, 1, "evidence_mismatch: refusing stale, changed or unrelated record")


def store_record_existing(path: String, +expected: String, previous: Maybe<&2, String>) -> IO(Unit):
  match previous:
    case None{}:
      do IO<Unit>:
        store_write(path, expected)
        IO.print("evidence_recorded: local single-writer file; no Git or cryptographic attestation")
    case Some{stored}:
      store_match(store_text_equal(stored, expected))


def store_record(+path: String, expected: String) -> IO(Unit):
  do IO<Unit>:
    previous : Maybe<&2, String> <- store_read(path)
    store_record_existing(path, expected, previous)


def store_restored_source(parsed: Maybe<&2, Nat>) -> IO(Unit):
  match parsed:
    case None{}:
      IO.die(Unit, 1, "invalid_stored_source_id")
    case Some{+source_id}:
      IO.print("{\"restored_source_id\":" ++ Nat.show(source_id) ++ ",\"restored_task_result\":" ++ Nat.show(evidence_reused_task_dispatch(source_id)) ++ "}")

def store_restore_lines(lines: +List<String>) -> IO(Unit):
  match lines:
    case Con{header, Con{source_id, rest}}:
      store_restored_source(Nat.read(source_id))
    case _:
      IO.die(Unit, 1, "invalid_stored_envelope")

def store_replay_existing(expected: String, previous: Maybe<&2, String>) -> IO(Unit):
  match previous:
    case None{}:
      IO.die(Unit, 1, "evidence_missing")
    case Some{+stored}:
      do IO<Unit>:
        store_match(store_text_equal(stored, expected))
        store_restore_lines(String.lines(String.take(stored, 80n)))

def store_replay(path: String, expected: String) -> IO(Unit):
  do IO<Unit>:
    previous : Maybe<&2, String> <- store_read(path)
    store_replay_existing(expected, previous)


# Bind snapshots by exact source/evidence text, not unverified claimed hashes.
# The external Bend launcher checks the executing source. Base cannot attest
# that this supplied source path is the compiled source; external receipt
# tooling must bind that relationship and its actual checker output.
def store_envelope(+source: String, +payload: String) -> String:
  "intuitxn-single-writer-evidence/v1\n" ++ Nat.show(evidence_lookup(evidence_context(), evidence_history())) ++ "\nsource-characters:" ++ Nat.show(String.length(source)) ++ "\n" ++ source ++ "\nevidence-characters:" ++ Nat.show(String.length(payload)) ++ "\n" ++ payload ++ "\n"

def store_source_present(source: Maybe<&2, String>) -> IO(String):
  match source:
    case None{}:
      IO.die(String, 1, "source_missing")
    case Some{text}:
      IO.pure(String, text)

def store_action(record: Bool, ledger: String, envelope: String, payload: String) -> IO(Unit):
  match record:
    case True{}:
      do IO<Unit>:
        store_record(ledger, envelope)
        IO.print(payload)
    case False{}:
      do IO<Unit>:
        store_replay(ledger, envelope)
        IO.print(payload)

def store_command_valid(valid: Bool, record: Bool, ledger: String, source_path: String, +payload: String) -> IO(Unit):
  match valid:
    case False{}:
      IO.die(Unit, 1, "usage: record|replay LEDGER SOURCE (single writer, existing private directory)")
    case True{}:
      do IO<Unit>:
        found : Maybe<&2, String> <- store_read(source_path)
        source : String <- store_source_present(found)
        store_action(record, ledger, store_envelope(source, payload), payload)

def store_dispatch(args: List<String>, payload: String) -> IO(Unit):
  match args:
    case Nil{}:
      IO.print(payload)
    case Con{+command, Con{ledger, Con{source_path, Nil{}}}}:
      store_command_valid(String.eq(command, "record") || String.eq(command, "replay"), String.eq(command, "record"), ledger, source_path, payload)
    case _:
      IO.die(Unit, 1, "usage: record|replay LEDGER SOURCE (single writer, existing private directory)")

# Concrete executions accompany universal laws; they are not the proofs.
def algebra_report() -> String:
  "{\"original\":" ++ Nat.show(maximum([17n, 4n, 23n, 23n, 8n])) ++ ",\"chunked\":" ++ Nat.show(chunked_max([17n, 4n, 23n, 23n, 8n])) ++ ",\"transported\":" ++ Nat.show(solve_reformulated(encode_problem(MaxProblem{17n, [4n, 23n, 23n, 8n]}))) ++ ",\"empty_identity\":" ++ Nat.show(chunked_max([])) ++ ",\"speedup_claimed\":false}"

def full_report() -> String:
  "{\"schema\":\"intuitxn-adaptive-blocks/v1\",\"adaptation\":" ++ report() ++ ",\"algebra\":" ++ algebra_report() ++ ",\"evidence\":" ++ evidence_report() ++ ",\"scope\":\"finite authored kernels and fixtures; local reuse, no network synchronization or neural training\"}"

# Online observations are external tasks, not the fixed experiment above. The
# small event log is replayed on every read; derived scores are never trusted.
# Each task has exactly three values and a checked maximum answer. Its two
# counterfactual runs are deterministic, so this is policy learning, not a
# claim that simulated tasks reveal new facts about the world.
def online_nat_parsed(+text: String, parsed: Maybe<&2, Nat>) -> Maybe<&2, Nat>:
  match parsed:
    case None{}:
      None{}
    case Some{+n}:
      Bool.pick(Maybe<&2, Nat>, Nat.is_le(String.length(text), 5n) && Nat.is_le(n, 65535n) && String.eq(text, Nat.show(n)), Some{n}, None{})

def online_nat_short(+text: String, short: Bool) -> Maybe<&2, Nat>:
  match short:
    case True{}:
      online_nat_parsed(text, Nat.read(text))
    case False{}:
      None{}

def online_nat(+text: String) -> Maybe<&2, Nat>:
  online_nat_short(text, Nat.is_le(String.length(text), 5n))

def online_task(expected: Maybe<&2, Nat>, head: Maybe<&2, Nat>, second: Maybe<&2, Nat>, third: Maybe<&2, Nat>) -> Maybe<&2, Task>:
  match expected head second third:
    case Some{+e} Some{+h} Some{+s} Some{+t}:
      Bool.pick(Maybe<&2, Task>, Nat.is_eq(maximum([h, s, t]), e), Some{Task{h, [s, t], e}}, None{})
    case _ _ _ _:
      None{}

def online_parse_add(head: Maybe<&2, Task>, tail: Maybe<&2, +List<Task>>) -> Maybe<&2, +List<Task>>:
  match head tail:
    case Some{h} Some{t}:
      Some{h <> t}
    case _ _:
      None{}

def online_parse(fuel: Nat, lines: +List<String>) -> Maybe<&2, +List<Task>>:
  match fuel lines:
    case _ Con{end, Nil{}}:
      Bool.pick(Maybe<&2, +List<Task>>, String.eq(end, "END"), Some{[]}, None{})
    case 0n _:
      None{}
    case 1n+f Con{e, Con{h, Con{s, Con{t, rest}}}}:
      online_parse_add(online_task(online_nat(e), online_nat(h), online_nat(s), online_nat(t)), online_parse(f, rest))
    case _ _:
      None{}

def online_emit_task(item: Task) -> String:
  match item:
    case Task{h, Con{s, Con{t, Nil{}}}, e}:
      Nat.show(e) ++ "\n" ++ Nat.show(h) ++ "\n" ++ Nat.show(s) ++ "\n" ++ Nat.show(t) ++ "\n"
    case _:
      ""

def online_emit(items: +List<Task>) -> String:
  match items:
    case Nil{}:
      "END"
    case Con{h, t}:
      online_emit_task(h) ++ online_emit(t)

def online_append(items: +List<Task>, item: Task) -> +List<Task>:
  match items:
    case Nil{}:
      [item]
    case Con{h, t}:
      h <> online_append(t, item)

def online_header() -> String:
  "intuitxn-online/v1\n"

def online_split_done_match(events: String, same: Bool) -> Maybe<&2, +List<Task>>:
  match same:
    case True{}:
      online_parse(64n, String.lines(events))
    case False{}:
      None{}

def online_split_done(events: String, stored_source: String, source: String) -> Maybe<&2, +List<Task>>:
  online_split_done_match(events, store_text_equal(stored_source, source))

# Scan at most the bounded event prefix; never take/drop through the source.
def online_split(fuel: Nat, found: Bool, cursor: String, original: String, source: String, offset: Nat) -> Maybe<&2, +List<Task>>:
  match fuel found cursor:
    case _ True{} _:
      online_split_done(String.take(original, (offset + 3n : Nat)), String.drop(cursor, 4n), source)
    case 0n False{} _:
      None{}
    case 1n+f False{} SNil{}:
      None{}
    case 1n+f False{} SCon{h, +t}:
      online_split(f, String.starts_with(t, "END\n"), t, original, source, (offset + 1n : Nat))

def online_decode_header(valid: Bool, stored: String, source: String) -> Maybe<&2, +List<Task>>:
  match valid:
    case False{}:
      None{}
    case True{}:
      +events_and_source = String.drop(stored, String.length(online_header()))
      online_split(1600n, String.starts_with(events_and_source, "END\n"), events_and_source, events_and_source, source, 0n)

def online_decode(+stored: String, source: String) -> Maybe<&2, +List<Task>>:
  online_decode_header(String.starts_with(stored, online_header()), stored, source)

def online_count(items: +List<Task>) -> Nat:
  match items:
    case Nil{}:
      0n
    case Con{h, t}:
      1n+online_count(t)

def online_choose(+items: +List<Task>) -> Nat:
  Bool.pick(Nat, Nat.is_lt(successes(items, 0n), online_count(items)), 1n, 0n)

def online_report(+items: +List<Task>) -> String:
  +selected = online_choose(items)
  "{\"schema\":\"intuitxn-online/v1\",\"observations\":" ++ Nat.show(online_count(items)) ++ ",\"selected_policy\":" ++ Nat.show(selected) ++ ",\"shortcut_correct\":" ++ Nat.show(successes(items, 0n)) ++ ",\"exact_correct\":" ++ Nat.show(successes(items, 1n)) ++ ",\"shortcut_element_visits\":" ++ Nat.show(total_cost(items, 0n)) ++ ",\"exact_element_visits\":" ++ Nat.show(total_cost(items, 1n)) ++ ",\"counterfactuals_are_replay\":true}"

law online_empty_uses_shortcut:
  {online_choose([]) == 0n : Nat}

def online_empty_uses_shortcut():
  {==}

law online_counterexample_switches:
  {online_choose([Task{1n, [2n, 0n], 2n}]) == 1n : Nat}

def online_counterexample_switches():
  {==}

def online_valid_task(item: Maybe<&2, Task>) -> IO(Task):
  match item:
    case None{}:
      IO.die(Task, 1, "invalid_observation: require canonical 0..65535 integers and the true maximum")
    case Some{task}:
      IO.pure(Task, task)

def online_decoded(decoded: Maybe<&2, +List<Task>>) -> IO(+List<Task>):
  match decoded:
    case None{}:
      IO.die(+List<Task>, 1, "state_invalid_or_source_changed")
    case Some{items}:
      IO.pure(+List<Task>, items)

def online_existing(previous: Maybe<&2, String>, source: String) -> IO(+List<Task>):
  match previous:
    case None{}:
      IO.die(+List<Task>, 1, "state_missing")
    case Some{stored}:
      online_decoded(online_decode(stored, source))

def online_previous_choose(path: String, source: String, fresh: Bool) -> IO(+List<Task>):
  match fresh:
    case True{}:
      IO.pure(+List<Task>, [])
    case False{}:
      do IO<+List<Task>>:
        stored : Maybe<&2, String> <- store_read(path)
        online_existing(stored, source)

def online_previous(+path: String, source: String) -> IO(+List<Task>):
  online_previous_choose(path, source, String.eq(path, "new"))

def online_source(path: String) -> IO(String):
  do IO<String>:
    found : Maybe<&2, String> <- store_read(path)
    store_source_present(found)

def online_write_guard(room: Bool, items: +List<Task>, output: String, source: String, item: Task) -> IO(Unit):
  match room:
    case False{}:
      IO.die(Unit, 1, "state_full: at most 64 observations per lineage")
    case True{}:
      do IO<Unit>:
        +next : +List<Task> <- IO.pure(+List<Task>, online_append(items, item))
        store_record(output, online_header() ++ online_emit(next) ++ "\n" ++ source)
        IO.print(online_report(next))

def online_write(previous: String, output: String, +source: String, item: Task) -> IO(Unit):
  do IO<Unit>:
    +items : +List<Task> <- online_previous(previous, source)
    online_write_guard(Nat.is_lt(online_count(items), 64n), items, output, source, item)

def online_observe(previous: String, output: String, source_path: String, e: String, h: String, s: String, t: String) -> IO(Unit):
  do IO<Unit>:
    item : Task <- online_valid_task(online_task(online_nat(e), online_nat(h), online_nat(s), online_nat(t)))
    source : String <- online_source(source_path)
    online_write(previous, output, source, item)

def online_latent(path: String, source_path: String) -> IO(Unit):
  do IO<Unit>:
    source : String <- online_source(source_path)
    items : +List<Task> <- online_previous(path, source)
    IO.print(online_report(items))

def online_dispatch_latent(is_latent: Bool, command: String, path: String, source: String, payload: String) -> IO(Unit):
  match is_latent:
    case True{}:
      online_latent(path, source)
    case False{}:
      store_dispatch([command, path, source], payload)

def online_dispatch_observe(is_observe: Bool, previous: String, output: String, source: String, e: String, h: String, s: String, t: String) -> IO(Unit):
  match is_observe:
    case True{}:
      online_observe(previous, output, source, e, h, s, t)
    case False{}:
      IO.die(Unit, 1, "usage: observe PREVIOUS|new OUTPUT SOURCE EXPECTED HEAD SECOND THIRD")

def online_dispatch(args: List<String>, payload: String) -> IO(Unit):
  match args:
    case Nil{}:
      IO.print(payload)
    case Con{+command, Con{path, Con{source, Nil{}}}}:
      online_dispatch_latent(String.eq(command, "latent"), command, path, source, payload)
    case Con{command, Con{previous, Con{output, Con{source, Con{e, Con{h, Con{s, Con{t, Nil{}}}}}}}}}:
      online_dispatch_observe(String.eq(command, "observe"), previous, output, source, e, h, s, t)
    case _:
      IO.die(Unit, 1, "usage: record|replay LEDGER SOURCE | latent STATE SOURCE | observe PREVIOUS|new OUTPUT SOURCE EXPECTED HEAD SECOND THIRD")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    online_dispatch(args, full_report())
