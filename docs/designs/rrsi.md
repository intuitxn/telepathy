# RRSI for the meta node

[RRSI](https://arxiv.org/abs/2609.24972) means *Regularized Recursive Self-Improvement of Agent Harnesses*. The node produces isolated jj candidate revisions and retains evidence. `runtime/rrsi_run.py` now evaluates one incumbent/candidate pair using temporary node instances; `runtime/rrsi.py` applies deterministic admission rules to the measured evidence. Neither adds a resident service or permission to promote a candidate.

`runtime/rrsi_loop.py` now repeats that cycle for a bounded number of rounds. It compiles the checked [RRSI agent program](../../runtime/agent_programs/rrsi.meta), asks the resident meta node to optimize one allowed file, obtains a separate pre-score critique, measures both revisions, records one-edit feedback, and uses the Bend `rrsi-select` gate before advancing its **private** incumbent. Held-out verified score and mean token cost must both avoid regression. The program's policy fixes the editable path, required guards and reviewed-release boundary. A selected private incumbent is not a live release or a merged Git revision. See [the language design](intuitxn-language.md) for the forward/backward/optimization interpretation.
The generic one-task agent-program bridge rejects this policy program, because a model following the step text alone cannot enforce the protocol guards.

Run it with private evolve and held-out suites outside the repository and a ready resident node. The installed `meta` launcher supplies its ACP executable, model, Bend tool and Python interpreter. The loop creates a fresh private output directory and never resumes an existing run:

```sh
meta improve --repo "$REPO" --incumbent "$FULL_COMMIT" \
  --suite "$PRIVATE_EVOLVE/suite.json" --heldout-suite "$PRIVATE_HELDOUT/suite.json" \
  --out "$PRIVATE_NEW_RUN_DIR" --rounds 2
```

`summary.json`, per-round patches, proposal and critic task records, measured trials, feedback, and `history.json` remain private. The first program permits only `.opencode/agents/meta.md`; expand that policy only together with independent scope and verifier checks. One edit per round makes its feedback attributable to a single hypothesis, though a small suite cannot establish a general causal effect. Critic tasks are separate ACP sessions, not OS-isolated reviewers; the host validates their exact diff binding but cannot prove independence or honesty.

Use the existing `meta` task path to propose one harness change in a jj workspace. Pin the candidate revision and its diff. An independent critic must inspect the diff **before** benchmark scores are revealed, rejecting task-specific answers, benchmark identifiers, or inert additions. Run the same frozen model, evolve suite, trial count, environment and verifier on the incumbent and candidate; retain raw traces privately. The runner estimates provisional empirical noise bands from repeated unchanged-incumbent scores and relative token costs; savings inside the cost band get no credit. A larger suite and more trials are needed for stable estimates. A separate held-out suite measures transfer only after the evolve admission decision; it must not guide proposals. The loop requires held-out nonregression before advancing its private incumbent.

The suite is a fixed JSON manifest with task IDs, fixture directories, prompts, acceptance text and external verifier argv. Each verifier must include `{project}`, which the runner replaces with a private copy of its fixture. The runner pins the suite tree by SHA-256, creates jj checkouts of both revisions, starts temporary local meta nodes with the same ACP executable/model, alternates trials, scores the copied fixture, and records raw node events and trial JSON under a new private `--out` directory. It stops both temporary nodes; the normal resident node keeps running. `examples/rrsi-smoke` checks this workflow but is **not** a meaningful improvement benchmark.

The critic file must contain `revision`, `diff_sha256`, `passed: true`, and a concrete `evidence` string. Compute the digest from the exact diff **before** any trials:

```sh
jj --no-pager --color=never --ignore-working-copy diff \
  --from "$INCUMBENT" --to "$CANDIDATE" --git | shasum -a 256
```

After independently reviewing that diff, write the critic JSON and an edits JSON array with one `{ "component": "...", "hypothesis": "..." }` per independent change. The run command is:

```sh
python3 runtime/rrsi_run.py --repo "$REPO" \
  --incumbent "$INCUMBENT" --candidate "$CANDIDATE" \
  --suite "$SUITE" --critic "$CRITIC" --edits "$EDITS" \
  --out "$PRIVATE_NEW_RUN_DIR" --python "$META_VENV_PYTHON" \
  --acp-agent "$ACP_EXECUTABLE" --model "$MODEL" --repeats 2 \
  --heldout-suite "$PRIVATE_HELDOUT_SUITE"
```

`--heldout-suite` is optional for the one-round runner and required by the recursive loop. If the candidate passes the evolve gate, the runner then measures it and the incumbent on the separate held-out suite and writes `heldout/report.json`. That result is reported for transfer analysis and never fed back into the evolve admission calculation; the loop uses it as a final nonregression guard. The suite, critic and edits are trusted operator inputs. The runner validates their shape and binds the critic to the exact diff, but it cannot prove that a reviewer is independent, that the ACP worker stayed within the fixture, or that a model was honest. The executing agent retains its host permissions. Keep benchmark cases and raw traces private; use separate machine or OS-level sandboxing if hostile candidates are in scope.

Each run writes `history-next.json` and `proposal-context.json` for a later meta proposal. The latter lists tested hypotheses, the next edit budget and advisory pruning candidates. Pass `--history` with the prior `history-next.json` on the next round. These records keep negative results visible; they do not automatically launch another round.

Pass a JSON evidence record to `python3 runtime/rrsi.py EVIDENCE.json`. The file may live in private node state; do not commit benchmark answers, raw traces, or private task data. The gate checks the annealed edit budget, exact trial coverage, critic evidence, domain guard, best-score floor, and score/token-cost tradeoff. A within-noise change must earn its place through savings beyond the provisional cost-noise band or previously unused structural machinery. Each admitted or rejected edit should be retained with its component, hypothesis, diff digest, measured score and token changes, and reason so the next proposer can learn from failed hypotheses and identify pruning targets.

The evidence shape is:

```json
{
  "suite": ["case-a", "case-b"], "repeats": 1,
  "revision": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "incumbent_revision": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "incumbent_trials": [{"task": "case-a", "reward": 0, "tokens": 100}, {"task": "case-b", "reward": 1, "tokens": 100}],
  "candidate_trials": [{"task": "case-a", "reward": 1, "tokens": 105}, {"task": "case-b", "reward": 1, "tokens": 105}],
  "noise": 0.05, "cost_noise": 0.02, "best_score": 0.5,
  "round": 0, "rounds": 8, "min_edits": 1, "max_edits": 3,
  "edits": [{"component": "prompt", "hypothesis": "Request a final verification pass"}],
  "critic": {"passed": true, "evidence": "Independent reviewer checked the pinned diff before scores"},
  "guards_passed": true, "beta0": 0, "beta1": 1,
  "within_band": {"score": 0, "cost": 1, "novelty": 0},
  "history": []
}
```

Scores are in `[0,1]`; `tokens` is measured policy-token use. Each task needs `repeats` trials in both sets. `best_score` is the highest evolve score previously selected. Accepted structural component types in history count against novelty. The gate exits 0 for an admissible candidate, 1 for rejection, and 2 for malformed evidence. Admission is a research selection recommendation, not an assertion that the recorded trials or critic are authentic. It never integrates a revision or restarts the live node.

The remaining work for a trustworthy **live self-improving system** is a representative private evolve and held-out suite, stronger empirical noise calibration, an independent critic with an enforceable isolation boundary, controlled multi-edit attribution, and a reviewed release path. The bounded loop is executable but does not run continuously, integrate into `main`, or deploy candidates. The installed live node remains on its pinned release until a reviewed change is deliberately deployed.
