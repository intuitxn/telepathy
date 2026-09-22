# Bend Web Protocol (BWP) — the web protocol for a Bend agent network

**Status:** proposal (draft for Shubham review). **Date:** 2026-09-22.
**Relation:** the protocol layer for
[mundus-simplified.md](mundus-simplified.md). Grounded in the shipped worker
loopback contract (`runtime/worker/protocol.test.mjs`) and the NIP-98 HTTP
design in [a2a-protocol.md](a2a-protocol.md).

## Stance

HTTP is the wire; Bend is the brain; NIP-98 is identity; X402 is payment;
GraphQL is state. The IO host is deliberately dumb — it maps HTTP to Bend
transitions and back. All decision logic, receipts, and memory stay in Bend.

One Bend process per request (the existing worker-test pattern): the host
spawns `bend FILE -- <command> ...` with snapshot paths, reads the exit code
and stdout, and renders the HTTP response. Bend never opens a socket, holds a
key, or calls a model.

## Request lifecycle

1. TLS ends at the Cloudflare tunnel (hostname routing already live).
2. **Identity:** NIP-98 verification — `Authorization: Nostr <base64 kind
   27235 event>`; pubkey must be in the Buzz directory and the event fresh.
3. **Core check:** the host serves only while its loaded core's sha256 matches
   the registry record. Mismatch or failed `--check-only` → `503` fail-closed.
4. **Transition:** HTTP → Bend command invocation (spawn, snapshot files).
5. **Response:** status + Bend receipt headers (see below).

## Endpoints

| Method + path | Purpose | Notes |
|---|---|---|
| `GET /.well-known/agent.json` | descriptor | no auth: name, pubkey, capabilities, core sha, x402 pricing, endpoints |
| `GET /v1/health` | liveness + integrity | echoes `--check-only` result, core hash, transition count |
| `POST /v1/intent` | typed intent | `{kind, payload, idempotencyKey}`; 200/202/402/409/412/422 |
| `GET /v1/state/{name}` | snapshot read | private snapshots stay private |
| `GET /v1/evidence/{hash}` | content-addressed evidence | replay recomputes; not cached inference |
| `POST /session/{id}/prompt_async` | delivery to an executor | the shipped Bend loopback contract; expects 204 ack |
| GraphQL `query` / `subscription` | live state | projections of Bend-owned state; subscriptions replace polling |

## Intent kinds

`predict · claim · packet · return · learn · correct · artifact · accept` —
the Mundus domain semantics. `predict` and `return` are worker payloads;
`learn` and `correct` are explicit memory transitions; `artifact` and `accept`
are reviewed publications. New kinds require a schema version bump.

## Headers

- `X-Bend-Core: sha256:…` — the executing core, echoed on every response.
- `X-Bend-Receipt: …` — receipt path/hash for accepted transitions.
- `X-Idempotency-Key: …` — maps to the Bend record identity (records are
  idempotent by design; identical record → same receipt, resubmission refused).
- `Authorization: Nostr …` — NIP-98 kind 27235.
- `X402-*` — on 402 responses (see payment).

## Semantics inherited from Bend

- **Idempotency:** identical record → identical receipt; resubmission refused
  (proven in the worker loopback test).
- **No implicit learning:** delivery acknowledges transport only. An HTTP 204
  is not completion and does not promote memory (proven in the same test).
- **Ambiguous timeout ≠ retry:** a missing ack must not trigger blind retry.
- **Fail closed:** malformed, oversized, or tampered records → 4xx, nothing
  written.

## Error mapping

| Bend outcome | HTTP |
|---|---|
| unknown command / bad payload | `400` |
| payment required | `402` + X402 headers |
| receipt already exists / conflict | `409` |
| precondition (core/schema mismatch) | `412` |
| validation failure | `422` |
| executor did not ack (expected 204) | `502` |
| core check failed / tampered | `503` fail-closed |

## Conformance levels

- **L0 identity:** descriptor + health + NIP-98.
- **L1 transitions:** `/v1/intent` with the worker verb set.
- **L2 state:** GraphQL query + subscription projections.
- **L3 economy:** X402 gating + evidence retrieval.

## Honest markers

- The Bend side of delivery (`prompt_async`, receipts, no-implicit-learning)
  is shipped and tested. The server-side NIP-98 middleware, intent schema
  registry, agent descriptors, and X402 gate are design, not code.
- Bend 2.0.21 pinned; do not silently switch versions.
- Reviewer: Shubham. Execution hosts hold no signing keys.
