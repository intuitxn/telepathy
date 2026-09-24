# Mundus Bend kernel: the one-file system

`runtime/system.bend` is the single consolidated system file: the pure ops
(status projection, fold, retrieval graph/rank/route) plus the native Lorenz
worker protocol (adaptive kernels, memory transitions, worker registration,
claims, packets, reported results, explicit learning and loopback OpenCode
delivery). SHA-256:
`60dcbfaa46e09c34259c14f5884800c4c1a3c1aba80f16943f6512bf88577114`.
There are 78 named worker laws. Check them with the actual Bend compiler;
their scope does not include correctness of arbitrary worker answers.

```sh
BEND_NO_TELEMETRY=1 ~/.bend/bin/bend runtime/system.bend --check-only
BEND_NO_TELEMETRY=1 ~/.bend/bin/bend runtime/system.bend -- help
BEND_NO_TELEMETRY=1 ~/.bend/bin/bend runtime/system.bend system   # pure-op fixtures
node --test runtime/worker/protocol.test.mjs
```

The host test starts a fresh Bend process for every transition and checks
exclusive claims within one history, rejection of the wrong worker, no implicit
learning from a return, later retrieval, correction propagation, and preservation
of old evidence. Node is only the test driver; transitions stay in this Bend file.
The tested toolchain is Bend 2.0.21.

A separate loopback HTTP test exercises the native Bend connector against a
local server: quoted packet data survives JSON transport, an existing receipt
prevents resubmission, HTTP 500 produces no successful receipt, and delivery
does not create learned memory. This test does not call a model.

The actual OpenCode `/meta` run in `meta-trial.json` completed in 178.256 seconds
after an initial timeout. Independent checks confirmed explicit learning and
reuse in a subsequent packet read by a fresh Bend process. Parent and child
model costs are recorded separately. This demonstrates protocol execution;
it does not measure an independent second LLM improving from that memory.

Use [Buzz native memory and agents](BUZZ.md), [/meta agents](../adaptive/META.md)
from OpenCode, or follow the same protocol from Codex. No custom JavaScript
runtime adapter is needed. One coordinator owns each immutable snapshot lineage. Workers perform
concrete authorized tasks in their host harness and return evidence; the
coordinator evaluates results before explicitly selecting memories with `learn`.
The runtime does not itself judge those results or train model weights.

Keep snapshots and delivery receipts in a private directory. Writes are not
atomic; there are no distributed locks, globally exclusive claims across forks,
authenticated actor labels, or automatic snapshot merge. An HTTP 204 acknowledges
delivery, not completion. An ambiguous timeout must not trigger blind retry.

The previous JavaScript registry is retired; its data and historical receipts
remain preserved. Buzz memory holds selected findings, while native Bend
snapshots hold explicit local transitions. Neither mechanism automatically
merges snapshot branches. Source and tests are distributed through Git; check
the actual source and relevant examples before claiming executable verification.
