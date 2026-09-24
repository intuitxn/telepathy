# t04-memory-parse

Goal: KEY=VALUE fixture lookups return the frozen values.

Acceptance: `run.sh` looks up `engram.alpha`, `kernel.mundus`,
`scope.default`, `policy.version`, and missing key `nope.missing` in
`mem.txt`, diffs the `key=value` lines against `expected.txt`, prints
`PASS t04-memory-parse cost=<N>s` and exits 0 iff identical.
Otherwise `FAIL` + nonzero. Missing keys resolve to the empty value.
