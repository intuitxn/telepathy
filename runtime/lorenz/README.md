# Lorenz explicit memory core

[`runtime/system.bend`](../system.bend) is the consolidated executable Bend source.
Its Lorenz commands retain explicitly selected conversation text, promote statements to
memory, record corrections without deleting history, invalidate dependent
statements transitively, and record work as queued data. They do not execute
queued work or automatically capture conversations or train a model.

From the repository root, using Bend 2.0.21:

```sh
export BEND_NO_TELEMETRY=1
~/.bend/bin/bend runtime/system.bend --check-only
~/.bend/bin/bend runtime/system.bend -- help
mkdir -p .local/lorenz
RUN_DIR=$(mktemp -d .local/lorenz/session.XXXXXX)
~/.bend/bin/bend runtime/system.bend -- init "$RUN_DIR/0"
~/.bend/bin/bend runtime/system.bend -- capture "$RUN_DIR/0" "$RUN_DIR/1" retain operator episode:example 'Investigate retry behavior'
~/.bend/bin/bend runtime/system.bend -- remember "$RUN_DIR/1" "$RUN_DIR/2" 1 0 agent 'Retries need idempotent writes'
~/.bend/bin/bend runtime/system.bend -- memory "$RUN_DIR/2"
node --test runtime/lorenz/evaluate.test.mjs
```

Each command starts a new process and reads the preceding snapshot. Output
paths must be new. IDs are local to a snapshot history; dependency 0 means no
premise. `correct IN OUT MEMORY_ID DEPENDENCY_ID ACTOR REASON TEXT` supersedes a
memory. Its descendants disappear from active-memory retrieval until explicitly
rechecked and corrected against active dependencies. `history` preserves them
as `needs-review`; `explain IN ID` displays their recorded provenance.

`work IN OUT CONVERSATION_ID ACTOR OWNER ACCEPTANCE` queues one item per
conversation. Repeating it preserves the first item rather than updating its
owner or acceptance. A changed assignment needs a future explicit transition.

The historical registry identifier was `lorenz-memory`, contract
`lorenz-memory-v1`, evaluator `lorenz-memory-cli-v1`. That custom JavaScript
registry is retired; the [Buzz-native worker path](../worker/BUZZ.md) is current.
The retained offline evaluator
runs actual CLI transitions in a private temporary directory and requires 19
named assertion groups, including invalid requests failing without output
creation. It does not accept a source-generated claim that these checks passed.
Its test driver also runs the Bend checker on the candidate source. Fixed public
examples are regression evidence, not a hidden generalization benchmark.

The source has 17 named laws. History length and absence of implicit retention
are parameterized proofs; most remaining laws establish behavior on explicit
fixtures (including transitive invalidation). They are not universal proofs of
the complete persistence implementation. Trust includes Bend, Base and the host
checker/evaluator. The optional `compute` command is an inherited binary-tree
CPU/GPU demonstration, not neural learning or a performance claim.

Current limits: one dependency per statement; at most 256 events per snapshot;
nonempty single-line fields at most 4096 characters; snapshot writes at most
100000 decoded characters and reads at most 1 MiB. Actors and origins are
supplied labels, not authenticated identities. Snapshot text is not bound to a
particular core-source revision internally; retained historical registry receipts
bound code and verification separately. There are no file locks or atomic snapshot writes:
use a private directory with one writer. Buzz memory does not automatically merge
these snapshots or perform those historical registry checks. Retain only
explicitly selected, suitable data; private conversation state need not be
published with this core.
