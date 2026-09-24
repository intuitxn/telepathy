# Decentralized agent mesh: system proposal

**Status: DRAFT — for human review. No implementation or publication authorized by this file.**
**Date:** 2026-09-24 · **Author:** meta (drafting orchestrator) · **Reviewer:** Shubham (owner)
**Supersedes:** the deferred M1–M8 federation direction (`docs/designs/a2a-protocol.md`, whose active baseline is already standard-OpenCode with federation deferred — there is no live relay-centered build to replace) as the build plan, plus the lost 2026-09-24 federation draft. Relay doc retained for the Nostr-anywhere future.
**Companion spec:** `2026-09-24-routing-brain.md` (capability schema + verb registry + learned router θ).

---

## 0. Problem

The resident service is live but loopback-only; telepathy is single-host; the fleet (tailnet: air + mini online; pro, iphone, mem offline; SSH tier: runpod, mi300x, lightning, dashboard) has no shared execution plane. Prior design centered a relay (Buzz/Nostr) for rendezvous, identity, and memory — but the mesh already has transport (Tailscale/WireGuard), discovery (`tailscale status` + MagicDNS + `:4096`→401), execution (`opencode serve` + `run --attach`/`prompt_async`), mobility (`export`/`import`, `share`), and files (Taildrop, git). No relay is required for agents to stay live and work together. The missing pieces are: per-node serving config, a gossip-carried directory + job board + membership, agent-decided routing, and the standing policy agents run on.

**Measured baseline (2026-09-24):** air answers `200` + open HTML on loopback `:4096` (no password set) and `000` via tailnet (loopback bind) — reachable-but-open locally, unreachable remotely. Mini answers `401` over tailnet (password set). Phase 0's first act is password-before-bind on air: no `0.0.0.0` until a password is set and verified.

## 1. Outcome and owning scope

**Outcome:** every device is a self-managing node (KeepAlive → self-sync → serve → advertise); agents decide placement, relocate by export/import/share, and return results; routes emerge from gossiped observations + learned π; the harness improves as a side effect of accepted work. No controller, no relay, no scheduler. Nostr/Buzz reserved for the day a participant can't join the tailnet.

| Area | Owner | Notes |
|---|---|---|
| Resident service, presence, job ingest, worker (`run`/`acp`) | **`telepathy/`** (canonical; plist + live proc verified) | LaunchAgent `space.intuitxn.meta`; `meta_shell.py` on `:47831` |
| Gossip transport + CRDT directory/jobs/membership | **`telepathy/runtime/`** (`gossip.py` + `relay.py` **to be created** — neither file exists) | one `POST /sync` endpoint; T=1s, F=2, K=2 |
| Routing brain (spec) + verb registry + learned router θ / observation logs | **`telepathy/artifacts/proposals/2026-09-24-routing-brain.md`** → implements to `telepathy/runtime/` | the one new logic component |
| Telepathy tools (same surface, mesh-aware peers) | file present at `~/.config/opencode/plugins/telepathy.ts` but **retired/inactive** (absent from `opencode.json` plugins; `AGENTS.md:19`) | peers = directory + tailnet once re-activated; local files become cache |
| Agent standing policy (route/move/share/sanitize/audit) | **`telepathy/`** docs → agent charters | the one artifact agents run on |
| Design docs, proposals, HARNESS_STATE | **`telepathy/`** | this file's home |
| Relay/Buzz | **external / deferred** | not in the build plan; re-activate iff cross-trust requirement appears |

## 2. Design (five mechanisms, all native except one)

1. **Gossip + CRDT + SWIM-lite** (the load-bearer): directory (LWW-map), job board (claim-once LWW), membership (SWIM incarnations) ride one 1s tick over the tailnet. Equations: `s_{t+1} = s_t·e^{−f(1−s_t)}`, `T(n) = log_{f+1}(n) + (1/f)·ln(n)` → n=5 converges in ~2–3 rounds. Lamport `(C, node)` stamps order everything; monotonic clock paces everything. Merge laws (idempotent/commutative/associative) are the convergence proof.
2. **Agent-decided routing** (spec companion): classify (declared > inferred > learned) → route by π(job,cands;θ) → observe and feed back. No scheduler; learned policy routes the work.
3. **Mobile sessions**: `export --sanitize` → Taildrop/`cp` → `import` → continue (mesh-internal); `share` → link (human/cross-trust). Agents relocate to hardware; bounded steps delegate instead.
4. **Self-managing nodes**: KeepAlive + on-start self-sync (git pull config, version check) + bounded execution + checkpoints. Five-property node contract (§4).
5. **Mesh + SSH one table**: capability records carry `access:{mesh|ssh}`; `run --attach`/`prompt_async` for mesh, `ssh <host> '<cmd>'` for bounded SSH compute, tunnel for SSH sessions. Promotion ladder: ssh-only → tunnel → `tailscale up` + serve.

**Held, not built:** Nostr-anywhere (needs cross-trust users + signer custody), split inference/Petals-style (needs link proof), scheduler/queues (needs proven contention).

## 3. Phased plan (ordered, with rationale)

Order is dependency-forced: serve before discovery can see you (§0); directory before routing has addresses (§1); claims before work is safe (§2); routing brain before autonomy is safe (§3); mobility + learning last, on top of a working plane (§4).

### Phase 0 — Node contract + serve (gates on Q3; Q4 resolved passwordless)

**Gate.** Q3 (`share: manual`) is decided BEFORE Phase 0 executes. Q4 resolved: **passwordless for now** — no server password; perimeter is Tailscale membership alone. Username mapping deferred until identity is needed; movement via import needs no credentials. Bind the node's Tailscale IP only (never `0.0.0.0` — without a password that would expose serve to the LAN).

**Smallest change (bind tailnet IP, then config; no password).**
1. **No password.** No secret to generate, store, distribute, or rotate. Trust = tailnet membership (per-device WireGuard identity). Explicit cost: anyone on the tailnet can call any node's API — acceptable on a personal tailnet, stated here. If a non-owner device ever joins, re-open Q4 (passwords or scoped credentials) before it serves.
2. **CREATE the canonical config** at `telepathy/opencode.json` (it is currently a stub) — nodes `git pull` it. `<tailscale-ip>` is per-node (stable 100.x; `tailscale ip -4`); the file documents the shape, each node fills its own IP:
```json
{
  "$schema": "https://opencode.ai/config.json",
  "server": {"port": 4096, "hostname": "<tailscale-ip>", "mdns": true},
  "share": "manual"
}
```
3. **Resident service:** separate KeepAlive LaunchAgent for `opencode serve` (do not edit `space.intuitxn.meta.plist`, which owns the meta shell); no secrets in env; restart procedure `launchctl unload/load`.
4. **Safety invariant (tailnet-only bind):** serve answers `200` open — so it must never touch the LAN. Bind the Tailscale IP; verify `curl http://<tailscale-ip>:4096/` → `200` from a peer while the LAN IP refuses. Reachability without authentication is the design; confinement to the tailnet is the guardrail.

**Five contract properties (defined for `meta_status`).** `supervised` = KeepAlive loaded and process alive; `synced` = canonical config pulled at/after this commit; `serving` = `:4096` answers per acceptance below; `bounded` = serve runs with the policy budgets (no unbounded spawn); `checkpointed` = clean-restart path verified (stop → state intact → start).

**Acceptance (exact procedure, run from a peer).**
1. `curl -s -o /dev/null -w "%{http_code}" http://<peer>:4096/` → `200` (serving, open by design; mini's existing `401` is cleared in this phase).
2. Same path via the node's LAN IP → refused/`000` (confined to tailnet, never LAN-exposed).
3. `tailscale status` lists all expected members with correct online/offline.
4. `meta_status` reports all five properties true.
5. Distinguish: `200` via tailnet = live node (pass); `000` via tailnet = down/loopback-only (fail); any `401` = unexpected password still set (clear it).

**Rollback.** Revert `telepathy/opencode.json`; `launchctl unload` the serve agent; restart loopback-only serve; confirm `000` via tailnet. No secrets to rotate (passwordless).

### Phase 1 — Gossip transport + CRDT directory (the load-bearer)

**Smallest change.** One `POST /sync` endpoint per node implementing `GOSSIP/PULL/PING/PING_REQ/HELLO` per the pseudocode (digest → delta → join, transitive forward, SWIM-lite suspicion, LWW `(lamport, node)` merges, monotonic timeouts).

**Acceptance.** 5-node fleet converges a fresh capability record in ≤3 rounds; partition-heal replays zero losses and zero duplicates-effects; kill one node mid-round → suspect within TTL, dead after, traffic reroutes; duplicate/reordered/lost packets change nothing (property test on the join laws). Rollback: stop gossiping; nodes run local-only.

### Phase 2 — Jobs + dispatch (mesh + SSH adapters)

**Smallest change.** Claim-once job records on the board; mesh adapter (`run --attach`/`prompt_async`) and SSH adapter (`ssh <host>`) behind one `dispatch(target, job)`; result acceptance re-checks the stamped winner. Placement here uses static `price` from capability records only — learned router weights θ arrive in Phase 3.

**Acceptance.** Replay a job twice → one row, one executor; unsigned/unknown caller rejected (password + tailnet membership); an SSH-only and a mesh target compete — winner by π (sample/argmax; cold-start prior = price), mechanism follows `access`; thread root + origin stamp travel with the job. Rollback: dispatch flag off; local-only.

### Phase 3 — Routing brain live (classify → route → observe)

**Smallest change.** Implement the companion spec: registry, observation/lesson G-sets (union), TTL load map, learned kind LWW-map on accepts, θ via gradient / BoN-distill in τ_int per spec §3.

**Acceptance.** Per the spec §5: attraction ≤3 rounds; 10× repeat converges to stable winner with observation G-set digests identical mesh-wide and routes settled under π; killed winner drains with no config change; novel wording routes correctly after ≤2 observations; all of it with any single node (incl. any "coordinator") powered off. Rollback: static registry + local-prefer; learning pauses.

### Phase 4 — Mobility + self-updating harness (autonomy, safely)

**Smallest change.** Standing policy artifact (move/share/delegate rules, never-share list, `--sanitize` default, audit format); session export/import + share wired to policy; accepted-job lesson deltas gossip into observation/lesson G-sets (+ kind map) and HARNESS_STATE drafts; θ updates in τ_int.

**Acceptance.** A session relocates air→mini via export/Taildrop/import and continues verifiably; a cross-trust handoff uses `share`, never raw export; every share/export/move appears in the audit log with what/where/when; a repeated pattern (≥2×) drafts the smallest policy/config change; nothing requires a human gate, everything is reviewable after. Rollback: policy to manual-approve; lessons stay local.

## 4. Rules that hold throughout

- **Nodes dial out and serve; nothing dials in uninvited.** Tailnet membership is the entire perimeter (passwordless by decision; re-open iff a non-owner device joins). Serve binds the Tailscale IP only — never LAN-reachable. No cross-subnet mDNS dependency, no relay.
- **Lamport orders, stopwatch paces.** `(lamport, node)` arbitrates every merge and claim; monotonic time runs timers, timeouts, TTLs. Wall-clock never crosses the wire for ordering.
- **Coordination is ephemeral, memory is retained.** Telepathy/job events transient; lessons/engrams/HARNESS_STATE durable. Same gossip bus, different retention — never replay mail as memory.
- **State stays local; events travel.** Sessions, mailboxes, worktrees live where owned. What moves: job requests, results, session JSON, config/lessons, files. No shared mutable state, no distributed lock.
- **Secrets never move.** Sanitize-by-default on export/share; never-share list enforced in policy; agents carry no keys across nodes.
- **One owner per mutable record.** Directory record: owning node. Job row: claiming node. Lesson: accepting scope. Cost tables: merge by rule, dispute by evidence.
- **mDNS is LAN convenience, not mesh reachability.** Tailnet reachability = bind + password. `mdns:true` advertises `_http._tcp` on the local subnet only; MagicDNS names resolve regardless. Never gate mesh acceptance on mDNS.

## 5. Open questions and labeled guesses

1. **Capability record home:** git file vs node endpoint (`GET /caps`)? [guess: node endpoint, gossiped — single source, no sync skew.]
2. **Price policy:** static asks in the record vs dynamic by load? [guess: static to start, load-term in the learned policy does the dynamics.]
3. **Share default:** `manual` + autonomous policy (recommended) vs literal `auto`? Decision needed — `auto` links everything including secrets-bearing sessions.
4. **Mesh password: RESOLVED passwordless.** No server password; perimeter is Tailscale membership; bind Tailscale IP only. Username mapping deferred until identity is needed. Re-open iff a non-owner device joins.
5. **Scheduler:** confirmed unnecessary until proven contention. Revisit iff repeated double-claims or starvation observed.
6. **Nostr re-activation condition:** a participant that cannot join the tailnet + need for verifiable cross-trust memory. Until both true, deferred (and with it, the signer-custody problem).

## 6. Decision needed

Approve (a) the phase order, (b) the node contract as Phase 0's acceptance, (c) Q3 (`manual`) — decided FIRST, as Phase 0 gates on it (Q4 already resolved: passwordless) — and (d) Phase 0 as the first job thereafter: bind tailnet IP, then canonical node config in repo. Phases 1–4 each gate on the prior acceptance. The relay design (`docs/designs/a2a-protocol.md`) stays as the Nostr-anywhere blueprint.

---

**Status: DRAFT — for human review; no implementation or publication authorized.**
Supersedes the deferred M1–M8 federation direction as the build plan (relay doc kept for Nostr-anywhere future).
