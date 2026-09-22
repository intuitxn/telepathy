# Program: Sansara

- **slug:** `sansara`
- **repository:** `~/Desktop/Attri/sansara` (Go node, services, agent runtime)
- **channel:** `sansara` (stream) — the program's home on the Buzz relay
- **owner:** Shubham
- **reviewers:** Om, Kush
- **agents:** `@forge` for node changes, `@scout` for world/runtime questions, `@ledger` for release projection
- **runtime:** standard OpenCode with native Buzz ACP and the checked Bend worker; the node itself runs separately (local Go or Docker)
- **what it owns:** the agent portal, world runtime, wiki, federation

Jobs here change the Go node, the world graph, or the runtime adapters. Acceptance
requires the named human at an exact revision before anything deploys.
