# Historical one-file adaptive Bend experiment

This is a retained experiment, not the active Telepathy algorithm or a DSH task entry point. The checked current candidate is [`runtime/core/telepathy.bend`](../core/telepathy.bend); use the [DSH guide](../dsh/README.md) for the funded host path. The commands below examine this historical file locally and do not install or select it.

`system.bend` was the standalone executable Bend experiment. It contains algorithms,
problem representations, proofs, surprise/intervention experiments, revision
evidence, compatible-block lookup, native file persistence, and reporting.
Bend 2.0.21 and its Base library are runtime dependencies; Git is an external
recording tool. There is no Python host.

The earlier [Lorenz worker](../worker/README.md) and [`/meta agents` route](META.md) are historical. The custom JavaScript runtime stack was retired; see [HARNESS.md](HARNESS.md) for its implementation record and preserved state.

## Run and reuse after restart

From the Telepathy repository:

```sh
BEND_NO_TELEMETRY=1 ~/.bend/bin/bend runtime/adaptive/system.bend --check-only
BEND_NO_TELEMETRY=1 ~/.bend/bin/bend runtime/adaptive/system.bend

mkdir -p .local/adaptive
chmod 700 .local/adaptive
BEND_NO_TELEMETRY=1 ~/.bend/bin/bend runtime/adaptive/system.bend -- record .local/adaptive/blocks.evidence runtime/adaptive/system.bend
BEND_NO_TELEMETRY=1 ~/.bend/bin/bend runtime/adaptive/system.bend -- replay .local/adaptive/blocks.evidence runtime/adaptive/system.bend
```

Record saves the exact source text, computed evidence, and selected block ID.
An identical record is idempotent; different existing content is rejected.
Replay checks the record, reads its saved block ID, and dispatches that block
on a new task. The block implementations are compiled into this source;
this is not dynamic loading of arbitrary code. Replay also recomputes evidence
for validation; it is not a cached inference speedup.

Native file reads decode UTF-8: comparison checks decoded text, not raw bytes.
An independently measured SHA256 source digest supplies byte-level binding.
Always supply the executing source as SOURCE. Base cannot independently attest
that the supplied path is the running program. Records are untrusted,
single-writer local files: there are no locks, atomic replacement, or fsync
guarantees. Use the private directory above. Missing, changed, malformed, and
oversized records fail closed. Changing source requires a new record path.

## Use from Codex

The repository skill at `.agents/skills/bend-kernels/SKILL.md` supplies the
check, run, and isolated record/replay workflow. Invoke it with:

```text
$bend-kernels verify the adaptive system and replay its accepted block
```

Codex discovers the skill inside this checkout. For access from other projects
on the same machine, link that skill directory into `~/.agents/skills/`.
The development machine already has that link. Restart Codex if it does not
appear. Other machines need this checkout (including the skill and source)
and the Bend toolchain; the local link does not distribute files or evidence.
This is an instruction workflow, not an enforced hook or a network service.

This adaptive example and the separate [memory-only core](../lorenz/README.md)
remain available for reproducing prior experiments. The current worker path
uses direct Bend commands and Buzz native memory, without a Node service.
The [transfer experiment](../evaluation/README.md) measures reuse on new inputs
with no-memory and always-exact controls; it does not establish LLM learning.

## Mathematical pieces

- Maximum is associative, commutative, and idempotent.
- Maximum over concatenation equals maximum of the component maxima.
- A pair-chunking algorithm has a checked lossless roundtrip.
- Reduction over arbitrary chunks equals reduction over their flattened values.
- Typed `MaxProblem -> ChunkProblem` encoding transports the answer and both
  upper-bound and least-upper-bound contracts.
- Evidence binds problem, objective, evaluator, dependency, and source labels.
  Mismatched evidence cannot qualify for adoption or reuse.
- Appending evidence preserves prior entries; a concrete failed shortcut case
  remains in the history alongside an accepted block.

These are the specific laws checked by Bend. The proposal does not define
correctness for arbitrary problem reformulations. Empty lists have internal
maximum identity zero; the original task type is nonempty.

## Executed experiment

A first-item shortcut succeeds on descending training lists. A forecast
violation triggers a comparison with paired reorderings, unchanged sham
inputs, and an exact-kernel control. Causal-control evidence gates selection.
Selection uses development cases; final admission checks distinct audit cases.

The authored fixed fixtures produce 8/8 correct after adaptation versus 4/8
with learning disabled, using 24 versus 8 element visits. No-surprise and
failed-causal-evidence controls block adaptation. These are author-visible
fixtures, not secret benchmarks. Surprise is prediction error, not subjective
experience or sufficient evidence of causation.

A second demonstration retrieves accepted block 2, executes the chunked
algorithm on `[17,4,23,23,8]`, and returns 23. A retained failure records
the shortcut returning 1 for `[1,2]`, where the expected maximum is 2.
Changing the dependency label makes lookup return no compatible block.
Labels are not cryptographic hashes and do not authenticate their supplier.

## Agit evidence boundary

The repository's existing `scripts/agit.py` accepts proof-envelope JSON and
does not itself execute Bend. It is not invoked by this program. The prototype
uses native source-bound evidence plus an independently captured local Git
snapshot under `.local/adaptive/agit` when created by the verification session.
That snapshot binds actual checker output, source SHA256, toolchain identity,
execution evidence, and the explicit problem/evaluator description.

This is an experimental Git evidence record, not a completed production agit
lifecycle or authenticated human acceptance. The current Bend Base has no
subprocess API, so automatic Git transport is not implemented in this one-file
program. No network synchronization or public publication is enabled.

## Scope

See [retained findings and next experiments](LEARNING.md) for the project memory,
the distinction between runtime selection and session knowledge, and historical
experiments with the now-retired shared registry.

Coding agents authored the algorithms and proofs during development. Runtime
learning remains bounded selection from those implementations. Persisted
evidence can be revalidated and reused locally; the program does not autonomously
invent new source, train neural weights, or discover arbitrary causal laws.
Proofs do not establish compiler/hardware correctness, empirical usefulness
outside the stated tasks, faster execution, or AGI.
