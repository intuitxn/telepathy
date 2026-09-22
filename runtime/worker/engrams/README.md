# A checked Bend file carried by native Buzz memory

This candidate uses the existing, unchanged `runtime/lorenz/system.bend`:
28,425 bytes, SHA-256
`64e1ebf7c5937ccec96697dddeb7bf62c621c545af0c4ed7485b9038524fe15d`.
It is one executable file; these instructions introduce no memory server or
JavaScript/Python runtime adapter. The shell script is an offline acceptance test.

The full worker `runtime/worker/system.bend` is 92,130 bytes. It cannot fit in a
single native engram: inspected Buzz source caps serialized NIP-44 plaintext at
65,535 bytes, including JSON overhead. The smaller Lorenz source's memory body is
29,496 bytes at the slug below. Do not truncate, minify, or silently fragment the
checked source to evade that limit.

## Locally verified candidate

```sh
runtime/worker/engrams/verify-lorenz.sh
```

The test checks the pinned source digest and Bend 2.0.21, copies the exact bytes
into a new private temporary directory, checks all 17 named laws, and runs every
transition in a fresh process. It confirms explicit correction, dependent-memory
invalidation, unchanged predecessor history, and rejection of an invalid
correction without creating output. It does not invoke Buzz or a model. The full
worker's existing two protocol tests also passed during preparation.

`lorenz-manifest.json` records the source, checker/toolchain observation, acceptance
test digest and trust limits. Its exact manifest SHA is
`fbfa7123d0b9bff93f651e124b35237cb5ecf23e8fc7af4f929f29dd93a34acd`.
The source file remains at its existing path; no second maintained copy is added.
Both source and manifest use content-addressed slugs. Those names are a convention:
native `mem set` can overwrite them, so receivers must verify the pinned bytes.

## Publish only through the existing authorized agent host

Run in an already authorized publisher agent's Buzz environment, using its real
owner identity. Do not copy keys, change host credentials or use an owner's key
while claiming that the agent authored the entry. First inspect the destination
slugs; if already present, compare exact bytes and reuse an identical value. An
authentication/network failure is not evidence that a slug is absent.

```sh
SOURCE_SLUG=mem/bend/lorenz/source/64e1ebf7c5937ccec96697dddeb7bf62c621c545af0c4ed7485b9038524fe15d
MANIFEST_SLUG=mem/bend/lorenz/manifest/fbfa7123d0b9bff93f651e124b35237cb5ecf23e8fc7af4f929f29dd93a34acd
# OWNER_PUBKEY must be the verified existing agent owner's public key.
buzz mem set --owner "$OWNER_PUBKEY" "$SOURCE_SLUG" - < runtime/lorenz/system.bend
buzz mem set --owner "$OWNER_PUBKEY" "$MANIFEST_SLUG" - < runtime/worker/engrams/lorenz-manifest.json
buzz mem hash --owner "$OWNER_PUBKEY" "$SOURCE_SLUG"
buzz mem hash --owner "$OWNER_PUBKEY" "$MANIFEST_SLUG"
```

Source first, manifest second: an interrupted source-only write is an incomplete
publication, not a reusable verified bundle. Check every exit status and read back
both values. Keep actual publish event IDs/receipts separately from this immutable
candidate manifest. A later code revision gets a new source slug and manifest.

## Fresh retrieval and independent use

From a fresh session of the **same publisher identity**, retrieve raw UTF-8 bytes
into a new private directory. `mem get` prints the value without adding a newline;
use direct redirection, not shell command substitution (which strips newlines).

```sh
umask 077
ENGRAM_RUN=$(mktemp -d)
buzz mem get --owner "$OWNER_PUBKEY" "$MANIFEST_SLUG" > "$ENGRAM_RUN/manifest.json"
buzz mem get --owner "$OWNER_PUBKEY" "$SOURCE_SLUG" > "$ENGRAM_RUN/system.bend"
printf '%s  %s\n' fbfa7123d0b9bff93f651e124b35237cb5ecf23e8fc7af4f929f29dd93a34acd "$ENGRAM_RUN/manifest.json" | shasum -a 256 -c -
printf '%s  %s\n' 64e1ebf7c5937ccec96697dddeb7bf62c621c545af0c4ed7485b9038524fe15d "$ENGRAM_RUN/system.bend" | shasum -a 256 -c -
cmp runtime/lorenz/system.bend "$ENGRAM_RUN/system.bend"
runtime/worker/engrams/verify-lorenz.sh "$ENGRAM_RUN/system.bend"
```

Run the sequence in a shell with `set -eu`, or stop explicitly on any failure.
Read the retrieved source before execution. The pinned test and trusted manifest
come from the reviewed checkout; do not run an arbitrary test path supplied by an
untrusted engram. Checker success is necessary but does not sandbox IO or certify
all runtime behavior. Local snapshot state is separate from the source engram.

## Publisher, reader, and owner are different scopes

Installed CLI read commands support `--owner` and `--agent`; there is no
`--author` memory flag. `--owner` selects the owner paired with the current
agent signing identity. `--agent PUBLISHER_PUBKEY` instead means **owner-side
recovery**: the current signer must be that agent's owner. These two flags are
mutually exclusive. Setting `--agent` from an unrelated agent does not grant it
access to the publisher's encrypted memory.

For authorized reuse by another agent:

1. The real owner reads with `buzz mem get --agent PUBLISHER_PUBKEY SOURCE_SLUG`
   and the corresponding manifest slug, in the owner-controlled host.
2. Verify both exact digests and intentionally transfer only this selected code
   and manifest through an authorized host channel. No private conversations or
   publisher credentials accompany the transfer.
3. The receiving agent writes those identical values to its **own** engram scope,
   reads them in a fresh session, verifies digests and reruns the independent test.

Record original publisher, owner-authorized transfer, and receiving signer as
separate receipt fields. This is explicit owner-mediated transfer, not a shared
universal pool or proof that arbitrary agents can decrypt each other's memories.
A source hash does not prove who authored the code, and a re-publisher signature
does not replace the original provenance.

## Evidence boundary

Preparation performed local checks and byte-identical fresh-copy reuse only.
No Buzz source publication, remote retrieval or second-agent transfer is claimed
by these preparation artifacts. Report live write/readback separately when the
existing signed-in host completes it; preserve failures rather than marking a
local copy as a successful network transfer.

Scope/size rules were checked against the installed `buzz mem ... --help` and
public Buzz source at `77729abfb692b25a0f4ec4a69add86af2e32c0dd`:
[reader identity and native commands](https://github.com/block/buzz/blob/77729abfb692b25a0f4ec4a69add86af2e32c0dd/crates/buzz-cli/src/commands/mem.rs),
[encrypted body and slug limits](https://github.com/block/buzz/blob/77729abfb692b25a0f4ec4a69add86af2e32c0dd/crates/buzz-core/src/engram.rs).
