> Implementation update (2026-09-08): M2 network configuration is implemented. Live Codex and Buzz tool calls passed. The running node inherits a Buzz identity; the no-key assertion below is not true for this host. See [current verification and limits](../FOUNDATIONS_AND_LIVE_USE.md).

> Design proposal — not shipped. Prepared by an agent design pass on 2026-09-08.
> Every fact in section 0 was verified live (probes, exact outputs). Marked guesses are in section 6.
> Milestones M1–M8 are ordered and independently testable. Owner review required before any milestone starts.

# A2A Protocol Design — oc2 / Telepathy Agent Runtime Stack

**File:** `/Users/a3fckxmini/agent-workspaces/a2a-protocol-design.md`
**Date:** 2026-09-08 · **Author:** research agent (child of harness session)
**Scope:** unified auth (codex + opencode in one resident node), ACP-over-Buzz network topology, A2A inter/intra-node communication, identity mapping, continual node learning, and implementation milestones.

Every fact in this document was verified by reading the ground-truth files or by running live probes on 2026-09-08. Verified findings are stated plainly; unverified design options are marked **[guess]**.

---

## 0. Verified ground truth (one page)

### 0.1 Runtime stack

| Piece | Verified state |
|---|---|
| Resident node | `opencode serve` on `127.0.0.1:4096` (binds 0.0.0.0), LaunchAgent `intuitxn.oc2-node`, PID 1502, healthy v2.0.0, basic auth `opencode:<node-password>` |
| Node env (from `ps eww` on PID 1502) | `HOME=/Users/a3fckxmini`, `SHELL=/bin/zsh`, `USER=a3fckxmini`, `PATH=/usr/bin:/bin:/usr/sbin:/sbin`, `OPENCODE_SERVER_PASSWORD` — **nothing else** (launchd minimal env) |
| Node config | `GET /config` → model `opencode-go/deepseek-v4-flash`, plugins: updates, runtimes, navigate, launch, nudge, nodes, buzz (all local `.ts`), share disabled |
| Gateway | `oc2-gateway.py` on `127.0.0.1:4099` (LaunchAgent `intuitxn.gateway`, PID 1501), Bearer token intake, job queue in `state/gateway-jobs/`, `/health` reports `{"healthy":true,"jobs":N,"lamport":110}` |
| Lamport clock | one-row table `lamport_clock` in the node DB (`data/opencode/opencode-local.db`), value 110 at probe time; ticks on local events, merges `max+1` on remote replay; stamped on every sync-event envelope; exposed as `SyncEvent.clock()` and on gateway `/health` |
| opencode binary | `~/opencode2/packages/opencode/dist/opencode-darwin-arm64/bin/opencode`, v2.0.0 |
| codex binary | `/opt/homebrew/bin/codex` → `Caskroom/codex/0.153.4/bin/codex` (codex-cli 0.153.4) |
| Buzz CLI | `~/.local/bin/buzz`; relay `https://intuitxn.communities.buzz.xyz` (REST/JSON), `wss://intuitxn.communities.buzz.xyz` (WebSocket, 101 handshake verified live) |
| Buzz identity env | `BUZZ_PRIVATE_KEY` (nsec), `BUZZ_RELAY_URL`, `BUZZ_AUTH_TAG` (NIP-OA owner attestation) from `~/.config/buzz/environment.sh` |

### 0.2 Auth stores (all three verified)

| Credential | Location | How resolved | Works in the resident node? |
|---|---|---|---|
| codex (ChatGPT OAuth) | `~/.codex/auth.json` — `auth_mode:"chatgpt"`, tokens: `id_token`, `access_token`, `refresh_token`, `account_id`; no `OPENAI_API_KEY` | `$HOME/.codex/` | **Auth: yes. Binary: no** — see §1.3 |
| opencode (opencode-go API key) | `~/.opencode2-profiles/work/data/opencode/auth.json` — `{"opencode-go":{"type":"api","key":"sk-…"}}` | `$XDG_DATA_HOME` (exported by `oc2-node.sh`) | **Yes** — node session completed a real model call (`deepseek-v4-flash`, 15219 tokens, cost 0.00334906, reply "OK") |
| buzz (Nostr nsec) | `BUZZ_PRIVATE_KEY` env only (also keychain item `buzz-desktop` as fallback); `~/.buzz/nostr-keyfile` for git NIP-98 | env / keychain | **Deliberately no** — the node never holds the nsec; it drafts, humans send (design invariant) |

### 0.3 ACP in this fork (verified live)

`opencode acp` is an **Agent-side ACP endpoint over stdio** (ndjson JSON-RPC, `@agentclientprotocol/sdk` 0.16.1, `PROTOCOL_VERSION = 1`). Live `initialize` probe returned:

```json
{"protocolVersion":1,
 "agentCapabilities":{"loadSession":true,
   "mcpCapabilities":{"http":true,"sse":true},
   "promptCapabilities":{"embeddedContext":true,"image":true},
   "sessionCapabilities":{"fork":{},"list":{},"resume":{}}},
 "authMethods":[{"name":"Login with opencode","id":"opencode-login"}],
 "agentInfo":{"name":"OpenCode","version":"2.0.0"}}
```

- Agent methods (client → agent): `initialize`, `authenticate`, `session/new`, `session/load`, `session/list`, `session/prompt`, `session/cancel`, `session/close`, `session/fork`, `session/resume`, `session/set_mode`, `session/set_model`, `session/set_config_option`.
- Client methods (agent → client): `fs/read_text_file`, `fs/write_text_file`, `session/request_permission`, `session/update`, `terminal/create`, `terminal/output`, `terminal/kill`, `terminal/release`, `terminal/wait_for_exit`.
- `--port`/`--hostname` configure the **internal** opencode server the ACP shim wraps; the ACP stream itself is stdio. `--mdns` publishes the internal server via mDNS (`opencode.local`).
- The node's HTTP session API (specs/project.md) includes `POST /project/:id/session/:id/compact`, share, revert, permission, file status — usable by any SDK client.

### 0.4 Buzz relay object model (verified via CLI)

- `buzz users` — `get` (by `--pubkey`/`--name`/`--owner`), `set-profile` (`--name --avatar --about --nip05`), `set-status` (NIP-38 `--text --emoji`), `presence`, `set-presence` (kind 20001; **broken over HTTP per bundled buzz-cli skill**).
- `buzz agents` — `draft-create` / `draft-update` (open owner-reviewed forms in Buzz Desktop; need `BUZZ_AUTH_TAG`), `archive`/`unarchive` (NIP-IA kinds 9035/9036), `archived` (kind 13535 snapshot; one archived identity `55eff5…78c3`).
- `buzz mem` — **agent engram memory per NIP-AE**: `ls/get/hash/set/patch/rm`, slug-addressed, owner-scoped (`--owner` or `BUZZ_AUTH_TAG`), `patch` takes `--base-hash` for concurrency-safe updates; `rm` cannot delete `core`.
- `buzz pack` — persona pack `validate`/`inspect` (local, no relay).
- `buzz workflows` — `list/get/create/update/delete/trigger/runs/approve` (YAML definitions; the live `jtbd` workflow on telepathy has steps request→execute→accept→resolve).
- `buzz projects` (NIP-MP kind 30621) — slug `d`-tag + `name`/`description`/`a` (channel anchor)/`buzz-channel` tags; live: telepathy, sansara, iktara, nudge.
- `buzz notes` (NIP-23), `buzz canvas`, `buzz channels` (incl. `members`, roles `owner|member|bot`), `buzz repos/patches/issues/pr` (NIP-34), `buzz dms`, `buzz messages`, `buzz feed`, `buzz social`.
- There is **no `buzz users list`** — it is `buzz users get` (always returns an array).

---

## 1. Unified auth

### 1.1 Why the three credential stores already coexist

They are independent and resolved by different mechanisms, so they never collide:

1. **codex** reads `$HOME/.codex/auth.json` (ChatGPT OAuth). Nothing about the opencode profile changes `HOME`.
2. **opencode** reads `$XDG_DATA_HOME/opencode/auth.json` (opencode-go API key). `oc2-node.sh` exports the four `XDG_*` vars pointing at the profile before exec'ing the server.
3. **buzz** reads `BUZZ_PRIVATE_KEY` from the environment, and is *intentionally absent* from the node env (draft-only boundary: `buzz.ts` writes drafts to `~/.opencode2-profiles/work/OUTBOX/`; only the owner environment sends).

### 1.2 Verified answer — does codex auth work when dispatched through the node?

**Auth: yes. Binary resolution: no — currently broken by one launchd detail.**

Verified probes:

| Probe | Result |
|---|---|
| `codex exec --json "reply exactly: OK"` (plain shell env) | `agent_message "OK"`, exit 0 |
| Same with launchd-minimal env (`HOME` + `PATH=/usr/bin:/bin:/usr/sbin:/sbin`, nothing else) | `agent_message "OK"`, exit 0 → **auth resolution needs only `HOME`** |
| Same inside seatbelt (`sandbox-exec -f oc2-job.sb`) | `Error loading config.toml: Failed to read config file …/.codex/config.toml: Operation not permitted` → **sandbox blocks codex auth by design** |
| `Bun.which("codex")` with the node's exact PATH | `null` |
| `Bun.spawn(["codex", …])` with the node's exact env | throws `Executable not found in $PATH: "codex"` |
| `Bun.spawn(["/opt/homebrew/bin/codex", …])` with the node's exact env | works (`codex-cli 0.153.4`) |

Conclusion: the node process has `HOME`, so codex auth would work the moment codex actually runs. The resident node's launchd `PATH=/usr/bin:/bin:/usr/sbin:/sbin` does not contain `/opt/homebrew/bin`, so `runtimes.ts` (`runtime_run` codex branch spawns bare `codex`) **fails before auth is ever touched**, and `runtime_list` currently reports codex as unavailable. The desk engine side (telepathy) is unaffected: it runs codex from a different LaunchAgent whose plist explicitly sets a full `PATH` (`com.intuitxn.telepathy-desk-watch`), and HARNESS_STATE.md records fully autonomous codex jobs landing (`5046e555`, commit `05afab1`).

**One-line fixes (Milestone M1):**
- In `runtimes.ts`: `const CODEX_BIN = Bun.which("codex") ?? "/opt/homebrew/bin/codex"` and spawn the absolute path, or
- In `oc2-node.sh install`: add `<key>PATH</key>` to the plist `EnvironmentVariables` (copy the desk-watch plist pattern: `/Users/a3fckxmini/.local/bin:/Users/a3fckxmini/.hermes/node/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`).

Prefer the absolute-path fix in `runtimes.ts` (immune to cask upgrades) **plus** the plist PATH (fixes everything else that shells out, e.g. `git`, `docker`, `nudge`).

### 1.3 Sandbox handling (exact rules)

| Execution path | codex auth | opencode auth | buzz nsec |
|---|---|---|---|
| Node `runtime_run("opencode")` | n/a | works (node session verified) | absent (draft-only) |
| Node `runtime_run("codex")` (no seatbelt) | works once M1 lands | n/a | absent |
| Node `runtime_run("opencode-sandbox")` / gateway jobs (`oc2-agent.sh --sandbox`) | n/a | works (writes confined; auth.json is in `@STATE@` which is read-allowed) | absent |
| codex inside seatbelt (`oc2-job.sb`) | **denied by design** — `~/.codex` is in the deny-read list | n/a | denied (`~/.buzz` deny-read) |
| Desk engine codex (`codex exec --sandbox workspace-write`) | works — codex's *internal* sandbox applies after codex itself reads auth (proven in production jobs) | n/a | env-stripped before spawn (`delete env.BUZZ_PRIVATE_KEY`) |

Seatbelt policy stays as-is: user-sourced jobs must never read `~/.codex`, `~/.buzz`, `~/.ssh`, `.env` files. If a future seatbelted job truly needs a codex-grade model: pass a **scoped `OPENAI_API_KEY` via env** (env injection survives `sandbox-exec` because it is not a file read; `auth.json` supports the key field) **[guess — no scoped key was available to test]**. Do not weaken the sandbox profile.

### 1.4 The ONE env var: `INTUITXN_NETWORK`

**Name:** `INTUITXN_NETWORK`
**Value:** `https://intuitxn.communities.buzz.xyz` (relay base URL; the Buzz CLI accepts `http(s)` only for `--relay`). The live-stream endpoint is derived by scheme swap: `wss://intuitxn.communities.buzz.xyz` (WebSocket upgrade verified live).

It is the single network knob every layer reads; everything else is derived:

| Layer | Derivation |
|---|---|
| Buzz CLI / desk / buzz plugin | `BUZZ_RELAY_URL="${INTUITXN_NETWORK:-https://intuitxn.communities.buzz.xyz}"` |
| Live stream / subscriptions | swap `https://` → `wss://` |
| Channel UUIDs, workflow IDs, program slugs | relay directory note (M3), cached locally |
| Node endpoints | LAN: Bonjour `_oc2-node._tcp` (already live, `oc2-lan.sh`); WAN: labs tunnel |
| `BUZZ_PRIVATE_KEY` / `BUZZ_AUTH_TAG` | **never derived, never in the node** — secrets stay owner-side |

This replaces the scattered `BUZZ_RELAY_URL` defaults in `buzz.ts`, `desk` `buzz.js`, and `desk-watch.sh` with one source of truth (they keep `BUZZ_RELAY_URL` as a read-only alias for compatibility).

---

## 2. ACP-over-Buzz topology

### 2.1 Roles of each surface

- **Buzz relay** = directory + identity + causal message bus. It carries discovery (node directory note, channel members, NIP-IA/NIP-AE metadata) and thread traffic (requests, candidates, acceptance). It does **not** carry ACP streams.
- **ACP (stdio, per peer)** = the actual agent-agent session protocol: `session/new → session/prompt → session/update` with fork/resume. Point-to-point, spawned per inbound connection.
- **Node HTTP server (4096)** = the resident execution truth (sessions, plugins, model calls, Lamport clock). Intra-node everything talks here via the SDK.
- **Gateway (4099)** = LAN job intake for external tools/humans (token-auth), sandboxed.

### 2.2 Topology diagram

```
                      ┌─────────────────────────────────────────────┐
                      │  Buzz relay  intuitxn.communities.buzz.xyz   │
                      │  (https REST · wss stream)                    │
                      │                                              │
                      │  identity:   kind:0 profiles, NIP-IA agents,  │
                      │              NIP-OA ownership, NIP-38 status  │
                      │  directory:  NIP-23 notes (shared-files KB)   │
                      │              node-directory · harness-state   │
                      │  programs:   NIP-MP projects (telepathy,      │
                      │              sansara, iktara, nudge)          │
                      │  channels:   telepathy · changelog ·          │
                      │              opencode-transcripts · DMs       │
                      │  code:       NIP-34 repos, issues, patches    │
                      │  memory:     NIP-AE engrams (buzz mem)        │
                      └──────┬───────────────────────┬───────────────┘
                     draft/  │  human accept /        │  directory lookups
                    review   │  thread replies        │  (read-only, unsigned)
   ┌──────────┐     loop    │                        │
   │ humans   │◄────────────┴──────────────┐         │
   │ Shubham  │   (Buzz Desktop/CLI)       │         ▼
   │ Om, Kush │                            │   ┌────────────────────────────┐
   └──────────┘                            │   │ node A (this Mac)          │
                                           │   │ oc2-node :4096 (resident)  │
        LAN  (Bonjour _oc2-node._tcp)      │   │  ├ plugins: nodes/runtimes │
   ┌───────────────────────────────────────┼──►│  │   buzz/nudge/acp(bridge)│
   │                                       │   │  ├ subagent tree           │
   │  WAN (labs tunnel / named tunnels)    │   │  │   telepathy→atlas/forge/ │
   │                                       │   │  │   ledger/scout/diplomat/ │
   │        ACP bridge :4150               │   │  │   pilot                 │
   │        (NIP-98 signed,                │   │  ├ codex worker (M1 fix)   │
   │         spawns `opencode acp`         │   │  ├ Lamport clock (SQLite)  │
   │         per peer, pipes stdio)        │   │  └ gateway :4099           │
   └───────────────┬───────────────────────┘   └────────────────────────────┘
                   │ ACP session (stdio over signed TLS socket)
                   ▼
        ┌────────────────────────────┐
        │ node B (teammate's Mac)    │
        │ oc2-node :4096 + bridge    │
        │ own buzz keypair (nsec     │
        │ never leaves machine)      │
        └────────────────────────────┘
```

### 2.3 Message flow (inter-node job, numbered)

1. **Discover.** Agent on node A needs node B's `@forge`. It reads the local LAN cache (`state/lan-nodes.json`, produced by `oc2-lan.sh discover` — already implemented) and the relay `node-directory` NIP-23 note (shared-files KB). The directory entry per node: `{node_id, pubkey, endpoints:[lan,wss], bridge_port, lamport, tier, agents[], updated_at, event_id}`.
2. **Authenticate.** A opens a TLS connection to B's bridge and performs a **NIP-98 signed HTTP request** (Nostr event kind 27235 over HTTP headers, signed by A's node keypair). B validates: signature, pubkey ∈ directory, freshness (created_at within skew), tier capabilities. This reuses the exact scheme the stack already uses for relay git (`git-credential-nostr` + `nostr.keyfile`, verified in HARNESS_STATE lesson log) **[guess for the bridge itself — the fork does not yet implement NIP-98 middleware]**.
3. **Bridge.** B's bridge spawns `opencode acp --cwd <worktree>` as a child and pipes the socket ↔ stdio. A now speaks ACP v1 ndjson JSON-RPC directly to B's ACP agent.
4. **Session.** A sends `initialize` → `session/new` (worktree = the job's detached git worktree, per the desk job contract) → `session/prompt` with the causal envelope (see §3.4): `{thread_root, parent_event, origin_node, origin_clock, task}`.
5. **Execute.** B's agent runs in the worktree (opencode or codex runtime per `runtime_run`), streams `session/update` notifications back; B's node ticks its Lamport clock on each local event.
6. **Return.** Final assistant message + verification evidence travel back over ACP. A records the result in its desk ledger (job state) and **merges B's clock** (`Lamport.merge(remoteClock)` — already implemented in the fork's sync replay path).
7. **Human surface.** Per the invariant "tools prepare, humans accept": any relay-facing reply is drafted (OUTBOX / desk outbox digest-addressed), reviewed, and sent from the owner environment only. Replies carry the `root`/`reply` e-tags so the thread on the relay stays causally ordered.

### 2.4 Why ACP-over-Buzz and not "ACP inside Buzz"

Buzz channels are messages, not sessions; the relay is the wrong place for prompt/update streams (64 KiB content cap, human-audience semantics, moderation). The design keeps **session traffic point-to-point (ACP)** and **everything durable/auditable on the relay** (directory, identity, threads, receipts, engrams). One protocol for work, one ledger for truth.

---

## 3. A2A: inter- and intra-node

### 3.1 Intra-node (no relay, no bridge)

Inside one node, A2A is the **opencode2 subagent tree within a session** — declared as data in `plugin/nodes.ts` (telepathy → atlas/forge/ledger/scout/diplomat/pilot, each with charter + runtime + JTBD). Routing is `nodes_route` (narrowest JTBD score). The fork additionally supports:
- **`session/fork`** — fork a session so a sibling agent continues from the same context without mutating the parent (ACP `sessionCapabilities.fork` verified);
- **`session/list` / `session/load` / `session/resume`** — cross-session handoffs on the same node;
- **`POST …/session/:id/compact`** (specs/project.md) — horizon shrink inside a session;
- `runtime_run` for handing a bounded task to the codex worker and `opencode-sandbox` for user-sourced work (isolation tiers seatbelt/docker/vm via `tier_run`).

### 3.2 Inter-node (relay-referenced endpoints)

Inter-node A2A = §2.3 flow. Addressing rule: **an agent is addressed as `(node_id, agent_id)` resolved through the directory; a job thread is addressed by its Nostr thread root.** Credentials never travel through the relay — nodes authenticate to each other with their own keys (NIP-98), exactly like git to the relay repo today.

### 3.3 Context horizons

The horizon boundary for any A2A exchange is the **telepathy shared context layer** (channel canvas + shared-files notes + job thread), not raw session history. Concretely:

| Layer | Horizon | Mechanism (verified) |
|---|---|---|
| Session | compact window: summary + recent N messages | `POST /project/:id/session/:id/compact`; ACP `session/load` re-enters from the compact summary |
| Cross-session | the job brief | desk `brief()`: task data only; context snapshots sha256-pinned, 120 KB/file cap, copied into the worktree job folder |
| Cross-node | program canvas + harness-state + agent-map + registry | NIP-23 notes in shared-files KB; canvas as the index (verified live: telepathy canvas enumerates rules + program file); the receiving node loads these *before* `session/new` |
| Relay history | per-channel cursor with 1 s overlap, dedupe by `channel:event_id` | desk `poll()` (verified implementation); bounded page growth (100→10k, saturated page fails without advancing) |
| Transcripts | `opencode-transcripts` channel (exists, currently empty, owner-only member) | projection target for accepted session summaries — humans accept what lands there |
| Model budget | 15 min / 900 s max per job; 64 KiB Buzz content cap; nudge `[limits]` (max_turns/max_model_calls/max_input_chars) | enforced in `runtimes.ts` MAX_MS, desk `timeoutSeconds`, buzz CLI, nudge compiler |

Design rule: **an agent may read its session + the shared context layer + the job thread; anything deeper must be re-fetched through the relay or the owning node, never assumed.** (This mirrors the existing "honest tool" rule in buzz.ts/navigate.ts.)

### 3.4 Causal node routing (Lamport)

The fork already has the primitive (verified in `packages/opencode/src/sync/lamport.ts` and the `949059878` commit):

- every local sync event **ticks** the clock; replaying a remote event **merges** `max(local, remote)+1`;
- events are stamped `{id, seq, clock, aggregateID, data}`;
- `SyncEvent.clock()` and gateway `/health` expose it.

Causal routing rules on top:

1. **Thread roots are causal anchors.** Every inter-node task carries the Nostr thread root (`e` tag with `root` marker) and parent event id. The target node keys its job to `source = channel:event_id` (already how desk dedupes) — so a task replayed twice is executed once.
2. **Clock travels with the task.** Envelope: `{origin_node, origin_clock, thread_root, parent_event, task, tier}`. On receipt the target node runs `Lamport.merge(origin_clock)` **before** recording the job (one-line addition to the job-ingest path), so downstream events are causally after everything the origin knew.
3. **Total order is `(clock, node_id, event_id)`.** Lamport gives a partial order; projections (ledger activity, transcripts) break ties lexicographically. Wall clocks are never trusted (the stack already says "without wall clocks" in lamport.ts).
4. **Node routing is causal by construction:** a task is routed to the node that owns its thread root's repository (directory + program map); results flow back as replies to the same root, so the relay thread *is* the causal history — reads of that thread are reads of the job's causal past.
5. **Replay safety** = the existing desk rules: claim-once jobs (`UPDATE … WHERE state='queued'`), source-event dedupe, uncertain-send reconciliation before retry.

### 3.5 Continual node-learning loop

Already partially live; this design closes the loop across nodes:

```
accepted job outcome
      │ (human accepted exact revision — desk accept)
      ▼
steward/ledger drafts: resolution · changelog entry · HARNESS_STATE lesson
      │ (dated, specific, "written only after a human accepts" — verified lesson log)
      ▼
human approves the send (owner environment only)
      │
      ├──► lesson lands in docs/HARNESS_STATE.md  → published as NIP-23 note in shared-files
      ├──► changelog → changelog channel (steward tier only)
      └──► repeated pattern (≥2x) → steward proposes the *smallest* prompt/config change
              │ (ledger "may: draft HARNESS_STATE.md lesson entries and prompt updates
              │        from repeat patterns" — verified in registry.json + charters)
              ▼
      human approves → change ships via the oc2-sync bundle (owner publishes, nodes pull)
              ▼
      next sessions on every node read the updated harness-state note → improved
```

Machine-side memory, parallel to the human lesson log: **NIP-AE engrams via `buzz mem`** (verified command surface; owner-scoped, `patch` with `--base-hash` for CAS updates). Suggested slugs **[guess — nothing written yet]**: `node/codex-bin` (M1 lesson), `node/lamport-high-water`, `node/last-good-revision`, `node/known-failures`. Nudge programs make learned procedures digest-pinned bundles — a lesson that changes a program is a new program version (content-addressed, cycle-checked by the compiler).

Stewardship tiers gate who may draft what (§4.4); humans accept everything (the boundary invariant).

---

## 4. Identity mapping + user profiles

### 4.1 Verified identities (live relay)

| Buzz pubkey | Display name | Role on telepathy channel | Human/agent |
|---|---|---|---|
| `e43fcfd4…b4d7e7` | a3fckx | `owner` | **Shubham** (owner; reviewer name mapped in desk config) |
| `33f27bb6…b15b080f` | om2524 | `member` | **Om** |
| `5c1a5668…2ff87858c` | Kush | `member` | **Kush** |
| `051722e8…d238ee068f` | (no public kind:0) | `bot` | telepathy bot (desk runner) |
| `55eff5a3…78b78c3` | — | — | archived agent identity (NIP-IA snapshot) |

### 4.2 Profile schema (real Buzz fields, verified)

- **kind:0 profile** (read): `display_name`, `picture` (avatar URL; can be relay media or data-URI), `about`, `nip05`, plus injected `pubkey`.
- **Writable via `buzz users set-profile`**: `--name`, `--avatar`, `--about`, `--nip05`.
- **Status**: NIP-38 kind 30315 via `buzz users set-status --text --emoji` (the "status line" on the profile).
- **Presence**: kind 20001 via `buzz users set-presence` — broken over HTTP per the bundled skill; WSS needed **[guess]**.
- **Agent identity**: created only through owner-reviewed Buzz Desktop forms (`buzz agents draft-create --channel --display-name --system-prompt` → `{request_id, action, saved:false}`), archived via NIP-IA; ownership attested by NIP-OA (`BUZZ_AUTH_TAG`).
- **Persona packs**: local directory `validate`/`inspect` (`buzz pack`) — the right home for node personas (charter + map + boundaries as data) **[guess on pack schema; command surface verified]**.

### 4.3 Persona mapping (three-layer)

```
human user ──► buzz profile (kind:0 + NIP-38 status + tier role in channel)
persona    ──► Buzz Nest agent (Pollen/Fizz/Honey — Buzz Desktop personas,
                pairing table in ~/.buzz/PLANS/BUZZ_AGENT_PROMPTS.md)
node agent ──► charter file (config/opencode/agent/*.md) + entry in plugin/nodes.ts
                + interface row in plugins/telepathy-meta-agents/registry.json
```

Proposed mapping (from the pairing table, currently dormant-by-decision):

| Buzz persona | Node agent(s) | JTBD | Runtime |
|---|---|---|---|
| Pollen | @atlas + @scout | propose, scope, research | opencode (desk jobs via gateway) |
| Fizz | @forge + @pilot | implement, verify, ship | opencode **or codex** (`runtime_run`) |
| Honey | @ledger | resolve, project, learn | opencode |
| (no persona) | @telepathy | route | opencode |
| (no persona) | @diplomat | draft-external | opencode |

Mapping rule: **buzz pubkey → human profile is the relay's truth; persona → node agent is local data (charters + nodes.ts); node agent → buzz identity is an owner-admitted binding** (one node keypair per machine, keys never leave machines — same rule as today's owner-admitted Nest identities).

### 4.4 Tier-based permissions (from oc2-team.sh, verified)

| Capability | member | builder | steward |
|---|---|---|---|
| Agents | all | all | all |
| Plugins | nodes, runtimes, navigate, updates | all | all |
| Sandboxed jobs | always | always | always |
| Push path | manifest-pull | + gateway-token-jobs | + changelog-post |
| A2A (this design) **[guess — new]** | bounded inter-node jobs on own repositories only | + delegate jobs via gateway token | + draft changelog projections + node-directory updates |

Existing enforcement points: `oc2-sync.sh` filters the pulled bundle by `~/.oc2/tier` (default member), the gateway token gates `/job`, and the changelog channel post requires the owner environment.

---

## 5. Implementation milestones (8, ordered, each independently testable)

**M1 — codex works in the resident node (fix the PATH gap).**
Files: `~/.opencode2-profiles/work/config/opencode/plugin/runtimes.ts` (absolute `CODEX_BIN`, fallback `Bun.which`), `~/opencode2/script/oc2-node.sh` (plist `EnvironmentVariables.PATH`, same string as the desk-watch plist). Restart the LaunchAgent.
Verify: attach to node (`opencode attach http://127.0.0.1:4096`), call `runtime_list` → `codex: available true`; call `runtime_run(runtime="codex", task="reply exactly: OK")` → `codex exit=0` + "OK".

**M2 — `INTUITXN_NETWORK` as the single network knob.**
Files: `oc2-node.sh` (export + plist), `oc2-agent.sh`, `buzz.ts` (default `BUZZ_RELAY_URL` from it), `desk-watch.sh`, docs. Do not touch `BUZZ_PRIVATE_KEY` handling.
Verify: `unset BUZZ_RELAY_URL` in a shell with only `INTUITXN_NETWORK` set → `buzz channels list` still lists the six team channels; node tool `buzz_channels_list` returns the same.

**M3 — node directory on the relay.**
Files: new plugin tool `nodes_directory` in `nodes.ts` (drafts a directory update to OUTBOX; human sends), a NIP-23 `oc2-node-directory` note in shared-files (created via `buzz notes set`), reuse `oc2-lan.sh discover` for the LAN cache.
Verify: note exists with this node's `{node_id, pubkey, endpoints, lamport, tier, agents}`; `nodes_directory` on the node returns the same record plus the live clock from `/global/health`.

**M4 — NIP-98 A2A auth middleware on the node.**
Files: fork `packages/opencode/src/server/` (auth hook: verify kind-27235 signatures against directory pubkeys; keep basic-auth for local TUI). Node keypair stored like `~/.buzz/nostr-keyfile` (mode 600).
Verify: unsigned request → 401; a test script signing with the node's key → 200; a key not in the directory → 401.

**M5 — ACP bridge process.**
Files: new `oc2-acp-bridge.sh` + small TS entry (`opencode acp` already exists): listen on `:4150`, NIP-98 verify, then per peer spawn `opencode acp` and pipe socket↔stdio.
Verify: scripted ACP client over the socket completes `initialize → session/new → session/prompt("reply exactly: OK")` and receives "OK" (mirror of the stdio probe already done, but over the network).

**M6 — inter-node delegation tool (draft-only, as always).**
Files: plugin tool `agent_delegate` (node: directory lookup → NIP-98 attach → ACP prompt with causal envelope → Lamport merge on receipt → result into desk-style job record); second test node = the existing `smoke` profile.
Verify: node A delegates to node B in `smoke` profile; B's reply returns; A's `/health` lamport ≥ B's origin clock; replaying the same task twice creates one job (source dedupe).

**M7 — context horizon + learning loop wiring.**
Files: `buzz.ts` (tool `buzz_context`: canvas + harness-state + agent-map + thread load before inter-node sessions), ledger charter/desk (lesson draft on accept — already drafted, make it end-to-end), transcript projection note draft to `opencode-transcripts`.
Verify: accepted job → HARNESS_STATE lesson draft exists + outbox note draft appears; a second identical failure pattern triggers the steward's "smallest change" proposal.

**M8 — tiered A2A rollout.**
Files: `oc2-team.sh` (`access_tiers` gains `a2a` entries), `nodes.ts` (capability checks per tier), `oc2-sync.sh` unchanged (manifest-driven).
Verify: smoke-profile member node can run M6 delegation but its changelog/directory drafts are refused; steward tier can draft changelog projections.

---

## 6. Marked guesses / open questions

1. NIP-98 middleware on the fork's HTTP server does not exist yet — M4 is new code (scheme itself is proven in the stack via relay git).
2. Scoped `OPENAI_API_KEY` env-injection for seatbelted codex — untested (no scoped key available); auth.json supports the field, sandbox-exec passes env, so it should work.
3. Buzz `set-presence` requires the WSS path (bundled skill says HTTP is broken) — untested against WSS.
4. Persona-pack schema for `buzz pack` — command surface verified, pack file format not inspected **[guess]**.
5. Desk watcher config note: the live watcher config (`~/.local/share/telepathy-host/shared/config.json`) has 3 authorized pubkeys, 4 watched channels, and `autoRun: true` (re-verified 2026-09-08 15:45 local). An earlier probe read a stale checkout copy that showed an empty list — ignore that reading.
6. `opencode acp` port/mdns flags configure the internal server only; the ACP stream is stdio — hence the explicit bridge in M5 rather than "point ACP at the relay".
