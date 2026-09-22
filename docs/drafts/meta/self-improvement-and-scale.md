# DRAFT — Async delegation, scale policy, and self-improvement

Status: draft, agent-authored · Updated: 2026-09-22 · Owner/reviewer: Shubham ·
Coordinator: `@meta` (single writer of one private Lorenz snapshot lineage).
**Not published, not sent, not merged. No external effect and no publication
authority. Written for human review.**

Re-authored on 2026-09-22 after the concurrent worktree sync that destroyed the
prior draft (`.local/engram/incident-sync-wipe.md`). This is a draft spec; a
named human accepts a specific revision. Nothing here is acceptance.

Source of truth: `.local/engram/async-scale-self-improvement.md`,
`.local/engram/incident-sync-wipe.md`,
`.local/engram/mundus-runtime-2026-09-22.md`,
`.local/engram/engram-write-path.md`, `.local/engram/op-dispatch-convention.md`,
`docs/drafts/meta/op-dispatch-convention.md`, `runtime/adaptive/HARNESS.md`,
`runtime/adaptive/META.md`, `docs/WORKTREE_LIFECYCLE.md`,
`docs/drafts/meta/world-model.md`.

Everything below is a proposal. Where a number or unit is not decided, it is
marked **owner decision** rather than invented.

## A. Async delegation protocol

Coordinator-only orchestration over the primitives that already exist. No new
service is introduced.

### A.1 Mailbox contract

| Actor | Does | Tool | Bound |
|---|---|---|---|
| Coordinator | Spawns work; places each subtask on a distinct output; reads replies and unblocks. | Task tool / server session; `telepathy_inbox` | One writer of the snapshot lineage. |
| Worker | Executes one bounded subtask; returns the artifact to the coordinator (never merges it). | `telepathy_send` to report; `telepathy_status` to publish state | Does not race to mutate/fork the snapshot. |

Telepathy is **coordination only, never durable memory** (coordinator manifest +
sync). Mailbox state survives only as the manifest the coordinator records.

### A.2 Coordinator manifest

One row per subtask; the coordinator owns the manifest and is its only writer.

| Field | Meaning |
|---|---|
| `subtask_id` | Stable id for one unit of work. |
| `deliverable` | The exact artifact expected (path or value). |
| `acceptance` | The single check that decides pass/fail for this subtask. |
| `owned_files` | Files this subtask may write; must be distinct from every other row. |
| `owner` | Acting agent/session for the subtask. |
| `state` | `proposed → running → returned → checked → merged` (or `stalled`/`failed`). |
| `budget` | Complexity budget allocated to this subtask (unit = open decision 1). |

### A.3 Shared-file-free merge

- Each subtask writes only its `owned_files`. No two rows share a file.
- Workers **return** artifacts; the **coordinator merges** them into one
  attributed artifact. No worker writes the merged output.
- git remains the revision authority; the coordinator commits the accepted
  revision, per `WORKTREE_LIFECYCLE.md:15-40`. A worktree is isolation, not a
  sandbox — claims, not branch locks (`op-dispatch-convention.md:105-119`).

### A.4 Backpressure

| Condition | Detection | Handling |
|---|---|---|
| **Stall** | No `state` advance within the subtask budget/timeout. | Re-read inbox; if still silent, escalate to coordinator. Re-spawn vs escalate = open decision 4. |
| **RED verdict** | Check returns RED (checker error, TODO in proof, missing toolchain, launcher failure). | Stop the subtask; do not merge; record evidence; any RED exits nonzero (`op-dispatch-convention.md:142-157`). |
| **Claim collision** | Two rows resolve to the same `owned_files` or worker claim. | Reject the later claim; reassign distinct files; preserve the first. |
| **Budget exhaustion** | Recorded spend reaches the row `budget`. | Pause the subtask; return partial state; do not borrow another row's budget silently. |

### A.5 Non-goal

No daemon, scheduler service, or agent framework. Delegation is a
coordinator-and-manifest discipline over the existing Task tool, telepathy
mailbox and worker `claim` semantics (`op-dispatch-convention.md:159-181`).

## B. Scale policy (the "~10^4 agents" question)

### B.1 Budget before fan-out

- The **complexity budget MUST be recorded before fan-out** (subtask count, agent
  count, node budget, steps, optional weighted scalar). Exact unit = open
  decision 1.
- Fan-out is permitted **only** for subtasks that are (i) independent, (ii) have
  exactly one acceptance check, and (iii) own distinct files.
- If delegation width `D > cap`, run in **waves** of `cap` (default cap and wave
  size = open decision 2); each wave's budget is recorded before it starts.

### B.2 Scale failure modes and mitigations

| Failure mode | What happens | Mitigation |
|---|---|---|
| Claim collision | Two workers claim the same file/subtask. | Distinct `owned_files` per row; reject later claim; re-read manifest. |
| Merge explosion | Coordinator cannot combine N divergent outputs. | Coordinator-only merge; shared-file-free rule; cap width per wave. |
| Context loss | A worker lacks the evidence it needs. | Hand each subtask its brief + explicit memory; telepathy is transport, engram is durable. |
| Cost runaway | Spend grows with fan-out, not with real work. | Budget recorded before fan-out; backpressure on exhaustion; measure cost per run. |
| Partial-failure recovery | Some subtasks fail, some return. | Row states isolate failures; RED halts its row only; coordinator merges only checked rows. |

### B.3 ~10^4 is a budgeted capability, not a default

- ~10^4 agents is a **BUDGETED capability**: it is bounded by cost unless the work
  is genuinely independent (complexity as fuel). Independence is required — a
  task that cannot be split into distinct-file, one-check subtasks must not be
  fanned out to hit a number.
- Concurrency is not claimed to be safe by default: current local laws do **not**
  provide distributed exclusive claims, merge safety or global ordering
  (`HARNESS.md:87-91`; `META.md:70-73`).

## C. Self-improvement and stabilization

### C.1 What "stabilization" means

Stabilization = converting an observed instability into a **durable check or
program**, asserted by artifact type. A prose note is not stabilization.

| Artifact type | Form the stabilization takes | Asserted by |
|---|---|---|
| Bend law | Named law + proof of the same name | `bend <file> --check-only` → `All terms check.` |
| Test | Executable test over an exact input | test runner exit code |
| Dispatched op | Op file + fixture in its own worktree | op gate + fixture run |

### C.2 The loop

```
observe → attribute → detect instability → propose a stabilization (draft)
  → independent check → human review → project
```

Nothing self-accepts. The proposer is never the independent checker; only a named
human reviews and promotes the exact revision (`HARNESS.md:48-53,93-96`;
`WORKTREE_LIFECYCLE.md:35-40`).

### C.3 Current stabilization targets

| # | Target | Instability observed | Stabilization artifact type |
|---|---|---|---|
| S1 | **Retrieval authority 2.0.5 → 2.0.21** | `runtime/programs/retrieval/*` was authored for Bend 2.0.5 and fails on 2.0.21 (`graph.bend:60`, `(a + b : Nat)`). | Port + Bend laws re-checked on 2.0.21; decide authority vs `diffusion.bend`. |
| S2 | **Owner-scope engram write** | **Resolved:** engram writes are agent-scoped only; relay rejects owner-scope (`agent-engram event must have exactly one p tag`). | Durable test/assertion on the write path (agent-scoped). |
| S3 | **Missing op driver** | Registry listing + driver specified, not implemented. | Dispatched op + driver code; empty harness diff when adding an op. |
| S4 | **Unreviewed status vocabulary** | Five-entity/state vocabulary proposed but unratified; no real `status IN` reader. | Owner decision + assertable status op. |
| S5 | **Doc drift D1–D5** | Doc-vs-code contradictions (`world-model.md:80-90`), reported not fixed. | Corrected docs + a check that catches each drift class. |
| S6 | **Durability against concurrent sync** | Concurrent worktree sync wiped untracked work (`incident-sync-wipe.md`). | Durability rule as an enforced check: artifact is not "done" until committed on a branch OR written to the Buzz engram; one writer per worktree. |

### C.4 Measurement

- Evaluate **before/after on a frozen task set** (tasks frozen before the change),
  with attributed evidence: source revision, contract, checker output, concrete
  inputs/results, toolchain identity, and measured cost.
- Retain **counterexamples** and negative results; a note alone is not
  improvement (`HARNESS.md:72,81-85`; `LEARNING.md:99-104,173-180`).
- Do not claim a learning benefit from a single trial; the recorded cross-harness
  and workflow-transfer experiments showed **zero accuracy gain** (74/74 and
  652/652 both arms) — retain them as evidence, not as success.

## Open owner decisions (unresolved)

1. Complexity-cost unit and weights.
2. Default `policy_cap` and wave size.
3. Where the coordinator manifest lives.
4. Stall policy (timeout; re-spawn vs escalate).
5. Authoritative retrieval kernel (`runtime/programs/retrieval/*` vs
   `runtime/worker/diffusion.bend`).
6. Owner-scope engram write — **resolved 2026-09-22: agent-scoped only**.
7. Status vocabulary (five-entity/state set) and whether a `status IN` reader
   ships.
8. Which stabilization targets S1–S6 are funded first.
9. Measurement plan for the frozen task set (tasks, controls, budgets).
10. Durability rule enforcement point (pre-commit hook vs coordinator check vs
    both) for S6.
11. Named owner + independent reviewer for this spec.

## Open limitations (do not claim)

- The delegation driver, registry listing and manifest store are specified, not
  implemented.
- No distributed exclusive claims, merge safety or global ordering.
- Telepathy proof-of-concept and telepathy mailbox are coordination transport;
  they are not durable memory.
- `runtime/worker/diffusion.bend` and `runtime/worker/history.bend` are being
  re-authored; their current state is unverified at drafting time.
