# Telepathy in Buzz — verified native setup (draft)

Status: draft, engineering setup record · 2026-09-22. Not sent, not published,
creates no identity. Reviewer/owner decision required for the one host-config step.
No secrets, receipts, transcripts or session ids are recorded here.

## Request and acceptance

User request: *"can you set up telepathy in buzz"*.

Interpretation used: make the installed Buzz host run the native **Telepathy /
OpenCode ACP** agent harness — stock OpenCode (which loads the global `telepathy`
mailbox plugin) as the ACP `agent_command`, with `acp` as its args — instead of
assuming `codex-acp`. Local worker state stays in the one-file Bend worker.

Acceptance checks actually observed:

1. The absolute OpenCode binary completes an ACP `initialize` handshake.
2. The global telepathy plugin loads and registers peers/mailboxes in stock
   OpenCode sessions.
3. The Buzz host fields that select the ACP agent are identified from the
   installed configuration.
4. The one-file Bend worker checks clean and exposes
   `worker/claim/packet/return/learn`.
5. No new identity, credential or outbound send is created.
6. The exact owner-gated host-config change is recorded with source paths.

## Observed evidence

| Check | Command (read-only) | Observed |
|---|---|---|
| Bend | `~/.bend/bin/bend version` | `bend 2.0.21` |
| Worker source | `shasum -a 256 runtime/worker/system.bend` | `6e224e26d47c56d3601b26b55ae77497ab4680cacda89846640380a1d9e69d74` |
| Worker laws | `bend runtime/worker/system.bend --check-only` | `All terms check.` |
| Worker protocol | `bend … -- help` | lists `worker`, `claim`, `packet`, `return`, `learn`, `opencode` |
| OpenCode | `~/.opencode/bin/opencode --version` | `1.18.32` (same path resolves on PATH) |
| ACP handshake | `initialize` over `opencode acp` | `protocolVersion: 1`, `agentInfo { name: OpenCode, version: 1.18.32 }` |
| Telepathy plugin | installed global plugin | `~/.config/opencode/plugins/telepathy.ts`; store `~/.config/opencode/telepathy` |
| Plugin in a stock session | headless `opencode run` worker, no explicit model | reported `TELEPATHY_PLUGIN_OK` and listed all 7 `telepathy_*` tools; peer count rose 10 → 12 |
| Buzz CLI | `~/.local/bin/buzz --help` | Buzz Desktop CLI 0.5.23; `mem`, `workflows`, `agents` present |
| Buzz ACP bridge | `…/MacOS/buzz-acp --help` | `--agent-command` (env `BUZZ_ACP_AGENT_COMMAND`, default `goose`), `--agent-args` (default `acp`) |

### Where Buzz selects the agent

Installed host configuration (non-secret fields only):

`~/Library/Application Support/xyz.block.buzz.app/agents/managed-agents.json`

- `global-agent-config.json` → `preferred_runtime: "codex"`.
- Three live agents (Fizz, Honey, Pollen) each have
  `acp_command: "buzz-acp"`, `agent_command: "codex-acp"`,
  `agent_command_override: "codex-acp"`, `mcp_command: "buzz-dev-mcp"`,
  `agent_args: []`.
- The builtin template agents and `Attractor` have empty `agent_command`.

So Buzz currently launches `buzz-acp` whose ACP child is `codex-acp`. To run
Telepathy/OpenCode natively, that child becomes the absolute OpenCode path with
`acp` args.

## The exact change (owner-gated)

Required values:

```text
agent-command = /Users/a3fckx/.opencode/bin/opencode
agent-args    = acp
```

Native, reviewed path — this only opens a prefilled form in the owner's Buzz
Desktop; it does not save or start anything until the owner reviews it:

```sh
buzz agents draft-update \
  --channel <CHANNEL_UUID> \
  --agent-name "<existing agent name>" \
  --runtime opencode
```

This command requires `BUZZ_AUTH_TAG` and `BUZZ_PRIVATE_KEY`, which are **not**
present in this worker's environment and were deliberately not injected
(runtime/worker/BUZZ.md: signing belongs to the owner-controlled host). Applying
the change to the app's `managed-agents.json` directly is not done here: that file
is app-managed, holds agent auth tags, and currently drives working agents, so it
is an owner decision, not a worker edit.

## Boundaries and outstanding work

- No identity, credential, relay connection, send, or publish was created.
- The `opencode acp` `session/new` probe did not return inside a 20 s window
  (initialize did), so end-to-end ACP session creation is **not** yet observed;
  only the plugin's presence in a stock session was observed. Retain as an open
  item, not a success.
- Remaining owner action: run the `buzz agents draft-update` (or the Desktop
  agent form), set `agent-command` / `agent-args` as above, save, and verify a
  live Buzz turn actually reaches OpenCode and returns.
- Keep `codex-acp` available as the existing fallback until one native turn is
  observed.
- Local Bend state and Buzz engrams remain separate stores; this setup does not
  migrate or merge them.

## Sources

- `runtime/worker/BUZZ.md` (native ACP config, review boundary)
- `runtime/adaptive/META.md`, `runtime/adaptive/HARNESS.md` (one-file worker, no
  retired JS runtime)
- `~/Library/Application Support/xyz.block.buzz.app/agents/{managed-agents,global-agent-config}.json`
- `~/.config/opencode/plugins/telepathy.ts`
