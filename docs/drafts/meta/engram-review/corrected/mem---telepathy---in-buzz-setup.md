# DRAFT - NOT SENT — proposed replacement body for `mem/telepathy/in-buzz-setup`

Source evidence (read-only, 2026-09-24):
- `runtime/worker/system.bend` live sha256 `1b8baaf9f8036024561b15d4c4a99df3f96c62e5ccdd5099b47bb14e6068f182`;
  recorded `6e224e26d47c56d3601b26b55ae77497ab4680cacda89846640380a1d9e69d74` superseded
- Pattern `6e224e26` in exactly 2 of 22 agent slugs (this + `mem/mundus/world-model-2026-09-22`)
- Relay base-hash: `44596124f8b19eec0230ee10fd0b57a3aa871a9dd7a593c0484325400d35fabb`
- File `runtime/worker/system.bend`: PRESENT live

---

slug: telepathy-in-buzz-setup
scope: Evidence-backed setup finding. Retain only after Shubham reviews this exact
content; the owner-controlled Buzz signer performs the send. Not yet sent.
CORRECTION 2026-09-24 appended; no new live checks asserted.

Finding
In Buzz Desktop 0.5.23 the ACP child process is selected by the managed-agent
fields `agent_command` / `agent_command_override` (live agents currently use
`codex-acp`), which `buzz-acp` consumes via `--agent-command` / `--agent-args`
(CLI defaults `goose` / `acp`). Pointing `agent-command` at the absolute OpenCode
binary with args `acp` runs stock OpenCode, and the global plugin
`~/.config/opencode/plugins/telepathy.ts` then loads.

Observed checks (2026-09-22, unchanged)
- OpenCode 1.18.32 `initialize` over `opencode acp` -> protocolVersion 1.
- A headless `opencode run` listed all 7 `telepathy_*` tools; telepathy peer
  count rose 10 -> 12. So the plugin loads in stock sessions.
- Bend 2.0.21; worker `runtime/worker/system.bend`
  sha256 6e224e26d47c56d3601b26b55ae77497ab4680cacda89846640380a1d9e69d74
  (2026-09-22 value; SUPERSEDED — live sha 2026-09-24 is
  1b8baaf9f8036024561b15d4c4a99df3f96c62e5ccdd5099b47bb14e6068f182)
  `--check-only` -> `All terms check.`; help lists worker/claim/packet/return/learn.

Required change (owner-gated) (unchanged)
- Run `buzz agents draft-update --channel <uuid> --agent-name <name> --runtime opencode`,
  or set the Desktop agent form, so `agent-command` = `/Users/a3fckx/.opencode/bin/opencode`
  and `agent-args` = `acp`. Requires `BUZZ_AUTH_TAG` + `BUZZ_PRIVATE_KEY`.

Limits / counterexamples (unchanged)
- The `opencode acp` `session/new` probe did not return in 20 s (initialize did),
  so end-to-end ACP session creation is not yet observed.
- No identity, credential, send, or publish was created; workers must not edit the
  app-managed `managed-agents.json` or inject keys.
- Local Bend snapshots and Buzz engrams remain separate stores.

CORRECTION (2026-09-24): the only stale piece is the pinned `system.bend` sha.
All setup observations stay scoped to 2026-09-22. Re-verify `--check-only` on the
live sha before citing this entry as current.
