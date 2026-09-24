# RRSI for the meta node

[RRSI](https://arxiv.org/abs/2609.24972) means *Regularized Recursive Self-Improvement of Agent Harnesses*. The current node already produces isolated jj candidate revisions and retains evidence, but it does not autonomously run harness-evolution rounds. `runtime/rrsi.py` is the first, deterministic admission gate for such rounds. It adds no daemon, remote dependency, or permission to promote a candidate.

Use the existing `meta` task path to propose one harness change in a jj workspace. Pin the candidate revision and its diff. An independent critic must inspect the diff **before** benchmark scores are revealed, rejecting task-specific answers, benchmark identifiers, or inert additions. Run the same frozen model, evolve suite, trial count, environment and verifier on the incumbent and candidate; retain raw traces privately. Repeated unchanged-incumbent evaluations should calibrate the empirical noise band. A separate held-out suite measures transfer only after selection; it must not guide proposals.

Pass a JSON evidence record to `python3 runtime/rrsi.py EVIDENCE.json`. The file may live in private node state; do not commit benchmark answers, raw traces, or private task data. The gate checks the annealed edit budget, exact trial coverage, critic evidence, domain guard, best-score floor, and score/token-cost tradeoff. A within-noise change must earn its place through lower cost or previously unused structural machinery. Each admitted or rejected edit should be retained with its component, hypothesis, diff digest, measured score and token changes, and reason so the next proposer can learn from failed hypotheses and identify pruning targets.

The evidence shape is:

```json
{
  "suite": ["case-a", "case-b"], "repeats": 1,
  "revision": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "incumbent_revision": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "incumbent_trials": [{"task": "case-a", "reward": 0, "tokens": 100}, {"task": "case-b", "reward": 1, "tokens": 100}],
  "candidate_trials": [{"task": "case-a", "reward": 1, "tokens": 105}, {"task": "case-b", "reward": 1, "tokens": 105}],
  "noise": 0.05, "best_score": 0.5,
  "round": 0, "rounds": 8, "min_edits": 1, "max_edits": 3,
  "edits": [{"component": "prompt", "hypothesis": "Request a final verification pass"}],
  "critic": {"passed": true, "evidence": "Independent reviewer checked the pinned diff before scores"},
  "guards_passed": true, "beta0": 0, "beta1": 1,
  "within_band": {"score": 0, "cost": 1, "novelty": 0},
  "history": []
}
```

Scores are in `[0,1]`; `tokens` is measured policy-token use. Each task needs `repeats` trials in both sets. `best_score` is the highest evolve score previously selected. Accepted structural component types in history count against novelty. The gate exits 0 for an admissible candidate, 1 for rejection, and 2 for malformed evidence. Admission is a research selection recommendation, not an assertion that the recorded trials or critic are authentic. It never integrates a revision or restarts the live node.

The missing work for a **live RRSI loop** is a fixed, independently scored agent-task suite, a runner that executes candidate harness revisions in isolated node instances with a frozen model, calibrated repeat trials, a real pre-score critic, retained round history, and post-selection held-out evaluation. Until these exist, describe the system as having an RRSI admission gate, not full autonomous RRSI. The installed live node remains on its pinned release until a reviewed change is deliberately deployed.
