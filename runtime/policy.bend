import Base

# ===========================================================================
# runtime/policy.bend — SMALL pure policy kernel (deny-by-default).
#
# STATUS: draft, agent-authored. Nothing here is acceptance or publication.
# Only a named human reviewing this exact revision resolves a job.
#
# SHAPE
#   * Types: Role, Action, Request, Rule, Decision (below).
#   * Policy is a rule list: +List<Rule> (no wrapper).
#   * `decide` is the ONLY public decision site. Helpers named decide_* /
#     *_of / *_against are private sub-steps of decide (scope check, review
#     gate, allow construction); they are never a standalone authorization.
#     `route` is NOT a decision: it returns Maybe<&2, Rule> (Some first
#     match, explicit None when unmatched).
#   * decide pipeline (deny-by-default, first-match-wins):
#       route -> None => Deny{"deny:no-match"}
#       route -> Some rl:
#         scope_ok = subset(target,max) AND subset(target,actor_scope)
#         scope_ok False => Deny{"deny:scope"}
#         gate = is_review_action(action) AND requires_review
#         gate True => NeedReview{"review:required"} (never Allow)
#         else Allow{target_scope, Nat.min(requested, max_budget)}
#   * Scope is +List<Nat>; containment is subset (both endpoints in scope
#     for conduction-style gating lives elsewhere; here target must sit
#     inside the rule max AND inside the actor's own scope).
#
# MONOTONICITY (exact sense used by law monotonicity_tail_preserved):
#   if a policy head already matches, appending any tail preserves the
#   decision: decide(r1 <> extra, req) == decide([r1], req).
#
# WORK BOUND (exact sense used by law work_bound_policy_length):
#   route takes at most policy_len steps (one rule_matches per element);
#   policy_len is the syntactic length; witness: 2-element demo = 2n.
#
# PERFORMANCE (heavily loaded machine):
#   * shared recursive tails are bound once (t used once per call);
#   * no Bool.pick has a recursive call in both arms (route has recursion
#     only in the miss arm; member/subset use Bool.or/and via match);
#   * recursion is structural on one List at a time (member/subset/route/
#     policy_len/show), never mutual.
# ===========================================================================

type Role is Data:
  Orchestrator{}
  Forge{}
  Builder{}
  Reviewer{}
  Scout{}

type Action is Data:
  Read{}
  Write{}
  Delegate{}
  Publish{}
  Retire{}
  Spend{}

type Request is Data:
  Request{actor: Role, actor_scope: +List<Nat>, action: Action, target_scope: +List<Nat>, budget: Nat}

type Rule is Data:
  Rule{role: Role, action: Action, max_scope: +List<Nat>, max_budget: Nat, requires_review: Bool}

type Decision is Data:
  Allow{scope: +List<Nat>, budget: Nat}
  Deny{reason: String}
  NeedReview{reason: String}

# ---- tags + equality (small, no 25-case match) -----------------------------

def role_tag(r: Role) -> Nat:
  match r:
    case Orchestrator{}:
      0n
    case Forge{}:
      1n
    case Builder{}:
      2n
    case Reviewer{}:
      3n
    case Scout{}:
      4n

def role_eq(a: Role, b: Role) -> Bool:
  Nat.is_eq(role_tag(a), role_tag(b))

def action_tag(a: Action) -> Nat:
  match a:
    case Read{}:
      0n
    case Write{}:
      1n
    case Delegate{}:
      2n
    case Publish{}:
      3n
    case Retire{}:
      4n
    case Spend{}:
      5n

def action_eq(a: Action, b: Action) -> Bool:
  Nat.is_eq(action_tag(a), action_tag(b))

def is_review_action(a: Action) -> Bool:
  match a:
    case Read{}:
      False{}
    case Write{}:
      False{}
    case Delegate{}:
      False{}
    case Publish{}:
      True{}
    case Retire{}:
      True{}
    case Spend{}:
      True{}

# ---- scope sets ------------------------------------------------------------

def member(+x: Nat, +xs: +List<Nat>) -> Bool:
  match xs:
    case Nil{}:
      False{}
    case Con{h, +t}:
      Bool.or(Nat.is_eq(h, x), member(x, t))

def subset(+sub: +List<Nat>, +sup: +List<Nat>) -> Bool:
  match sub:
    case Nil{}:
      True{}
    case Con{h, +t}:
      Bool.and(member(h, sup), subset(t, sup))

# ---- match / scope / gate sub-steps (private to decide) --------------------

def match_against(rr: Role, aa: Action, +r: Request) -> Bool:
  match r:
    case Request{actor, asc, act, tsc, b}:
      Bool.and(role_eq(rr, actor), action_eq(aa, act))

def rule_matches(+rl: Rule, +r: Request) -> Bool:
  match rl:
    case Rule{rr, aa, ms, mb, rev}:
      match_against(rr, aa, r)

def scope_against(+ms: +List<Nat>, +r: Request) -> Bool:
  match r:
    case Request{actor, +asc, act, +tsc, b}:
      Bool.and(subset(tsc, ms), subset(tsc, asc))

def scope_ok_of(+rl: Rule, +r: Request) -> Bool:
  match rl:
    case Rule{rr, aa, +ms, mb, rev}:
      scope_against(ms, r)

def gate_against(rev: Bool, +r: Request) -> Bool:
  match r:
    case Request{actor, asc, act, tsc, b}:
      Bool.and(is_review_action(act), rev)

def gate_of(+rl: Rule, +r: Request) -> Bool:
  match rl:
    case Rule{rr, aa, ms, mb, rev}:
      gate_against(rev, r)

# ---- route: first match or explicit None (not a decision) ------------------

def route(+p: +List<Rule>, +r: Request) -> Maybe<&2, Rule>:
  match p:
    case Nil{}:
      None{}
    case Con{+h, +t}:
      Bool.pick(Maybe<&2, Rule>, rule_matches(h, r), Some{h}, route(t, r))

# ---- decide: the ONLY decision site ----------------------------------------
# Sub-steps below are private to decide (leaf-first for Bend's declaration
# order: every callee is declared above its caller; no mutual recursion).

def allow_with(+mb: Nat, +r: Request) -> Decision:
  match r:
    case Request{actor, asc, act, +tsc, +b}:
      Allow{tsc, Nat.min(b, mb)}

def decide_allow(+rl: Rule, +r: Request) -> Decision:
  match rl:
    case Rule{rr, aa, ms, +mb, rev}:
      allow_with(mb, r)

def decide_gated(g: Bool, +rl: Rule, +r: Request) -> Decision:
  match g:
    case True{}:
      NeedReview{"review:required"}
    case False{}:
      decide_allow(rl, r)

def decide_scoped(ok: Bool, +rl: Rule, +r: Request) -> Decision:
  match ok:
    case False{}:
      Deny{"deny:scope"}
    case True{}:
      decide_gated(gate_of(rl, r), rl, r)

def decide_from(+m: Maybe<&2, Rule>, +r: Request) -> Decision:
  match m:
    case None{}:
      Deny{"deny:no-match"}
    case Some{+rl}:
      decide_scoped(scope_ok_of(rl, r), rl, r)

def decide(+p: +List<Rule>, +r: Request) -> Decision:
  decide_from(route(p, r), r)

# ---- classifiers / measures -------------------------------------------------

def is_decision(d: Decision) -> Bool:
  match d:
    case Allow{s, b}:
      True{}
    case Deny{r}:
      True{}
    case NeedReview{r}:
      True{}

def is_allow(d: Decision) -> Bool:
  match d:
    case Allow{s, b}:
      True{}
    case Deny{r}:
      False{}
    case NeedReview{r}:
      False{}

def policy_len(+p: +List<Rule>) -> Nat:
  match p:
    case Nil{}:
      0n
    case Con{h, +t}:
      Nat.add(1n, policy_len(t))

# ---- fixtures ---------------------------------------------------------------

def allow_read_rule() -> Rule:
  Rule{Builder{}, Read{}, [1n, 2n, 3n], 10n, False{}}

def allow_read_rule_small() -> Rule:
  Rule{Builder{}, Read{}, [1n, 2n, 3n], 3n, False{}}

def review_publish_rule() -> Rule:
  Rule{Builder{}, Publish{}, [1n, 2n], 5n, True{}}

def allow_read_request() -> Request:
  Request{Builder{}, [1n, 2n, 3n], Read{}, [1n, 2n], 7n}

def review_publish_request() -> Request:
  Request{Builder{}, [1n, 2n], Publish{}, [1n, 2n], 4n}

def scope_denied_request() -> Request:
  Request{Builder{}, [1n, 2n, 3n], Read{}, [9n], 2n}

def no_match_request() -> Request:
  Request{Scout{}, [1n], Read{}, [1n], 1n}

def unknown_role_request() -> Request:
  Request{Scout{}, [9n], Write{}, [9n], 1n}

def empty_scope_request() -> Request:
  Request{Builder{}, [1n, 2n, 3n], Read{}, Nil{}, 5n}

def zero_budget_request() -> Request:
  Request{Builder{}, [1n, 2n, 3n], Read{}, [1n, 2n], 0n}

def write_no_match_request() -> Request:
  Request{Builder{}, [1n, 2n, 3n], Write{}, [1n], 1n}

def demo_policy_allow() -> +List<Rule>:
  [allow_read_rule()]

def demo_policy_review() -> +List<Rule>:
  [review_publish_rule()]

# ---- pretty print (shell demo only) -----------------------------------------

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

def show_decision(d: Decision) -> String:
  match d:
    case Allow{+s, b}:
      "Allow{" ++ show_nats(s) ++ "," ++ Nat.show(b) ++ "}"
    case Deny{r}:
      "Deny{" ++ r ++ "}"
    case NeedReview{r}:
      "NeedReview{" ++ r ++ "}"

# ===========================================================================
# LAWS (21) — each with a same-named proof def.
# ===========================================================================

# totality: every Decision value is covered (never a silent non-decision).
law totality_decision_covers:
  for d: Decision
  {is_decision(d) == True{} : Bool}

def totality_decision_covers(d):
  match d:
    case Allow{s, b}:
      {==}
    case Deny{r}:
      {==}
    case NeedReview{r}:
      {==}

# determinism: same policy + request => identical decision.
law determinism_decide_refl:
  for +p: +List<Rule>
  for +r: Request
  {decide(p, r) == decide(p, r) : Decision}

def determinism_decide_refl(p, r):
  {==}

# deny-by-default: a non-matching request denies with no-match.
law deny_by_default_no_match:
  {decide([allow_read_rule()], no_match_request()) == Deny{"deny:no-match"} : Decision}

def deny_by_default_no_match():
  {==}

# no-escalation (budget): grant never exceeds the rule cap.
law no_escalation_budget_cap:
  for b: Nat
  for mb: Nat
  {Nat.is_le(Nat.min(b, mb), mb) == True{} : Bool}

def no_escalation_budget_cap(b, mb):
  match b mb:
    case 0n 0n:
      {==}
    case 0n 1n+bp:
      {==}
    case 1n+ap 0n:
      {==}
    case 1n+ap 1n+bp:
      no_escalation_budget_cap(ap, bp)

# no-escalation (scope witness): granted scope is exactly the requested target.
law no_escalation_scope_witness:
  {decide([allow_read_rule()], allow_read_request()) == Allow{[1n, 2n], 7n} : Decision}

def no_escalation_scope_witness():
  {==}

# review gate: gated publish yields NeedReview.
law review_gate_publish_needs_review:
  {decide([review_publish_rule()], review_publish_request()) == NeedReview{"review:required"} : Decision}

def review_gate_publish_needs_review():
  {==}

# review gate: a gated decision never Allows.
law review_gate_never_allows:
  {is_allow(decide([review_publish_rule()], review_publish_request())) == False{} : Bool}

def review_gate_never_allows():
  {==}

# first-match-wins: a matching head shadows any tail.
law first_match_wins_prefix:
  {decide([allow_read_rule(), allow_read_rule_small()], allow_read_request()) == decide([allow_read_rule()], allow_read_request()) : Decision}

def first_match_wins_prefix():
  {==}

# route: miss is explicit None.
law route_none_on_miss:
  {route([allow_read_rule()], no_match_request()) == None{} : Maybe<&2, Rule>}

def route_none_on_miss():
  {==}

# route: hit returns the first matching rule.
law route_some_on_hit:
  {route([allow_read_rule()], allow_read_request()) == Some{allow_read_rule()} : Maybe<&2, Rule>}

def route_some_on_hit():
  {==}

# monotonicity (exact sense: tail extension after a hit preserves decision).
law monotonicity_tail_preserved:
  for +extra: +List<Rule>
  {decide(allow_read_rule() <> extra, allow_read_request()) == decide([allow_read_rule()], allow_read_request()) : Decision}

def monotonicity_tail_preserved(extra):
  {==}

# counterexample: unknown role (no rule for Scout/Write) denies.
law counter_unknown_role_denied:
  {decide([allow_read_rule()], unknown_role_request()) == Deny{"deny:no-match"} : Decision}

def counter_unknown_role_denied():
  {==}

# counterexample: empty target scope grants empty (no escalation).
law counter_empty_scope_grants_empty:
  {decide([allow_read_rule()], empty_scope_request()) == Allow{Nil{}, 5n} : Decision}

def counter_empty_scope_grants_empty():
  {==}

# counterexample: zero budget grants zero (no floor lift).
law counter_zero_budget_grants_zero:
  {decide([allow_read_rule()], zero_budget_request()) == Allow{[1n, 2n], 0n} : Decision}

def counter_zero_budget_grants_zero():
  {==}

# counterexample: empty policy denies everything.
law counter_empty_policy_denied:
  {decide(Nil{}, allow_read_request()) == Deny{"deny:no-match"} : Decision}

def counter_empty_policy_denied():
  {==}

# counterexample: role matches but action does not => no-match deny.
law counter_no_match_denied:
  {decide([allow_read_rule()], write_no_match_request()) == Deny{"deny:no-match"} : Decision}

def counter_no_match_denied():
  {==}

# counterexample: double match picks the first (7n, not 3n).
law counter_double_match_first_wins:
  {decide([allow_read_rule(), allow_read_rule_small()], allow_read_request()) == Allow{[1n, 2n], 7n} : Decision}

def counter_double_match_first_wins():
  {==}

# work bound witness: route steps bounded by policy length (2 here).
law work_bound_policy_length:
  {policy_len([allow_read_rule(), allow_read_rule_small()]) == 2n : Nat}

def work_bound_policy_length():
  {==}

# budget cap witness: small cap clamps a big request (7n -> 3n).
law allow_budget_capped_witness:
  {decide([allow_read_rule_small()], allow_read_request()) == Allow{[1n, 2n], 3n} : Decision}

def allow_budget_capped_witness():
  {==}

# scope containment witness: out-of-max target denies with scope reason.
law scope_containment_denied_witness:
  {decide([allow_read_rule()], scope_denied_request()) == Deny{"deny:scope"} : Decision}

def scope_containment_denied_witness():
  {==}

# plain allow witness (fixture demo anchor).
law allow_read_witness:
  {is_allow(decide([allow_read_rule()], allow_read_request())) == True{} : Bool}

def allow_read_witness():
  {==}

# ---- demo main ---------------------------------------------------------------

def main() -> IO(Unit):
  do IO<Unit>:
    IO.print("allow: " ++ show_decision(decide(demo_policy_allow(), allow_read_request())))
    IO.print("review: " ++ show_decision(decide(demo_policy_review(), review_publish_request())))
    IO.print("scope-denied: " ++ show_decision(decide(demo_policy_allow(), scope_denied_request())))
    IO.print("no-match-denied: " ++ show_decision(decide(demo_policy_allow(), no_match_request())))
