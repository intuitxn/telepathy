# t02-shell-syntax

Goal: key shell entry points are syntactically valid bash.

Acceptance: `run.sh` prints `PASS t02-shell-syntax cost=<N>s` and exits 0
iff `bash -n` succeeds on every file listed below. Otherwise `FAIL` + nonzero.

Checked files (relative to repo root):
- scripts/census.sh
- scripts/memory-sync.sh
- scripts/worktree-guard.sh
- scripts/learn-loop.sh
- tasks/frozen/score.sh
