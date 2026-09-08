# Program: Telepathy

- **slug:** `telepathy`
- **repository:** `github.com/intuitxn/telepathy` (local checkout `~/Desktop/Attri/telepathy`)
- **channel:** `telepathy` (stream) — the program's home on the Buzz relay
- **owner:** Shubham
- **reviewers:** Om, Kush
- **agents:** `@telepathy` (primary) routing to `@atlas`, `@forge`, `@ledger`, `@scout`, `@diplomat`
- **runtime:** desk engine with Codex (proven); opencode2 interactive only
- **workflow:** `jtbd` (request -> execute -> accept -> resolve) — created from `scripts/jtbd-workflow.yaml`
- **chat:** mention the telepathy bot in-thread, or DM it; Pollen/Fizz/Honey cover scoping, status, and receipts
- **what it owns:** the human context layer, the Job contract, the meta-agent registry, the site alpha

Requests arrive as Buzz threads or NIP-34 issues in the home channel. Desk polls the channel,
runs accepted jobs in worktrees, and replies with candidates and evidence. Humans accept.
