# Scope laws — executable regularization (draft)

Status: draft, agent-authored. Checker `runtime/scope.bend` is pure and fast (MAX_DEPTH=1, CAP=1, no recursion). Wiring into the entry point is a separate deferred step; this file does not authorize or route production traffic.

## Compat table (explicit, mirrors `compat` in scope.bend)

- Frame requires task==1
- Split requires task==1 and delegation==3
- Retrieve requires memory==2
- Judge requires task==1 and policy==4
- PolicyX requires policy==4
- MergeTriage requires delegation==3 and memory==2
- CensusTriage requires task==1 and memory==2 and delegation==3
- Full scope Scope{1,2,3,4} satisfies every row.
- Policy escalation: non-Judge/PolicyX with policy==4 but compat false -> Escalate{7} to scope-guardian (never acts).

Registry (tiny explicit): 0=empty, 1=task, 2=memory, 3=delegation, 4=policy, >=5=unknown. Reasons: 1=depth, 2=zero, 3=scope, 4=compat, 5=over-cap, 6=handle-cap, 7=policy.

## Laws — one line each (23 total)

1. totality_verdict_covers: every Verdict is covered by is_verdict.
2. totality_admit_total: every Req gets exactly one verdict via admit.
3. determinism_admit_refl: same Req always gives identical verdict.
4. deny_by_default_empty: empty scope ids always deny (is_deny true).
5. deny_by_default_unknown: unknown scope ids always deny (is_deny true).
6. depth_strictness_exact: depth>=MAX_DEPTH returns Deny{1}.
7. depth_strictness_never_admit: depth>=MAX_DEPTH never admits.
8. budget_zero_exact: budget 0 returns Deny{2}.
9. budget_overcap_exact: budget>CAP with full scope returns Escalate{5}.
10. budget_overcap_never_admit: budget>CAP never admits.
11. monotonicity_budget_within_cap: raising budget within cap never turns Admit into Deny.
12. compat_completeness_full_scope: full scope is compatible with every handle.
13. counter_unknown_scope_id: Scope{9,2,3,4} denies with scope reason.
14. counter_zero_budget: budget 0 denies.
15. counter_max_depth: depth>=MAX denies.
16. counter_incompatible_pair: Frame with Scope{2,2,3,1} denies with compat reason.
17. counter_overcap_budget: budget 2 with CAP=1 escalates.
18. escalate_handle_cap_witness: PolicyX with budget 1 exceeds handle cap 0, escalates.
19. escalate_policy_witness: Frame with Scope{2,2,3,4} escalates for policy remit.
20. work_bound_admit_steps: admit costs 7 steps.
21. work_bound_within_budget: 7 steps fit within bound 8.
22. escalation_routes_to_human: escalations route to scope-guardian.
23. escalate_never_admits: Escalate never counts as Admit.

## Counterexamples (explicit)

- unknown scope id: Frame Scope{9,2,3,4} 1 0 -> Deny{3}
- zero budget: Frame full_scope 0 0 -> Deny{2}
- max depth: Frame full_scope 1 1 -> Deny{1}
- incompatible pair: Frame Scope{2,2,3,1} 1 0 -> Deny{4}
- over-cap: Frame full_scope 2 0 -> Escalate{5} (never Admit)

## PROVEN vs DESIGNED

- PROVEN (checker verifies): all 23 laws above via same-named proof defs in runtime/scope.bend; `bend runtime/scope.bend --check-only` prints All terms check.
- DESIGNED (not proven by checker): choice of MAX_DEPTH=1 and CAP=1 for speed; handle-cap values (PolicyX 0, others 1); reason-code numbers; human name scope-guardian; decision to escalate (not deny) on policy-remit mismatch and handle-cap exceed.
- Deferred: wiring admit into the neural-handle entry point; any production enforcement; human acceptance.
