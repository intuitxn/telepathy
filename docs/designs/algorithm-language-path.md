# A checkable path from prose to a one-file algorithm

The executable language today is Bend 2. A paper, pseudocode excerpt, or code
fragment can begin a task, but prose is not compiled automatically. A model or
human must translate its assumptions and claimed behavior into a `.bend` file.
The checked result is a candidate for testing, not a proof that the translation
faithfully implements the source.

`runtime/dsh/algorithm-spec.mjs` supplies three small steps:

1. `defineAlgorithmTask` freezes a bounded source excerpt, reference, claim,
   assumptions, CLI argument types, up to 16 probe inputs, and up to 16 proposed
   counterexample inputs. Its digest changes when any of those fields change.
2. `prepareBendExperiment` reads one workspace `.bend` file, computes the exact
   source SHA-256, and converts candidate predictions into the existing
   `algorithm_run` input. It requires a prediction for each probe. The runner
   reads and checks the file again, so a change between preparation and run is
   rejected by the source digest rather than silently executed.
3. `runAlgorithmTask` calls the existing bounded Bend runner, then
   `inspectBendReceipt` presents checker/build diagnostics, observed outputs,
   prediction errors, and the task's still-open counterexample requests. The
   result is marked `unscored`; only the host-pinned independent evaluator and
   case set can score correctness through `algorithm_score`.

The current CLI contract is deliberately small: at most 16 `text` or canonical
`nat` arguments, where each natural is 0..65535, and either text output or a
canonical natural followed by a newline. A task uses 1..16 probe inputs and a
source excerpt of at most 16 KiB. These limits align with `algorithm_run`; they
do not restrict Bend's internal type system. The task record has no authority
or permission fields. A paper's claims, probe choices, and proposed
counterexamples remain attributed proposals.

Example:

```js
import { defineAlgorithmTask, runAlgorithmTask } from './runtime/dsh/algorithm-spec.mjs';

const task = defineAlgorithmTask({
  material: { kind: 'pseudocode', reference: 'local design note §2',
    text: 'Start at zero; add three once per step.' },
  claim: 'batch n returns value 3n',
  assumptions: ['n is a canonical natural up to 65535'],
  interface: { argv_types: ['text', 'nat'], stdout_type: 'text' },
  probes: [{ name: 'one', args: ['batch', '1'] }],
  counterexample_requests: [{ name: 'zero', args: ['batch', '0'],
    reason: 'Check the empty-step boundary.' }],
});
const result = await runAlgorithmTask(task, {
  source: 'candidate.bend', predict_check_pass: true,
  predict_build_pass: true,
  case_predictions: [{ name: 'one', predicted_stdout: 'clock=1;value=3\n' }],
}, { workspaceRoot: '/exact/worker/workspace', archiveRoot: '/private/algorithm/archive' });
```

A `prediction_counterexamples` item means the candidate's observed output
differed from its prediction. It does not establish that the paper is false or
that the candidate is wrong. A proposed `counterexample_requests` input is
likewise a next test request, not a measured counterexample. Independent
scoring, held-out cases, and later replication decide whether a claim can be
accepted for a task. A checker success establishes well-typed Bend source; it
cannot establish semantic fidelity to arbitrary prose.

## A bounded executable pseudocode subset

`runtime/dsh/algorithm-language.mjs` accepts a small, line-oriented transition
program. It compiles deterministically to a single Bend file and also runs a
fast in-process simulation for early feedback. For example:

```text
algorithm service_queue
state backlog = 5
state served = 0
step backlog = sub(backlog, if_lt(backlog, 2, backlog, 2))
step served = add(served, if_lt(backlog, 2, backlog, 2))
return served
```

Each `step` expression reads the **previous** state. `tick` is the zero-based
step index. The only operations are natural-number `add`, saturating `sub`, and
`if_lt(a, b, yes, no)`. One CLI natural argument sets the number of steps,
0..128; the selected state is printed as a canonical natural line. The source
is bounded to 16 KiB, eight state fields, and 64 expression nodes per step.
This subset expresses bounded recurrences and small state machines, not
arbitrary papers or programs. Source diagnostics use zero-based UTF-16
`range.start` and `range.end` positions compatible with editor/LSP clients;
there is no language server process yet.

The single module is also a CLI. Given `queue.algo`:

```sh
node runtime/dsh/algorithm-language.mjs check queue.algo
node runtime/dsh/algorithm-language.mjs simulate queue.algo 3
node runtime/dsh/algorithm-language.mjs compile queue.algo > queue.bend
```

`check` returns a JSON digest and diagnostics. `check` and `compile` exit
nonzero on invalid source; `simulate` rejects counts outside 0..128. The CLI
does not grant a task, run a model, or select an algorithm.

`compileAlgorithmText(text)` returns the exact Bend bytes and both source and
generated SHA-256 digests. The agent writes those bytes into its workspace,
then uses `defineAlgorithmTask` and `runAlgorithmTask` to obtain a source-pinned
checker, build, and execution receipt. `simulateAlgorithmText(text, steps)`
returns an immediate result, but it shares the language parser and is a
differential aid rather than a correctness oracle. The host-pinned independent
evaluator still decides candidate acceptance. A successful generated Bend
check proves that the emitted file is well typed; it does not prove a prose
source was translated faithfully.

The immediate developer aid remains fast Bend checker output for the exact
source and source-to-receipt links. A Bend LSP could later add symbol navigation
and inline compiler diagnostics. Build one after repeated editing sessions show
that checker latency or navigation causes a measured bottleneck.
