# Historical Mundus Bend worker protocol

This file describes the retained Lorenz worker source and its earlier tests. It is not the new algorithm entry point and is not selected by the DSH release gate. The current checked candidate is [`runtime/core/telepathy.bend`](../core/telepathy.bend), with task grants and independent settlement in the [DSH host](../dsh/README.md). Operational cutover from any installed legacy worker remains a separate migration step.

`system.bend` packages the other development checkout's one-file Lorenz worker
implementation without changing it. SHA-256:
`6e224e26d47c56d3601b26b55ae77497ab4680cacda89846640380a1d9e69d74`.
It includes the adaptive kernels, memory transitions, worker registration,
claims, packets, reported results, explicit learning and loopback OpenCode
delivery. There are 78 named laws. Check them with the actual Bend compiler;
their scope does not include correctness of arbitrary worker answers.

```sh
BEND_NO_TELEMETRY=1 ~/.bend/bin/bend runtime/worker/system.bend --check-only
BEND_NO_TELEMETRY=1 ~/.bend/bin/bend runtime/worker/system.bend -- help
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

The earlier [Buzz memory guide](BUZZ.md) and [`/meta agents` route](../adaptive/META.md) record how this source was used. One coordinator owns each immutable
snapshot lineage. Workers perform concrete authorized tasks in their host harness and return evidence; the
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
