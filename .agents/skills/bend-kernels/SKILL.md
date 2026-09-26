---
name: bend-kernels
description: Turn an algorithm or pseudocode into one executable Bend candidate, then predict, run, independently score, and revise it through DeepSeek Harness.
---

# Executable algorithm loop

Use this skill when the task is to write, adapt, compare, or improve a Bend
algorithm. The target agent host is the pinned DeepSeek Harness profile in
`runtime/dsh/README.md`. Bend holds pure algorithm logic; DSH owns the model
session, tools, source archive, receipts, and version selection. A paper,
snippet, or pseudocode is an input proposal, not yet a checked program.

## Specify before compiling

Write a compact contract with input and output types, assumptions, task oracle,
termination or fuel, measurable success, and explicit unknowns. If source text
admits multiple interpretations, preserve alternatives as separate candidates.
Do not turn an author claim or retrieved memory into an acceptance criterion.
Keep one candidate in one self-contained `.bend` file when possible.

For a recurrence with at most eight natural-number state fields and 128 steps,
write one bounded algorithm text using `algorithm`, `state`, `step`, and
`return`. Expressions admit literals, prior state fields, `tick`, `add`,
saturating `sub`, and `if_lt`. Call the funded `algorithm_compile` tool with
the exact text. Resolve any returned diagnostics, then write its exact
`bend_source` to a `.bend` file with the scoped file tool. Use its
`bend_sha256` for `algorithm_run`. This translation is executable syntax,
not evidence that the algorithm's claim is correct. For other algorithms,
write the one-file Bend source directly.

Implement pure `init`, `step`, `fold`, or `run` definitions as needed.
Use `main -> IO(Unit)` for a bounded command-line batch driver. The hot loop
belongs in the compiled Bend binary; do not call a model for every simulated
step. A logical event sequence or fuel is simulation time; wall time, tokens,
CPU, and money are distinct costs.

In an operator shell, read the installed `bend guide` and check `bend version`;
this repository's verified compiler is Bend 2.0.21. The file precedes flags:

```sh
BEND_NO_TELEMETRY=1 bend path/to/candidate.bend --check-only
BEND_NO_TELEMETRY=1 bend path/to/candidate.bend -o /tmp/candidate-binary
```

Require exit zero and `All terms check.`, then run independently specified
cases. Funded DSH agents use `algorithm_run` for this check and native run;
their shell tool is disabled. Named laws prove only their written statements. In Bend, passing both
recursive branches to `Bool.pick` can duplicate the traversal; bind the
recursive tail once and measure longer inputs. A budget should limit work,
not merely truncate an already computed output.

## Predict, observe, score, select

1. Read `algorithm_active` and the exact source and case-set identities.
2. Before `algorithm_run`, state predicted checker/build results and case
   outputs. Pass the exact source SHA-256. The tool freezes those bytes,
   checks, builds, runs bounded exploratory cases, and returns a receipt.
3. Compare prediction with observation. Unknown or unmeasured outcomes remain
   unknown. Prediction accuracy is separate from task quality.
4. Submit the archived run receipt for host-side independent scoring. The
   production model catalog does not expose `algorithm_score` or
   `algorithm_select`; only the host may reserve the evaluation, run the pinned
   evaluator, and publish a score. Preserve counterexamples and the score
   report digest when the host returns them.
5. Compare candidate and incumbent on the same evaluator, case set, toolchain,
   and compute schedule. The host may select a complete passing first score;
   a later selection requires a strict measured gain without lost passing
   cases, accepted exact-revision settlement, and fresh-task evidence. A new
   session reads the selected digest; an existing session keeps its earlier
   pin. Use `algorithm_execute` to run that pinned archive, rather than
   re-reading editable source.
6. Revise from failures, then repeat with a finite width, depth, and compute
   budget. A changed evaluator begins a new comparison generation.

The actual task score is the independent report, not a Bend field whose caller
can assert success. `runtime/core/telepathy.bend` contains useful pure
transition primitives, but its direct caller must bind any success verdict to
an evaluator receipt. The default `benchmarks/core` cases are public
regressions; improvement of a self-editing agent needs fresh tasks and an
unchanged-clone comparison.

## Context and authority

Retrieve current source, accepted constraints, scoped evidence, and relevant
counterexamples. Record the source/evaluator digests and the prediction error
in a concise finding. Never inject a finding across an incompatible scope;
scope filtering and retrieval gain need independent checks.

The user-authorized work loop permits bounded edits and evaluation. Follow
`runtime/AUTONOMY.md` and `AGENTS.md` for external publication, private
state, and exact-revision review. DSH sessions are records of decisions, not
permission to widen tool authority. Do not put API keys in source, prompts,
receipts, or benchmarks.
