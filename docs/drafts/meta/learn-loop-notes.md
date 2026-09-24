# Learn-loop harness notes

Frozen task set under `tasks/frozen/` (6 tasks: repo gates, shell syntax,
scope-admit fixture, memory-parse fixture, kernel presence, harness
selfcheck). Each task has `task.md` (goal + acceptance) and `run.sh`
(prints `PASS/FAIL <name> cost=<N>s`, exit 0/nonzero); `score.sh` runs all
tasks and prints `passed=N total=M cost=Ss`, nonzero iff any fail.

Run: `timeout 120 ./scripts/learn-loop.sh baseline` (or `remeasure`).
Each run appends one JSONL line to `/tmp/learn-loop-runs.log` (mirrored at
`tasks/frozen/runs.log`, gitignored). BASELINE: `passed=6 total=6 cost=0s`.
Deterministic: fixed fixtures/expected outputs, no network, no daemon.
