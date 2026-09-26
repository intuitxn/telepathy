# Telepathy algorithm harness

The new source harness is the [pinned DeepSeek Harness integration](../dsh/README.md), with `deepseek-official/deepseek-flash` as its model route. Its keyless session and algorithm tools are tested. One live funded DeepSeek task produced a source-bound Bend receipt and passed independent hidden cases; this establishes that route for one task, not reliable autonomous operation. [The algorithm machine contract](../../docs/designs/dsh-algorithm-machine.md) defines the wider target. One Bend source file is the executable candidate; the DSH plugin owns bounded execution and receipts; the independent benchmark owns expected results and selection evidence. The former Mundus, Meta shell, OpenCode `/meta`, and mailbox host paths are historical source, not the active build plan.

## Closed loop

1. State a goal, acceptance cases, budget, current source digest, and a prediction before the next action.
2. Fork one candidate source or an agent/plugin policy in an owned `jj` workspace. Keep the incumbent digest available.
3. Check and build the exact Bend bytes once per source/toolchain key. Run bounded exploratory simulations without model calls inside the hot loop.
4. Compare predicted outputs, exits, and costs with observed receipts. Preserve failures and prediction error.
5. Independently score archived source against the host-pinned evaluator and case set. Compare candidate and incumbent under the same toolchain and repeat count; retain negative results.
6. Select only a strict gain with no lost passing cases. A new session reads the selected source digest; an existing session keeps its prior pin.

`runtime/core/telepathy.bend` implements deterministic algorithm, event-clock, frontier, retrieval, and prediction examples. `benchmarks/core/` tests its executable behavior with a separate oracle. The score is an empirical result over those cases, not a proof of general correctness. Named Bend laws prove only the stated laws. A new evaluator or case set starts a new comparison generation and requires rescoring both sides.

The frontier is a finite, budget-admissible set of candidate actions or versions. Record `birth`, `refine`, `fork`, `falsify`, `suspend`, and `select` events by causal parent and session sequence. Simulation fuel is event-relative duration; wall time, check/build/runtime time, model calls, and money are separate costs. A candidate's prediction error can reveal uncertainty but cannot substitute for task quality. Retrieval must be compared with a no-retrieval baseline and must abstain on incompatible evidence.

For self-improvement, evaluate an agent or plugin descendant against an unchanged clone on fresh tasks before selection. Pin the grader, cases, runtime, and budget for that comparison. Store only source-bound, supported findings for later retrieval; a session transcript or claimed insight is not admitted knowledge by itself. The current keyless DSH headless test exercises proposal, check/build, independent score, selection, and old/new session pins. The live DeepSeek run exercised one algorithm task; general self-improvement remains unverified until a fresh-task comparison is measured.

## Local checks and authority

```sh
npm run check
make check
node benchmarks/core/run.mjs --source runtime/core/telepathy.bend --cases benchmarks/core/kernel-cases.json
```

`make check` requires Bend; CI installs pinned Bend and runs the same source and benchmark gate. The [DSH README](../dsh/README.md) gives exact pinned upstream build and private `DSH_HOME` setup. Never put provider keys, private receipts, or raw transcripts in repository artifacts. Internal candidate testing and supported learning can proceed within the authorized task. Publication and GitHub merge remain separate exact-revision actions under [AUTO_MERGE.md](../../docs/AUTO_MERGE.md).

The older [learning record](LEARNING.md) and [workflow-transfer evaluator](../evaluation/README.md) remain historical evidence. They do not establish performance of the new DSH route.
