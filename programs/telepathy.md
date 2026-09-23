# Program: Telepathy

- **slug:** `telepathy`
- **repository:** `github.com/intuitxn/telepathy` (local checkout `~/Desktop/Attri/telepathy`)
- **channel:** `telepathy` (stream) — the program's home on the Buzz relay
- **owner:** Shubham
- **reviewers:** Om, Kush
- **agents:** `@telepathy` (primary) routing to `@atlas`, `@forge`, `@ledger`, `@scout`, `@diplomat`
- **runtime:** standard OpenCode with native Buzz ACP and the checked Bend worker
- **workflow:** the former `jtbd` workflow (request -> execute -> accept -> resolve) was retired 2026-09-22 with the Desk engine; use native project review ([docs/PROJECT_REVIEW.md](../docs/PROJECT_REVIEW.md))
- **chat:** mention the telepathy bot in-thread, or DM it; Pollen/Fizz/Honey cover scoping, status, and receipts
- **what it owns:** the human context layer, the Job contract, the meta-agent registry, the site alpha

Requests arrive as Buzz threads or NIP-34 issues in the home channel. The relay
agent routes accepted jobs to the retained runtime, which runs them in worktrees
and replies with candidates and evidence. Humans accept.
