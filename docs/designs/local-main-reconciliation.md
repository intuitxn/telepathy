# Reconcile local main with the DSH machine

Status: two-parent source integration candidate. Its parents are local `main`
`35e602d98c0cec37fa28250b7a18433e3c5284e7` and the DSH source
`10d077a74cd472ec188f342214d292a02dcd43ea`, which descends from remote
`main` `89ab36c8d28c048090b90fc94e810197ae72bb62`. The merge resolution
selects the DSH source tree after the explicit ports and retirements below.
Both histories remain reachable. Shared ancestry does not prove preservation
of every local-main behavior, and the `main` bookmark is not moved by this
source candidate.

Select a small active machine by behavior, not by copying every old module.
Each local-main capability needs a checked port, historical archive, or an
explicit decision that it is outside the requested core.

| Local-main capability | Disposition | Acceptance check |
| --- | --- | --- |
| `runtime/worker/diffusion.bend`: scoped graph activation and ranking | A selected bounded subset is ported into `runtime/core/telepathy.bend`; host-only `scoped-context.mjs` maps its IDs to source-linked refs at an exact controller cut. PPR, lexical fusion, full provenance, and timing noninterference are not claimed. | Kernel cases include out-of-scope bridge and fanout; one fixed diagnostic comparison favors diffusion. Matched tasks and total compute remain before live selection. |
| `runtime/programs/retrieval/`: multi-file CSR/PPR/lexical-fusion spike | Retire from active runtime. Its exact 2026-09-18 source and `REPORT.md` remain in jj revision `a19b016847a1a2b5551d75c55a4b18f0e2f222ec`; the six-file spike is not a one-file DSH candidate. The DSH `diffuse` path above retains only the checked bounded scoped subset. PPR, lexical fusion, and the spike's five laws are historical experiments, not active capabilities. | No runtime caller or current checker imports the spike; `scripts/check.mjs` rejects its return. Bend 2.0.21 failed at `graph.bend:60` before retirement. Check the active one-file kernel and its scoped-context cases instead. |
| `runtime/ops/ctx.bend`: static bounded context inventory | Retire that static inventory. The DSH controller selects source-linked context refs at a causal cut with a token cap; the Bend `diffuse` result is a pure candidate ranking, not a replacement for the host grant. | Exact refs, deterministic order, cap, and omission report in host receipts. |
| `runtime/worker/system.bend` and history: claims, results, explicit learning | DSH task controller owns grants, immutable parents, independent settlement, and feedback. Keep old source and receipts as historical evidence, never two live writers on one task. | Replay, unknown-call recovery, unauthorized result rejection, correction retention, fresh-session read. |
| `runtime/ops/fold.bend`, `status.bend`, op driver, old local loops | One-file algorithm candidate plus source digest, Bend check, bounded run, independent score, and exact jj adoption gate. Old revisions remain examples, not a second scheduler. | A failing-law counterexample blocks execution or adoption. |
| Resident `runtime/meta_shell.py`: queue, ACP, CLI/MCP, snapshots, jj workspaces | Thin host-owned DSH ingress/status adapter with reviewed task profiles. Preserve old service/state as archival sidecar. ACP IDs do not resume in DSH. | Idempotent submit/status/list, no replay of uncertain calls, separate private state, coherent old-state backup, reversible switch, preserve reviewable workspaces. |
| `plugins/telepathy-meta-agents/registry.json` and activity CI | Retain the five planned interface records and accepted activity projection as documents, without claiming a Desk runtime. The CI workflow and exact checker run `scripts/validate-projections.mjs`. | The catalog paths and activity format validate; the workflow invokes an existing script. A catalog entry is not a funded DSH agent. |
| `plugins/telepathy-mailbox`, Buzz relay intake, JTBD workflow | Retire automatic relay intake from the local core. Optional `scripts/setup-programs.sh` can set up channels and notes, but does not install the unsupported approval workflow or grant DSH tasks. | No retired workflow or Desk config instructions in the setup script; operator guides link the local reviewed-profile ingress. Network delivery remains outside task authority. |
| `feat/adaptive-observation-loop` branch | Keep as a narrow synthetic max-of-three policy experiment. The DSH event clock and feedback are the active general mechanism. | Fresh-task unchanged-clone comparison at equal total compute before self-edit selection. |
| `knowledge-computation-v0` branch | Keep as a design candidate. Port task-derived capability *contracts* to the checked DSH catalog; do not import its OpenCode tool IDs. Networked CRDT/nodes stay outside local core. | Held-out retrieval, computation and combined tasks; typed authority; no unverified memory admission; quality per total compute. |

## State, time, and potentia

The host freezes goal, acceptance, authority, evaluator, scope, budget, and
source head. Each event has a causal parent. Sequence measures progress in one
lineage; wall time and provider cost are separate measurements. State is the
bounded replay of admitted events. Potentia is the finite set of distinct
admissible next actions, with proposed cost and discriminating prediction.
Neither a model assertion nor a simulator output changes accepted state by
itself. An observed result plus independent verdict updates the frontier at
the next causal cut.

```text
frozen task + causal cut -> scoped retrieval/diffusion -> finite frontier
  -> funded prediction/action -> archived observation/verdict
  -> accepted state, revised frontier, or explicit unknown
```

The machine is local and state-independent of network transport. Federation,
mailbox delivery, and nodes can later carry attributed proposals; they cannot
grant local authority or mark a claim accepted. One-file Bend candidates own
pure computation; the DSH host owns credentials, effects, archives, budgets,
and independent verifiers. An executable one-file algorithm is not the whole
trusted machine compressed into one file.

## Migration gates

1. Check the exact two-parent revision after scoped diffusion/context,
   resident ingress, CI, and operator docs are combined. Child receipts do not
   prove the combined source.
2. Compare retained behaviors against local-main fixtures. Name intentional
   retirements; the new gate need not keep checking retired kernels after
   equivalent capabilities have been checked or retired.
3. Separately review changed gate, checker, and protected inputs. `jj fix`
   may transform source, but a rewrite invalidates its old receipt. Jujutsu
   has no native pre-commit hook; exact-revision adoption is the control gate.
4. Install the reviewed release without switching the old service. Trial a
   funded DeepSeek Flash turn and independent oracle on separate private state.
5. Freeze old intake; back up its SQLite state coherently with sidecars; keep
   historical sessions and reviewable workspaces accessible; switch ingress
   deliberately with a rollback path. Never import an old reported job as
   accepted DSH knowledge without its independent verifier.
6. Compare unchanged and self-edited agents on fresh tasks at equal total
   compute before selecting a harness or algorithm improvement.

The 10,000-agent target bounds logical task contracts admitted in pages.
Physical sessions remain a small funded pool limited by verifier, integration,
provider, and workspace capacity. Missing sources, instruments, oracles, or
budget remain recorded needs and leave affected claims unknown. Agent count
is not a score for scientific progress.
