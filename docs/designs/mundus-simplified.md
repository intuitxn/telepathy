# Mundus simplified — meta agents, ACP, Bend, and stateful GraphQL

**Status:** proposal (draft for Shubham review). **Date:** 2026-09-22.
**Supersedes as target:** the per-app runtime integrations described in
[SYSTEM.md](SYSTEM.md) and the oc2-node-centric parts of
[a2a-protocol.md](a2a-protocol.md). Historical M1–M8 federation work stays
deferred until a real multi-node need.

## Goal

Every product (forsee, telepathy, labs, meta) runs the **same agent pattern**:

- **Meta agents** — one meta-agent core, instantiated per product with a persona
  and toolset. No bespoke per-app runtime.
- **ACP** — the single agent interface. Agents talk ACP (stdio) to their host;
  `buzz-acp` bridges Buzz events to them. No custom watchers or bridges.
- **Stateful GraphQL** — the single app↔agent IO surface. Jobs, workspace state,
  chart results, and threads are live queries/subscriptions, not REST polling.
- **Bend** — unchanged: the checked logic layer (adaptive core, Lorenz memory,
  one-file worker protocol). Agents invoke it as a tool; it never speaks network.
- **Buzz relay** — unchanged: identity, channels, engrams, events, signer.
- **Protocols** — exactly three: ACP (agent↔host), GraphQL (app↔state),
  relay events/A2A (agent↔agent over Buzz).

## Target shape

```
        Apps: forsee · telepathy · labs · meta
                 │  GraphQL (query + subscription over WS/SSE)
                 ▼
        Workspace state service (one per app, same schema)
                 │
        ┌────────┴─────────────────────────────┐
        │            META AGENT CORE           │
        │  persona: iktara|telepathy|labs|meta │
        │  tools: chart · git · bend · mem     │
        └────────┬──────────────────┬──────────┘
                 │ ACP (stdio)      │ typed intents (predict/return/learn/...)
                 ▼                  ▼
      model executors         Buzz relay (identity · engrams · events)
      (opencode/codex)
                 │
                 ▼
      Bend cores (checked: adaptive · lorenz · worker)
```

## IO and protocols

- **App ↔ agent:** GraphQL over WebSocket. Subscriptions replace polling:
  `jobUpdated(id)`, `chartComputed(profileId)`, `threadEvent(channel)`.
  Writes are mutations with explicit review state (draft → accepted).
- **Agent ↔ host:** ACP stdio. One entry: `buzz-acp --agent-command opencode
  --agent-args acp`. The host injects the `core` engram; other slugs are
  explicit reads.
- **Agent ↔ agent:** relay events. Typed intents (`predict`, `return`, `learn`,
  `correct`, `artifact`, `accept`) ride Buzz events; Lamport ordering deferred
  until multi-node. The Buzz signer sends; execution processes hold no keys.
- **Bend:** local only. Invoked as `bend FILE --check-only` / protocol commands
  (`worker → claim → packet → return → learn`). Never holds sockets, keys, or
  model calls.

## Stateful GraphQL — the changes

Each app's state service exposes one schema (per-app prefixes isolate products):

```graphql
type Query {
  workspace(owner: ID!): Workspace
  job(id: ID!): Job
  chart(profileId: ID!): Chart
  thread(channel: ID!): Thread
}
type Subscription {
  jobUpdated(id: ID!): Job
  chartComputed(profileId: ID!): Chart
  threadEvent(channel: ID!): Event
  workspaceChanged(owner: ID!): Workspace
}
type Mutation {
  enqueueJob(input: JobInput!): Job
  acceptRevision(job: ID!, reviewer: ID!): Job
  publishIntent(intent: IntentInput!): IntentReceipt   # owner signer only
}
```

What this replaces today:

| Today | After |
|---|---|
| forsee `/api/jobs/<id>` polling | `jobUpdated` subscription |
| telepathy desk outbox + REST workspace | GraphQL mutations + thread subscriptions |
| meta console/pages REST | same schema, meta prefix |
| per-app runtimes (desk CLI, iktara worker, meta worker) | one meta-agent core, per-app persona |
| oc2 fork as integration point | stock OpenCode ACP + buzz-acp; fork stays as build host |
| JS learning registry (retired) | engrams (core injected) + Bend local memory |


## Agent-native network — every piece is an agent

**Direction set by Shubham 2026-09-22:** the network itself becomes agents.
Services, workers, and products are each an agent: a **Bend file** defines its
checked behavior, a thin **IO host** exposes it, and **DNS** gives it an address
on the agent network, like www gives websites addresses. Payments between
agents use **X402** (HTTP 402 Payment Required).

### Bend-authored agents

- One Bend file per agent core: state transitions, protocol rules, and local
  memory — same pattern as `runtime/worker/system.bend` (worker → claim →
  packet → return → learn) and the adaptive/Lorenz cores.
- The IO host is deliberately thin and dumb: stdlib-only Node (or the existing
  Bend worker harness). It binds the Bend core to HTTP/ACP and holds no keys,
  no sockets of its own design, no model calls.
- A registry records `agent-name → bend-core-sha256 → host endpoint → pubkey`.
  Unknown or tampered cores fail closed (same discipline as the retired
  evidence registry, now via Git + relay records).

### Agent DNS (www for agents)

- Every agent gets a hostname: `chart.forsee.intuitxn.com`,
  `desk.telepathy.intuitxn.com`, `meta.agent.intuitxn.com` — routed by the
  existing Cloudflare tunnels/DNS (already proven live for the four products).
- Discovery contract: `GET /.well-known/agent.json` → `{name, pubkey,
  capabilities[], bendCore{sha256,version}, x402{asset,amount,currency},
  endpoints{acp,graphql}}`.
- Buzz is the directory: the relay already holds identity (pubkeys), names
  (NIP-05), repos (NIP-34), and projects (NIP-MP). Add an agent-record type
  (or reuse NIP-34 with `agent` scope) so `agent.telepathy.intuitxn.com`
  resolves to a verified pubkey + descriptor hash.

### HTTP protocol between agents

- **Identity:** NIP-98 signed HTTP (kind 27235 headers) — already specified in
  [a2a-protocol.md](a2a-protocol.md) §A2A; the fork does not yet implement the
  middleware (marked there as a guess). This is now the load-bearing piece:
  every agent-to-agent call is a NIP-98 request the callee verifies against the
  directory.
- **State:** GraphQL query/mutation/subscription (above).
- **Session:** ACP over HTTP to the model executors (fork already serves ACP
  over HTTP; stock OpenCode `acp` for the simplified path).
- **Events:** relay wss stream (verified live) carries typed intents
  (`predict/return/learn/correct/artifact/accept`).

### X402 payments between agents

- Paid agent endpoints answer `402 Payment Required` with X402 headers
  (`x402-network`, `x402-asset`, `x402-amount`, `x402-recipient`). Clients
  settle USDC and retry with proof. `x402` npm package v1.2.0 verified
  available for the pilot.
- First paid surfaces (candidates): chart compute, model inference beyond the
  free tier, deep readings, and cross-tenant agent work.
- Free paths stay free (engrams, relay events, open channels). Payments are
  machine-to-machine only; humans keep the signer boundary.
- Honest markers: no wallet, no settlement path, and no 402 middleware exist
  yet in our stack. This section is target architecture, not a claim.

## Migration phases (proposed order)

1. **M1 — one pilot agent on ACP.** `buzz-acp` + stock `opencode acp` for the
   telepathy persona. Replaces the desk watcher. Verify one
   request → candidate → accept cycle.
2. **M2 — GraphQL state service for telepathy.** Workspace server gains
   GraphQL + subscriptions alongside REST (both live during migration).
3. **M3 — IO intents.** Land the typed intent schema (`predict/return/learn/
   correct/artifact/accept`) as relay events; Bend worker integration unchanged.
4. **M4 — port forsee and meta** to the same meta-agent core + GraphQL schema.
5. **M5 — agent DNS.** `/.well-known/agent.json` descriptors + Cloudflare hostnames for each agent; Buzz directory records bind name → pubkey → Bend-core hash.
6. **M6 — NIP-98 middleware.** Signed HTTP between agents (fork middleware + verification against the directory).
7. **M7 — X402 pilot.** One paid agent endpoint (chart compute) with 402 + USDC settlement; free tier unchanged.
8. **M8 — remove dead paths.** Desk watcher, REST polling endpoints, and
   per-app runtime wrappers are retired once parity is verified.

## Boundaries (unchanged)

- Reviewer: **Shubham**. Tools prepare; humans accept; owner signer sends.
- No keys in repositories, memory, command arguments, or execution processes.
- Evidence carries limits: the runtime does not judge worker answers or train
  weights; engrams are attributed findings, Bend owns checked semantics.
- Bend 2.0.21 pinned. Do not silently switch versions.
