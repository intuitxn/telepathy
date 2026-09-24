# Harness programs

A harness is a small program that chooses when to call a model, use a tool,
retrieve context, retry, or check an answer. Its control flow runs in
[`../system.bend`](../system.bend). [`run.py`](run.py) only executes requested
effects through fixed bindings and saves their results. Everything lives in this
repository; no daemon, new agent framework, or second repository is required.

## Try it without a model

From the repository root (Bend 2.0.21, Bun and Python 3 required):

```sh
python3 runtime/harness/run.py demo --out .local/harness/demo
```

To run individual tasks and inspect their execution:

```sh
python3 runtime/harness/run.py run runtime/harness/examples/retry.harness \
  --bindings runtime/harness/examples/bindings.json \
  --input runtime/harness/examples/task.json --out .local/harness/example

python3 runtime/harness/run.py replay .local/harness/example

python3 runtime/harness/run.py compare \
  --baseline runtime/harness/examples/baseline.harness \
  --candidate runtime/harness/examples/retry.harness \
  --bindings runtime/harness/examples/bindings.json \
  --suite runtime/harness/examples/suite.json --out .local/harness/comparison
```

Every output directory must be new. The driver checks the Bend source and builds
JavaScript with Bend's supported backend, then runs that generated program in Bun.
Bun is required for Bend's file and network effects. The driver checks the source digest before each
call. Standard Bend installations reuse
a local build cache keyed by source, compiler, runtime library and Bun version, with
artifact hashes verified on each load. Cache misses run the checker and compiler;
unknown installation layouts use a temporary uncached build. Cached artifacts
live in `.local/harness/builds`, with a bounded build lock and atomic publication.
Set `BEND` to use another Bend executable. Compiler checks/builds have a ten-minute
timeout; effect calls default to two minutes (`--timeout`).
`npm run harness -- ...` is an optional shorthand for the Python command.

The offline model binding is an explicitly deterministic test double. It first
returns the first number, then uses `max` after failed verification. The verifier
checks membership and ordering. This demonstrates retry and comparison mechanics;
it does not demonstrate learned algorithms or improved model capability.

## The language

The wire format is prefix notation with **one token per line**. Files can end
with a newline. Read this example as `Repeat(2, ok, Verify(maximum, Model(maximum)))`:

```text
repeat
2
ok
verify
maximum
model
maximum
```

| Form (shown on one line for readability) | Meaning |
|---|---|
| `model REF` | Ask the model bound to REF |
| `tool REF` | Run the tool bound to REF |
| `retrieve REF` | Load context through REF |
| `sequence A B` | Run A, then B, including when A fails |
| `branch PRED A B` | Choose A when PRED matches the last status, otherwise B |
| `repeat N STOP A` | Run A at least once, stop after a matching status or N attempts |
| `verify REF A` | Run A; if successful, request independent verification through REF |

Branch predicates are `ok`, `fail`, `always`; repeat conditions are `ok`, `fail`,
`never`. The last effect's status determines the result; the initial status is
`ok`. A bounded repeat that exhausts its attempts preserves its last status.
Wrap a model in `verify` when completion alone is insufficient. Sequence allows
explicit recovery with a following branch. Failed tool/model results may be
retried; infrastructure errors abort the run instead of becoming model failures.

Bounds: 16,384 program characters, 128 parse depth, references up to 128 characters,
repeat counts 1..32, 128 effect observations, 2,048 parse transitions and 2,048
execution transitions.
Exhaustion and malformed input produce errors, never a successful result.
Static checking includes references in branches that the run does not visit.

## Three equations

Execution asks for one effect at a time:

```text
step(program, recorded_statuses) -> next_effect | done | error
```

The host retains full values; Bend sees only `ok`/`fail` observations. Replaying
the statuses reconstructs control flow without executing effects again.

An edit produces another program:

```text
candidate = edit(incumbent)
```

Selection consumes measurements from a fixed evaluator:

```text
decision = select(incumbent_metrics, candidate_metrics, policy)
```

These are separate operations. A stored report does not modify model weights,
and a passing Bend check establishes only the checked terms and named laws.

## Bindings and useful model calls

A version-1 JSON binding file maps `kind:reference` to host operations. Bindings
are fixed across a comparison; programs cannot change the evaluator or introduce
commands. Available binding kinds:

| Kind | Use |
|---|---|
| `command` | An explicit argv array; JSON input on stdin, JSON result on stdout |
| `opencode` | Native `opencode run --pure`, with the text-only `harness-model` agent |
| `file` | Retrieve a UTF-8 file relative to the binding file |
| `memory` | Retrieve active memories from an existing Bend snapshot |
| `json` | Verify a JSON object contains specified required keys |

Command stdin contains `input`, previous `value`, `observations`, and the current
`request`. Return `{"ok": true, "value": ...}`; `detail` and `tokens` are optional.
Commands run relative to the binding file. `{python}`, `{root}`, and `{bindings}`
expand inside argv elements; there is no shell interpolation. Commands are trusted
host configuration, not a sandbox. Model and tool values flow to the next effect;
verification preserves the candidate value. Models also receive the earlier
observations, so retrieved context and failure feedback remain available.
Input/config files and individual effect outputs are capped at 1 MiB, complete
receipts at 160 MiB, and OpenCode prompt context at 64 KiB. Exceeding a bound
aborts with an error instead of silently truncating evidence.

For a live model, use the supplied OpenCode binding and a JSON task file:

```sh
python3 runtime/harness/run.py run runtime/harness/examples/answer.harness \
  --bindings runtime/harness/examples/opencode.json \
  --input runtime/harness/examples/live-task.json --out .local/harness/live
```

OpenCode uses its existing provider configuration. `OPENCODE_BIN` selects the
executable; a binding's optional `model` chooses a configured `provider/model`.
The live example independently verifies the maximum through a command binding.
The generic `json` binding checks shape only, not truth. Use a task-specific
command verifier for correctness. The `harness-model` agent denies tools; agentic tool
execution belongs in explicit tool bindings or the existing `/meta` workflow.

## Propose, compare, retain

After obtaining a comparison report, ask the configured model for a new program:

```sh
python3 runtime/harness/run.py propose \
  --program runtime/harness/examples/baseline.harness \
  --bindings runtime/harness/examples/bindings.json \
  --feedback .local/harness/comparison/comparison.json \
  --edit-budget 16 --out .local/harness/proposal
```

This writes a checked, **unevaluated** `candidate.harness`. Compare it with the
incumbent using the same bindings and suite. The proposer receives aggregate
feedback, prior program edits and available references, not expected answers.
Pass multiple report paths after `--feedback` to include accepted and rejected
history (up to 64 reports, subject to the model context bound). Keep every comparison,
including rejected candidates; do not repeatedly use final held-out tasks to
choose edits. Promotion of a chosen program is an explicit repository change.
There is no background self-modification or automatic publication.

For a bounded local search, `evolve` seeds the incumbent on the fixed suite,
proposes an edit each round, compares it under the same policy, and carries only
accepted edits forward:

```sh
python3 runtime/harness/run.py evolve \
  --program runtime/harness/examples/baseline.harness \
  --bindings runtime/harness/examples/bindings.json \
  --suite runtime/harness/examples/suite.json \
  --rounds 2 --out .local/harness/evolution
```

The result is `result.harness`; `frontier.json` links every round's proposal and
comparison report. Rounds are capped at eight, and the result remains local until
someone explicitly edits the repository. The fixed suite is development feedback,
so acceptance on it is not evidence of transfer to unseen tasks.

The evaluator compares the final value with each suite case's `expected` value,
which is never passed to the effects. Scores are basis points (0..10,000).
The current cost metric is rounded-up mean **effect count**, not tokens or money;
live token counts are retained separately when provided by OpenCode.

The Bend selector is a conservative policy inspired by
[RRSI](https://arxiv.org/abs/2609.24972), not a reproduction. It rejects failed
guards, flagged leakage, excessive edits and scores below `best - delta`. For
gains above delta, relative cost growth must not exceed
`min(maxGrowthBps, gain * gainMultiplier)`; within the noise band, cost must
strictly decrease. `compare` uses the baseline as the best score (or a higher
`--best-score`), a supplied
noise allowance, and changed-line count as its edit budget. It does **not** run
a leakage critic, calibrate noise, prune components, or perform stochastic
annealing. Its suite score does not establish transfer to unseen tasks.

Receipts bind source, program, bindings and suite digests. `run.json` records
intent before each external effect. Interrupted runs retain a pending request
and cannot be replayed as completed runs or automatically retried: delivery may
already have occurred. Replay verifies recorded control flow, not the truth of
external observations. Use a private output directory; receipts contain task data.
The suite digest and selection settings live in `comparison.json`; individual
run receipts bind their program and bindings. Replay checks the current Bend
source and recorded program, and performs no binding calls.

## Verify changes

```sh
BEND_NO_TELEMETRY=1 ~/.bend/bin/bend runtime/system.bend --check-only
python3 -m unittest discover -s runtime/harness -p 'test_*.py' -v
node --test runtime/worker/protocol.test.mjs runtime/lorenz/evaluate.test.mjs
```

The older worker `claim → packet → return → learn` protocol remains in the same
Bend file. See [META.md](../adaptive/META.md) for delegated task state and
[BUZZ.md](../worker/BUZZ.md) for native memory and host configuration.
