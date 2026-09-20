# Lorenz explicit memory core

`system.bend` is one executable source file, separate from the adaptive maximum
core. It retains explicitly selected conversation text, promotes statements to
memory, records corrections without deleting history, invalidates dependent
statements transitively, and records work as queued data. It does not execute
queued work or automatically capture conversations or train a model.

From the repository root, using Bend 2.0.21:

```sh
export BEND_NO_TELEMETRY=1
~/.bend/bin/bend runtime/lorenz/system.bend --check-only
~/.bend/bin/bend runtime/lorenz/system.bend -- help
mkdir -p .local/lorenz
RUN_DIR=$(mktemp -d .local/lorenz/session.XXXXXX)
~/.bend/bin/bend runtime/lorenz/system.bend -- init "$RUN_DIR/0"
~/.bend/bin/bend runtime/lorenz/system.bend -- capture "$RUN_DIR/0" "$RUN_DIR/1" retain operator episode:example 'Investigate retry behavior'
~/.bend/bin/bend runtime/lorenz/system.bend -- remember "$RUN_DIR/1" "$RUN_DIR/2" 1 0 agent 'Retries need idempotent writes'
~/.bend/bin/bend runtime/lorenz/system.bend -- memory "$RUN_DIR/2"
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

The registry dispatch identifier is `lorenz-memory`, contract
`lorenz-memory-v1`, evaluator `lorenz-memory-cli-v1`. The external evaluator
runs actual CLI transitions in a private temporary directory and requires 19
named assertion groups, including invalid requests failing without output
creation. It does not accept a source-generated claim that these checks passed.
The registry also runs the Bend checker on the candidate source. Fixed public
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
particular core-source revision internally; registry receipts bind code and
verification separately. There are no file locks or atomic snapshot writes:
use a private directory with one writer. Remote bundle synchronization shares
code and evidence, not a mergeable live conversation database. Retain only
explicitly selected, suitable data; private conversation state need not be
published with this core.
