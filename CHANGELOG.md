# Changelog

## [Unreleased]

### Added

- Harness boundary document (`HARNESS.md`) — accepted via the first end-to-end desk job (owner Shubham, runtime Codex).
- Relay setup reference (`docs/RELAY_SETUP.md`) — written by the first relay-sourced job (requested from the Buzz telepathy channel, accepted by Shubham).
- Declarative meta-agent registry (`plugins/telepathy-meta-agents/registry.json`) — the site's Interfaces catalog now renders from it; all site tests pass.
- Agent map (`docs/AGENT_MAP.md`) and living harness state (`docs/HARNESS_STATE.md`) with a dated lesson log that Steward maintains.
- Desk `accept` command — completes the Job lifecycle on the ledger (Review -> Resolved) with a named human reviewer and timestamp.

### Changed

- Agent charters (`.opencode/agents/`) now describe the real harness: desk engine, Codex/openCode runtimes, state stores, boundary rules, and the learning loop.
- Runtime config prompts (`setup.js`, v2 pilot) aligned with the harness.
- Execution runtime decision: Codex is the default worker; openCode v2 remains for interactive planning only (its free zen models returned `ModelUnavailable` in a live job test).

### Fixed

- Desk openCode runtime now passes a `provider/model` reference to the session API instead of a bare model string.


All notable Telepathy product changes are recorded here. Planned work stays in the GitHub Project and is not listed as shipped.

## [0.1.0-alpha.1] - 2026-09-02

### Added

- Live GitHub Pages preview of the browser-local human workspace.
- Now feed with updates, decisions, questions, announcements, replies, acknowledgements, and durable resolutions.
- Clearly labelled demo identities and local onboarding checklists for Shubham, Om, and Kush.
- Interfaces catalog for Prime, Build, Steward, Research, and Relationships, with intended routes and explicit human gates.
- Declarative `telepathy-meta-agents` Codex plugin, one operating skill, registry validation, and reference contracts.
- Accepted-activity Git projection format and CI integrity validation.
- Internal Job/artifact harness with transition, reservation, synchronization, and rejection tests.
- Human-first product contract, team communication SOP, private Intuitxn GitHub Project, Internal alpha milestone, and launch backlog.

### Changed

- Reframed Telepathy from an agent gateway into a human communication workspace with hidden execution infrastructure.
- Defined Git, OpenKnowledge, Obsidian, and Sites as projections of accepted work rather than competing sources of truth.

### Known limits

- The website persists data in one browser and has no authenticated shared backend or cross-device delivery.
- Om is an active Intuitxn member and Kush's organization invitation remains pending; both currently have read-only repository permission rather than contributor access.
- The intended custom domain and meta-agent subdomains are not live until authoritative DNS, managed HTTPS, access control, and host routing pass verification.
- The harness is local and unauthenticated; it must not be exposed as a production service.

[0.1.0-alpha.1]: https://github.com/intuitxn/telepathy/releases/tag/v0.1.0-alpha.1
