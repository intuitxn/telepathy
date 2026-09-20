# Retained findings and next experiments

This is agent-authored project memory, not a training update or a proof receipt.
Read it before proposing changes; recheck claims against the current source.

## Findings retained from development

- First-item selection fails on `[1,2]`: observed 1, expected maximum 2.
  Preserve this counterexample when changing selection logic.
- A forecast violation alone does not establish cause. The current experiment
  compares reorder interventions with unchanged sham inputs and an exact-kernel
  control before admitting a replacement. This conclusion is fixture-specific.
- Representation changes can be reusable algorithms: the chunked representation
  has a lossless roundtrip and transports the maximum answer and its contracts.
- Reuse requires compatible problem, objective, evaluator, dependency, and source
  context. The current numeric labels are not hashes or authenticated identities.
- Development encountered a stack overflow comparing long source text with
  `String.eq`; native persistence now uses `store_text_equal_go`. Check large
  records when changing this path, not just short strings.
- Native text equality binds decoded UTF-8, not bytes. Bind published evidence
  to an external source SHA256 as well as checker and toolchain identity.
- Separate record directories avoid multiple writers sharing an unlocked file.
  Source changes need a new record; never repair stale evidence by overwriting it.
- Codex can discover the Bend workflow as a skill. Discovery does not enforce
  verification on all edits or connect remote agents automatically.

## What learning currently means

The Bend process chooses among authored kernels, retains a failure and accepted
block evidence, and can restore a block in a later process. Coding agents also
retain these written findings and workflow instructions. Neither mechanism
updates LLM weights or automatically distills every conversation into knowledge.
The fixed author-visible fixtures demonstrate selection, not general learning.

## Implementation sequence for shared learning

### Completed retrieval probe

Two fresh agents with no inherited conversation answered the same six
project-specific questions. Both had tools disabled by instruction and a
300-word answer limit; one additionally received selected retained findings.
The baseline answered unknown to all six; the memory arm answered all six
correctly against an explicit rubric. Raw protocol and answers were retained
locally by the development session; they are not included in this checkout.

This single paired trial demonstrates prompted transfer of retained facts.
The questions directly target those facts; selection and scoring were not
blinded, and the memory was manually supplied. It does not demonstrate
automatic retrieval, better code on unseen tasks, or model training. The
next evaluation must use executable tasks rather than factual recall.

### Remaining implementation

The shared registry now dispatches two cores: adaptive maximum and Lorenz memory.
It snapshots source, runs fresh Bend checks and the selected external evaluator,
saves optional findings, and publishes complete bundles. Retrieval uses bounded
lexical matching. Compaction hardlinks identical payloads without deleting history.
Signed Git sync stages trusted bundles and applies exact-ID revocations; explicit
execution repeats admission. It rejects remote rollback after a local checkpoint.
Structured general episodes, semantic retrieval, live conversation merging,
and a replicated coding-agent learning study remain outstanding.

The recorded transfer run (seed 2571500135) scored 128/128 with compatible evidence
versus 14/128 for frozen/no-memory/stale/irrelevant controls. The always-exact
no-memory control also scored 128/128. This establishes bounded policy transfer
on subsequently generated inputs, not new capability beyond the authored kernels.
See `runtime/evaluation/README.md` for resource caps, hashes, and reproduction.

1. Define an episode schema: problem/contract revision, candidate source digest,
   prediction, observation, intervention/control, counterexample, checker result,
   evaluator/toolchain versions, costs, and provenance. Keep raw conversations
   separate; extract specific claims with supporting evidence.
2. Extend the implemented core-specific admission/evaluators as new contracts
   become available. Preserve independent checks and counterexamples.
3. Scale the implemented lexical retrieval beyond full registry scans, preserving
   core compatibility and exact-revision filtering.
4. Extend the implemented signed Git synchronization with publisher roles and
   key rotation, operational monitoring, and managed retention if needed.
5. Evaluate agent learning on new tasks: compare a fresh agent against one given prior
   evidence at equal resource budgets. Measure correctness, cost, reuse, and
   regressions. Keep evaluation tasks independent of selection decisions.

The executable algorithm, selection rules, and expressible laws can stay in
`system.bend`. Codex, Bend's compiler/Base, storage, hashing, and transport are
external dependencies. Current Base does not supply the subprocess/Git and
transactional storage facilities needed to implement that entire boundary
inside the existing one-file program.

## Session closeout procedure

Record only findings supported by observed work. Include the exact source and
evidence location in a private receipt; mark hypotheses and untested plans.
On the next relevant task, retrieve this file and replay compatible evidence.
Demonstrating improved performance after retrieval is a separate experiment;
the existence of a note alone does not demonstrate learning effectiveness.
