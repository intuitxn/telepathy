# Agent web: language, kernel, and runtime contract

The unit of the system is a **versioned program running on a node**, not a chat
session. A node is one resident `meta_shell.py` process with one writer for its
Bend lineage, a durable task queue, an authenticated local MCP endpoint, and
an execution adapter. OpenCode is an adapter: it owns model sessions and its
own child sessions, while the node owns work, budgets, evidence, and promotion.
The terminal, a person, a timer, an observation, and a peer all enter through
the same work admission path. None of these origins gains authority merely by
being a trigger.

## Three layers

1. **Bend kernel:** pure state transitions for observation provenance, work
   claims, delegation, result return, verification, knowledge revision, and
   program promotion. A law can prove a transition rejects missing flags; it
   cannot prove a host-supplied observation is true. The existing Lorenz
   lineage already checks work → claim → return and requires explicit learn.
2. **Resident host:** one node process supplies clocks, storage, authenticated
   identities, leases, resource accounting, process supervision, jj workspaces,
   and effect execution. It serializes writes to each Bend lineage. These
   capabilities cannot be obtained from a pure language definition alone.
3. **Agent workers:** an OpenCode server session, its native subagents, or an
   ACP provider executes a bounded work packet. A worker can propose facts,
   code, prompts, or new programs; the node records those as reports until
   independent checks admit them. A node may use several worker processes
   without becoming several authorities over the same lineage.

## Source language

Keep `.meta` as the human-written pseudocode language. Its existing
`program`, `input`, `effect`, `step`, `choice`, `noul`, `score`, and `policy rrsi`
forms are the executable subset today. The following is the **proposed next
grammar**, not yet accepted by the compiler:

```text
program investigate_world version 0.2.0
input signal: Observation<Claim>
output finding: Finding

agent scout:
  engine opencode
  mode subagent
  may read_workspace, observe_web
  max_tokens 20000

routine investigate on observation signal:
  when signal.source_verified and signal.novelty >= 0.7
  budget tokens 40000, seconds 900, children 2
  lease 15m
  run scout with signal
  verify finding with independent_source
  emit KnowledgeProposal<Finding>

routine reflect on schedule daily:
  budget tokens 20000, seconds 600, children 1
  read failed_hypotheses, unresolved_questions
  emit ImprovementProposal<Program>
```

`Observation<T>` carries source identity, capture time, schema, digest, and
value. `Finding` carries claims, citations, methods, uncertainty, and
counterexamples. `KnowledgeProposal<T>` is not accepted knowledge. A routine
is a durable subscription plus a bounded work template. A trigger only creates
a candidate work event. The host checks source, budget, concurrency, and
authority before any model session starts. Typed `Choice`, `Noul`, and `Score`
remain advisory model results; they do not grant effects.

Each routine needs a stable program digest, idempotent trigger key, maximum
in-flight count, retry rule, effect allowlist, acceptance verifier, and pause
switch. Reject an unbounded routine at compile time. Start with one timer and
one observation source; a peer mesh is unnecessary for the first useful loop.

## The readable protocol

Use `meta/1` text for human-authored work and event records. One executable
entry point exists now:

```text
work meta/1
id: research-20260924-001
project: /absolute/path/to/project
conversation: research
acceptance: Report independently checkable evidence
task:
  Investigate the current question.
  State uncertainty and cite the sources used.
```

`meta submit-file work.meta --wait` parses this file and uses its `id` as the
node's idempotency key. Replaying the same envelope returns the same job;
reusing an ID for changed work is rejected. The `task:` block preserves
newlines and requires two-space indentation. The host still uses JSON inside
its MCP/OpenCode HTTP adapters because those APIs require it; JSON is not the
language or the protocol a person writes. This first text envelope is local
intake, not yet a peer transport.

The next `meta/1` event forms should be `observe`, `offer`, `claim`, `return`,
`verify`, `learn`, `revise`, and `promote`. Their shared header is event ID,
causal parent ID, node ID, program digest, actor, timestamp, and body digest.
`offer` names the typed task, effect scope and budget; `claim` adds worker
identity and lease expiry; `return` adds session ID and artifact digests;
`verify` cites a verifier and exact artifact digest; `learn` cites successful
verification and dependency links; `revise` names old and new program/prompt
digests; `promote` cites release approval. Unknown versions and event kinds
must fail closed. Text is for inspection; storage should persist canonical
bytes plus a hash, not trust an unparsed transcript.

## End-to-end flow

```text
source/timer/person/peer
  → observe (source + digest)
  → routine match and admission (Bend policy + host budget)
  → durable offer and lease
  → OpenCode session or ACP worker in an isolated jj workspace
  → optional OpenCode child sessions, each with a bounded subtask
  → return (report + trace + artifact digest)
  → independent verify (tests, source checks, human judgment as required)
  → knowledge proposal or program candidate
  → explicit learn or measured RRSI selection
  → reviewed release → new node/program revision
```

The parent node reserves each child's budget before spawn and maps OpenCode
`parentID`/child sessions to one causal work ID. The child cannot publish or
integrate merely because its parent asked. A lost lease makes a return
suspect; it does not erase evidence. A transport timeout is ambiguous delivery,
so resend with the same idempotency key and reconcile status before retrying
execution. A node moving between networks retains its local queue and lineage;
it resumes peer exchange when reachable. Peer storage is an outbox/inbox of
signed, content-addressed events with acknowledgments and per-lineage single
writers. There is no need to claim global consensus for independent work.

OpenCode's [server API](https://opencode.ai/docs/server/) exposes health and
event streams, session creation, `parentID` child sessions, asynchronous
prompts, agent selection, and session status. Its
[agent model](https://opencode.ai/docs/agents/) supports named primary and
subagents. A node can start one loopback `opencode serve` child, then use those
endpoints to create and observe sessions; native subagents are child sessions,
not additional meta nodes. The server must be authenticated and bound to
loopback or carried through an authenticated peer tunnel. Its `prompt_async`
acknowledgment means delivery, not task completion. The current resident node
uses ACP per task; its older Bend direct HTTP path reaches one local OpenCode
session but is not a distributed scheduler.

## Prompts, memory, and improvement

A prompt is a versioned program artifact with a digest. Compose a worker's
context from: immutable kernel rules, reviewed role charter, exact task and
effect contract, attributed observations/knowledge, and bounded recent trace.
Pin that composition at session creation. A proposed prompt edit creates a new
revision; existing sessions keep their pinned context. The present RRSI loop
already proposes, critiques, measures, and privately selects a one-file prompt
change. A selected candidate reaches the live node only through a reviewed
release. The same boundary will apply to DSL routines and kernel changes.

Operational self-model means the node can inspect its own revision, queue,
budgets, failures, evidence coverage, and measured task outcomes. It can use
that state to propose experiments and build test environments. It is not a
claim that a model has subjective awareness or that a program improvement is
neural weight training. Structured knowledge becomes useful to people when
claims retain sources, uncertainty, dependencies, counterevidence, and a way
to correct or supersede them.

## Implementation order and current limit

The current code has local task intake, MCP, ACP, jj workspaces, Bend lineage,
an on-demand SSH relay, and a bounded RRSI policy. `work meta/1` now removes
JSON from the first human-authored intake path. It has no autonomous routine
subscription, OpenCode server supervisor, authenticated peer event transport,
distributed leases, or general accepted-knowledge verifier. Implement in this
order: (1) compile bounded routine declarations and event schemas; (2) add a
durable scheduler to the resident node with one timer and one observation
source; (3) supervise a local OpenCode server and reconcile session/child
events; (4) add outbox/inbox exchange through the existing authenticated relay;
(5) evaluate knowledge and program revisions on held-out tasks before release.
Keep one node process and one Bend kernel throughout.
