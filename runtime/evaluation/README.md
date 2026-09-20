# Bounded transfer demonstration

For the separate fresh coding-agent pilot, see [agent-transfer.md](agent-transfer.md).
Both agents passed 136/136 held-out cases; the observed memory benefit was zero.

Run from the repository root with Node and Bend 2.0.21 installed:

```sh
node runtime/evaluation/transfer.mjs
# Reproduce the checked-in task set without replacing the recorded run:
node runtime/evaluation/transfer.mjs --seed 2571500135 --output /tmp/bend-transfer-repeat.json
```

Set `BEND` to an alternative Bend executable. `--source FILE` evaluates a
different source snapshot; that source must supply `solve` and `chunked_max`
and pass Bend checking. This script is an external measurement adapter;
the algorithms and laws remain in the single `runtime/adaptive/system.bend`.
It executes local Bend source and is not an execution sandbox.

## What happens

1. Copy and check the exact source snapshot.
2. Evaluate a first-item shortcut and the chunked maximum kernel on six fixed
   training examples. Record the shortcut's failures and the successful kernel.
3. Write and hash that evidence before drawing a random evaluation seed
   (or reading the explicitly supplied replay seed).
4. Generate 128 inputs from the recorded seed. Exclude the training inputs;
   expand lengths and values beyond those in training.
5. Start a fresh Node process and Bend process for each treatment. A frozen
   selector uses only compatible retained evidence to choose the authored
   kernel. Score outputs against an independent JavaScript `Math.max` oracle.
6. Assert negative-control equivalence and exact-kernel correctness. Write the
   complete inputs, outputs, hashes, toolchain, costs, timings and conclusions.

The public task generator is deliberately simple. These are held-out inputs
generated after evidence freezing, not a secret benchmark or unseen problem
family. The fixed training set, selector, candidates and generator are authored.

## Measured result

The checked-in `transfer-report.json` records seed `2571500135`:

| Treatment | Correct / 128 | Logical input-element visits |
| --- | ---: | ---: |
| Frozen first-item baseline | 14 | 128 |
| Compatible retained evidence | 128 | 1,619 |
| No memory | 14 | 128 |
| Irrelevant evidence only | 14 | 128 |
| Stale-source evidence only | 14 | 128 |
| Compatible + irrelevant + stale | 128 | 1,619 |
| Always exact, no memory | 128 | 1,619 |

Every arm has the same cap: 32 input elements per task, 128 tasks, and a
60-second Bend process timeout. Consumption differs: exact evaluation reads
more input. Visit counts describe the logical input observations of the
selected algorithm, not CPU instructions, unary-natural arithmetic, chunk
allocation or compiler work. Elapsed times include startup and compilation;
they are one observation each, not a speed benchmark. Training is an upfront
cost recorded separately. No claim of equal total training expenditure is made.

The result demonstrates that retained selection evidence survives a process
boundary and changes behavior correctly on new inputs. Rejecting irrelevant
and stale evidence prevents those records from changing the selector. The
always-exact control also gets 128/128: memory adds no capability beyond the
available exact algorithm. This is useful regression evidence for bounded
policy transfer, not evidence of LLM weight learning, agent coding improvement,
new algorithm discovery, arbitrary causal discovery, or AGI.

## Boundary and remaining experiment

This runner constructs its own evidence fixtures and validates their declared
compatibility. It is not an end-to-end registry transport/admission test, and
its evidence JSON is not independently authenticated. The registry's own tests
cover that boundary. The unchanged source is freshly checked before the run;
recorded hashes bind these measurements to the bytes that were executed.

A stronger agent-learning experiment still requires multiple independent
coding tasks, randomized memory assignment, equal model/tool budgets,
unseen tests owned by a separate evaluator, task-level reporting including
negative transfer, and replicated runs. No claim about those outcomes is made
by this demonstration. Replaying a seed reproduces inputs and correctness;
wall times naturally vary.
