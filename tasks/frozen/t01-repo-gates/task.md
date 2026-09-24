# t01-repo-gates

Goal: the checkout exposes the required top-level gate files.

Acceptance: `run.sh` prints `PASS t01-repo-gates cost=<N>s` and exits 0
iff all of `README.md`, `SOP.md`, `AGENTS.md`, `HARNESS.md`, `package.json`
exist as regular files at the repo root. Otherwise it prints
`FAIL t01-repo-gates cost=<N>s` and exits nonzero.
