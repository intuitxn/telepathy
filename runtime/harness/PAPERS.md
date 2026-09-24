# Paper methods, reproducibility and a small world model

The DSL interpreter, selector and symbolic world update live in
[`../system.bend`](../system.bend). Effect execution and suite scoring live in
the small Python driver beside this note. One Bend source file is useful for
inspectable control and update rules; it cannot contain a frozen
language model, benchmark environments, human/world observations or a trained
latent dynamics model.

## RRSI and the harness

[RRSI](https://arxiv.org/html/2609.24972v1) evolves prompts, tools, memory and
control flow around a frozen policy. Its regularization includes an annealed
budget on independent edits, history-guided exploration, a leakage critic, a
noise-adjusted score floor, a token-cost rule and pruning. Its
[reference implementation](https://github.com/google-research/rrsi) runs two
candidates per round in separate worktrees. The paper reports up to 14.1 score
points on the evolve split, up to 4.7 points on five out-of-distribution
benchmarks and 30% fewer policy tokens than unregularized evolution. These are
the authors' results, not measurements from this repository.

Our Bend `select` command captures only a bounded score floor, edit limit and
cost gate. The Python driver can run a development suite, retain accepted and
rejected edits, and measure one disjoint-input holdout after selection. Its
current cost is mean **effect count**, not policy tokens, and its `delta` is
user-supplied rather than calibrated. `guard=1` and `leak=0` are placeholders;
there is no independent critic or component pruner. The example suite is four
maximum tasks, so even a perfect score is not evidence of broad transfer.

To reproduce the paper's numbers, use the authors' benchmark adapters and
splits, starting harnesses, frozen policy and judges, repeated stochastic
trials, token accounting, edit annotations, critic and selection settings.
Preserve per-task outcomes and costs, not just one aggregate score. The paper
uses 20/20/40 rounds with 2/2/4 trials per task for its coding, workspace and
engineering instances. Copying its equations into one Bend file cannot
replace those experimental dependencies.

## A finite latent world in Bend

[DreamerV3](https://arxiv.org/html/2301.04104) trains a recurrent latent state,
posterior/prior distributions and observation/reward predictors. [MuZero](https://arxiv.org/html/1911.08265v2)
trains a representation, recurrent dynamics, reward, policy and value heads.
Our `world` command is deliberately smaller: it filters one unknown binary
transition rule, with no learned neural parameters or planner.

Let `s`, `a` and the hidden rule `r` be bits. The toy simulator uses
`s_next = (s + a + r) mod 2` and assumes an observed next bit is correct with
probability 0.9. The kernel stores `b = P(r=1)` in basis points; the equations
below use its normalized 0-to-1 value. It computes

```text
P(o=1 | b,s,a) = b P(o=1 | r=1,s,a) + (1-b) P(o=1 | r=0,s,a)
b_next = b P(o | r=1,s,a) / [b P(o | r=1,s,a) + (1-b) P(o | r=0,s,a)]
```

All terms are bounded integers. `world belief state action observation` returns
the prediction, posterior and bounded prediction error. The DSL can call it
through `tool world` and use `repeat` for a bounded sequence of observations;
an external environment owns the observation. In the independent simulator
test, four transitions shift a 50/50 prior above 99.9% toward the correct rule
for either hidden rule. On a withheld fifth transition, its Brier error is
below 0.011 versus 0.25 for the uninformed prior. This validates the toy
update and one-step prediction under its assumed world; it does not validate
world understanding, long-horizon planning or real-world dynamics.
The batch example is restricted to `tool:world` because its task file already
contains future observations. A neural policy would need a streaming environment
boundary before it could be evaluated without lookahead leakage.

To test a richer world model, freeze transition sequences and an independent
simulator or observation source first. Measure one-step and multi-step
prediction, calibration and downstream reward on held-out environments, with
reactive and memory-free controls. A larger latent space needs learned
parameters, data and an optimizer; the Bend DSL should specify when those
modules predict, update, verify and retain evidence.

## Cost and scaling

The current search is deliberately bounded: at most eight evolution rounds,
100 development cases, 100 holdout cases, 128 effects per run and 32 iterations
per `repeat` node. A round measures both incumbent and candidate on every
development case, so the dominant external work grows roughly with
`rounds × cases × effects`; the Bend build is cached by source and toolchain.
The binary-world filter uses constant time and memory per observation because
it has exactly two hypotheses. Explicitly enumerating `K` rules would require
at least `O(K)` work per update and does not scale to an open-ended latent
world. Learned latent dynamics require an external model and optimizer, while
the Bend kernel can still specify bounded calls and evidence gates.

## Why the hashes exist

| Identifier | What it binds | What it cannot prove |
|---|---|---|
| Git commit | Versioned repository tree | A passing test or valid model |
| Source/compiler/cache SHA-256 | Exact Bend and generated-code bytes | Correct semantics |
| Program/binding/dependency SHA-256 | The selected DSL, configuration and declared files | Undeclared imports or remote model weights |
| Suite SHA-256 | Exact evaluation cases | Independence or representativeness |
| Lorenz numeric event ID | Position in one snapshot lineage | Content identity or authenticity |

The checked-in `runtime/evaluation/transfer-report.json` hashes a prior
adaptive source and runner. It remains historical evidence; the consolidated
source requires a fresh measurement. Hashes support traceability. Independent
oracles, invariants, controls and held-out tests support correctness claims.
