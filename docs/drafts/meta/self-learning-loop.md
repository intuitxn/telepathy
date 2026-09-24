# DRAFT — self-learning loop: executable protocol with frozen re-measurement gate

Status: draft, agent-authored (Prime, project steward) · 2026-09-24 · **Not published, not sent, not merged. No external effect.**
Written for human review; a named human accepts a specific revision. Nothing here is acceptance.
A passing check is never acceptance (`docs/drafts/meta/neural-handles-scopes.md:4-5`).
This draft invents no metrics, customers, or shipped features. Items marked **unverified** were not re-checked live in this run.

Human intent: define one executable learning loop in which a retained finding only counts as learning if it moves a frozen score or cost with evidence.

What changed / why it matters / what is needed (Prime three answers):
- **What changed:** this one file defines the 5-step loop (freeze → baseline → learn → re-measure → delta), the learning-vs-noting distinction, the admit/quarantine gate, the frozen-set properties, the auto-vs-human roles, and the acceptance checks — all cited to current drafts/memory, no new code.
- **Why it matters:** today notes alone have never demonstrated learning. Prior trials showed zero accuracy benefit when re-measured (`runtime/adaptive/LEARNING.md:76-80,99-104,106-114,173-180`; `docs/drafts/meta/self-improvement-and-scale.md:143-152`). Without a frozen re-measurement gate, noting is mislabeled as learning and unreviewed content merges without provenance.
- **What is needed:** owner decisions below (frozen-set content, scorer, cost unit, gate owner, branch/store conventions); then `@build` can implement the loop runner without re-deriving intent.

Prior honest finding (retained, not re-proven here): writing a finding with no re-measurement is not learning (`runtime/adaptive/LEARNING.md:182-188`); the retrieval probe transferred prompted facts but did not demonstrate automatic retrieval or better code on unseen tasks (`runtime/adaptive/LEARNING.md:76-80`); the coding-agent pilots scored 136/136 both arms, 74/74 both arms, and 652/652 both arms with zero accuracy gain (`runtime/adaptive/LEARNING.md:99-114,173-180`).

---

## 1. THE LOOP — executable protocol

One learning cycle = exactly these five steps, in order, on the same frozen-set version. A cycle that skips re-measurement is not a learning cycle (see §2).

| Step | Name | Inputs (fixed) | Action | Outputs (recorded) |
|---|---|---|---|---|
| L0 | FREEZE | candidate task-source revision + scorer revision | Pin `frozen_set_version = {git_base_SHA, task_manifest_SHA256, scorer_SHA256}`; record in cycle dir; no edits to the set after this point | `frozen.manifest.json` (task ids + input hashes + scorer id) |
| L1 | BASELINE | `frozen.manifest.json` at pinned version, pre-change code/policy revision `R_base` | Run the fixed scorer over the whole frozen set; record per-task pass/fail + cost (wall time, steps, agent calls as available) | `baseline.json` = `{score_base, cost_base, per_task[], toolchain_id, evidence_refs[]}` |
| L2 | LEARN | `baseline.json` + observed outcomes only (checker output, fixture output, inputs/results, source revision, toolchain id, measured cost) | Produce at most one candidate update: retained finding, policy-rule edit, retrieval-graph change, or law/test/op draft. No new tasks invented; no frozen inputs edited; no training on the frozen answers | candidate branch + `candidate.json` = `{parent_R_base, candidate_SHA, change_description, outcome_sources[]}` |
| L3 | RE-MEASURE | same `frozen.manifest.json` version as L0/L1 + candidate revision `R_cand` | Re-run the identical scorer over the whole frozen set; record same schema as L1 | `remeasure.json` = `{score_cand, cost_cand, per_task[], toolchain_id, evidence_refs[]}` |
| L4 | DELTA + DISPOSITION | `baseline.json` + `remeasure.json` + gate rule (§3) | Compute `delta_score = score_cand − score_base`, `delta_cost = cost_cand − cost_base`; apply LEARN GATE; write disposition `ADMIT` or `QUARANTINE` with reason; never merge on `QUARANTINE` | `delta.json` = `{delta_score, delta_cost, disposition, reason, base_SHA, candidate_SHA, frozen_version}` |

Cycle directory (proposal; store path = owner decision D5): one dir per cycle holding exactly `frozen.manifest.json`, `baseline.json`, `candidate.json`, `remeasure.json`, `delta.json`. Missing `remeasure.json` or version mismatch between L1 and L3 → cycle is void as learning (record as noting only).

Relation to existing loop: this is the executable form of `observe → attribute → detect → propose → independent-check → human-review → project` (`docs/drafts/meta/self-improvement-and-scale.md:121-131`); proposer ≠ checker and only a named human promotes the exact revision (same source). Stabilization still means law / test / dispatched op, never prose alone (`docs/drafts/meta/self-improvement-and-scale.md:110-120`).

---

## 2. LEARNING vs NOTING

| Category | Definition | Required evidence | Label |
|---|---|---|---|
| **LEARNING** | Measured `delta_score` or `delta_cost` on the same frozen-set version (L1 vs L3), admitted through the §3 gate | `baseline.json` + `remeasure.json` + `delta.json` with identical `frozen_version`, attached checker/fixture outputs, source revisions, toolchain id | `LEARNING:<cycle-id>` |
| **NOTING** | Writing a finding, hypothesis, or operational note with no L3 re-measurement on the frozen set | Finding text + outcome sources; explicitly no score/cost claim | `NOTING:<finding-id> — not learning` |

Rules:
- A `NOTING` record must never be cited as a score/cost improvement. Prior zero-gain pairs are retained as evidence, not success (`docs/drafts/meta/self-improvement-and-scale.md:143-152`).
- Counterexamples and negative deltas are retained in the cycle dir; a zero or negative result is a completed measurement, not a failure to record (same source).
- Drift-triage handle H8 already requires before/after replay on a frozen set with retained counterexamples (`docs/drafts/meta/neural-handles-scopes.md:32,92`); this loop is that replay, made executable.

---

## 3. THE LEARN GATE + ROLLBACK

### 3.1 Admission rule

Let `S_b, C_b` = baseline score/cost (L1); `S_c, C_c` = re-measured score/cost (L3) on the same frozen version. Higher score is better; lower cost is better; cost unit = owner decision D2.

- **ADMIT** iff `S_c >= S_b` AND (`S_c > S_b` OR `C_c < C_b`).
- **Otherwise QUARANTINE** (score regressed, or equal score at equal-or-higher cost, or measurement void). Quarantined content is never merged to main, never published, never cited as learning.
- Cost-breaks-tie only at equal score: a faster candidate that regresses score is quarantined, not admitted.
- Single-trial gains inside L2 with no L3 are `NOTING`, never `ADMIT`.

Quarantine handling follows quarantine-first (no silent merge / no last-writer-wins, per `docs/drafts/meta/neural-handles-scopes.md:70-72` citing the merge proposal): conflicting or regressing payloads sit in `quarantine/<cycle-id>/` until a human dispositions them.

### 3.2 Rollback — every update versioned and revertible via git

1. Candidate work happens on a feature branch `learn/<cycle-id>` cut from recorded `R_base` (base SHA in `candidate.json` / `delta.json`). Standing auto authority covers this branch only (§5).
2. Merge to main requires a named-human gate (§5); the merge commit message cites `delta.json` disposition `ADMIT` + `frozen_version` + `candidate_SHA`.
3. Revert is exact: record pre-merge main SHA `M_pre` in the cycle dir before merging. To roll back an admitted update `U` (merge SHA `M_u`): create `revert/<cycle-id>` from current main, run `git revert M_u` (or `git revert <update-SHA>` for a fast-forwarded single commit), re-run L3 on the same frozen version, record the post-revert `delta.json`, and require the same human gate to merge the revert. If history requires it, `git reset --hard M_pre` on a new branch is allowed only as a human-gated replacement proposal, never as a force-push to main — **unverified** against this repo's remote/branch-protection settings in this run.
4. Engram/memory findings admitted through this loop are tombstoned on rollback, not deleted or overwritten — tombstone shape itself is a proposal, **unverified** (per `docs/drafts/meta/neural-handles-scopes.md:30,90`).

---

## 4. FROZEN SET — required properties

| # | Property | Statement |
|---|---|---|
| F1 | Independence (no training on the test) | Frozen tasks, inputs, and answers are pinned at L0 before the L2 change. L2 must not read frozen answers to author the candidate, must not add frozen tasks to the learning content, and evaluation tasks stay independent of selection decisions (`runtime/adaptive/LEARNING.md:128-130`). Violation voids the cycle. |
| F2 | Versioned + immutable per cycle | `frozen_version` = `{git_base_SHA, task_manifest_SHA256, scorer_SHA256}`. Any edit to tasks or scorer creates a new version; L1 and L3 must share the identical version or the delta is void. Temporal/provenance scope S bounds which lineage a claim may cite (`docs/drafts/meta/neural-handles-scopes.md:46`). |
| F3 | Small enough to run every cycle | The whole set re-runs at L1 and L3 of every cycle. Size and timeout cap = owner decisions D1–D2; if a cycle cannot afford both runs, it does not start. Width caps/waves discipline applies (`docs/drafts/meta/neural-handles-scopes.md:68-69`). |
| F4 | Covers correctness + cost | Each task records pass/fail under the fixed scorer plus cost: wall time and, where available, steps/agent-calls. Cost unit/weights = owner decision D2. Prior pilots report both (e.g. 74/74 identical code with 13.773s vs 4.608s; 652/652 with 60.711s vs 70.785s as observations, not causal estimates — `runtime/adaptive/LEARNING.md:106-114,173-180`). |
| F5 | Fixed scorer | One deterministic scorer revision per frozen version: same inputs → same verdicts; evidence digests recorded per run. Verdict vocabulary GREEN/YELLOW/RED is fixed and GREEN is never acceptance (per `docs/drafts/meta/neural-handles-scopes.md:28` citing the op convention). Scorer identity (path + revision + toolchain id) is recorded in `baseline.json` / `remeasure.json`. |

---

## 5. ROLES — what runs automatically vs what stays human

| Automatic ( standing authority, no per-step approval) | Human-gated (never automatic) |
|---|---|
| Run the whole L0–L4 cycle: freeze, baseline, learn-draft, re-measure, delta report | Acceptance of this loop spec itself (named human, exact revision) |
| Feature-branch commits on `learn/<cycle-id>` and `revert/<cycle-id>` (standing auto authority) | Merges to main (including reverts) |
| Engram memory ops within agent-scoped write path (standing auto authority; owner-scope resolved agent-scoped-only — `docs/drafts/meta/self-improvement-and-scale.md:132-141` S2) | External publishes / sends (reviewed publication path only) |
| Quarantine writes under `quarantine/<cycle-id>/` | Spend / budget changes; frozen-set content, scorer, and cost-unit decisions |
| Cycle-dir artifact writes (the five JSON files + evidence refs) | Promotion of any candidate to durable law/test/op; tombstone re-admit |

Boundary: agents draft, humans accept; proposer ≠ checker; no agent accepts its own artifact, resolves a job, merges, publishes, or sends externally (per `docs/drafts/meta/neural-handles-scopes.md:72-75`; loop at `docs/drafts/meta/self-improvement-and-scale.md:121-131`). Everything not listed under automatic is gated.

---

## 6. CHECKABLE ACCEPTANCE CRITERIA FOR THE LOOP

| # | Criterion | Check |
|---|---|---|
| A1 | This spec exists at `docs/drafts/meta/self-learning-loop.md` with §§1–6 + owner decisions, draft banner, no invented claims | `test -f` + grep `## 1.` … `## 6.` + `OPEN OWNER DECISIONS` + `unverified`; grep for customer/metric language returns nothing |
| A2 | Loop is executable as specified: five steps with named inputs/outputs and void-if-no-re-measure rule | grep `L0` … `L4` + `skips re-measurement is not a learning cycle`; cycle dir holds the five named JSON files |
| A3 | Learning-vs-noting labels enforced: no `LEARNING` record without `baseline.json` + `remeasure.json` on identical `frozen_version` | grep `LEARNING:` + `NOTING:`; script asserts every `LEARNING` dir has both files with matching `frozen_version` |
| A4 | Gate admits only non-regressing score with score-gain or equal-score cost-reduction; regressing/equal-cost content quarantined, never merged | grep `ADMIT` + `QUARANTINE`; `delta.json` fixtures: admitted case (`S_c>S_b`), cost-win case (`S_c==S_b, C_c<C_b`), quarantined regression case; `git log --oneline` shows no quarantined SHA merged |
| A5 | Rollback exact: base SHA + pre-merge SHA recorded; revert branch + re-measure recorded | grep `git revert` + `M_pre` + `revert/<cycle-id>`; drill dir shows `candidate.json` with `parent_R_base` and post-revert `delta.json` |
| A6 | Frozen set meets F1–F5: versioned, independent, small, correctness+cost, fixed scorer | grep `F1` … `F5`; `frozen.manifest.json` carries `{git_base_SHA, task_manifest_SHA256, scorer_SHA256}`; L1/L3 versions match; cost fields present |
| A7 | Roles respected: auto ran the cycle on branches + engram ops; human gated spec acceptance, main merges, publishes, spend | grep `Standing auto authority` + `Human-gated`; repo shows cycle commits only on `learn/*` branches and no main merge / publish / send from the trial run |
| A8 | Draft-only boundary: human owns outcome; prior zero-benefit findings retained as evidence, not success | file states human owns outcome; cites `runtime/adaptive/LEARNING.md:76-80,99-114,173-188`; repo shows no commit/publish/send from this drafting task except this file |

---

## 7. Numbered OPEN OWNER DECISIONS

1. Owner + independent reviewer for this loop spec (named humans); acceptance revision id.
2. Cost unit + weights (wall time vs steps vs agent-calls) and tie-break precision for the gate (blocks §3–§4 enforcement).
3. Frozen-set content v1: task list, input hashes, controls (frozen / no-memory / stale / irrelevant per `runtime/adaptive/LEARNING.md:93-97` — **unverified** live here), and size/timeout cap (blocks F3).
4. Scorer identity v1: scorer path + revision + toolchain-id capture + GREEN/YELLOW/RED mapping (blocks F5).
5. Cycle/quarantine store locations: cycle-dir root, `quarantine/<slug>/` root, coordinator manifest location (coordinator manifest store itself = open decision per `docs/drafts/meta/self-improvement-and-scale.md:154-170` O3 — **unverified** live here).
6. Branch + merge conventions: confirm `learn/<cycle-id>` / `revert/<cycle-id>` naming, main-merge approver, and whether `git reset --hard M_pre` replacement is ever allowed given remote protections.
7. First funded learning target (S1–S6 at `docs/drafts/meta/self-improvement-and-scale.md:132-141`) to trial this loop on, and its frozen budget.

Non-claims: no frozen set, scorer, cost unit, or cycle runner is claimed implemented beyond the paths cited; tombstone and structured-merge semantics remain proposals; prior scores quoted (128/128, 136/136, 74/74, 652/652) are retained evidence from `runtime/adaptive/LEARNING.md`, not claims of this loop.
