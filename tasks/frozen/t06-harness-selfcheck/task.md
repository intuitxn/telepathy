# t06-harness-selfcheck

Goal: the learning-loop harness itself is complete and runnable.

Acceptance: `run.sh` prints `PASS t06-harness-selfcheck cost=<N>s` and
exits 0 iff `tasks/frozen/score.sh` exists and is executable,
`scripts/learn-loop.sh` exists and is executable, and every
`tasks/frozen/t*/` dir contains a `task.md` and an executable `run.sh`.
Otherwise `FAIL` + nonzero.
