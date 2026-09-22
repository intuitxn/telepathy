# Fresh coding-agent paired pilot

Two fresh agents received the same new coding specification: implement
revision-compatible evidence selection with transitive dependencies, cycle
rejection, revocation, ambiguity handling and deterministic ranking. The memory
arm additionally received three curated earlier engineering findings about
context binding, revocation and evidence. Neither arm received test cases,
expected outputs, the oracle or the other arm's answer.

The protocol, 16 targeted cases and 120 seeded generated cases were written
before either answer was requested. Both agents used the same inherited model
configuration, zero tools, zero revisions, and a 1,000-word output cap. The
agents ran sequentially because the parallel launch hit the active thread
limit. Actual answers used 266 words without memory and 260 words with memory.
No model sampling seeds or exact internal compute budgets were controlled.

| Arm | Correct | Input mutations |
| --- | ---: | ---: |
| Without retained findings | 136 / 136 | 0 |
| With retained findings | 136 / 136 | 0 |

**Observed improvement: zero.** Both answers reached the test ceiling. This
pilot demonstrates actual task scoring, not an advantage from session memory.
The explicit specification already supplies the required semantics; this test
may have little sensitivity to the additional findings. A null result here does
not establish that memory never helps, and these 136 cases are not 136
independent coding tasks or replicated model samples.

Replay the saved answers against the frozen cases:

```sh
node runtime/evaluation/agent-transfer.mjs
```

`agent-transfer-protocol.json` contains the exact common prompt, extra memory,
budgets, synthetic inputs and expected outputs. The `.txt` answers are immutable
experiment data, not additional maintained runtime cores. The evaluator checks
each answer in a fresh JavaScript context with a one-second per-case timeout;
that context is not a security sandbox for hostile code. The independent oracle
uses iterative eligibility expansion. The answers were copied verbatim without
repair, and no test feedback was provided to either agent.

The report hashes the protocol, evaluator and answers. Replaying reproduces
scoring, not the stochastic generation of the original answers. This is one
paired pilot, not randomized task assignment, a blinded external evaluation,
statistical evidence of agent learning, or model-weight training. Broader claims
need multiple genuinely distinct coding tasks and repeated model runs, reporting
negative transfer and the cost of retrieving memory as well as accuracy.
