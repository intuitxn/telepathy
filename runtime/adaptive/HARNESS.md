# One repository, one Bend core

The working harness is a program interpreted by `runtime/system.bend`. The same
file contains candidate selection, a finite latent-world experiment, worker claims
and local correctable memory.
Use the [harness guide](../harness/README.md) for runnable examples, the small DSL,
its three equations, effect bindings and evaluation commands.

## Responsibilities

| Piece | Responsibility |
|---|---|
| `runtime/system.bend` | Typed programs, bounded control flow, replay and selection rules; worker and memory transitions |
| `runtime/harness/run.py` | A command-line effect adapter; invokes existing executables, records results and feeds statuses back to Bend |
| OpenCode | Configured model calls and native agent execution |
| Buzz | Existing coordination and selected persistent engrams |
| Independent evaluator | Scores final outputs; candidate programs cannot rewrite its expected answers |

There is no second registry, learning service, agent manager or repository.
The Python driver contains no DSL control-flow interpreter. It checks the source,
builds Bend's generated JavaScript backend and asks Bend for each next effect through
Bun. The build cache is local to this repository.

## Use the system

1. **Run** a harness with fixed bindings and a task.
2. **Inspect/replay** the recorded effects without calling the model again.
3. **Propose** a program edit using the configured model and aggregate feedback.
4. **Compare** the incumbent and candidate with the same evaluator and bindings.
5. **Evolve** for a bounded number of local rounds, retaining each decision.
6. **Retain** the measured result, including failures. Choosing the program for
   future work is an explicit repository change.

`propose` creates an unevaluated candidate. `compare` emits a Bend admission
decision; neither silently replaces the incumbent. `evolve` repeats these steps
for at most eight rounds and keeps accepted edits in a local result file. The present
selector is a conservative RRSI-inspired rule. Calibrated noise, leakage criticism,
and transfer gains beyond a tiny example remain unestablished. An optional
disjoint-input holdout is measured once after selection. See the
[guide](../harness/README.md) for exact score, cost and edit-count definitions,
and [paper-method comparison](../harness/PAPERS.md) for the world-model boundary.

For delegated engineering work, use standard OpenCode `/meta agents` or the
host's native task interface and the [worker protocol](META.md). A single
coordinator owns each immutable snapshot lineage. `return` records a report;
`learn` is a separate attributed transition. Neither is a correctness certificate.
Native OpenCode ACP and [Buzz setup](../worker/BUZZ.md) remain available without a
fork or additional server. Live key isolation remains a deployment concern,
not a property established by these local programs.

## Evidence and history

Run the Bend checker and independent behavior tests after changing the core.
Bind results to the source, evaluator and inputs. Named laws establish their
stated properties only; model quality requires measurement on independent tasks.
Saved memory does not update model weights. Preserve counterexamples and failed
comparisons rather than retaining only successful runs.

[LEARNING.md](LEARNING.md) retains earlier positive and negative experiments.
The retired JavaScript registry/lifecycle/sync implementation remains recoverable
at `d7a6c7b0930f6d91b691e58df84b775479380c0d`; existing private registry data and
receipts are preserved, not migrated into Buzz. The [historical A2A plan](../../docs/designs/a2a-protocol.md)
is optional federation work, not a prerequisite for this local harness.

Shared publication uses the existing owner-controlled Buzz host and the exact
reviewed payload. Local implementation and evaluation do not require publication.
