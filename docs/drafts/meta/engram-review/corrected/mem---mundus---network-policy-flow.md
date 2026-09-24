# DRAFT - NOT SENT — proposed replacement body for `mem/mundus/network-policy-flow`

Source evidence (read-only, 2026-09-24):
- `docs/drafts/meta/network-policy-flow.md`: ABSENT (22-file listing has no such name)
- `runtime/memory.bend`: ABSENT
- `runtime/policy.bend`: ABSENT
- Relay `mem/policy/<name>`: NONE (agent ls → `[]`)
- Companion `mem/kernels/policy`: EXISTS but is itself stale (see its draft)
- Relay base-hash: `43ace4c8ce4fe3e428140ba463e8a4b92775978bf75ddc7bd83d2ce49ab8ceb4`

---

# Verifiable, math-backed network flow — 2026-09-22 (corrected 2026-09-24; spec file absent)

Draft spec: docs/drafts/meta/network-policy-flow.md — CORRECTION 2026-09-24: this
file does NOT exist live (ABSENT). The spec pointer below is an unfulfilled
reference, not a live document. Companion: mem/kernels/policy (EXISTS live but
itself stale — its evaluator file `runtime/policy.bend` is ABSENT and no
`mem/policy/<name>` entry exists).

## The network, as it actually was (2026-09-22 observation, unchanged)
- Relay `https://intuitxn.communities.buzz.xyz` (wss), Cloudflare-fronted,
  NIP-11 `auth_required: true`, `restricted_writes: true`.
- Bend Base has raw `TCP.*`/`UDP.*` (base.bend:296-346) but NO TLS (grep 0), so
  the kernel CANNOT speak to the relay. Transport is host-side.
- Flow: kernel (pure decision) <-> host (transport/effects) <-> relay (durable,
  signed, owner-attested). The kernel never opens a relay connection.

## Policies in the network itself (PROPOSAL — wiring absent live)
- The policy was to be DATA in the durable layer: an engram entry `mem/policy/<name>`.
- It was to be materialized like memory and read through the ONE import
  (runtime/memory.bend); the evaluator was to be runtime/policy.bend.
- CORRECTION: none of the three wiring pieces exists live (`mem/policy/*` ABSENT,
  `runtime/memory.bend` ABSENT, `runtime/policy.bend` ABSENT).
- Consequence (as designed, not as built): policy changes would be attributed,
  versioned, owner-scoped events on the relay; the network would carry its own rules.

## What makes a flow verifiable (design criteria, unchanged)
1. Every decision is a TOTAL pure function with named, compiler-checked laws
   (deny-by-default, no-escalation, review gate, determinism, first-match-wins,
   monotonicity).
2. The flow is an append-only sequence of events (mirror the Lorenz lineage:
   each step reads IN and writes a new OUT; nothing mutated in place).
3. Each event carries provenance (source id, actor, policy slug + digest,
   request digest, decision) so a reviewer can REPLAY it: same policy + same
   request -> same decision.
4. The law is the artifact: a claim without a checked law is not math-backed.

## Proven vs not (unchanged scoping)
- Proven by a Bend check: the decision function's laws on fixtures; the review
  gate and budget bound are universal.
- NOT proven: authorization, host obedience, digest != signature, freshness,
  universal theorems beyond the stated cases, human acceptance.

## Pipeline (proposed, unchanged)
request -> policy materialization (if stale) -> pure decide ->
Allow/Deny/NeedReview -> host performs only allowed effects -> event appended ->
provenance recorded -> review for Publish/Retire/Spend.

## Limits (carried forward)
Relay ACLs still apply; the host could ignore a Deny; no in-kernel TLS; policy
digest is not a signature; agent-scoped memory means the writer's scope matters.

## Open owner decisions (carried forward)
Rule grammar/scope; no-match default; enforcement point; event/provenance store;
writer scope; digest trust; two-key effects for Publish/Spend/Retire;
rotation/retire; fail-closed on staleness; whether policy.bend stays separate.
Plus 2026-09-24: restore vs retire the spec file and the three missing wiring pieces.
