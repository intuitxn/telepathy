# System map — meta · nudge · telepathy → Buzz

Status: draft · 2026-09-22. Local, versioned source of truth for how the three
Intuitxn systems are identified and managed in Buzz. It performs no relay write
and authorizes no publication. Owner signer applies every Buzz change.

## 1. The three systems

| System | What it is | Canonical source (local) | Runtime / interface |
|---|---|---|---|
| **telepathy** | Coordination + human-context layer. Inter-agent mailboxes/registry and the meta-agent charters that route intent. | `telepathy-shared-learning/.opencode/agents/*.md` · `~/.config/opencode/plugins/telepathy.ts` · `~/.config/opencode/telepathy/` | OpenCode plugin + agents; Buzz is durable memory |
| **meta** | Orchestrator. The `/meta` loop, the one-file Lorenz worker that records worker state, and global agent discovery of the charters. | `.opencode/commands/meta.md` · `.opencode/agents/meta.md` · `runtime/worker/system.bend` · `~/.config/opencode/plugins/meta-agents.ts` | OpenCode command/agent + Bend (`~/.bend/bin/bend`) |
| **nudge** | Compiles typed Markdown AI programs into immutable prompt bundles a harness can run. Portable package contract, not an agent framework. | `Attri/nudge` (Python, `src/nudge/program_dsl/`) · `programs/*.nudge.md` in this checkout | CLI `nudge`; MCP `nudge mcp` (stdio) |

> `oc2` is the retired custom fork and is **not** part of the active path.

## 2. Buzz surfaces (native NIPs)

| Surface | Buzz mechanism | Command | Holds |
|---|---|---|---|
| Program | NIP-MP project (kind 30621) + home channel | `buzz projects create \| get \| list \| add-channel` | one project per repo/system |
| Channel | relay channel (stream/forum) | `buzz channels` | discussion + job threads |
| Agent | NIP-OA agent identity | `buzz agents draft-create \| draft-update` | persona bindings |
| Memory | NIP-AE engram | `buzz mem ls \| get \| set \| patch` | selected durable findings |
| Workflow | relay workflow YAML | `buzz workflows` | optional; `request_approval` is NOT enforced upstream |

## 3. Mapping

| System | Buzz program (proposed) | Home channel | Persona (proposed) | Charter(s) | Memory slug (proposed) |
|---|---|---|---|---|---|
| telepathy | `telepathy` | `telepathy` (stream) | — | `@telepathy` (route) | `telepathy-routing` |
| meta | `meta` (new) | `meta` (stream) | — | `@meta` (orchestrate) | `meta-worker-protocol` |
| nudge | `nudge` (new) | `nudge` (stream) | — | (skill runtime, no charter) | `nudge-program-contract` |
| cross | — | `intuitxn-general` (forum) | Pollen→`@prime`+`@research`, Fizz→`@build`, Honey→`@steward` | `@prime @build @steward @research @relationships @bend-forge @relay-keeper` | — |

Persona pairings come from `docs/AGENT_MAP.md` and remain **proposed** until an
authorized Buzz read confirms the deployed personas.

## 4. Management — owner signer only

Do not inject `BUZZ_PRIVATE_KEY`/`BUZZ_AUTH_TAG` into an execution process. Run
these where the owner's Buzz signing environment is configured.

```sh
# 1. read current state (needs key)
buzz projects list
buzz channels list
buzz agents archived            # NIP-IA snapshot (read)
buzz mem ls --json

# 2. create the two missing programs (meta, nudge) + home channels
buzz projects create --slug meta  --name meta  ...
buzz projects create --slug nudge --name nudge ...
#    channel creation is drafted for owner review:
buzz projects add-channel <slug> --name <channel>

# 3. bind/refresh an agent's runtime to stock OpenCode ACP
buzz agents draft-update --channel <uuid> --agent-name <name> --runtime opencode
#    -> opens a prefilled edit form in Buzz Desktop; owner submits

# 4. retain a reviewed finding
buzz mem patch <slug> --base-hash <CAPTURED_SHA256> --patch-file <diff> --dry-run
```

Exact flags: run each subcommand's `--help` before the owner-gated change.

## 5. Blockers observed now (2026-09-22)

- No relay reachable at the CLI default (`http://localhost:3000` → `000`).
- `BUZZ_RELAY_URL`, `BUZZ_PRIVATE_KEY`, `BUZZ_AUTH_TAG` all unset; every relay
  read returns `auth_error`. Mapping is therefore local-only.
- Buzz Desktop **is** running (`buzz-desktop`, local API `127.0.0.1:63651`); its
  managed agents live at `~/Library/Application Support/xyz.block.buzz.app/agents/`.
  `global-agent-config.json` still says `"preferred_runtime": "codex"`.

## 6. `.claude` is not one of these systems

- The meta/nudge/telepathy charters come from `telepathy-shared-learning/.opencode/agents/`
  and `Attri/nudge` — **not** `.claude`.
- `.claude` only appears because: (a) OpenCode auto-discovers skills from
  `~/.claude/skills` and `Attri/.claude/skills` (Claude-compat), and (b) the
  Discord MCP command in `~/.config/opencode/opencode.json` runs out of
  `~/.claude/plugins/cache/...`. Canonical shared skills are `.agents/skills/`.
- `~/.claude/agents/*.md` (cal, crm, exec, …) are Claude Code subagents; OpenCode
  does not load them.

## 7. Open questions for the owner

1. Confirm relay URL + whether changes go through the CLI or Buzz Desktop forms.
2. Confirm the persona bindings (Pollen/Fizz/Honey) or replace this table.
3. Decide whether to drop `.claude` from the OpenCode skill discovery path.
