# DRAFT — Mundus runtime proposal: architecture, ownership, and the learning loop

Status: draft, agent-authored · Updated: 2026-09-22 · Owner/reviewer: Shubham ·
Coordinator: `@meta` (single writer of one private Lorenz snapshot lineage).
**Not published, not sent, not merged. No external effect and no publication
authority. Written for human review.**

Re-authored on 2026-09-22 after the concurrent worktree sync that destroyed the
prior draft (`.local/engram/incident-sync-wipe.md`). This is a proposal; a named
human accepts a specific revision. Nothing here is acceptance.

Source of truth read for this draft: `.local/engram/mundus-runtime-2026-09-22.md`,
`.local/engram/async-scale-self-improvement.md`,
`.local/engram/incident-sync-wipe.md`, `.local/engram/diffusion-retrieval-kernel.md`,
`.local/engram/engram-write-path.md`,
`docs/drafts/meta/op-dispatch-convention.md`, `runtime/adaptive/META.md`,
`runtime/adaptive/LEARNING.md`, `runtime/adaptive/HARNESS.md`,
`runtime/worker/BUZZ.md:127-139`, `docs/WORKTREE_LIFECYCLE.md`.

**Unverified at drafting time.** `runtime/worker/diffusion.bend` and
`runtime/worker/history.bend` are being re-authored by other agents in this same
worktree. Their presence, line counts and digests below are **prior/lost-copy
facts from the engram, not a claim about the current files.** The same applies to
`docs/drafts/meta/diffusion-retrieval-laws.md` and
`docs/drafts/meta/buzz-mem-history-laws.md`, which are in progress elsewhere.

## 1. Outcome and owning scope per surface

The outcome: one runtime where capability is added as data (a file), memory is
task-scoped and durable, checks are independent and compiler-enforced, and the
delegation shape is a learned policy — with no service, daemon or framework added.

| Surface | Owns (authority) | Does not own (must not) | Evidence |
|---|---|---|---|
| **Buzz engram** | Durable memory and events; retained, attributed summaries. | Not an unrestricted shared pool; not a snapshot merge; not verified truth. **Agent-scoped writes only** (verified 2026-09-22: relay rejects owner-scope, `agent-engram event must have exactly one p tag`). | `BUZZ.md:127-139`; `.local/engram/engram-write-path.md`; `.local/engram/mundus-runtime-2026-09-22.md:34-35` |
| **Bend** | Pure kernels and compiler-checked laws; the pure decision over handed-in values. | No IO, network, clock, subprocess, directory creation or hashing from the kernel. | `op-dispatch-convention.md:82-99`; `diffusion-retrieval-kernel.md:14-16` |
| **Program files** | Ops — one self-contained file per capability (Bend op / workflow YAML / prompt bundle). | Op logic must not live in the driver or a registry edit. | `op-dispatch-convention.md:23-38,159-181` |
| **git** | Accepted revisions; the single revision authority. Worktree/branch = disposable candidate. | Learning is never the worktree. No silent rewrite of accepted revision. | `WORKTREE_LIFECYCLE.md:23-40` |
| **Harness** | Orchestration: one coordinator, one writer of the private Lorenz snapshot lineage. | No distributed exclusive claims, no auto-merge, no auto-send/publish. | `META.md:45-79`; `HARNESS.md:87-96` |

## 2. The five principles (each with mechanism and a falsifiable claim)

| # | Principle | Concrete mechanism | Falsifiable claim (fails if...) | Status |
|---|---|---|---|---|
| P1 | Memory is task-scoped, not ambient. | Diffusion `retrieve` filters to the IN-SCOPE set **before** top-K, so an out-of-scope node may carry internal activation but is never returned. Core engram is the only default injection; other slugs require explicit retrieval. | A node outside `scope` is returned for any anchor/step budget. (Negative fixture, criterion d.) | Design + reported law on the lost copy; re-verify on re-authored kernel. |
| P2 | Retrieval is diffusion, not lookup. | Activation spreads over the memory graph from task anchors for exactly `steps` rounds under a per-round `node_budget` cap; integer fixed point (scale 8, decay 4). Not a full scan. | Two runs with the same graph/anchors/steps — including edge/anchor reorderings — return different rankings. | Design + reported determinism law; re-verify (criterion b). Prior state was bounded lexical matching (`LEARNING.md:86-88`). |
| P3 | Kernels and ops are programs, not code paths. | One op file declares typed `Input -> Output` + named laws; adding capability adds a file and touches no runtime/driver source. | Adding an op produces a non-empty diff under the harness/driver source. (Criterion e.) | Contract specified; registry listing + driver **not implemented** (`op-dispatch-convention.md:219-221`). |
| P4 | The runtime is the learning loop; delegation shape is a policy learned from outcomes and stored as data. | A policy parameter (e.g. default fan-out cap / wave size) is a stored value the coordinator reads; Lorenz `learn`/`correct` is the substrate. | A policy-parameter change cannot be attributed to a named run or cannot be reverted. (Criterion f.) | Partial: Bend `learn`/`correct` implement part of the loop (`HARNESS.md:61-65`); policy store = open decision 3. |
| P5 | Complexity is the currency — cost to minimize or fuel to spend deliberately. | Each run records a complexity cost (subtask count, agent count, node budget, steps, optional weighted scalar); the run reports it. | Repeated identical tasks show non-decreasing cost **without** an accuracy gain, or an accuracy loss at lower cost. (Criterion g.) | Unit unresolved (open decision 4); not yet measured. |

## 3. The architecture loop

Anchors → op selection → capped delegation shape → scope-gated diffusion read →
predict/propose → independent checks → return + complexity cost → learn/correct →
reuse → policy update.

| Step | Input | Mechanism | Output | Check |
|---|---|---|---|---|
| 1. Anchors | Task + acceptance | Caller supplies `DTask{anchors,steps,scope}`; anchors = task-relevant memory ids. | Anchor set | Open decision 2 (what anchors a task). |
| 2. Op selection | Anchors + task | Coordinator derives a selector key from the op header, matches a static listing (`op name -> role`). No daemon. | Chosen op file | `op-dispatch-convention.md:159-181`. |
| 3. Capped delegation shape | Op + task | Policy decides fan-out depth/breadth; **complexity budget recorded before fan-out**. | Delegation plan + budget | Criterion g; File 2 §B. |
| 4. Scope-gated diffusion read | Graph + anchors + budget + scope | Exactly `steps` rounds, `node_budget` cells/round, in-scope filter before top-K. | Ranked in-scope memory | Criteria b, c, d. |
| 5. Predict / propose | Retrieved evidence | Propose a candidate and a **stated prediction** of its outcome; surprise = prediction vs observation. | Candidate + prediction | `HARNESS.md:81-85`. |
| 6. Independent checks | Candidate | Compiler check, fixture run, held-out/negative fixtures — run by an actor other than the proposer. | GREEN/YELLOW/RED verdict | `op-dispatch-convention.md:142-157`. |
| 7. Return + complexity cost | Checks + run | `return` records reported result; run records measured complexity cost. A GREEN is never acceptance. | Attributed result + cost | `META.md:93-102`. |
| 8. Learn / correct | Selected result | Explicit `learn` (not implicit); corrections invalidate dependents. | Learned finding | `META.md:102-112`. |
| 9. Reuse | Fresh task | Retrieve the finding **without the original conversation**; measure the difference. | Reuse receipt | `HARNESS.md:70`; `LEARNING.md:182-188`. |
| 10. Policy update | Reuse outcomes | Update the stored delegation-policy parameter, attributed and reversible. | New policy value | Criterion f. |

## 4. Non-goals

- No auto-send, auto-publish, auto-merge, auto-accept or auto-resolve; a named
  human accepts the exact revision.
- No secrets, keys or session transcripts in artifacts; no credentials in args or
  memory content.
- No model weight training; saved text alone is not learning.
- No revival of the retired JavaScript registry / lifecycle / sync stack
  (`HARNESS.md:27-35`).
- No unbounded fan-out; no daemon, scheduler service or agent framework.
- git remains the revision authority; Buzz memory does not merge Bend snapshots.

## 5. Acceptance criteria

These are checkable criteria for the runtime proposal, not for this prose draft.
`bend` = `BEND_NO_TELEMETRY=1 ~/.bend/bin/bend` (tested 2.0.21).

| # | Criterion | Check |
|---|---|---|
| a | **Checker passes.** Every named kernel at the accepted revision checks clean. | `bend <kernel> --check-only` → `All terms check.` (exit 0) for each kernel (`system.bend`, re-authored `diffusion.bend`, re-authored `history.bend`); plus a mutated-law copy that fails (exit 1). |
| b | **Deterministic diffusion.** Ranking is a pure function of graph/anchors/steps. | Two runs, including edge/anchor reorderings, are byte-identical. |
| c | **Bounded node budget.** No round exceeds `node_budget`; total work is bounded by `steps × node_budget`, not graph size. | Instrumented count per round ≤ budget; a graph far larger than the budget still terminates in `steps` rounds. |
| d | **Scope-gating with a negative fixture.** Out-of-scope nodes never returned. | Fixture where an out-of-scope node would rank highest if admitted; asserted absent from `retrieve` output. |
| e | **Programs-as-data; empty harness diff.** A new op adds a file only. | Add one op file; `git diff --name-only` shows no change under `runtime/adaptive/` or the driver source. |
| f | **A delegation-policy parameter changes, attributed and reversible.** | Change the stored parameter; the change records the run/policy id; reverting restores prior behavior. |
| g | **Complexity cost reported and reduced across repeated tasks without accuracy loss.** | Same frozen task repeated: cost non-increasing while accuracy holds; record both, retain counterexamples. |

## 6. Rollback (git)

- Each candidate is a branch created from committed HEAD in its own worktree;
  the worktree is disposable and is not where knowledge lives
  (`WORKTREE_LIFECYCLE.md:15-33`).
- Accepted revision lives on `main`. To roll back an accepted change, revert to
  the previous revision by ordinary git history (`git revert` or a merge-from-
  previous-revision); no silent rewrite of history.
- Buzz memory is **not** rolled back by git; corrections use explicit `correct`
  and dependent invalidation, and engram edits use `patch --base-hash`.
- A RED or rejected candidate is discarded with its worktree; it is a failed
  experiment, not a revision.

## 7. Open owner decisions (unresolved)

1. Where the diffusion graph lives (engram edges / Bend lineage / derived index).
2. What anchors a task.
3. Where the learned delegation policy is stored.
4. The unit of "complexity cost" (and any weights).
5. Which ops become programs first.
6. Whether diffusion runs inside Bend or as a program over Bend output.
7. Who ports `runtime/programs/retrieval/*` from Bend 2.0.5 to 2.0.21 (the known
   gap: `graph.bend:60`, `(a + b : Nat)`).
8. Default `policy_cap` and wave size for delegation (see File 2 §B).
9. Whether `runtime/worker/diffusion.bend` or `runtime/programs/retrieval/*` is
   the authoritative retrieval kernel.
10. The five-entity/state vocabulary and whether a real `status IN` reader ships.
11. Named owner and independent reviewer for the runtime proposal.

## 8. Open limitations (do not claim)

- The integrated runtime is **not wired**; kernels check, orchestration is
  specified only (`mundus-runtime-2026-09-22.md:3-4`).
- The op registry listing and driver are specified, not implemented.
- `runtime/programs/retrieval/*` currently fails on Bend 2.0.21 (known gap).
- D1-D5 doc-vs-code drift is reported, not fixed (`world-model.md:80-90`).
- No distributed exclusive claims, no cross-worktree merge safety, no
  Buzz↔Bend automatic sync.
