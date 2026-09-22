# Network discovery — from a static agent directory to live registries

Draft. This document designs how the static agent directory becomes a **view
over live discovery** for local sessions, the retired LAN layer, and the
proposed relay directory. It is a design record only: it creates no external
effect, authorizes no commit, relay write, or publication, and edits no shared
document or store.

Privacy: no session IDs, pubkeys, receipts, prompts, transcripts, job IDs, or
tool-call payloads appear here. Session identity is described by mechanism only
(`docs/AGENT_DIRECTORY.md:19-20`). The local registry file is referenced by path
and schema, never by its raw contents.

Scope status legend: **live** (running today, verifiable from this checkout),
**retired** (historical oc2-era code, retained as evidence, not part of the
active baseline), **proposed** (designed, not shipped).

Related: [`../../AGENT_DIRECTORY.md`](../../AGENT_DIRECTORY.md) ·
[`../../designs/a2a-protocol.md`](../../designs/a2a-protocol.md) ·
[`agent-directory.json`](agent-directory.json) ·
[`agent-directory-notes.md`](agent-directory-notes.md).

---

## 1. Three discovery scopes

| # | Scope | Status | What it discovers | Cited source |
|---|---|---|---|---|
| S1 | Local live registry | **live** | Sessions/agents on this host | `~/.config/opencode/plugins/telepathy.ts:22`, `:79-99` |
| S2 | LAN / historical | **retired** | oc2-era nodes on the LAN | `docs/designs/a2a-protocol.md:165`, `:229` |
| S3 | Relay / network | **proposed** | Agents, projects, channels, nodes across hosts | `docs/designs/a2a-protocol.md:176`, `:392` |

### S1 — Local live registry (status: live)

The only discovery surface that is running today is the telepathy peer store.

- **Store path.** `STORE = TELEPATHY_DIR ?? ~/.config/opencode/telepathy`
  (`~/.config/opencode/plugins/telepathy.ts:22`). Registry file `peers.json`
  (`PEERS`, used by `readPeers`/`upsertPeer`, `:79-99`); workspace event log
  `events.jsonl` (`EVENTS`, `:26`, appended at `:197`, `:287`, `:385`).
- **Record shape.** A peer is keyed by `sessionID` and carries
  `sessionID, agent, name, status, firstSeen, lastSeen` — the `Peer` type at
  `~/.config/opencode/plugins/telepathy.ts:30-38` (plus an optional `directory`
  field that current records do not set).
- **Identity / announcement.** A session announces itself on the
  `session.created` event (`:175-181`) and again on its **first telepathy tool
  call**, because every tool calls `self(...)` → `upsertPeer(...)`
  (`:165-166`; calls at `:230`, `:263`, `:307`, `:353`, `:383`). Display name is
  `peerName(sessionID, agent)` = `<agent>:<id8>` (`:101-104`).
- **Lifetime.** Explicitly disposable — stop the server, remove the store,
  restart (`~/.config/opencode/server/ARCHITECTURE.md:185-186`); catalogued as
  ephemeral in `docs/AGENT_DIRECTORY.md:116`, `:121-130`.
- **Read-only view already present.** `telepathy_peers` lists each peer with
  `name, agent, sessionID, status, presence` (`:329-342`); `presence` is
  recomputed, not stored (`:335-337`).

### S2 — LAN / historical (status: retired)

The oc2-era LAN discovery path is **not part of the active baseline** and no
such file exists in this checkout (verified: no `state/lan-nodes.json` under the
checkout; the only in-repo references are the design record). It is retained
here as reframed historical design, not as a current capability.

- **Bonjour service.** `_oc2-node._tcp` was the LAN advertisement
  (`docs/designs/a2a-protocol.md:165`).
- **LAN cache.** `state/lan-nodes.json`, produced by `oc2-lan.sh discover`, held
  the per-node entry
  `{node_id, pubkey, endpoints:[lan,wss], bridge_port, lamport, tier, agents[], updated_at, event_id}`
  (`docs/designs/a2a-protocol.md:229`); `oc2-lan.sh discover` is reused by the
  proposed M3 (`:392`).
- **Reframing.** The active baseline defers directory bridges and network-intent
  schemas until a real multi-node need (`docs/designs/a2a-protocol.md:26-30`),
  and states that A2A peer discovery is **not shipped**
  (`docs/FOUNDATIONS_AND_LIVE_USE.md:67`). Treat S2 as evidence for a future
  design, not a live scope.

### S3 — Relay / network (status: proposed)

The relay is the designed directory + identity plane (`docs/designs/a2a-protocol.md:176`),
but the node-directory piece is **not shipped**.

- **NIP-MP projects.** Kind 30621, slug `d`-tag + `name`/`description`/`a`/
  `buzz-channel` tags; live set telepathy, sansara, iktara, nudge
  (`docs/designs/a2a-protocol.md:102`; `docs/AGENT_MAP.md:40`).
- **NIP-IA agent identities.** Owner-reviewed agent identities, archived via
  NIP-IA kinds 9035/9036 (`docs/designs/a2a-protocol.md:98`).
- **Channels / members.** `buzz channels` exposes members with roles
  `owner|member|bot` (`docs/designs/a2a-protocol.md:103`).
- **Proposed `node-directory` NIP-23 note.** The designed discovery record on
  the relay (`docs/designs/a2a-protocol.md:176`, `:392`).
- **M3 status: not shipped.** M3 ("node directory on the relay") is a milestone
  entry, not an implemented capability; it specifies a new `nodes_directory`
  tool that drafts to OUTBOX and an `oc2-node-directory` NIP-23 note
  (`docs/designs/a2a-protocol.md:391-393`). Discovery across hosts is explicitly
  listed as unshipped (`docs/FOUNDATIONS_AND_LIVE_USE.md:67`).

---

## 2. Discovery RECORD schema

Two record kinds share one field vocabulary: **(i) an agent** (a stable role /
charter, host-independent) and **(ii) a session/node** (a running or
advertised endpoint). Fields required by the task: `identity`, `endpoint`,
`capabilities` / `agents[]`, `status`, `lastSeen`, `version`.

### 2(i) Agent record

```jsonc
{
  "identity":      { "handle": "@<canonical>", "charterPath": ".opencode/agents/<file>.md", "role": "<agent role>" },
  "endpoint":      { "kind": "local|lan|relay", "ref": "<mechanism, no secret>" },
  "capabilities":  { "jtbd": ["..."], "may": ["..."], "mustNot": ["..."], "mode": "primary|subagent", "runtime": "<runtime>" },
  "agents":        [],                       // empty for an agent record; see node record
  "status":        "planned|active|idle|error|deleted",
  "lastSeen":      0,                        // epoch ms, from the live registry
  "version":       "<charter/registry revision>"   // NOT derivable today
}
```

### 2(ii) Session / node record

```jsonc
{
  "identity":      { "sessionRef": "<id8 mechanism>", "agent": "<role>", "name": "<agent>:<id8>", "nodeRef": "<node_id, relay only>" },
  "endpoint":      { "kind": "loopback|lan|relay", "ref": "127.0.0.1:4096 | _oc2-node._tcp | node-directory" },
  "capabilities":  { "runtime": "<runtime>", "jtbd": ["..."] },
  "agents":        ["@<canonical>", "..."],  // roster a node advertises
  "status":        "active|idle|error|deleted",
  "lastSeen":      0,
  "version":       "<host version>"          // NOT derivable today
}
```

### Reconciliation with the static directory and the live peer fields

| Schema field | `AGENT_DIRECTORY.md` (A1/A2) | Live peer fields (`peers.json`) | Derivable today? |
|---|---|---|---|
| `identity.handle` | A1 "Canonical" `@handle` (`:31-40`) | — | Static only (charters/registry) |
| `identity.charterPath` | A1 "Charter" (`:31-40`) | — | Static only |
| `identity.role` | A1 "JTBD"/name; A2 identity mechanism (`:114-119`) | `agent` | Static + live (partial) |
| `identity.name` | A2.1 `<agent>:<id8>` (`:121-123`) | `name` | Live, **with a caveat below** |
| `identity.sessionRef` | A2.1 `sessionID` (`:116`) | `sessionID` | Live (kept private) |
| `identity.nodeRef` | A2.1 store path (`:116`) | — | **Not derivable** (relay only, M3) |
| `endpoint.kind` / `.ref` | A2 "Where state lives" (`:114-119`) | — | **Not derivable** from `peers.json` |
| `capabilities.jtbd` | A1 "JTBD" (`:31-40`) | — | Static only |
| `capabilities.may` / `.mustNot` | A1 per-agent authority (`:51-108`) | — | Static only |
| `capabilities.mode` / `.runtime` | A1 "Mode"/"Runtime" (`:31-40`) | — | Static only |
| `agents[]` | A1 roster (8 canonical) (`:31-40`) | — | **Not derivable** (relay/LAN only) |
| `status` | registry `status: planned` (`plugins/telepathy-meta-agents/registry.json:10,35,60,87,110`) | `status` (`active/idle/error/deleted`) | Live (session) + static (agent) |
| `lastSeen` | — | `lastSeen`, `firstSeen` | Live |
| `version` | — | — | **Not derivable** today |

**Non-derivable fields today (named):** `identity.nodeRef`, `endpoint.*`,
`agents[]`, and `version`. `endpoint` and `agents[]` exist only in the
historical/relay entry shape (`docs/designs/a2a-protocol.md:229`) and are not
present in `peers.json` or the registry. `version` is recorded only in prose
(Buzz 0.5.23 `runtime/worker/BUZZ.md:17`; OpenCode 1.18.32/1.14.20
`runtime/worker/BUZZ.md:96-97`; Bend 2.0.21 `runtime/worker/README.md:21`) and
is not a field of any registry.

**Live field caveat (observed, not assumed).** `AGENT_DIRECTORY.md:121-123`
asserts the display name is `<agent>:<id8>`, which matches `peerName`
(`~/.config/opencode/plugins/telepathy.ts:101-104`). The persisted fallback in
`upsertPeer` is `session-<id8>` (hyphen, `:90`). In the current store, sessions
that first appear without a known agent persist the fallback shape, so the
reconciliation must accept **both** forms (see the check in §4). This is a real
divergence between the doc's asserted shape and the stored value, not a schema
change.

---

## 3. Announcement / registration mechanism

### 3.1 Local self-registration (works today)

A session becomes discoverable in two ways, both via `upsertPeer`
(`~/.config/opencode/plugins/telepathy.ts:83-99`):

1. **On creation.** The plugin's `event` hook matches `session.created` and
   upserts the peer with the session's `agent` and computed `name`
   (`:175-181`). Subsequent `session.updated` / `session.status` /
   `session.compacted` set `status: active`; `session.idle` → `idle`;
   `session.error` → `error`; `session.deleted` → `deleted` (`:182-193`).
2. **On first tool call.** Every telepathy tool calls `self(...)`, which upserts
   `{sessionID, agent, name, directory, status: "active"}` (`:165-166`). This is
   why `telepathy_peers` can show peers whose `session.created` was missed
   (`~/.config/opencode/server/ARCHITECTURE.md:181-183`).

Each upsert writes `peers.json` atomically (temp file + rename, `:69-73`) and
appends a workspace event (`:197`). `telepathy_status` additionally records a
free-text status/note (`:376-394`). No registration step requires a key or a
network call.

### 3.2 Staleness (works today)

Staleness is derived, never stored:

- Window: `ONLINE_WINDOW_MS = 5 * 60 * 1000` (`~/.config/opencode/plugins/telepathy.ts:28`).
- Rule: `presence = (now - lastSeen < ONLINE_WINDOW_MS) ? "online" : "stale"`
  (`:335-337`). `lastSeen` is refreshed by every upsert (`:94`).
- `status` (session lifecycle) and `presence` (recency) are independent axes:
  a peer can be `status: active` but `presence: stale` if it has not been seen
  within the window.

### 3.3 Relay publication (to build; draft → owner-sent)

Publishing a node to the relay is **not implemented** and must follow the
project's send boundary:

- A node directory entry would be **drafted, reviewed, then sent by the
  owner-controlled signer** — the M3 tool drafts to OUTBOX and a human sends the
  `oc2-node-directory` NIP-23 note (`docs/designs/a2a-protocol.md:392`).
- The publication rule is global: draft → Shubham reviews the exact payload/
  revision → owner-controlled signer sends (`docs/designs/a2a-protocol.md:15-19`).
- **Never inject signing keys into workers.** Buzz commands run in the
  owner-controlled signing environment; credentials must not be injected into an
  execution process to make discovery work (`runtime/worker/BUZZ.md:53-55`), and
  workers must not acquire signing credentials (`runtime/adaptive/HARNESS.md:93-96`).

---

## 4. `AGENT_DIRECTORY.md` as a VIEW over discovery

### 4.1 Principle

Keep the **static schema** in the document — the A1 agent table, the A2 session
kinds, and the per-agent authority block (`docs/AGENT_DIRECTORY.md:31-45`,
`:51-108`, `:114-130`) — and **populate the volatile fields** (`status`,
`lastSeen`, live `name`, `presence`) from the live registries. The document is
the schema and the authority for names/roles; the registries are the runtime
truth for presence. The existing `agent-directory.json` already models the
static parts as data (`docs/drafts/meta/agent-directory.json:158-183`); this view
adds the live layer without editing it.

### 4.2 Smallest atomic first step: a read-only `discover` view

The smallest step that is atomic, read-only, and testable is to treat the
**existing** `telepathy_peers` read (`~/.config/opencode/plugins/telepathy.ts:329-342`)
as the first `discover` view and bind it to the record schema of §2:

- **Read-only.** It only calls `readPeers()`; it writes no store, no relay, no
  snapshot.
- **Atomic.** One projection of `peers.json` → one row per peer, no aggregation
  across scopes.
- **Schema-bound.** Each row projects to a session/node record
  (`identity.sessionRef`, `identity.agent`, `identity.name`, `status`,
  `lastSeen`, derived `presence`); fields not derivable today (`endpoint`,
  `agents[]`, `version`) are explicitly emitted as `null`/absent, never invented.

**Named acceptance check — `discover-view-check`.** Run from the checkout root:

```sh
node -e 'const fs=require("fs"),os=require("os"),path=require("path");
const P=path.join(os.homedir(),".config","opencode","telepathy","peers.json");
const W=5*60*1000,now=Date.now();
const peers=JSON.parse(fs.readFileSync(P,"utf8"));
const allowed=new Set(["sessionID","agent","name","status","firstSeen","lastSeen","directory"]);
let n=0,ok=0;
for(const [k,v] of Object.entries(peers)){n++;
 const peerName=(v.agent&&v.agent!=="unknown"?v.agent:"session").toLowerCase()+":"+String(v.sessionID).slice(0,8);
 const fb="session-"+String(v.sessionID).slice(0,8);
 const nameOk=v.name===peerName||(v.agent==="unknown"&&v.name===fb);
 const req=["sessionID","agent","name","status","firstSeen","lastSeen"].every(f=>f in v);
 const noExtra=Object.keys(v).every(f=>allowed.has(f));
 const keyOk=v.sessionID===k;
 const presence=(now-v.lastSeen<W)?"online":"stale";
 if(req&&noExtra&&keyOk&&nameOk&&(presence==="online"||presence==="stale"))ok++;}
console.log("discover-view-check: records="+n+" conforming="+ok+" "+(ok===n?"PASS":"FAIL"));'
```

The check asserts: one record per `peers.json` key; `key === sessionID`; the six
documented fields present; no undeclared field; `name` matches either
`<agent>:<id8>` or the documented `session-<id8>` fallback; and `presence`
recomputes to `online`/`stale`. It reads only; it prints aggregate counts, not
session IDs. Observed result: **PASS, 14 records, 14 conforming** (see §6).

---

## 5. Privacy and authority boundary

- **No keys.** No signing key, `BUZZ_PRIVATE_KEY`, `BUZZ_AUTH_TAG`, or keyfile
  is read, derived, or placed in a worker (`docs/designs/a2a-protocol.md:15-19`;
  `runtime/worker/BUZZ.md:53-55`). Discovery is a read path; publication is a
  separate owner-signed path.
- **No raw session IDs on shared surfaces.** Local `peers.json` may hold the raw
  `sessionID` privately, but any shared/relay projection carries identity **by
  mechanism only** — the `<agent>:<id8>` shape and role, never the full session
  ID, pubkey, receipt, or transcript (`docs/AGENT_DIRECTORY.md:19-20`). The
  relay `node-directory` entry would publish node-level identity (node_id,
  endpoints, tier, agents), not session IDs
  (`docs/designs/a2a-protocol.md:229`).
- **Identity by mechanism only.** Names/roles come from charters and the
  registry; live presence comes from `lastSeen`. Labels are not authenticated
  identities (`runtime/adaptive/META.md:70-71`).

---

## 6. Verification actually run

Checkout: `/Users/a3fckx/Desktop/Attri/telepathy-shared-learning`. All commands
below were run while drafting this document.

- **Worker source resolution and check** (META.md:17-36):
  `BEND_NO_TELEMETRY=1 ~/.local/bin/bend runtime/worker/system.bend --check-only`
  → `All terms check.`; `bend version` → `bend 2.0.21`. The packaged
  `runtime/worker/system.bend` qualifies (its `-- help` lists `worker`, `claim`,
  `packet`, `return`, `learn`).
- **Local scope read** (path + schema only; contents kept private): `peers.json`
  parsed as a JSON object with 14 keys; `events.jsonl` has 1822 lines with event
  types `session.status` (1413), `session.updated` (371), `session.created` (20),
  `session.idle` (16), `telepathy.status` (2). Event keys confirmed:
  `session.*` → `{ts, type, sessionID}`; `telepathy.status` → `{ts, type, peer,
  status, note}`.
- **Named acceptance check** `discover-view-check` (command in §4.2):
  `discover-view-check: records=14 conforming=14 fallbackNames=12 PASS`.
- **Absence checks:** no `state/lan-nodes.json` exists under the checkout; the
  only in-repo references to `lan-nodes` / `_oc2-node` / `oc2-lan` are in
  `docs/designs/a2a-protocol.md`. Confirms S2 is retired.
- **Citation existence:** every `file:line` cited in §1–§5 was printed from its
  source file and confirmed present (telepathy plugin `~/.config/opencode/plugins/telepathy.ts`
  lines 22, 26, 28, 30-38, 79-104, 165-166, 175-197, 329-342, 376-394;
  `docs/AGENT_DIRECTORY.md` 19-20, 31-45, 51-108, 114-130;
  `docs/designs/a2a-protocol.md` 15-19, 26-30, 98, 102, 103, 165, 176, 229,
  391-393; `docs/FOUNDATIONS_AND_LIVE_USE.md:67`; `docs/AGENT_MAP.md:40`;
  `runtime/worker/BUZZ.md:17, 53-55, 96-97`; `runtime/worker/README.md:21`;
  `runtime/adaptive/HARNESS.md:93-96`;
  `~/.config/opencode/server/ARCHITECTURE.md:181-186`).

### Meta-agent lineage

The `/meta` worker protocol was executed once by the coordinator as a single
writer in a private snapshot directory: `init → capture → work → worker → claim
→ packet → return → learn`. The packet rendered bounded task data (no active
memory). This is protocol-execution evidence; the returned artifact is a reported
result and an explicitly learned finding, **not** a verified code bundle or human
acceptance.

---

## 7. Outstanding work

- **Relay node-directory (M3) is unbuilt.** S3 remains proposed; the
  `nodes_directory` draft tool and `oc2-node-directory` NIP-23 note do not exist
  (`docs/designs/a2a-protocol.md:391-393`).
- **`endpoint`, `agents[]`, `version` are non-derivable.** No live registry
  supplies them; they require either a new local field or the relay directory.
- **Name-shape divergence.** The persisted `session-<id8>` fallback differs from
  the `<agent>:<id8>` shape asserted at `docs/AGENT_DIRECTORY.md:121-123`; a
  future edit should reconcile the doc with `upsertPeer` (`:90`) or vice versa.
- **LAN layer needs a real multi-node need** before any revival
  (`docs/designs/a2a-protocol.md:26-30`).
- **No shared-surface projection is built.** This document defines the view and
  its check; it does not add a script, tool, or store field.
- This file is a draft: no commit, no Buzz/relay write, no publication, and no
  edit to `docs/AGENT_DIRECTORY.md`, `docs/INDEX.md`, or any store.
