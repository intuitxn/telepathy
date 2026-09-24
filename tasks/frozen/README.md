# tasks/frozen — frozen learning-loop task set

Deterministic, fast (<30s each), no network, no daemon.
Each task dir `tNN-name/` contains:

- `task.md` — goal + acceptance criteria
- `run.sh` — executes the task, prints one verdict line `PASS <name> cost=<N>s`
  (or `FAIL <name> cost=<N>s`), exits 0 on pass / nonzero on fail
- fixture files (e.g. `input.txt`, `expected.txt`, `mem.txt`) with fixed
  expected outputs where applicable

## Running

```sh
./tasks/frozen/score.sh            # runs all tasks
./scripts/learn-loop.sh baseline   # score + record run to /tmp/learn-loop-runs.log
./scripts/learn-loop.sh remeasure  # same, mode=remeasure
```

`score.sh` prints each task verdict, then a summary line:

```
passed=N total=M cost=Ss
```

and exits nonzero iff any task fails.

## Log

Each `learn-loop.sh` run appends one JSONL line to `/tmp/learn-loop-runs.log`
(mirrored at `tasks/frozen/runs.log`, gitignored via `tasks/frozen/.gitignore`).
The harness never auto-updates fixtures, code, or docs.

## Tasks

| dir | what it checks |
|-----|----------------|
| t01-repo-gates | required repo-root files exist |
| t02-shell-syntax | key shell scripts pass `bash -n` |
| t03-scope-admit | scope admit/deny fixture decisions match expected |
| t04-memory-parse | KEY=VALUE fixture lookups match expected |
| t05-kernel-presence | runtime `.bend` kernel files present |
| t06-harness-selfcheck | harness files (score.sh, run.sh, learn-loop.sh) all present |
