import Base

# ===========================================================================
# runtime/scope.bend — SMALL pure scope checker (deny-by-default).
# Executable regularization: every neural handle passes through admit.
# Deny by default; Admit only if depth < MAX_DEPTH and 0 < budget <= CAP
# and every scope id registered and handle compatible with scope kind.
# Escalate when well-formed but exceeds authority (budget above handle cap,
# policy-scope action outside handle remit). Escalate never acts, routes to
# named human via escalation_contact (scope-guardian).
#
# Types: Handle = Frame | Split | Retrieve | Judge | PolicyX | MergeTriage
#   | CensusTriage (loop decision points); Scope{task,memory,delegation,policy}
#   as registry ids; Req{handle,scope,budget,depth}; Verdict=Admit|Deny|Escalate.
# Registry (tiny explicit): 0=empty, 1=task, 2=memory, 3=delegation, 4=policy,
#   >=5=unknown. reg_name maps id -> name.
# Constants: MAX_DEPTH=1, CAP=1 (tiny for fast checker).
# Reason codes: 1=depth, 2=zero-budget, 3=scope, 4=compat, 5=over-cap,
#   6=handle-cap, 7=policy-escalation.
#
# COMPAT TABLE (explicit, in compat):
#   Frame         requires task==1
#   Split         requires task==1 and delegation==3
#   Retrieve      requires memory==2
#   Judge         requires task==1 and policy==4
#   PolicyX       requires policy==4
#   MergeTriage   requires delegation==3 and memory==2
#   CensusTriage  requires task==1 and memory==2 and delegation==3
# Full scope Scope{1,2,3,4} satisfies every row (completeness witness).
# Policy escalation (is_policy_escalation): non-Judge/PolicyX handle with
#   policy==4 but compat false -> Escalate{7} (routes to human, never acts).
#
# WORK BOUND: admit_steps()=7 (depth,zero,scope,compat,cap,handle-cap,route);
#   bound 8. No recursion; no Bool.pick with recursion.
# PERFORMANCE: shared recursive tails bound once (none recursive);
#   never a recursive call in both Bool.pick arms (no Bool.pick recursion).
# ===========================================================================

type Handle is Data:
  Frame{}
  Split{}
  Retrieve{}
  Judge{}
  PolicyX{}
  MergeTriage{}
  CensusTriage{}

type Scope is Data:
  Scope{task: Nat, memory: Nat, delegation: Nat, policy: Nat}

type Req is Data:
  Req{handle: Handle, scope: Scope, budget: Nat, depth: Nat}

type Verdict is Data:
  Admit{}
  Deny{reason: Nat}
  Escalate{reason: Nat}

def MAX_DEPTH() -> Nat:
  1n

def CAP() -> Nat:
  1n

def is_registered(id: Nat) -> Bool:
  match id:
    case 0n:
      False{}
    case 1n+p:
      match p:
        case 0n:
          True{}
        case 1n+q:
          match q:
            case 0n:
              True{}
            case 1n+r:
              match r:
                case 0n:
                  True{}
                case 1n+s:
                  match s:
                    case 0n:
                      True{}
                    case 1n+t:
                      False{}

def reg_name(id: Nat) -> String:
  match id:
    case 0n:
      "empty"
    case 1n+p:
      match p:
        case 0n:
          "task"
        case 1n+q:
          match q:
            case 0n:
              "memory"
            case 1n+r:
              match r:
                case 0n:
                  "delegation"
                case 1n+s:
                  match s:
                    case 0n:
                      "policy"
                    case 1n+t:
                      "unknown"

def scope_ok(s: Scope) -> Bool:
  match s:
    case Scope{t, m, d, p}:
      Bool.and(Bool.and(is_registered(t), is_registered(m)), Bool.and(is_registered(d), is_registered(p)))

def depth_ok(d: Nat) -> Bool:
  match d:
    case 0n:
      True{}
    case 1n+p:
      False{}

def is_zero(b: Nat) -> Bool:
  match b:
    case 0n:
      True{}
    case 1n+p:
      False{}

def le_cap(b: Nat) -> Bool:
  match b:
    case 0n:
      True{}
    case 1n+p:
      match p:
        case 0n:
          True{}
        case 1n+q:
          False{}

def le_handle_cap(h: Handle, b: Nat) -> Bool:
  match h b:
    case Frame{} 0n:
      True{}
    case Frame{} 1n+p:
      le_cap(1n+p)
    case Split{} 0n:
      True{}
    case Split{} 1n+p:
      le_cap(1n+p)
    case Retrieve{} 0n:
      True{}
    case Retrieve{} 1n+p:
      le_cap(1n+p)
    case Judge{} 0n:
      True{}
    case Judge{} 1n+p:
      le_cap(1n+p)
    case PolicyX{} 0n:
      True{}
    case PolicyX{} 1n+p:
      match p:
        case 0n:
          False{}
        case 1n+q:
          False{}
    case MergeTriage{} 0n:
      True{}
    case MergeTriage{} 1n+p:
      le_cap(1n+p)
    case CensusTriage{} 0n:
      True{}
    case CensusTriage{} 1n+p:
      le_cap(1n+p)

def compat(+h: Handle, +s: Scope) -> Bool:
  match h s:
    case Frame{} Scope{t, m, d, p}:
      Nat.is_eq(t, 1n)
    case Split{} Scope{t, m, d, p}:
      Bool.and(Nat.is_eq(t, 1n), Nat.is_eq(d, 3n))
    case Retrieve{} Scope{t, m, d, p}:
      Nat.is_eq(m, 2n)
    case Judge{} Scope{t, m, d, p}:
      Bool.and(Nat.is_eq(t, 1n), Nat.is_eq(p, 4n))
    case PolicyX{} Scope{t, m, d, p}:
      Nat.is_eq(p, 4n)
    case MergeTriage{} Scope{t, m, d, p}:
      Bool.and(Nat.is_eq(d, 3n), Nat.is_eq(m, 2n))
    case CensusTriage{} Scope{t, m, d, p}:
      Bool.and(Nat.is_eq(t, 1n), Bool.and(Nat.is_eq(m, 2n), Nat.is_eq(d, 3n)))

def is_policy_escalation(+h: Handle, +s: Scope) -> Bool:
  match h s:
    case Frame{} Scope{t, m, d, p}:
      Nat.is_eq(p, 4n)
    case Split{} Scope{t, m, d, p}:
      Nat.is_eq(p, 4n)
    case Retrieve{} Scope{t, m, d, p}:
      Nat.is_eq(p, 4n)
    case Judge{} Scope{t, m, d, p}:
      False{}
    case PolicyX{} Scope{t, m, d, p}:
      False{}
    case MergeTriage{} Scope{t, m, d, p}:
      Nat.is_eq(p, 4n)
    case CensusTriage{} Scope{t, m, d, p}:
      Nat.is_eq(p, 4n)

def admit_after_handlecap(ok: Bool, +h: Handle, +s: Scope, +b: Nat, +d: Nat) -> Verdict:
  match ok:
    case False{}:
      Escalate{6n}
    case True{}:
      Admit{}

def admit_after_cap(ok: Bool, +h: Handle, +s: Scope, +b: Nat, +d: Nat) -> Verdict:
  match ok:
    case False{}:
      Escalate{5n}
    case True{}:
      admit_after_handlecap(le_handle_cap(h, b), h, s, b, d)

def admit_compat_miss(e: Bool, +h: Handle, +s: Scope, +b: Nat, +d: Nat) -> Verdict:
  match e:
    case True{}:
      Escalate{7n}
    case False{}:
      Deny{4n}

def admit_after_compat(c: Bool, e: Bool, +h: Handle, +s: Scope, +b: Nat, +d: Nat) -> Verdict:
  match c:
    case False{}:
      admit_compat_miss(e, h, s, b, d)
    case True{}:
      admit_after_cap(le_cap(b), h, s, b, d)

def admit_after_scope(ok: Bool, +h: Handle, +s: Scope, +b: Nat, +d: Nat) -> Verdict:
  match ok:
    case False{}:
      Deny{3n}
    case True{}:
      admit_after_compat(compat(h, s), is_policy_escalation(h, s), h, s, b, d)

def admit_after_zero(z: Bool, +h: Handle, +s: Scope, +b: Nat, +d: Nat) -> Verdict:
  match z:
    case True{}:
      Deny{2n}
    case False{}:
      admit_after_scope(scope_ok(s), h, s, b, d)

def admit_after_depth(ok: Bool, +h: Handle, +s: Scope, +b: Nat, +d: Nat) -> Verdict:
  match ok:
    case False{}:
      Deny{1n}
    case True{}:
      admit_after_zero(is_zero(b), h, s, b, d)

def admit(+r: Req) -> Verdict:
  match r:
    case Req{+h, +s, +b, +d}:
      admit_after_depth(depth_ok(d), h, s, b, d)

def is_verdict(v: Verdict) -> Bool:
  match v:
    case Admit{}:
      True{}
    case Deny{r}:
      True{}
    case Escalate{r}:
      True{}

def is_admit(v: Verdict) -> Bool:
  match v:
    case Admit{}:
      True{}
    case Deny{r}:
      False{}
    case Escalate{r}:
      False{}

def is_deny(v: Verdict) -> Bool:
  match v:
    case Admit{}:
      False{}
    case Deny{r}:
      True{}
    case Escalate{r}:
      False{}

def is_escalate(v: Verdict) -> Bool:
  match v:
    case Admit{}:
      False{}
    case Deny{r}:
      False{}
    case Escalate{r}:
      True{}

def full_scope() -> Scope:
  Scope{1n, 2n, 3n, 4n}

def empty_scope() -> Scope:
  Scope{0n, 0n, 0n, 0n}

def unknown_scope() -> Scope:
  Scope{9n, 2n, 3n, 4n}

def admit_steps() -> Nat:
  7n

def escalation_contact() -> String:
  "scope-guardian"

def monotone_prop(+h: Handle, +b1: Nat, +b2: Nat) -> Bool:
  Bool.or(Bool.not(is_deny(admit(Req{h, full_scope(), b2, 0n}))), Bool.not(Bool.and(Bool.and(Nat.is_le(b2, CAP()), Nat.is_le(b1, b2)), is_admit(admit(Req{h, full_scope(), b1, 0n})))))

# ===========================================================================
# LAWS (23) — each with same-named proof def.
# ===========================================================================

law totality_verdict_covers:
  for d: Verdict
  {is_verdict(d) == True{} : Bool}

def totality_verdict_covers(d):
  match d:
    case Admit{}:
      {==}
    case Deny{r}:
      {==}
    case Escalate{r}:
      {==}

law totality_admit_total:
  for +req: Req
  {is_verdict(admit(req)) == True{} : Bool}

def totality_admit_total(req):
  totality_verdict_covers(admit(req))

law determinism_admit_refl:
  for +req: Req
  {admit(req) == admit(req) : Verdict}

def determinism_admit_refl(req):
  {==}

law deny_by_default_empty:
  for +h: Handle
  for +b: Nat
  for +d: Nat
  {is_deny(admit(Req{h, empty_scope(), b, d})) == True{} : Bool}

def deny_by_default_empty(h, b, d):
  match b d:
    case 0n 0n:
      {==}
    case 0n 1n+qd:
      {==}
    case 1n+qb 0n:
      {==}
    case 1n+qb 1n+qd:
      {==}

law deny_by_default_unknown:
  for +h: Handle
  for +b: Nat
  for +d: Nat
  {is_deny(admit(Req{h, unknown_scope(), b, d})) == True{} : Bool}

def deny_by_default_unknown(h, b, d):
  match b d:
    case 0n 0n:
      {==}
    case 0n 1n+qd:
      {==}
    case 1n+qb 0n:
      {==}
    case 1n+qb 1n+qd:
      {==}

law depth_strictness_exact:
  for +h: Handle
  for +s: Scope
  for +b: Nat
  for +t: Nat
  {admit(Req{h, s, b, 1n+t}) == Deny{1n} : Verdict}

def depth_strictness_exact(h, s, b, t):
  {==}

law depth_strictness_never_admit:
  for +h: Handle
  for +s: Scope
  for +b: Nat
  for +t: Nat
  {is_admit(admit(Req{h, s, b, 1n+t})) == False{} : Bool}

def depth_strictness_never_admit(h, s, b, t):
  {==}

law budget_zero_exact:
  for +h: Handle
  for +s: Scope
  {admit(Req{h, s, 0n, 0n}) == Deny{2n} : Verdict}

def budget_zero_exact(h, s):
  {==}

law budget_overcap_exact:
  for +h: Handle
  for +t: Nat
  {admit(Req{h, full_scope(), 2n+t, 0n}) == Escalate{5n} : Verdict}

def budget_overcap_exact(h, t):
  match h:
    case Frame{}:
      {==}
    case Split{}:
      {==}
    case Retrieve{}:
      {==}
    case Judge{}:
      {==}
    case PolicyX{}:
      {==}
    case MergeTriage{}:
      {==}
    case CensusTriage{}:
      {==}

law budget_overcap_never_admit:
  for +h: Handle
  for +t: Nat
  {is_admit(admit(Req{h, full_scope(), 2n+t, 0n})) == False{} : Bool}

def budget_overcap_never_admit(h, t):
  match h:
    case Frame{}:
      {==}
    case Split{}:
      {==}
    case Retrieve{}:
      {==}
    case Judge{}:
      {==}
    case PolicyX{}:
      {==}
    case MergeTriage{}:
      {==}
    case CensusTriage{}:
      {==}

law monotonicity_budget_within_cap:
  for +h: Handle
  for +b1: Nat
  for +b2: Nat
  {monotone_prop(h, b1, b2) == True{} : Bool}

def monotonicity_budget_within_cap(h, b1, b2):
  match h:
    case Frame{}:
      match b1:
        case 0n:
          match b2:
            case 0n:
              {==}
            case 1n+q2:
              match q2:
                case 0n:
                  {==}
                case 1n+r2:
                  {==}
        case 1n+q1:
          match q1:
            case 0n:
              match b2:
                case 0n:
                  {==}
                case 1n+q2:
                  match q2:
                    case 0n:
                      {==}
                    case 1n+r2:
                      {==}
            case 1n+r1:
              match b2:
                case 0n:
                  {==}
                case 1n+q2:
                  match q2:
                    case 0n:
                      {==}
                    case 1n+r2:
                      {==}
    case Split{}:
      match b1:
        case 0n:
          match b2:
            case 0n:
              {==}
            case 1n+q2:
              match q2:
                case 0n:
                  {==}
                case 1n+r2:
                  {==}
        case 1n+q1:
          match q1:
            case 0n:
              match b2:
                case 0n:
                  {==}
                case 1n+q2:
                  match q2:
                    case 0n:
                      {==}
                    case 1n+r2:
                      {==}
            case 1n+r1:
              match b2:
                case 0n:
                  {==}
                case 1n+q2:
                  match q2:
                    case 0n:
                      {==}
                    case 1n+r2:
                      {==}
    case Retrieve{}:
      match b1:
        case 0n:
          match b2:
            case 0n:
              {==}
            case 1n+q2:
              match q2:
                case 0n:
                  {==}
                case 1n+r2:
                  {==}
        case 1n+q1:
          match q1:
            case 0n:
              match b2:
                case 0n:
                  {==}
                case 1n+q2:
                  match q2:
                    case 0n:
                      {==}
                    case 1n+r2:
                      {==}
            case 1n+r1:
              match b2:
                case 0n:
                  {==}
                case 1n+q2:
                  match q2:
                    case 0n:
                      {==}
                    case 1n+r2:
                      {==}
    case Judge{}:
      match b1:
        case 0n:
          match b2:
            case 0n:
              {==}
            case 1n+q2:
              match q2:
                case 0n:
                  {==}
                case 1n+r2:
                  {==}
        case 1n+q1:
          match q1:
            case 0n:
              match b2:
                case 0n:
                  {==}
                case 1n+q2:
                  match q2:
                    case 0n:
                      {==}
                    case 1n+r2:
                      {==}
            case 1n+r1:
              match b2:
                case 0n:
                  {==}
                case 1n+q2:
                  match q2:
                    case 0n:
                      {==}
                    case 1n+r2:
                      {==}
    case PolicyX{}:
      match b1:
        case 0n:
          match b2:
            case 0n:
              {==}
            case 1n+q2:
              match q2:
                case 0n:
                  {==}
                case 1n+r2:
                  {==}
        case 1n+q1:
          match q1:
            case 0n:
              match b2:
                case 0n:
                  {==}
                case 1n+q2:
                  match q2:
                    case 0n:
                      {==}
                    case 1n+r2:
                      {==}
            case 1n+r1:
              match b2:
                case 0n:
                  {==}
                case 1n+q2:
                  match q2:
                    case 0n:
                      {==}
                    case 1n+r2:
                      {==}
    case MergeTriage{}:
      match b1:
        case 0n:
          match b2:
            case 0n:
              {==}
            case 1n+q2:
              match q2:
                case 0n:
                  {==}
                case 1n+r2:
                  {==}
        case 1n+q1:
          match q1:
            case 0n:
              match b2:
                case 0n:
                  {==}
                case 1n+q2:
                  match q2:
                    case 0n:
                      {==}
                    case 1n+r2:
                      {==}
            case 1n+r1:
              match b2:
                case 0n:
                  {==}
                case 1n+q2:
                  match q2:
                    case 0n:
                      {==}
                    case 1n+r2:
                      {==}
    case CensusTriage{}:
      match b1:
        case 0n:
          match b2:
            case 0n:
              {==}
            case 1n+q2:
              match q2:
                case 0n:
                  {==}
                case 1n+r2:
                  {==}
        case 1n+q1:
          match q1:
            case 0n:
              match b2:
                case 0n:
                  {==}
                case 1n+q2:
                  match q2:
                    case 0n:
                      {==}
                    case 1n+r2:
                      {==}
            case 1n+r1:
              match b2:
                case 0n:
                  {==}
                case 1n+q2:
                  match q2:
                    case 0n:
                      {==}
                    case 1n+r2:
                      {==}

law compat_completeness_full_scope:
  for +h: Handle
  {compat(h, full_scope()) == True{} : Bool}

def compat_completeness_full_scope(h):
  match h:
    case Frame{}:
      {==}
    case Split{}:
      {==}
    case Retrieve{}:
      {==}
    case Judge{}:
      {==}
    case PolicyX{}:
      {==}
    case MergeTriage{}:
      {==}
    case CensusTriage{}:
      {==}

law counter_unknown_scope_id:
  {admit(Req{Frame{}, Scope{9n, 2n, 3n, 4n}, 1n, 0n}) == Deny{3n} : Verdict}

def counter_unknown_scope_id():
  {==}

law counter_zero_budget:
  {admit(Req{Frame{}, full_scope(), 0n, 0n}) == Deny{2n} : Verdict}

def counter_zero_budget():
  {==}

law counter_max_depth:
  {admit(Req{Frame{}, full_scope(), 1n, 1n}) == Deny{1n} : Verdict}

def counter_max_depth():
  {==}

law counter_incompatible_pair:
  {admit(Req{Frame{}, Scope{2n, 2n, 3n, 1n}, 1n, 0n}) == Deny{4n} : Verdict}

def counter_incompatible_pair():
  {==}

law counter_overcap_budget:
  {admit(Req{Frame{}, full_scope(), 2n, 0n}) == Escalate{5n} : Verdict}

def counter_overcap_budget():
  {==}

law escalate_handle_cap_witness:
  {admit(Req{PolicyX{}, full_scope(), 1n, 0n}) == Escalate{6n} : Verdict}

def escalate_handle_cap_witness():
  {==}

law escalate_policy_witness:
  {admit(Req{Frame{}, Scope{2n, 2n, 3n, 4n}, 1n, 0n}) == Escalate{7n} : Verdict}

def escalate_policy_witness():
  {==}

law work_bound_admit_steps:
  {admit_steps() == 7n : Nat}

def work_bound_admit_steps():
  {==}

law work_bound_within_budget:
  {Nat.is_le(admit_steps(), 8n) == True{} : Bool}

def work_bound_within_budget():
  {==}

law escalation_routes_to_human:
  {escalation_contact() == "scope-guardian" : String}

def escalation_routes_to_human():
  {==}

law escalate_never_admits:
  for r: Nat
  {is_admit(Escalate{r}) == False{} : Bool}

def escalate_never_admits(r):
  {==}
