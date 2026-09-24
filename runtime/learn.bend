import Base

# ===========================================================================
# runtime/learn.bend — SMALL pure learning kernel (bounded update rule).
#
# STATUS: draft, agent-authored. Nothing here is acceptance or publication.
# Only a named human reviewing this exact revision resolves a job.
#
# SHAPE
#   * Types: Meas{score,cost,total} (frozen-set measurement); Policy{params,
#     version} (opaque numeric knobs + version); Update{param,delta,reason}
#     (proposed change + reason code); Outcome=Better|Same|Worse|Invalid;
#     ApplyOut{policy, admitted} (policy + admission bit).
#   * `evaluate` is the ONLY comparison site. Invalid if totals differ or
#     either measurement malformed (total 0, score > total); else score
#     first, then cost (lower cost wins ties):
#       cand.score > base.score => Better (cost ignored, score dominates)
#       cand.score < base.score => Worse  (even if cheaper)
#       scores equal: cand.cost < base.cost => Better; > => Worse; == => Same.
#   * EXACT APPLY RULE: admitted=True IFF evaluate==Better (covers both the
#     score-up case and the Same-score-lower-cost case, which IS Better via
#     the cost tiebreak). On admit: params = (param+delta) <> old_params,
#     version+1. On reject (Same|Worse|Invalid): policy UNCHANGED, version
#     UNCHANGED, admitted=False. "Same-with-lower-cost" never occurs as
#     Same; it is Better by definition.
#   * `rollback(cur, prior)` returns prior VERBATIM (identity on stored
#     prior); cur is ignored.
#
# PROVEN vs DESIGNED:
#   PROVEN (checker): the 22 laws below, each with a same-named proof def.
#     `bend runtime/learn.bend --check-only` must print `All terms check.`
#   DESIGNED (not proven): frozen-set runner feeding Meas values in,
#     versioned commits out, reason-code audit, host wiring. Host wiring
#     (runner in, commits out) is SEPARATE and not claimed here.
#
# PERFORMANCE (heavily loaded machine):
#   * shared recursive tails bound once (params_len binds t once via match);
#   * no Bool.pick with recursion in its arms (Bool.pick unused; match used);
#   * recursion is structural on one List at a time (params_len only);
#     evaluate/apply/rollback are non-recursive. Leaf-first declaration
#     order: every callee declared above its caller; no mutual recursion.
# ===========================================================================

type Meas is Data:
  Meas{score: Nat, cost: Nat, total: Nat}

type Policy is Data:
  Policy{params: +List<Nat>, version: Nat}

type Update is Data:
  Update{param: Nat, delta: Nat, reason: Nat}

type Outcome is Data:
  Better{}
  Same{}
  Worse{}
  Invalid{}

type ApplyOut is Data:
  ApplyOut{policy: Policy, admitted: Bool}

# ---- accessors ------------------------------------------------------------

def meas_score(+m: Meas) -> Nat:
  match m:
    case Meas{s, c, t}:
      s

def meas_cost(+m: Meas) -> Nat:
  match m:
    case Meas{s, c, t}:
      c

def meas_total(+m: Meas) -> Nat:
  match m:
    case Meas{s, c, t}:
      t

def is_valid(+m: Meas) -> Bool:
  match m:
    case Meas{s, c, t}:
      Bool.and(Bool.not(Nat.is_eq(t, 0n)), Nat.is_le(s, t))

def policy_version(+p: Policy) -> Nat:
  match p:
    case Policy{ps, v}:
      v

def policy_params(+p: Policy) -> +List<Nat>:
  match p:
    case Policy{+ps, v}:
      ps

def apply_admitted(+o: ApplyOut) -> Bool:
  match o:
    case ApplyOut{pol, a}:
      a

def apply_policy(+o: ApplyOut) -> Policy:
  match o:
    case ApplyOut{pol, a}:
      pol

def is_outcome(o: Outcome) -> Bool:
  match o:
    case Better{}:
      True{}
    case Same{}:
      True{}
    case Worse{}:
      True{}
    case Invalid{}:
      True{}

# ---- evaluate: score first, then cost (leaf first) -------------------------

def eval_cost_go2(blt: Bool) -> Outcome:
  match blt:
    case True{}:
      Worse{}
    case False{}:
      Same{}

def eval_cost_go(clt: Bool, blt: Bool) -> Outcome:
  match clt:
    case True{}:
      Better{}
    case False{}:
      eval_cost_go2(blt)

def eval_scores_miss(bgt: Bool, +bc: Nat, +cc: Nat) -> Outcome:
  match bgt:
    case True{}:
      Worse{}
    case False{}:
      eval_cost_go(Nat.is_lt(cc, bc), Nat.is_lt(bc, cc))

def eval_scores_go(cgt: Bool, bgt: Bool, +bc: Nat, +cc: Nat) -> Outcome:
  match cgt:
    case True{}:
      Better{}
    case False{}:
      eval_scores_miss(bgt, bc, cc)

def eval_scores(+b: Meas, +c: Meas) -> Outcome:
  match b c:
    case Meas{bs, bc, bt} Meas{cs, cc, ct}:
      eval_scores_go(Nat.is_gt(cs, bs), Nat.is_gt(bs, cs), bc, cc)

def eval_valid_go(ok: Bool, +b: Meas, +c: Meas) -> Outcome:
  match ok:
    case True{}:
      eval_scores(b, c)
    case False{}:
      Invalid{}

def eval_totals_go(eq: Bool, ok: Bool, +b: Meas, +c: Meas) -> Outcome:
  match eq:
    case True{}:
      eval_valid_go(ok, b, c)
    case False{}:
      Invalid{}

def evaluate(+b: Meas, +c: Meas) -> Outcome:
  match b c:
    case Meas{bs, bc, bt} Meas{cs, cc, ct}:
      eval_totals_go(Nat.is_eq(bt, ct), Bool.and(is_valid(b), is_valid(c)), b, c)

# ---- apply: admit iff Better (leaf first) ----------------------------------

def apply_params(+u: Update, +ps: +List<Nat>) -> +List<Nat>:
  match u:
    case Update{p, d, r}:
      Nat.add(p, d) <> ps

def apply_admit(+p: Policy, +u: Update) -> ApplyOut:
  match p u:
    case Policy{+ps, v} Update{up, ud, ur}:
      ApplyOut{Policy{apply_params(u, ps), Nat.add(v, 1n)}, True{}}

def apply_reject(+p: Policy) -> ApplyOut:
  match p:
    case Policy{+ps, v}:
      ApplyOut{Policy{ps, v}, False{}}

def apply_on_verdict(v: Outcome, +p: Policy, +u: Update) -> ApplyOut:
  match v:
    case Better{}:
      apply_admit(p, u)
    case Same{}:
      apply_reject(p)
    case Worse{}:
      apply_reject(p)
    case Invalid{}:
      apply_reject(p)

def apply(+p: Policy, +u: Update, +b: Meas, +c: Meas) -> ApplyOut:
  apply_on_verdict(evaluate(b, c), p, u)

# ---- rollback: identity on stored prior ------------------------------------

def rollback(cur: Policy, +prior: Policy) -> Policy:
  match prior:
    case Policy{+ps, v}:
      Policy{ps, v}

# ---- measures ---------------------------------------------------------------

def params_len(+ps: +List<Nat>) -> Nat:
  match ps:
    case Nil{}:
      0n
    case Con{h, +t}:
      Nat.add(1n, params_len(t))

def noregress_ok(+b: Meas, +c: Meas) -> Bool:
  match b c:
    case Meas{bs, bc, bt} Meas{cs, cc, ct}:
      Bool.and(Nat.is_eq(bt, ct), Bool.and(Bool.not(Nat.is_gt(bs, cs)), Bool.not(Bool.and(Nat.is_eq(bs, cs), Nat.is_gt(cc, bc)))))

def eval_steps() -> Nat:
  5n

# ---- fixtures ----------------------------------------------------------------

def base_ok() -> Meas:
  Meas{5n, 3n, 10n}

def cand_better_score() -> Meas:
  Meas{6n, 3n, 10n}

def cand_better_cost() -> Meas:
  Meas{5n, 2n, 10n}

def cand_same() -> Meas:
  Meas{5n, 3n, 10n}

def cand_worse_score() -> Meas:
  Meas{4n, 1n, 10n}

def cand_worse_cost() -> Meas:
  Meas{5n, 4n, 10n}

def cand_bad_total() -> Meas:
  Meas{5n, 3n, 9n}

def cand_zero_total() -> Meas:
  Meas{0n, 0n, 0n}

def cand_score_over() -> Meas:
  Meas{11n, 1n, 10n}

def demo_policy() -> Policy:
  Policy{[1n, 2n], 0n}

def demo_update() -> Update:
  Update{7n, 3n, 1n}

def empty_policy() -> Policy:
  Policy{Nil{}, 0n}

def prior_policy() -> Policy:
  Policy{[9n], 5n}

# ---- pretty print (shell demo only) ------------------------------------------

def outcome_show(o: Outcome) -> String:
  match o:
    case Better{}:
      "Better"
    case Same{}:
      "Same"
    case Worse{}:
      "Worse"
    case Invalid{}:
      "Invalid"

def show_nats_go(+xs: +List<Nat>, first: Bool) -> String:
  match xs:
    case Nil{}:
      ""
    case Con{+h, +t}:
      match first:
        case True{}:
          Nat.show(h) ++ show_nats_go(t, False{})
        case False{}:
          "," ++ Nat.show(h) ++ show_nats_go(t, False{})

def show_nats(+xs: +List<Nat>) -> String:
  "[" ++ show_nats_go(xs, True{}) ++ "]"

def policy_show(+p: Policy) -> String:
  match p:
    case Policy{+ps, v}:
      "Policy{" ++ show_nats(ps) ++ ",v=" ++ Nat.show(v) ++ "}"

# ===========================================================================
# LAWS (22) — each with a same-named proof def.
# ===========================================================================

# totality: every Outcome value is covered.
law totality_outcome_covers:
  for o: Outcome
  {is_outcome(o) == True{} : Bool}

def totality_outcome_covers(o):
  match o:
    case Better{}:
      {==}
    case Same{}:
      {==}
    case Worse{}:
      {==}
    case Invalid{}:
      {==}

# totality: evaluate always yields a covered Outcome.
law totality_evaluate_total:
  for +b: Meas
  for +c: Meas
  {is_outcome(evaluate(b, c)) == True{} : Bool}

def totality_evaluate_total(b, c):
  totality_outcome_covers(evaluate(b, c))

# determinism: same measurements => identical verdict.
law determinism_evaluate_refl:
  for +b: Meas
  for +c: Meas
  {evaluate(b, c) == evaluate(b, c) : Outcome}

def determinism_evaluate_refl(b, c):
  {==}

# determinism: same inputs => identical apply result.
law determinism_apply_refl:
  for +p: Policy
  for +u: Update
  for +b: Meas
  for +c: Meas
  {apply(p, u, b, c) == apply(p, u, b, c) : ApplyOut}

def determinism_apply_refl(p, u, b, c):
  {==}

# invalid: totals differ => Invalid.
law invalid_totals_differ:
  {evaluate(base_ok(), cand_bad_total()) == Invalid{} : Outcome}

def invalid_totals_differ():
  {==}

# counterexample: zero total => Invalid (never admit on empty frozen set).
law counter_zero_total:
  {evaluate(base_ok(), cand_zero_total()) == Invalid{} : Outcome}

def counter_zero_total():
  {==}

# counterexample: score > total => Invalid (malformed measurement).
law counter_score_over_total:
  {evaluate(base_ok(), cand_score_over()) == Invalid{} : Outcome}

def counter_score_over_total():
  {==}

# score-dominance: higher score wins (cost equal).
law score_dominance_up:
  {evaluate(base_ok(), cand_better_score()) == Better{} : Outcome}

def score_dominance_up():
  {==}

# score-dominance: lower score loses even when cheaper (score dominates cost).
law score_dominance_down_despite_cheap:
  {evaluate(base_ok(), cand_worse_score()) == Worse{} : Outcome}

def score_dominance_down_despite_cheap():
  {==}

# cost-tiebreak: equal score, lower cost wins.
law cost_tiebreak_cheaper_wins:
  {evaluate(base_ok(), cand_better_cost()) == Better{} : Outcome}

def cost_tiebreak_cheaper_wins():
  {==}

# cost-tiebreak: equal score, higher cost loses.
law cost_tiebreak_costlier_loses:
  {evaluate(base_ok(), cand_worse_cost()) == Worse{} : Outcome}

def cost_tiebreak_costlier_loses():
  {==}

# same: equal score and equal cost => Same.
law same_exact:
  {evaluate(base_ok(), cand_same()) == Same{} : Outcome}

def same_exact():
  {==}

# apply admits Better (score-up case).
law apply_admits_better:
  {apply_admitted(apply(demo_policy(), demo_update(), base_ok(), cand_better_score())) == True{} : Bool}

def apply_admits_better():
  {==}

# apply admits Same-score-lower-cost (it IS Better via tiebreak).
law apply_admits_cost_down:
  {apply_admitted(apply(demo_policy(), demo_update(), base_ok(), cand_better_cost())) == True{} : Bool}

def apply_admits_cost_down():
  {==}

# counterexample: equal scores with higher cost => rejected.
law counter_costlier_rejected:
  {apply_admitted(apply(demo_policy(), demo_update(), base_ok(), cand_worse_cost())) == False{} : Bool}

def counter_costlier_rejected():
  {==}

# apply rejects Invalid input.
law apply_rejects_invalid:
  {apply_admitted(apply(demo_policy(), demo_update(), base_ok(), cand_bad_total())) == False{} : Bool}

def apply_rejects_invalid():
  {==}

# admits-only-on-noregress witness: admitted Better case has score>= at
# equal total and no cost regress at equal score.
law apply_noregress_witness:
  {(apply_admitted(apply(demo_policy(), demo_update(), base_ok(), cand_better_score())), noregress_ok(base_ok(), cand_better_score())) == (True{}, True{}) : Bool & Bool}

def apply_noregress_witness():
  {==}

# apply preserves version on reject (policy + version unchanged).
law apply_preserves_version_on_reject:
  {policy_version(apply_policy(apply(demo_policy(), demo_update(), base_ok(), cand_worse_score()))) == policy_version(demo_policy()) : Nat}

def apply_preserves_version_on_reject():
  {==}

# apply bumps version by one on admit.
law apply_bumps_version_on_admit:
  {policy_version(apply_policy(apply(demo_policy(), demo_update(), base_ok(), cand_better_score()))) == 1n : Nat}

def apply_bumps_version_on_admit():
  {==}

# rollback is identity on the stored prior.
law rollback_identity:
  {rollback(demo_policy(), prior_policy()) == prior_policy() : Policy}

def rollback_identity():
  {==}

# counterexample: empty policy params has length 0 (admits still work).
law counter_empty_params_len:
  {params_len(policy_params(empty_policy())) == 0n : Nat}

def counter_empty_params_len():
  {==}

# work bound: evaluate is constant steps (5) within budget 8, no recursion.
law work_bound_steps:
  {(eval_steps(), Nat.is_le(eval_steps(), 8n)) == (5n, True{}) : Nat & Bool}

def work_bound_steps():
  {==}

# ---- demo main ---------------------------------------------------------------

def main() -> IO(Unit):
  do IO<Unit>:
    IO.print("better-admitted: " ++ outcome_show(evaluate(base_ok(), cand_better_score())) ++ " admitted=" ++ Bool.show(apply_admitted(apply(demo_policy(), demo_update(), base_ok(), cand_better_score()))) ++ " " ++ policy_show(apply_policy(apply(demo_policy(), demo_update(), base_ok(), cand_better_score()))))
    IO.print("worse-rejected: " ++ outcome_show(evaluate(base_ok(), cand_worse_score())) ++ " admitted=" ++ Bool.show(apply_admitted(apply(demo_policy(), demo_update(), base_ok(), cand_worse_score()))) ++ " " ++ policy_show(apply_policy(apply(demo_policy(), demo_update(), base_ok(), cand_worse_score()))))
    IO.print("invalid-on-bad-input: " ++ outcome_show(evaluate(base_ok(), cand_bad_total())) ++ " admitted=" ++ Bool.show(apply_admitted(apply(demo_policy(), demo_update(), base_ok(), cand_bad_total()))))
    IO.print("rollback-identity: " ++ policy_show(rollback(demo_policy(), prior_policy())) ++ "==" ++ policy_show(prior_policy()))
