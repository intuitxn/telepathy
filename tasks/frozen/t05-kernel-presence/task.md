# t05-kernel-presence

Goal: the runtime kernel gate — required `.bend` kernels exist.

Acceptance: `run.sh` prints `PASS t05-kernel-presence cost=<N>s` and
exits 0 iff `runtime/crdt.bend`, `runtime/memory.bend`, and
`runtime/policy.bend` exist as regular files at the repo root.
Otherwise `FAIL` + nonzero.
