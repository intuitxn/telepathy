# Buzz agent setup — native implementation plan (draft)

Status: draft · Updated: 2026-09-22. This plan follows the active baseline in
[the A2A design](../../designs/a2a-protocol.md), not its historical oc2 M1–M8
roadmap. It proposes work; it does not authorize sends, claim deployment,
install a daemon, or change persona identities.

Use standard OpenCode, native Buzz ACP/memory/workflow configuration, and the
one-file Bend worker. No custom coordination service or replacement registry.
Shubham reviews the exact outbound payload/revision and intended audience before
the owner-controlled signer sends it. Read-only investigation does not itself
require a human-only step. Credential isolation remains a deployment property
that must be checked, not assumed from instructions.

## 1. Confirm the actual host and agent names

Inspect the selected OpenCode binary/version and its `acp --help`, installed
Buzz help, and Bend's checker. Multiple OpenCode installations may resolve
through different PATHs; configure the intended absolute executable.

Acceptance: record the selected versions and existing host configuration without
secrets. Reconcile persona mappings against the owner-visible Buzz configuration
using authorized read access. Use canonical charters `telepathy`, `prime`,
`build`, `steward`, `research`, `relationships`, `bend-forge`, and `relay-keeper`.
Treat Pollen/Fizz/Honey mappings as proposals until observed; `pilot` has no
current charter. Do not manufacture an identity or restart another agent's host.

## 2. Complete one native ACP task

Use the existing Buzz harness with the selected stock OpenCode executable and
`acp` arguments. Give one bounded task a concrete acceptance check. Run Bend
checking and the worker's claim/packet/return sequence in a private single-writer
snapshot lineage. Preserve failures and actual results.

Acceptance: an actual host request reaches OpenCode, its task result returns,
and an independent check evaluates it. Record source revision and evidence;
CLI discovery or delivery acknowledgement alone does not establish completion.
Any outbound task or result uses the approved owner-controlled sending path.

## 3. Retain and retrieve one supported finding

Explicitly select a finding from the evaluated result. Draft its scope, source,
checks and counterexamples. After review, retain it using native `buzz mem`.
Use the existing core-injection behavior deliberately; explicitly retrieve other
slugs. No raw conversation or private session identifiers in shared findings.

Acceptance: a fresh host session actually receives the selected finding and
applies it to a related task. Keep a local Bend `learn` transition distinct from
Buzz retention: neither automatically migrates or merges the other's state.

## 4. Demonstrate correction propagation

Create a deliberately narrow test finding with an explicit dependent claim.
Correct its premise in a private Bend lineage and observe which dependents need
review. Separately update the selected Buzz summary using its captured hash and
a reviewed patch. Do not assume Buzz implements Bend dependency invalidation.

Acceptance: later retrieval does not silently use the superseded summary, and
Bend history preserves the original result and correction. Document any manual
reconciliation needed across these two storage boundaries.

## 5. Measure usefulness before expanding

Compare fresh agents with relevant, absent, and irrelevant retained findings on
new independently scored tasks. Keep model/tool budgets comparable and record
failures, time, tool use and negative transfer. Freeze tasks and scoring before
reading candidate outputs. Retain null results; successful storage is not a
performance gain.

Acceptance: publishable selected evidence distinguishes working integration,
correctness, measured benefit, and remaining uncertainty. No claim of weight
training, general intelligence, or unrestricted self-modification follows.

## Deferred federation and preserved history

The older oc2 M3–M8 directory, bridge, middleware, tier and Lamport proposals
remain historical design options, not prerequisites. Revisit them only for a
concrete multi-node need unsupported by the native facilities. Preserve existing
private registry evidence, snapshots and keys; no migration is implied here.
The other draft files in this folder may retain historical observations and
must be reconciled before being treated as current configuration.
