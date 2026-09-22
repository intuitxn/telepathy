# Shared learning operations

The registry is persistent evidence, not disposable cache. Keep accepted bundles,
staged imports, failures, lifecycle runs, revocations, and sync checkpoints when
cleaning a checkout. Back up the registry outside a public repository, including
private signing keys, with access restricted to its owner. Never publish that
backup. These tools assume exclusive access by trusted processes of the same OS
account; they are not a sandbox against another process modifying files.

## Read-only health check

```sh
REGISTRY="$HOME/.local/share/intuitxn/learning-registry"
node runtime/adaptive/maintenance.mjs doctor "$REGISTRY"
# Optional storage budget in bytes (default: 1 GiB)
node runtime/adaptive/maintenance.mjs doctor "$REGISTRY" 1073741824
```

Doctor checks manifest identities and all listed payload hashes in accepted and
staged bundles, including revoked bundles. It validates the configured Ed25519
keypair, private-key permissions and trusted-key fingerprints. It reports locks,
unique inode file bytes (hardlinks counted once), and a budget warning. It does
not execute source, contact remotes, print private keys, delete locks, prove core
compatibility, or rerun evaluators. Concurrent writes can make a report transient;
repeat after writers finish. Integrity/key failures exit nonzero; budget/lock
warnings are informational. A lock's age cannot establish that its owner died.

For actual compatible-core admission use the registry replay/import commands in
[SHARED.md](SHARED.md), after reviewing source. For recurring monitoring, have
an existing scheduler run doctor and retain its JSON/exit status; no daemon or
scheduler is installed by this change.

## Signing-key rotation

Stage and activate are separate operations. Rotation uses the existing sync lock
and registry mutation lock, preserves the old trusted public key for historical
signature verification, and backs up the old key/config in a private directory.

```sh
node runtime/adaptive/maintenance.mjs rotate-stage "$REGISTRY"
# Read returned current/staged fingerprints and verify the new public key.
# Distribute ONLY sync/rotation/publisher-public.pem to intended peers.
# Each peer independently verifies its fingerprint and runs sync.mjs trust.
node runtime/adaptive/maintenance.mjs rotate-activate "$REGISTRY" OLD_FINGERPRINT NEW_FINGERPRINT
node runtime/adaptive/maintenance.mjs doctor "$REGISTRY"
```

OLD_FINGERPRINT is required; NEW_FINGERPRINT is optional but recommended. Copy
fingerprints from staging output, rather than abbreviating them. The fingerprint
is SHA-256 of the exact SPKI PEM bytes, matching sync.mjs. No remote trust update,
publication, or private-key transfer occurs. Existing peers continue to reject
new-key publications until explicitly trusting the new public key. Rotation does
not revoke the old publisher: keeping its trust also keeps its publication and
revocation authority. If the old key is compromised, distribute an explicit trust
policy change to every receiver; merely changing the local signing key is not
sufficient. Do not remove old history/checkpoints to hide a compromise.

Caught activation errors restore the prior key/config from memory; durable private
backups remain under sync/key-backups. A successful rotation archives its staged
pair there too. This is serialized with transactional backup and individual atomic
file replacement, not a multi-file power-loss transaction or fsync guarantee. A
process crash may leave a mixed key/config set and a lock; doctor detects the
mismatch. Stop all registry/sync writers, inspect the matching backup, restore all
three files (publisher-private.pem, publisher-public.pem, config.json) together,
keep private files mode 0600, then run doctor. Remove only an inspected abandoned
lock once no writer remains. Never automatically erase locks based on age. Retain
backups until an operator's recovery policy explicitly permits removal.

## Scratch cleanup and storage budgets

```sh
# Dry run, at least 168 hours old by default:
node runtime/adaptive/maintenance.mjs cleanup "$REGISTRY"
# Explicit apply after reviewing candidates; age must be >= 1 hour:
node runtime/adaptive/maintenance.mjs cleanup "$REGISTRY" 168 --apply
```

Only direct .pending-<alphanumeric> directories under the registry or staged/
are eligible. Active/abandoned locks block cleanup; apply holds the same sync and
mutation locks to exclude cooperating writers. Symlinks and special files are
rejected. The tool preserves all durable entries, failures, runs, histories,
revocations and sync workspaces. Dry run never acquires locks or writes files.
No actual user registry data was deleted while testing this feature.

A budget warning does not trigger eviction. Review which work should be admitted
or published, bound retrieval, and use registry.mjs compact first. If more storage
is required, archive complete verified registries with their revocations and
checkpoints; do not silently drop counterexamples. Establish backup restoration
checks before implementing destructive retention.

## Another-machine checklist

1. Obtain the reviewed release checkout; install Node, Git and Bend 2.0.21.
2. Run the repository's registry, sync, lifecycle and core tests with the local
   Bend binary. Choose one private local registry directory for all harnesses.
3. Run sync.mjs init with the intended Git URL and learning branch. Use existing
   Git authentication; do not put tokens or private keys in URLs or bundles.
4. Exchange only public signing keys through a trusted channel and compare full
   fingerprints. Each receiver explicitly runs sync.mjs trust. A trusted publisher
   can publish and revoke any bundle, so choose peers deliberately.
5. Run sync.mjs pull. Inspect staged source/findings, then registry import with
   --execute to perform local verification. Pull alone never executes source.
6. Install the Bend skill and connect /meta's before/after hooks to this registry
   using [HARNESS.md](HARNESS.md). Verify recorded run IDs and selected evidence.
7. Publish one selected technical bundle, pull it on the original machine, and
   confirm both its fingerprint and fresh replay. Exercise one correction and
   ensure revocation prevents reuse after peers pull.
8. Run doctor and record latency, storage and retrieval outcomes. Back up private
   local state. Keep raw conversations local unless separately authorized.

This checklist has not been run on an additional physical machine in this task;
local temporary-directory transport tests cannot establish remote deployment.
