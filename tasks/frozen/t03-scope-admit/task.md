# t03-scope-admit

Goal: scope admit/deny decisions follow the frozen policy.

Policy: admit iff verb is `read` or `compute`, the resource is nonempty,
charset `[a-z0-9_-]`, and not in the deny list (`admin`, `root`). Matching is
byte-wise under `LC_ALL=C` so verdicts are locale-independent.

Acceptance: `run.sh` evaluates every scope in `input.txt` (one per line),
writes `admit`/`deny` per line, diffs against `expected.txt`, prints
`PASS t03-scope-admit cost=<N>s` and exits 0 iff identical.
Otherwise `FAIL` + nonzero.
