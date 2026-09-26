# Score lane (E1): evaluated quality as evidence

> Historical design proposal — no runtime changes. Date: 2026-09-18. Its multi-file retrieval spike was retired from active runtime; the current one-file DSH kernel and host-side scoped context path are described in `local-main-reconciliation.md`.
> Extends: `SYSTEM.md` (§4 plan), `agentic-git.md` (§5 note semantics), `nudge-simplify.md` (§2.8 non-goals), `SHARED_PRODUCT.md` (learning loop).

## 0. Why

The system records two kinds of claims today: structural proof (`bend` gate `pass`) and accountable acceptance (a named human on an exact revision). Quality — "was this response good?" — is deliberately unmeasured: receipts and review records carry `scoreStatus: not_evaluated` (`runtime/programs/cli.py`, `scripts/agit.py`), and `agentic-git.md` states that a score and a proof `pass` are *orthogonal claims recorded side by side*.

The gap this closes: satisfaction exists only as a binary human accept at an exact revision. There is no case list, no coverage, no comparison against the incumbent — so "this lesson improved the program" cannot be expressed as evidence.

E1 adds the third evidence lane: **quality reports as typed, reviewable evidence — never as approval.** Proof proves shape; acceptance assigns accountability; a score report measures outcome on identified cases.

## 1. Where it counts in (the four coordinates)

| Coordinate | Meaning | Lane | State |
|---|---|---|---|
| O = (stage, laws_passed, fresh) | commitment | agit, monotone law | proven |
| fuel | bounded steps per grant | agit / Bend kernels | P2 |
| H (openness / potentia) | support of admissible candidates | `potentia-laws` | formalizing |
| **Q (score)** | outcome quality vs incumbent on cases | **this doc** | **reserved: `not_evaluated`** |

Q is the only empirical coordinate. It must not be folded into O: orientation stays a monotone commitment metric; quality is empirical and may go down.

## 2. ScoreReport — the typed shape

One report, immutable, content-addressed. The shape is checkable (acceptance-shape style); the content is empirical.

```json
{
  "subject": {"kind": "program|agent|retrieval", "name": "artifact-design"},
  "incumbentDigest": "sha256:…",
  "candidateDigest": "sha256:…",
  "caseSetDigest": "sha256:…",
  "cases": [
    {"id": "c-0007", "outcome": "pass|fail|abstain|error", "metric": "recall@5", "value": 0.62, "notes": "…"}
  ],
  "metrics": [{"name": "recall@5", "aggregate": "mean", "value": 0.62}],
  "coverage": {"cases_total": 40, "evaluated": 38, "skipped": 2, "skip_reasons": ["budget"]},
  "evaluator": {"kind": "human|external-model|rule|harness", "id": "…", "distinctFromAuthor": true},
  "createdAt": "ISO-8601"
}
```

Rules:

- `incumbentDigest` / `candidateDigest` bind the report to exactly one comparison pair.
- `cases` outcome vocabulary is closed; `abstain` and `error` are scored outcomes, never dropped.
- `metrics` entries require a declared aggregation — no invented scalar "quality".
- `coverage` is arithmetic-consistent (`evaluated + skipped = cases_total`) and every skip carries a reason. A result without coverage is incomplete.
- `evaluator` identity is required and must be distinct from the candidate's author/proposer. A report whose evaluator is the author is refused.
- Reports are content-addressed; the report digest is the reference in git objects and receipts.

## 3. Promotion kinds — the policy

Two kinds, never collapsed:

| Kind | Requires | `scoreStatus` | Claim language |
|---|---|---|---|
| **Operational** (today's behavior) | human accept on exact revision | `not_evaluated` | "adopted" — no improvement claim |
| **Evaluated** | operational requirements **+** matching ScoreReport | `evaluated` | only what cases, coverage, and metrics support |

- No report, no improvement claim. No claim beyond recorded coverage. Directional results are reportable without significance language.
- `lesson-review` stays advisory model analysis — it is not a ScoreReport and never counts as evaluation evidence (`nudge-simplify.md` §2.8 keeps evaluators out of the Nudge schema; `runtime/programs/README.md` keeps operational adoption distinct from the evaluator-based optimization protocol).
- Promotion record: the envelope gains optional `scoreReportDigest`; when present it must match the report's candidate/incumbent pair, the report is stored immutably beside the sources, and the active pointer records it.
- Human acceptance remains the final act for both kinds. Evaluation informs; it never promotes.

## 4. Where reports are carried (agit)

- `agit review` already carries `scoreStatus` in its body and accepts `--score-status`. E1 adds `--score-report <path>`: validate shape, store the report as a git object + note under `refs/notes/agit-score`, and add a `Score-Report-Digest` trailer to the review commit.
- `agit accept` gains one conditional rule: when the resolution claims an improvement (or `--evaluated` is passed), require the score note on the review tip with matching candidate digest, distinct evaluator, and recorded coverage. Otherwise it refuses with a named rule (`missing-score`). Operational accepts are untouched.
- `agit state` surfaces `score: evaluated|not_evaluated (coverage n/m)`.
- Nothing about O changes; the score is not monotone and never blocks a non-claiming accept.
- Sequencing: P2's orientation/fuel fields land first (`am/orientation-fuel`); E1 builds on that envelope, not beside it.

## 5. First instance — retrieval quality vs the incumbent concat baseline (P3)

- **Cases:** query → gold items at a fixed character budget mirroring the incumbent's concat baseline (`runtime/desk/src/jobs.js` brief expansion, ~120 KB cap).
- **Metrics (historical proposal):** recall@k / MRR (selection) and downstream acceptance rate per run; `Abstain` would have been scored by the retired `runtime/programs/retrieval/route.bend` spike (source in jj revision `a19b016847a1a2b5551d75c55a4b18f0e2f222ec`).
- **Harness (unimplemented proposal):** `runtime/programs/retrieval/eval.py` (stdlib) + versioned `cases.json` would have emitted a ScoreReport; that file never landed.
- **Historical entry condition:** the retired retrieval `PROOF.bend` would have needed a green check and one failing negative control (P2 work in flight). Deterministic oracle numbers alone are not a quality claim until cases and budget are declared.
- **Output:** baseline (concat) vs candidate (diffuse + route) side by side, coverage stated, in the report format above.

## 6. What must not happen

- No self-evaluation: an author or proposer (including an RLM instance) may not evaluate its own candidate; RLM may propose and may **generate cases**, never grade its own work.
- No score in the law set, no auto-promotion, no score gate on operational adoption.
- No aggregate without a declared metric; no dropped abstain/error cases; no improvement claim without coverage.
- No score text as proof or approval; git wins on disagreement (`agentic-git.md`).

## 7. E1 acceptance evidence

1. Shape validator + unit tests: valid report accepted; missing coverage, unknown evaluator, bad digests, and self-evaluator refused with named reasons.
2. Fixture: evaluated promotion accepted with a valid report; improvement claim without a report refused (`missing-score`); operational accept unchanged; O untouched.
3. Retrieval eval: baseline vs retrieval on the versioned cases; output is a valid ScoreReport; evaluated receipts carry `scoreStatus: evaluated`.
4. All existing gates and tests stay green.

## 8. Open questions (owner)

1. Case-set ownership and versioning: steward-maintained in-repo `evals/` case files, or host state?
2. Which evaluator kinds are admissible for an evaluated promotion at first: human only, or human + deterministic rule + external model?
3. Is directional evidence sufficient (doctrine asks for cases, evaluator, coverage, comparison), or is a minimum-effect policy wanted?
4. Must evaluated promotions re-run the full case set, or is a coverage threshold acceptable?
