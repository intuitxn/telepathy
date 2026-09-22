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

A separate fresh coding-agent pilot tested dependency-aware evidence selection.
Both agents passed 136/136 pre-frozen cases, with zero input mutations; only one
received retained findings. The observed memory benefit was zero. This single
paired task does not demonstrate that memory improves coding performance.
The original synthetic answers, protocol, and evaluator are retained under
`runtime/evaluation/agent-transfer*` rather than selecting only positive results.

The real Codex-to-OpenCode trial then completed the lifecycle through a signed
remote and a separate receiving registry. The OpenCode worker invoked the
before hook and retrieved the producer's exact bundle; the coordinator scored
and recorded closeout. Both baseline and memory arms passed 74/74, generating
identical normalized code. The memory run took 13.773 seconds versus 4.608 seconds.
This proves the integration path works, not that retrieval improves this task.
Task-boundary hooks now retain selected outcomes and prevent failed/partial work
from promoting a core. `/meta` integration can call these hooks; the live server
did not expose that separately managed command during this trial.

1. Define an episode schema: problem/contract revision, candidate source digest,
   prediction, observation, intervention/control, counterexample, checker result,
   evaluator/toolchain versions, costs, and provenance. Keep raw conversations
   separate; extract specific claims with supporting evidence.
2. Extend the implemented core-specific admission/evaluators as new contracts
   become available. Preserve independent checks and counterexamples.
3. Retrieval now retains only the best bounded results and avoids building a
   full narrative vocabulary per entry. It still hashes every eligible bundle;
   a persistent index must not hide corruption in an unselected record.
4. Key rotation, read-only health checks, lock-aware scratch cleanup and recovery
   guidance are implemented in maintenance.mjs and OPERATIONS.md. Publisher roles,
   scheduled monitoring and destructive evidence retention remain separate work.
5. Evaluate agent learning on new tasks: compare a fresh agent against one given prior
   evidence at equal resource budgets. Measure correctness, cost, reuse, and
   regressions. Keep evaluation tasks independent of selection decisions.

The executable algorithm, selection rules, and expressible laws can stay in
`system.bend`. Codex, Bend's compiler/Base, storage, hashing, and transport are
external dependencies. Current Base does not supply the subprocess/Git and
transactional storage facilities needed to implement that entire boundary
inside the existing one-file program.

## Worker integration and operational findings

The native worker implementation is now packaged in `runtime/worker/system.bend`.
Its 78 named laws pass Bend 2.0.21 checking. Independent fresh-process tests cover
claim ownership, rejected duplicate/wrong-worker returns, explicit learning,
later memory retrieval and transitive invalidation after correction. A local
HTTP test exercises native packet delivery, quoted data, receipt reuse rejection
and failed acknowledgement without creating learned memory. These checks prove
neither arbitrary worker answers nor authenticated worker identity.

`/meta agents` is discoverable in fresh OpenCode contexts from both the checkout
and an unrelated directory. The command resolves its installed symlink to the
packaged source. It is an instruction workflow, not an enforced lifecycle hook.
The first live attempt timed out after guessing the wrong Bend checker syntax;
the instructions now give the exact `FILE --check-only` invocation. Preserve
this operational failure rather than counting command discovery as execution.
The corrected live command completed in 178.256 seconds and a fresh Bend process
retrieved the learned result in a second task packet. Six independent checks
passed; `runtime/worker/meta-trial.json` preserves both attempts and their scope.

Doctor found all 11 accepted/staged bundle instances intact and the configured
signing key healthy. Compaction linked 65 duplicate payloads, reporting 700397
bytes of duplicate storage removed, with zero evidence or failures deleted.
Scratch cleanup found no eligible expired directories. Key rotation was tested
on temporary registries; the live publisher key was deliberately not rotated.
Another physical machine has not been connected; the documented bootstrap and
local separate-registry tests do not establish that deployment.

The harder dependency-worker coding pilot froze 652 cases before model calls.
Both initial arms passed all cases, but the memory arm used one bash call despite
a zero-tool prompt, invalidating the stated equal-budget comparison. The adapter
now accepts `--tools none`, disables every discovered tool in the API request,
and aborts with preserved evidence if a tool call is observed. This is an observed
configuration failure and a tested repair; a prompt alone was not enforcement.

A separate fresh-session follow-up with that API policy produced 652/652 in both
arms with zero tool calls. Baseline took 60.711 seconds and memory 70.785 seconds;
shared-server timings are observations, not a causal cost estimate. Accuracy gain
was zero. Both pairs, including the invalid initial comparison, are retained in
`runtime/evaluation/workflow-transfer*`. The memory arm received a selected real
Lorenz finding as prompt context; this experiment does not claim autonomous
retrieval or general learning benefit. It does show how an observed workflow
failure can become a retained finding and an enforced operational fix.

## Session closeout procedure

Record only findings supported by observed work. Include the exact source and
evidence location in a private receipt; mark hypotheses and untested plans.
On the next relevant task, retrieve this file and replay compatible evidence.
Demonstrating improved performance after retrieval is a separate experiment;
the existence of a note alone does not demonstrate learning effectiveness.
