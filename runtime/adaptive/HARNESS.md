# Mundus: Buzz-native harness

Use standard OpenCode directly and its native ACP interface with Buzz's existing
agent harness, memory and workflow DSL. Our executable logic stays in Bend; no
oc2 fork, beta build, custom learning service, or port 4110 service is required.
Start with [Buzz and Bend](../worker/BUZZ.md), or use the same direct
[worker protocol](META.md) from another process-capable harness.

The [A2A plan](../../docs/designs/a2a-protocol.md) preserves the historical oc2
M1–M8 roadmap; those milestones are not prerequisites for the active baseline.
Federation and Lamport wiring are deferred until an actual multi-node need.
Local Lorenz memory and published NIP-AE engrams are distinct. Follow
[AUTONOMY.md](../AUTONOMY.md): verified internal memory upkeep and scoped work
continue under existing authorization. Use the existing owning-agent signer;
ask only for actions beyond that authority or explicitly gated by the task.
Credential isolation remains a target requiring deployment verification.

The installed Buzz 0.5.23 CLI exposes native memory commands and its ACP harness
injects core memory by default. Other findings require explicit retrieval. Buzz
owns agent identity, conversation routing and stored engrams. Bend owns the
selected algorithms, laws and explicit local worker/memory transitions.

Before executing or reusing changed Bend code, check its actual source, run the
relevant independent examples and inspect the results. A stored memory or signed
Buzz event is provenance, not a successful compiler check or correctness proof.
Keep source revision, checker output, concrete inputs/results and counterexamples
with the work. Select concise findings for Buzz memory after evaluation.

## Retired JavaScript experiment

The custom registry, Git synchronization, lifecycle, maintenance and OpenCode
delegation stack was removed from the active tree. Its exact implementation,
tests and operational instructions remain at Git commit
`d7a6c7b0930f6d91b691e58df84b775479380c0d` for historical reproduction.
Its bespoke bundle-admission, publisher-trust, revocation and rollback checks
have not been ported to Buzz or Bend. Do not claim that Buzz engrams reproduce
those guarantees.

Existing local registry entries, signing keys, private runs and the remote
`learning/shared-v1` evidence branch are retained. They have not been imported
into Buzz. Historical results in [LEARNING.md](LEARNING.md) and
[evaluation](../evaluation/README.md) describe the implementation used at the
time; they do not establish current automatic synchronization.

Offline Node drivers still check Bend transitions and score saved experimental
answers. They are optional development tools and never run as a learning service.
Desk remains optional and now uses the installed OpenCode CLI. The old custom
plugin source is historical and excluded from the active install and checks.

## What the system should build toward

The target is a system that improves reusable programs and its working methods
from checked outcomes. The LLM proposes changes; execution supplies observations;
independent checks decide which claims survive. Saved text alone is not learning
performance, and self-editing alone is not intelligence or AGI.

Keep one executable Bend file per kernel, starting with `runtime/worker/system.bend`.
Multiple cores may have different contracts and evaluators; add a core only when
an actual task needs it. Host configuration stays ordinary Buzz/OpenCode config.
Do not recreate a registry service, signer, dispatcher or agent framework merely
to connect capabilities the host already provides.

The work loop is: problem + acceptance → retrieve relevant evidence → predict
an outcome → propose a candidate → run independent checks → inspect disagreement
→ retain a selected finding → reuse it in a fresh task → measure the difference.
The full loop is a build target; existing Bend learn/correct transitions implement
only part of it. Session transcripts are not automatically admitted as knowledge.

| Next step | Completion evidence |
|---|---|
| 1. One native Buzz → OpenCode → Bend task | Native ACP session completes a bounded task, Bend checks and independent examples pass, result returns to the correct task. The current initialize handshake alone is insufficient. |
| 2. One finding reused in a fresh session | Capture source revision, contract, evidence and limits; retain the reviewed selection through native Buzz memory; a fresh worker retrieves it without the original conversation and produces a checked result. Record which memory was actually supplied. |
| 3. Correction and stale-memory handling | Introduce a counterexample, correct the local finding, verify dependent local records are invalidated, then verify the published replacement is what the next session retrieves. Buzz and Bend are not automatically synchronized. |
| 4. Independent improvement evaluation | Compare repeated fresh tasks with and without selected memory under matched models, tools and budgets. Hold back test cases; report failures, accuracy, time, tokens and cost. Keep negative results. |
| 5. Bounded self-modification | An agent proposes a kernel, algorithm, routing or problem-formulation change in an isolated candidate. Check source-bound laws and held-out behavior; reject regressions; retain the previous revision for rollback. Existing task authority controls promotion/publication; never fabricate human acceptance. |

A reusable piece needs its problem/contract, source revision, dependencies,
evaluator, measured result, counterexamples and supersession status. This is a
content requirement for selected findings and artifacts, not a new storage
service. Recheck compatibility before reuse; an old successful receipt does not
verify a changed program.

Record surprise as a discrepancy between a stated prediction and observation.
It nominates an investigation, not a causal conclusion. Change the suspected
factor, compare an unchanged control, repeat on new cases, and state confounders
before retaining a causal claim. Improving the problem statement or representation
is a valid candidate, evaluated against the original objective as well.

For parallel work, delegate independent tasks and give each a separate output.
One coordinator writes each Bend snapshot lineage. Do not claim distributed
exclusive claims, merge safety or global ordering from current local laws.
Measure coordination cost before adding more workers; federation/Lamport work
waits for a concrete multi-node requirement.

Promotion and publication remain separate from proposing and testing. Agents may
verify completion and retain supported internal learning within scope; record
human acceptance only when it happened. Workers must not expand authority or
acquire signing credentials. Current shell
environment filtering does not establish filesystem/keychain isolation. Verify
that deployment boundary before claiming a keyless execution node.
