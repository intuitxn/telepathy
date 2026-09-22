# Mundus: Buzz-native harness

Use standard OpenCode directly and its native ACP interface with Buzz's existing
agent harness, memory and workflow DSL. Our executable logic stays in Bend; no
oc2 fork, beta build, custom learning service, or port 4110 service is required.
Start with [Buzz and Bend](../worker/BUZZ.md), or use the same direct
[worker protocol](META.md) from another process-capable harness.

The [A2A plan](../../docs/designs/a2a-protocol.md) preserves the historical oc2
M1–M8 roadmap; those milestones are not prerequisites for the active baseline.
Federation and Lamport wiring are deferred until an actual multi-node need.
Local Lorenz memory and published NIP-AE engrams are distinct. Outbound work is
drafted, reviewed by Shubham, then sent by the owner-controlled signer.
Credential isolation remains a target requiring deployment verification.

The installed Buzz 0.5.23 CLI exposes native memory commands and its ACP harness
injects core memory by default. Other findings require explicit retrieval. Buzz
owns agent identity, conversation routing and stored engrams. Bend owns the
selected algorithms, laws and explicit local worker/memory transitions.

Before executing or reusing changed Bend code, check its actual source, run the
relevant independent examples and inspect the results. A stored memory or signed
Buzz event is provenance, not a successful compiler check or correctness proof.
Keep source revision, checker output, concrete inputs/results and counterexamples
with the work. Select concise findings for Buzz memory after evaluation.

## Retired JavaScript experiment

The custom registry, Git synchronization, lifecycle, maintenance and OpenCode
delegation stack was removed from the active tree. Its exact implementation,
tests and operational instructions remain at Git commit
`d7a6c7b0930f6d91b691e58df84b775479380c0d` for historical reproduction.
Its bespoke bundle-admission, publisher-trust, revocation and rollback checks
have not been ported to Buzz or Bend. Do not claim that Buzz engrams reproduce
those guarantees.

Existing local registry entries, signing keys, private runs and the remote
`learning/shared-v1` evidence branch are retained. They have not been imported
into Buzz. Historical results in [LEARNING.md](LEARNING.md) and
[evaluation](../evaluation/README.md) describe the implementation used at the
time; they do not establish current automatic synchronization.

Offline Node drivers still check Bend transitions and score saved experimental
answers. They are optional development tools and never run as a learning service.
Older desk/plugin code is separately maintained and was not part of this removal.
