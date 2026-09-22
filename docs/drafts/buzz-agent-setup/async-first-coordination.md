# Buzz as the async-first coordination substrate (draft)

**Historical snapshot:** this draft predates the committed stock-OpenCode cleanup.
Its old HEAD, test counts, runtime availability and oc2/M3–M8 prerequisites are
not current claims. Retained for design provenance only. Use
[buzz-implementation-plan.md](buzz-implementation-plan.md) and
[the active build plan](../../../runtime/adaptive/HARNESS.md) for new work.


Status: historical draft, superseded · Date: 2026-09-22 · Scope: mapping the requested capabilities to
Buzz/Telepathy primitives, specifying the async-first coordination protocol,
reconciling the recorded drift, and proposing an ordered gated plan. This
document cites sources; it does not replace them, authorizes no writes, publishes
nothing, installs no daemon, and makes no commit. It is not an execution
authority.

Concurrency note: `docs/designs/a2a-protocol.md` was edited by a separate writer
during the same period (mtimes 2026-09-22) and now carries a "Mundus alignment —
2026-09-22" section (section at current lines 9-46, reviewer Shubham). Line
references below are from the working tree at 2026-09-22 and may shift; section
names are stable. Contradictions D1/D2/D8 in
`docs/drafts/buzz-agent-setup/coordination-index.md` are resolved in the working
tree but still conflict at Git HEAD `d7a6c7b` (see (c)).

## 0. Method and evidence

- Worker source resolved per `runtime/adaptive/META.md:17-24`: the packaged
  `runtime/worker/system.bend` (SHA-256
  `6e224e26d47c56d3601b26b55ae77497ab4680cacda89846640380a1d9e69d74`, per
  `runtime/worker/README.md:4-5`). `bend version` = 2.0.21; `--check-only`
  printed `All terms check.`; `-- help` lists `worker`, `claim`, `packet`,
  `return`, `learn`, so the META.md worker requirement is satisfied.
- One coordinator wrote a local, private, single-writer Lorenz snapshot lineage
  (`.local/meta-async-first/`, gitignored) using `init`/`capture`/`work`/`worker`/
  `claim`/`packet`. Kept separate from the retired shared-registry Lorenz core
  (`runtime/adaptive/HARNESS.md:25-33`); that stack is retired and was not
  invoked.
- `npm run check` passes: 9 desk tests + 2 plugin tests.
- No relay write, no `buzz mem` write, no publication, no commit were performed.

## (a) Capability → primitive map

Each row has all five fields populated. "Status" uses the source cited in that
row. "Owning source path" is the checkout path that owns the primitive.

| Capability | Buzz/Telepathy primitive | Owning source path | Status | Gap |
|---|---|---|---|---|
| **Buzz projects** | NIP-MP kind 30621 project (`d`-slug + `name`/`description`/`a`/`buzz-channel` tags); `buzz projects` CLI | `docs/AGENT_MAP.md:19-33` (program model); `scripts/setup-programs.sh`; live objects listed `docs/designs/a2a-protocol.md:107` | live — live projects telepathy, sansara, iktara, nudge recorded (`docs/designs/a2a-protocol.md:107`); relay project writes verified (`docs/HARNESS_STATE.md:37`) | Projects are not yet the routing anchor for jobs; no per-project agent membership/role binding, so a job is routed by channel/repository, not by project record |
| **Buzz workflows** | Workflow YAML DSL + run/approval records (`buzz workflows list/get/create/update/delete/trigger/runs/approve`) | `scripts/jtbd-workflow.yaml`; live `jtbd` workflow on telepathy, steps request→execute→accept→resolve (`docs/designs/a2a-protocol.md:106`) | partial — workflow object is live (`a2a:106`), but typed network intents are not implemented in the worker (`docs/designs/a2a-protocol.md:36-38`) | The workflow's `request_approval`/`send_message` actions are not bound to desk claim-once, per-channel cursors, or the Lorenz worker, so a workflow step cannot yet claim/return a worker packet |
| **Agent feed (hidden)** | Owner-only relay channel as the internal agent feed; NIP-AE engrams (`buzz mem`) for retained findings | `docs/designs/a2a-protocol.md:200,272` (`opencode-transcripts` channel, owner-only member, currently empty); `runtime/worker/BUZZ.md:49-82` (`buzz mem` surface) | partial — channel exists but is empty and is not yet designated/enforced as the agent feed; no isolation test | No membership-boundary enforcement or non-projection test yet; `buzz feed` (`a2a:108`) is a human social feed and must not be repurposed as the agent feed (see (b) privacy boundary) |
| **Doing + posting work in Buzz** | Desk job engine (claim-once + worktree + runtime) for doing; digest-gated outbox (`draft→sending→sent/uncertain`) + thread `accept` for posting | `runtime/desk/src/jobs.js:14-18,22-73` (claim/run); `runtime/desk/src/buzz.js:9-33,72-87` (queue/send/accept); `runtime/desk/README.md:5-8` | live — autonomous loop `Buzz message → queue → Codex → candidate → chat accept → commit/push → resolution reply` recorded (`docs/HARNESS_STATE.md:40`); relay writes verified (`docs/HARNESS_STATE.md:37`) | Posting is human-gated by design (`buzz.js:17-21`); no agent-to-agent posting exists, and any relay write needs the owner identity (`runtime/desk/src/buzz.js:3-5`) |
| **Session-level work** | Resident opencode2 node `127.0.0.1:4096` ACP sessions (`session/new`, `session/prompt`, `session/fork`, `compact`); desk `runtime: opencode` worker | `docs/designs/a2a-protocol.md:63-68` (node), `:83-98` (ACP), `:250-256` (intra-node); `runtime/desk/src/jobs.js:51-62` (opencode run) | live — ACP `initialize` verified live (`a2a:83-93`); a real model call completed in the node (`a2a:78`); desk opencode smoke job resolved (`docs/HARNESS_STATE.md:34`) | The node currently inherits a Buzz signing identity (`docs/FOUNDATIONS_AND_LIVE_USE.md:63`), contradicting keyless-execution custody; session traffic has no projection to the relay except accepted summaries (`a2a:272`) |
| **"In sync while async"** | Lamport clock + per-channel cursors + claim-once + source-event dedupe over the durable relay | `docs/designs/a2a-protocol.md:277-291` (Lamport design); `runtime/desk/src/buzz.js:50-70` (cursors/dedupe); `runtime/desk/src/core.js:24,76-84` (UNIQUE source); `runtime/desk/src/jobs.js:14-17` (claim-once) | partial — desk cursors/claim/dedupe are live (`runtime/desk/test/*`; `npm run check`), but the Lamport primitive lives only in the oc2 fork and is not wired to the Bend worker or Mundus intents (`docs/designs/a2a-protocol.md:40-43`; `runtime/adaptive/HARNESS.md:12` "Lamport wiring remain pending") | No single total order spans relay events, node sessions, and worker snapshots; Lamport merge is not yet invoked on job/worker ingest |

## (b) Async-first coordination protocol

### b.1 Relay-durable vs session-ephemeral

| Class | What lives there | Primitive / owning path |
|---|---|---|
| Relay-durable (survives sessions, shared) | Projects (NIP-MP kind 30621), workflows + run/approval records, channels/threads/requests/acceptance/receipts, NIP-23 notes (shared-files, node-directory), NIP-AE engrams (`buzz mem`), NIP-34 repos/patches/issues/pr, accepted Git revisions | `docs/designs/a2a-protocol.md:100-108,181,244,270-272,390-392`; `docs/AGENT_MAP.md:103-110`; `docs/HARNESS_STATE.md:8-10,37` |
| Local-durable (single-writer, not shared) | Desk SQLite job/artifact/outbox/cursor rows; the private Lorenz snapshot lineage; private Buzz engram drafts awaiting review | `runtime/desk/src/core.js:19-29`; `docs/BUZZ_SETUP.md:108-113`; `runtime/worker/README.md:41-44`; `runtime/worker/BUZZ.md:97-103` |
| Session-ephemeral (point-to-point, never the record) | ACP stdio `session/update` streams; model context and compacted summaries; worktree contents; prompts and tool calls | `docs/designs/a2a-protocol.md:182,236-244,268`; `docs/BUZZ_SETUP.md:80`; `.opencode/...` charters via `docs/designs/ux-ax.md:448`; `PRODUCT.md:66` |

Rule: **session traffic is point-to-point; durable/auditable facts go on the
relay or in Git** (`docs/designs/a2a-protocol.md:244`). Context horizons are
bounded to session + shared context layer + job thread; anything deeper is
re-fetched, never assumed (`a2a:262-275`).

### b.2 How Lamport + cursors + claim-once + dedupe produce "in sync while async"

1. **Lamport clock** — every local sync event ticks the clock; replaying a remote
   event merges `max(local, remote)+1`; projections order by
   `(clock, node_id, event_id)`; wall clocks are never trusted
   (`docs/designs/a2a-protocol.md:279-291`). The envelope carries
   `{origin_node, origin_clock, thread_root, parent_event, task, tier}` and the
   receiver merges `origin_clock` before recording the job (`a2a:288`). Status:
   primitive exists in the oc2 fork (`a2a:67`); not yet connected to desk ingest
   or the Bend worker (`a2a:40-43`).
2. **Per-channel cursors** — desk keeps a `stamp` per channel, rereads with a
   one-second overlap (`--since stamp-1`), and refuses to advance on a saturated
   page (`runtime/desk/src/buzz.js:50-67`; `docs/RELAY_SETUP.md:32-33`).
3. **Claim-once** — transitions are conditional updates guarded by state:
   `UPDATE jobs SET state='running' WHERE state='queued'` and
   `UPDATE outbox SET state='sending' WHERE state='draft'`
   (`runtime/desk/src/jobs.js:14-17`; `runtime/desk/src/buzz.js:20-21`). A claimed
   job cannot run twice (`docs/BUZZ_SETUP.md:117`).
4. **Source-event dedupe** — `source TEXT UNIQUE` plus `newJob` returning the
   existing row on a duplicate (`runtime/desk/src/core.js:24,80-84`); the key is
   `channel:event_id` (`runtime/desk/src/buzz.js:46`; `a2a:287,291`).

Combined effect: the relay thread is the durable causal history; each node
advances a per-channel cursor, converges on one deterministic projection via the
Lamport order, and executes each task at most once via claim-once + dedupe. A
replayed task runs once; reading the thread is reading the job's causal past
(`a2a:287-291`).

### b.3 Agent-feed privacy boundary (explicit)

**Boundary: the agent feed is an internal coordination surface and must never
become a human product surface.** It carries no human-visible authors, no
avatars, and is excluded from every feed view.

- `PRODUCT.md:15` — synthetic publishing identities are outside the first-product
  boundary; `PRODUCT.md:66` — "The interface exposes no agent transcript, prompt,
  or tool call." (`README.md` product rule restates: internal agent traffic must
  not become a product for people to monitor.)
- Enforced in the UI as a type/test rule, not convention:
  `docs/designs/ux-ax.md:24,434,454,461`; job/agent objects never render as feed
  rows or as authors.
- `docs/SHARED_PRODUCT.md:15` — meta-agent roles "do not become human feed
  authors"; `docs/AGENT_MAP.md:56` — Agent Manager session IDs and harness events
  are internal metadata.
- **Citation note:** the request cites `PRODUCT.md:13` for this boundary. In the
  working tree `PRODUCT.md:13` is the persona bullet `- Kush`; the operative
  boundary statements are `PRODUCT.md:15` and `PRODUCT.md:66`. Recorded here
  rather than silently reassigned.
- **Transcript channel:** `opencode-transcripts` — exists, owner-only member,
  currently empty; the projection target for accepted session summaries
  (`docs/designs/a2a-protocol.md:200,272`).
- **Human-gated posting path:** agent drafts (`queueMessage`, digest-addressed)
  → owner reviews the exact digest → `sendMessage` from the owner environment
  carrying `BUZZ_PRIVATE_KEY`; state is `draft→sending→sent|uncertain` with no
  automatic retry (`runtime/desk/src/buzz.js:9-33`; `docs/BUZZ_SETUP.md:33-39`).
  Retained findings follow the same gate: draft → Shubham reviews the exact
  content/hash → owner-controlled signer runs `buzz mem set`/`patch`
  (`runtime/worker/BUZZ.md:63-75`). Nothing posts itself.

## (c) Prioritized cleanup worklist

Every recorded drift item and every HARNESS_STATE roster/channel item is listed
with all affected paths and **one** proposed resolution. Nothing is dropped.
Priority: **P0** = repo/pointer correctness; **P1** = authority/contradiction;
**P2** = historical evidence.

| # | Priority | Item | Affected paths | Proposed resolution (single) |
|---|---|---|---|---|
| D1 | P0 | Retired shared-learning stack documented as active | `HEAD:runtime/adaptive/README.md:9-10,13,66-70`; `runtime/adaptive/HARNESS.md:19-33`; deleted `runtime/adaptive/SHARED.md`,`OPERATIONS.md`,`registry.mjs`,`lifecycle.mjs`,`maintenance.mjs`,`sync.mjs` | Commit the working-tree reconciliation so HEAD matches the tree (or, if intentionally uncommitted, rewrite `HARNESS.md:22-24` to "removal is staged, not committed") |
| D2 | P0 | `lifecycle.mjs` before/after hooks vs retired | `HEAD:runtime/adaptive/META.md:40-45`; `runtime/adaptive/HARNESS.md:19-27`; `runtime/worker/README.md:46`; `.opencode/commands/meta.md:21-25`; absent `runtime/adaptive/lifecycle.mjs` | Same commit as D1; keep the working-tree wording (worker/META/HARNESS/command all consistent) and leave the file deleted |
| D3 | P1 | Three disjoint node-agent naming schemes | `docs/designs/a2a-protocol.md:358-362`; `docs/AGENT_MAP.md:45-52`; `docs/AGENT_ROLES.md:14-18`; `plugins/telepathy-meta-agents/registry.json:2-126`; `site/src/interfaces.ts:26-76`; actual charters `.opencode/agents/{prime,build,steward,research,relationships,telepathy,relay-keeper,bend-forge}.md` | Adopt the charter names as canonical; map the a2a persona table to them (or mark the others as aliases) so every catalog cites one source |
| D4 | P1 | Fizz maps to different node agents | `docs/designs/a2a-protocol.md:359` (Fizz=@forge+@pilot); `docs/AGENT_MAP.md:64` (Fizz=@forge); undefined `@pilot` | Set Fizz→Build only (align with `AGENT_MAP.md:64` + `registry.json`); drop `@pilot` until a charter exists |
| D5 | P0 | Job-implementation pointer at an absent directory | `docs/INDEX.md:32` (`packages/harness/harness/jobs.ts`); `README.md:44-49` (`packages/harness/`, `agents/`); `package.json:4` (workspaces); `docs/HARNESS_STATE.md:11` (`runtime/desk`) | Repoint the code map to `runtime/desk/src/jobs.js`, `runtime/desk/`, and `.opencode/agents/`; `packages/` does not exist in this checkout |
| D6 | P1 | A2A "not shipped" vs "M2 implemented" | `docs/INDEX.md:3`; `docs/designs/a2a-protocol.md:1,3` | Change `INDEX.md:3` to "A2A protocol & identity — partially shipped (M1-M2); M3-M8 proposed" |
| D7 | P1 | Competing statements of the execution center of truth | `docs/HARNESS_STATE.md:11-15`; `docs/designs/a2a-protocol.md:183`; `:15-18` (`:4110`); `docs/SHARED_RELEASE.md:27` | State one layered authority explicitly and cross-reference: relay = durable human truth; desk SQLite = pilot execution ledger (`docs/BUZZ_SETUP.md:111`); node `:4096` = runtime session truth; `:4110` workspace service = shared product persistence |
| D8 | P0 | "Removed from the active tree" is not committed | `runtime/adaptive/HARNESS.md:22-24`; Git HEAD `d7a6c7b` (unstaged `D` entries) | Same commit as D1; the document's "removed" claim becomes true at HEAD |
| D9 | P1 | In-document supersession: M4 node key vs Mundus custody | `docs/designs/a2a-protocol.md:395` (M4 file list); `docs/designs/a2a-protocol.md:26-36` (Mundus) | Edit the M4 line to point at the supersession; key custody stays owner-side (no signing key in the execution node) |
| HS-3 | P1 | Telepathy channel roster lost its owner role | `docs/HARNESS_STATE.md:46`; `docs/RELAY_SETUP.md:16`; live telepathy channel roster | Owner re-grants the owner role on the telepathy channel (or records it as accepted-cosmetic with a dated follow-up) — **HUMAN-ONLY** relay write |
| HS-4 | P2 | Historical `needs_attention` jobs kept as evidence | `docs/HARNESS_STATE.md:47`; `docs/HARNESS_STATE.md:34` | Mark the item resolved with the 2026-09-08 fix date; keep the two job records as historical evidence |
| HS-1/2 | P2 | Already-resolved watch-loop identity / relay repo binding | `docs/HARNESS_STATE.md:44-45` | Record as resolved; no action (listed so nothing is silently dropped) |

## (d) Ordered, gated implementation plan (a2a M3-M8)

Gates: **Owner gate** (named human reviews exact revision), **Reviewer gate**
(second named human checks the stated evidence), **HUMAN-ONLY** (needs
credentials, a relay/Buzz write, or an owner send). Milestone line refs are from
`docs/designs/a2a-protocol.md` section 5 (M3-M8) at current lines 390-412.

1. **Step 0 — close the P0 repo/pointer drift (pre-M3).** Covers D1/D2/D5/D8.
   - Acceptance check: at HEAD there are no unstaged retired-stack deletions and `docs/INDEX.md:32` / the README repository map name paths that exist (`runtime/desk/src/jobs.js`, `.opencode/agents/`).
   - Gate: Owner gate. **HUMAN-ONLY** for the commit and any push.
2. **Step 1 — reconcile authority & naming (pre-M3).** Covers D3/D4/D6/D7/D9 and HS-3.
   - Acceptance check: one canonical agent catalog is cited by a2a/AGENT_MAP/AGENT_ROLES with no undefined agent names; the three execution stores are cross-referenced; the M4 key line points at the supersession; the telepathy roster owner role is restored or recorded cosmetic.
   - Gate: Owner gate + Reviewer gate. **HUMAN-ONLY** for the relay roster write.
3. **Step 2 — M3: node directory + Buzz identities + project/workflow binding.**
   - Acceptance check: the `oc2-node-directory` NIP-23 note exists with this node's `{node_id, pubkey, endpoints, lamport, tier, agents}`, every approved persona has an owner-admitted Nest identity, and the `jtbd` workflow is bound to the project channel.
   - Gate: Owner gate. **HUMAN-ONLY** (`BUZZ_AUTH_TAG`, Buzz Desktop `draft-create`, owner-environment send). Refs: `a2a:390-392`; `runtime/worker/BUZZ.md:49-89`.
4. **Step 3 — M4: NIP-98 A2A auth middleware, Mundus key custody.**
   - Acceptance check: unsigned request → 401; directory-signed request → 200; non-directory key → 401.
   - Gate: Reviewer gate. **HUMAN-ONLY** for restarting the service with a scoped key. Refs: `a2a:394-396`; custody rule `a2a:26-36` (closes D9).
5. **Step 4 — M5: ACP bridge process.**
   - Acceptance check: a scripted ACP client over the socket completes `initialize → session/new → session/prompt("reply exactly: OK")` and receives `OK`.
   - Gate: Reviewer gate. Refs: `a2a:398-400`.
6. **Step 5 — M6: inter-node/session delegation (draft-only).** Exercises session-level work and the sync protocol.
   - Acceptance check: node A delegates to node B (`smoke`), B's reply returns, A's `/health` Lamport ≥ B's origin clock, and replaying the same task creates exactly one job (cursor overlap + claim-once + dedupe).
   - Gate: Owner gate; **HUMAN-ONLY** if the trial performs any relay write. Refs: `a2a:402-404`; protocol (b.2).
7. **Step 6 — M7: context horizon + learning loop + hidden agent feed.**
   - Acceptance check: an accepted job yields a `docs/HARNESS_STATE.md` lesson draft plus an outbox note draft; a repeated failure pattern triggers the steward's smallest-change proposal; the accepted session summary projects only to the owner-only `opencode-transcripts` channel and appears in no human feed view.
   - Gate: Reviewer gate for the drafts; **HUMAN-ONLY** for every `buzz mem set/patch` retention and every outbox send. Refs: `a2a:406-408`, `a2a:272`; privacy (b.3).
8. **Step 7 — M8: tiered A2A rollout.**
   - Acceptance check: a member-tier node runs M6 delegation while its changelog/directory drafts are refused; a steward-tier node can draft changelog projections.
   - Gate: Owner gate. **HUMAN-ONLY** for the `oc2-team.sh` `access_tiers` edit and the owner-environment deployment. Refs: `a2a:410-412`, `a2a:366-376`.

## Verification commands run

```sh
BEND_NO_TELEMETRY=1 ~/.bend/bin/bend version              # bend 2.0.21
BEND_NO_TELEMETRY=1 ~/.bend/bin/bend runtime/worker/system.bend --check-only   # All terms check.
BEND_NO_TELEMETRY=1 ~/.bend/bin/bend runtime/worker/system.bend -- help        # worker/claim/packet/return/learn present
npm run check                                             # 9 desk + 2 plugin tests pass
git status --short                                        # only ?? docs/drafts/ (this draft)
```

## Outstanding work / boundaries

- The persona pairing source (`~/.buzz/PLANS/BUZZ_AGENT_PROMPTS.md`) is outside
  this checkout and was not read; every persona row in
  `docs/drafts/buzz-agent-setup/buzz-agent-registry.draft.json` stays `proposed`.
- A2A M1 (codex PATH fix) is not landed, so the Fizz `codex` runtime stays
  proposed (`docs/designs/a2a-protocol.md:140-144,382-384`).
- Lamport↔desk/worker wiring is pending (`a2a:40-43`); the node's inherited Buzz
  signing identity is unresolved (`docs/FOUNDATIONS_AND_LIVE_USE.md:63`).
- This draft implements none of M3-M8 and performs no cleanup; every resolution
  in (c) is a proposal awaiting the gate named by its plan step.
- No secrets, session identifiers, receipts, raw transcripts, prompts, or tool
  calls are included above.
