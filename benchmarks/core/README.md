# Executable Bend benchmark lane

`run.mjs` checks a one-file Bend candidate, builds a native binary once per source,
toolchain, and target identity, runs every declared case, and compares exact
exit status, stdout, and stderr. It prints **one JSON report** to stdout and
exits nonzero on any failed case or incomplete check/build. The runner's case
file, rather than the candidate or agent, supplies expected results.

```sh
node benchmarks/core/run.mjs
node --test benchmarks/core/run.test.mjs
node benchmarks/core/run.mjs --source /absolute/candidate.bend \
  --cases /absolute/frozen-cases.json --repeat 3
```

The default `reference.bend` and `cases.json` exercise a batched 256-step native
simulation, prediction versus disturbed observation, event-prefix replay with
fuel, a lexical retrieval baseline, scoped fusion, an out-of-scope heat change,
and both threshold and margin abstention. They are public regression fixtures,
not hidden evidence that an agent can invent algorithms or improve itself.

`kernel-cases.json` exercises the one-file Telepathy kernel. Its frontier cases
require the highest positive host-supplied estimate within a funded scan prefix,
zero-estimate abstention, admissibility and fuel checks, deterministic ties, and
an explicit `scan_exhausted` flag when a chosen action leaves candidates unread.
The 128-candidate case checks bounded native execution; timing includes process
startup and does not measure the quality or calibration of the estimates.

## Case format

```json
{
  "version": 1,
  "name": "case-set-name",
  "cases": [
    {
      "id": "unique-case-id",
      "category": "causal-replay",
      "args": ["replay", "2", "2", "3", "4"],
      "items": 2,
      "expect": {"exit": 0, "stdout": "clock=2;value=5\n", "stderr": ""}
    }
  ]
}
```

Each case runs the native binary with its argument vector. A candidate can
implement a batch command that processes many inputs in **one process**;
`items` counts the declared work units. Every repetition is checked, not just
timed. The runner does not execute shell text from a case file.

## Score a DSH receipt on host-owned cases

```sh
node benchmarks/core/run.mjs \
  --source /absolute/archive/candidates/SOURCE_SHA.bend \
  --cases /absolute/host-owned/held-out-cases.json \
  --receipt /absolute/archive/receipts/RECEIPT_ID.json
```

Receipt mode checks the receipt's source SHA/byte count, Bend identity, and
successful checker/build observations. A cached receipt must carry the original
successful command observations; `cached:true` alone is refused. The evaluator
then independently rechecks, builds, and executes the archived source against
**all** pinned cases. Exploratory cases in the receipt may differ from the score
set. If a receipt case has the same ID and args as a pinned case, its stored
observation must match the independent replay; any discrepancy fails that case.
Predicted stdout is compared with both observed and expected stdout, separately
from task correctness.

The DSH scoring tool must choose the case path from host configuration and
verify its digest. It must not let the candidate or model supply expected
outputs. Both direct and receipt modes accept only a one-file source with
`Base` imports. Candidate executions receive a scrubbed environment and a
restricted native read view; source checking and compilation remain host
operations that process untrusted text.

## Report fields and timing

The JSON report binds `source_sha256`, `source_closure_sha256`,
`evaluator_sha256`, `case_set_sha256`, and, in receipt mode,
`receipt_sha256`. `coverage` counts every declared case; `cases[].pass` and
`cases[].failures` give the exact verdict. `ok` and `passed` are true only when
coverage is complete and all cases pass. The report records observed exit code
and output for review. A binary that prints `PASS` and exits 7 fails a case
expecting exit 0.

`timing.check_ms`, `build_ms`, `cold_run_ms`, `warm_run_ms`, and `runtime_ms`
are separate. A cache hit reports `build_ms: 0`. `items_per_second` includes
process startup and every case category; it is **not** an algorithm-only speed
claim. `warm_batch_items_per_second` uses only repeated `throughput` cases after
their first invocation. The receipt's original check/build timings are kept in
`receipt_timing`, separate from the evaluator's fresh timing. Wall measurements
vary across runs; compare candidates under matched hardware, toolchain, cases,
and compute budgets. Model tokens/calls/cost are outside this runner and belong
in the DSH session score report.

This lane verifies the executable part of the algorithm machine. A separate
agent evaluation must measure pseudocode-to-Bend generation, fresh-task quality,
prediction calibration, and a self-modifying descendant against an unchanged
clone. Those claims cannot be inferred from these fixed fixtures.
