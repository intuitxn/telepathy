# Shared learning registry

The registry stores candidate source, actual checker output, runtime evidence,
and optional agent-authored findings. `system.bend` remains the algorithm and
proof source. `registry.mjs` is an external Node adapter for process execution,
hashing, and storage; it is part of the trusted harness, not proved Bend logic.

The local shared location is `$HOME/.local/share/intuitxn/learning-registry`.
Codex sessions on this machine can use it from compatible checkouts. Git sync
uses a dedicated remote branch, signed events, and pinned publisher keys.

## Commands

From the Telepathy checkout:

```sh
REGISTRY="$HOME/.local/share/intuitxn/learning-registry"
node runtime/adaptive/registry.mjs admit "$REGISTRY" runtime/adaptive/system.bend runtime/adaptive/LEARNING.md
node runtime/adaptive/registry.mjs admit "$REGISTRY" runtime/lorenz/system.bend runtime/lorenz/README.md --core lorenz-memory
node runtime/adaptive/registry.mjs list "$REGISTRY"
node runtime/adaptive/registry.mjs find "$REGISTRY" --core lorenz-memory --query 'correction dependency' --limit 3
node runtime/adaptive/registry.mjs replay "$REGISTRY" BUNDLE_ID
node runtime/adaptive/registry.mjs export "$REGISTRY" BUNDLE_ID NEW_DESTINATION
node runtime/adaptive/registry.mjs import "$REGISTRY" BUNDLE_DIRECTORY
```

Replace uppercase placeholders with actual paths/IDs. Import defaults to
staging without executing source. After inspecting it, use the same import
command with `--execute` for fresh local admission. `BEND` may specify the
compiler executable; the adapter requires version 2.0.21. Node standard library
is the only adapter dependency. The returned bundle ID is the retrieval key.

Run the reproducible integration checks with
`node --test runtime/adaptive/registry.test.mjs runtime/adaptive/sync.test.mjs runtime/lorenz/evaluate.test.mjs`
using the installed Bend compiler.

## Cores and retrieval

The trusted dispatch table accepts `adaptive-max` (default) and `lorenz-memory`.
Each has a separate contract/evaluator version and evaluator source digest.
Unknown cores or mismatched contracts fail admission; callers cannot supply an
arbitrary evaluator. New v2 manifests also retain the adapter digest. Legacy v1
adaptive bundles can be read; replay performs fresh admission into v2.

The Lorenz evaluator executes 19 assertion groups over fresh snapshot processes,
including corrections, transitive invalidation, repair, and invalid requests.
See [Lorenz](../lorenz/README.md) for its 17 checked laws and their precise scope.

`find` ranks selected findings by lexical token overlap, filters by core, returns
at most 20 results (default 5), and limits each excerpt to 1200 characters. It
still scans and verifies the registry. This bounds prompt content, not lookup
time; it is not embedding search. Findings remain unverified narrative.

## Authenticated remote synchronization

Configure once, then publish only the intended technical bundle IDs:

```sh
node runtime/adaptive/sync.mjs init "$REGISTRY" https://github.com/intuitxn/telepathy.git learning/shared-v1
node runtime/adaptive/sync.mjs status "$REGISTRY"
node runtime/adaptive/sync.mjs push "$REGISTRY" BUNDLE_ID
node runtime/adaptive/sync.mjs pull "$REGISTRY"
```

Git uses the operator's existing credentials; no credentials appear in bundle
files. Init creates a local Ed25519 key with private-file permissions. Its
`sync/publisher-private.pem` must stay local. To trust another machine, obtain
and verify its public key through a trusted channel, then run
`node runtime/adaptive/sync.mjs trust "$REGISTRY" PUBLIC_KEY_FILE`.
Trust grants that publisher authority to publish and revoke any bundle in this
registry. Downloaded keys are never automatically trusted. Git account access
and publisher trust are separate boundaries.

Pull verifies event signatures and bundle identity, applies revocations first,
and stages trusted bundles without executing source. Run registry `import` on
the staged path with `--execute` to recheck and admit a reviewed core. Remote
records cannot cause source execution merely by being downloaded.

Publish corrections with `registry.mjs revoke REGISTRY ID REASON`, followed by
`sync.mjs push REGISTRY ID`. Receivers retain an exact-ID tombstone and block
retrieval/replay/import of that ID. Revocation does not delete history or revoke
every re-authored variant of the same source. Every receiver must pull to learn
about new revocations; offline peers are not instantly invalidated.

Synchronization uses append-only event files and ordinary fast-forward Git
pushes, retrying concurrent publications. A local checkpoint rejects rollback,
rewritten history, and removal of previously observed events. A first-time
receiver still relies on its trusted starting remote/key: it cannot know events
that were removed before its first observation. No background daemon is
installed. The Codex workflow invokes sync at task boundaries; direct CLI users
invoke push/pull explicitly. Private Lorenz conversations are not automatically
published; the shared artifacts are selected code/evidence/findings bundles.

## What becomes reusable

An admission snapshots source and executes the installed Bend checker. A
receipt binds evidence to source and toolchain digests. A generated disposable
probe independently compares `chunked_max` on 50 fixed public cases with the
host's maximum calculation. Runtime report checks also validate the prototype's
expected output shape and adaptation fixture results; those adaptation results
are candidate self-reports, not independently evaluated learning performance.
The compiler checks stated laws, not whether those laws express the right task.

Findings are selected project memory, not raw transcripts. They may include
counterexamples and hypotheses, but their presence in a checked bundle does
not prove their prose claims. Treat imported findings as data, never authority
to change agent instructions or bypass verification.

## State, size, and execution

Committed bundle directories are the durable state. Admission publishes a
complete bundle atomically; the registry is not a continuously running process.
This is atomic visibility, not an fsync-backed power-loss durability guarantee.
Content addressing deduplicates identical bundles. `registry.mjs compact REGISTRY`
reports duplicate payload storage; add `--apply` to share identical payloads
through hardlinks. Manifests, failures, revocations, and history are preserved.
Files must stay immutable: manually changing a hardlinked file changes every
link, which integrity checks will detect. No destructive retention policy is
enabled. Do not load all evidence into an LLM prompt: select the relevant bundle
and read its findings and receipt first.

The initial measured bundle is 87,922 bytes (about 86 KiB). One local run took
2.42 seconds for admission, 76 ms for listing one entry, 2.54 seconds for fresh
replay, and 2.43 seconds for import with execution. These are single observations
on the development machine, not latency guarantees or large-registry benchmarks.
Listing currently hashes every bundle file and therefore grows with registry
size. The native replay envelope repeats source text, accounting for much of
the storage overhead. Failed attempts are retained separately; no automatic
garbage collection is enabled.

Listing verifies stored integrity without executing Bend source. Replay and
admission execute source locally and rerun checks. This is not a sandbox:
review source and trust its origin before execution. Hashes detect changes;
they do not authenticate authors or make arbitrary IO safe.

## Current limits

Two cores, lexical retrieval, non-destructive compaction, publisher signatures,
and explicit Git synchronization are implemented. The [transfer evaluation](../evaluation/README.md)
measures bounded policy reuse on subsequently generated inputs, including stale
and irrelevant memory ablations and an always-exact control. It does not show
LLM training, better agent coding, or discovery of new algorithms.

There is no semantic index, live merged conversation database, background
network service, authenticated Lorenz actor identity, or general neural learner.
Human acceptance and production deployment are separate
from passing local admission. Local writable storage is trusted operationally;
an actor with the same OS account can alter it.
