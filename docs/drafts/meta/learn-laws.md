# learn-laws — executable learning kernel (draft)

STATUS: draft, agent-authored. Nothing here is acceptance or publication.
Only a named human reviewing the exact revision resolves a job.

Core: `runtime/learn.bend` — pure bounded update rule. `evaluate` compares
frozen-set `Meas`; `apply` admits iff `Better`, version+1 with knob
`(param+delta) <> params`, else unchanged; `rollback` returns prior verbatim.
Host wiring (frozen-set runner feeding `Meas` in, versioned commits out) is
SEPARATE and not claimed here.

PROVEN (checker, `bend runtime/learn.bend --check-only` → `All terms check.`):
22 laws below, each with a same-named proof def. DESIGNED (not proven):
runner measurement integrity, commit durability, reason-code audit, wiring.

Laws (one line each):
1. `totality_outcome_covers` — every Outcome is covered by is_outcome.
2. `totality_evaluate_total` — evaluate always yields a covered Outcome.
3. `determinism_evaluate_refl` — same Meas pair gives identical verdict.
4. `determinism_apply_refl` — same policy/update/measures give identical ApplyOut.
5. `invalid_totals_differ` — differing totals yield Invalid.
6. `counter_zero_total` — zero total yields Invalid (never learn from empty).
7. `counter_score_over_total` — score>total yields Invalid (malformed).
8. `score_dominance_up` — higher score yields Better (cost ignored).
9. `score_dominance_down_despite_cheap` — lower score yields Worse even if cheaper.
10. `cost_tiebreak_cheaper_wins` — equal score plus lower cost yields Better.
11. `cost_tiebreak_costlier_loses` — equal score plus higher cost yields Worse.
12. `same_exact` — equal score and cost yields Same.
13. `apply_admits_better` — Better (score-up) is admitted.
14. `apply_admits_cost_down` — Same-score-lower-cost is admitted (it is Better).
15. `counter_costlier_rejected` — equal score plus higher cost is rejected.
16. `apply_rejects_invalid` — Invalid input is rejected.
17. `apply_noregress_witness` — admitted Better has score>= at equal total and no cost regress at equal score.
18. `apply_preserves_version_on_reject` — reject leaves policy and version unchanged.
19. `apply_bumps_version_on_admit` — admit bumps version 0 to 1 (demo witness).
20. `rollback_identity` — rollback returns the stored prior verbatim.
21. `counter_empty_params_len` — empty policy params has length 0 (admit still works, prepends).
22. `work_bound_steps` — evaluate is 5 constant steps within budget 8, no recursion.

Counterexamples: zero total → Invalid; score>total → Invalid; equal scores
with higher cost → Worse and rejected; empty params → length 0 (singleton
after admit). Falsification: flipping the cost-tiebreak Better→Worse fails
`cost_tiebreak_cheaper_wins`, proving the law guards the tiebreak.
