# Intuitxn Labs: agent language and learning loop

The unit of improvement is a versioned **agent program**, not an unstructured
conversation. A program declares typed inputs and outputs, modules (ordered
steps), permitted effects, and a measurable objective. A node executes it,
records a trace, and returns attributed observations. The optimizer proposes a
new program revision; it does not silently mutate the running node.

```text
Forward(program revision, Observation<T>, node) -> Output<U>, Trace
Backward(Trace, external verifier, objective) -> Feedback by module/edit
Optimize(program revision, Feedback, history) -> candidate revision
```

The forward pass is agent execution, not a neural-network tensor pass. The
backward pass assigns measured task feedback to the changed module or edit;
without model gradients it is not neural backpropagation. The optimizer can
change prompts, control flow, context policy, tools, or memory policy inside an
explicit edit budget. Weight updates would require a separate training backend
and a distinct evidence contract. [DSPy's signatures, modules, and
optimizers](https://dspy.ai/3.1.1/learn/programming/overview/) are a useful
reference for this separation; [RRSI](https://arxiv.org/abs/2609.24972)
motivates regularized candidate generation and selection.

The first executable protocol is [rrsi.meta](../../runtime/agent_programs/rrsi.meta).
Its compiler pins a digest and requires the five ordered modules `optimize`,
`critique`, `forward`, `backward`, and `select`. The RRSI policy declares the
editable file scope, edit budget, cost weights, five required evidence guards, and a reviewed-release
promotion boundary. [rrsi_loop.py](../../runtime/rrsi_loop.py) interprets that
program through the resident meta node. It proposes one change in a jj
workspace, asks a separate pre-score critic, runs pinned temporary nodes on
frozen evolve and held-out suites, records one-edit feedback, and carries the
selected candidate into the next round. The [Bend kernel](../../runtime/worker/system.bend)
checks the final five-flag selection transition; its laws prove that an
unscoped or unreviewed candidate cannot pass that Boolean gate. External
verifiers, candidate scope, critic evidence, and measured trials are still
host-supplied facts. Bend cannot prove their truth merely by receiving flags.

The general program language currently checks typed inputs, outputs,
references, declared effects, decisions, step order, and this RRSI policy.
The resident node still executes an ordinary program as one ACP task, so its
step outputs are reported by a model rather than independently interpreted.
The RRSI loop is the first host-interpreted protocol. Its backward attribution
is limited to one edit per candidate; multi-edit credit assignment needs
controlled ablations, not a confident story from a single aggregate score.

The network protocol should carry `Observation<T>` with source identity,
collection time, schema and source digest; `Trace` with program/model/node
revisions and effect receipts; and `Feedback` with verifier identity, score,
cost, uncertainty, and counterexamples. Those are **proposed types**, not yet
validated by the compiler. The present node has an authenticated loopback MCP
endpoint and an on-demand SSH relay. It has no always-connected peer mesh,
durable cross-node scheduler, or consensus layer. A later peer protocol must
bind node identity and revision, use idempotent request IDs, carry evidence
across disconnections, and never treat remote model output as authority to
deploy or publish.

The research target is computational assistance that improves its own
programs under observed outcomes. A score gain on a small fixture, a Bend law
about a Boolean transition, and an agent's self-report each establish different
things. Keep these evidence classes separate so the language can express a
mind-like process without claiming that a present model's internals have been
explained or trained.
