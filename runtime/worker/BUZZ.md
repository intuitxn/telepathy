# Mundus: native Buzz memory and Bend workers

Use standard OpenCode for agent execution, Bend for checked worker transitions,
and Buzz for persistent memory, native ACP delegation, and ordinary workflow
YAML. No oc2 fork, beta build, or additional learning adapter is required.
Offline test drivers are separate from this path.

See the [baseline and historical A2A design](../../docs/designs/a2a-protocol.md).
Buzz's relay is coordination; ACP/execution stay node-local. Reviewer is Shubham.
The target is a keyless execution/kernel process with an owner-controlled Buzz
signer: draft, review the exact payload, then send. The earlier deployment audit
found an inherited signing identity, so isolation still needs implementation and
verification. No new signer or network-intent layer is implemented here.
The former M1–M8 roadmap, port 4110 service and Lamport/federation work are not
prerequisites for local execution. Keep existing service state intact.

The installed Buzz Desktop bundle was version **0.5.23** when these interfaces
were inspected. Its CLI does not expose `--version` or an `experimental`
subcommand. These instructions describe installed help, not assumed parity
with newer upstream code. No remote memory writes were performed to validate
this document.

Buzz's upstream [Experiments UI](https://github.com/block/buzz/blob/main/desktop/src/features/settings/ui/ExperimentalFeaturesCard.tsx)
uses a [preview-feature manifest](https://github.com/block/buzz/blob/main/preview-features.json)
that includes Workflows, Projects and Forum Channels. Use the app's native
settings for available features; no additional language layer is needed to
expose them. Which toggles are enabled in this installed app was not inspected
or changed. The [native core-memory loader](https://github.com/block/buzz/blob/main/crates/buzz-acp/src/engram_fetch.rs)
also documents the distinction between core injection and other memory retrieval.

## Check the local interfaces
```sh
BUZZ="$HOME/.local/bin/buzz"
BEND="$HOME/.bend/bin/bend"
WORKER_SOURCE="/absolute/path/to/telepathy/runtime/worker/system.bend"
export BEND_NO_TELEMETRY=1
"$BUZZ" --help
"$BUZZ" mem --help
"$BUZZ" mem patch --help
"$BUZZ" workflows --help
"$BEND" version
"$BEND" "$WORKER_SOURCE" --check-only
"$BEND" "$WORKER_SOURCE" -- help
/Applications/Buzz.app/Contents/MacOS/buzz-acp --help
```

Require successful checker exit and `All terms check.`. Bend 2.0.21 was tested.
The actual invocation is `bend FILE --check-only`, not `bend check FILE`.
The worker protocol remains `worker → claim → packet → return → explicit learn`;
follow [META.md](../adaptive/META.md) and the source's help for exact arguments.

## Retrieve and retain selected memory
Buzz commands below run in the owner-controlled signing environment, using its
configured relay, identity, and owner attestation. Do not inject those signing
credentials into a Mundus execution process to make commands work.
Do not put private keys in command arguments, documents, or memory. Without an
already configured identity, arrange that setup through the owning Buzz host.

These are templates: replace the slug and file paths deliberately. Reads:
```sh
"$BUZZ" mem ls --json
"$BUZZ" mem get "selected-finding-slug"
"$BUZZ" mem hash "selected-finding-slug"
```

First draft a concise finding with its source revision, observed checks, scope,
counterexamples and intended audience. Shubham reviews the exact content before
the owner-controlled signer sends it. For a reviewed new entry, stdin supplies
its contents; this is a send operation, not draft creation:
```sh
"$BUZZ" mem set "selected-finding-slug" - < "/private/path/selected-finding.txt"
```

For an existing entry, read it and capture its exact hash before preparing the
unified diff. Preview, then apply the reviewed patch against that captured hash:
```sh
"$BUZZ" mem patch "selected-finding-slug" --base-hash "CAPTURED_SHA256" --patch-file "/private/path/change.diff" --dry-run
"$BUZZ" mem patch "selected-finding-slug" --base-hash "CAPTURED_SHA256" --patch-file "/private/path/change.diff"
```

Patch checks exact UTF-8 bytes and context; help does not establish server-atomic
compare-and-swap. On conflict reread and reconcile. Avoid `--no-base-hash` for
shared edits. Empty writes require explicit `--allow-empty`; `mem rm` tombstones
entries and cannot remove `core`. Findings are attributed evidence, not proof
that arbitrary worker answers are correct.

## Use the existing Buzz harness and YAML

Standard OpenCode provides `opencode acp` directly. On the inspected machine,
`$HOME/.opencode/bin/opencode --version` returns **1.18.32**, while the Homebrew
executable on PATH returns **1.14.20**. Select the intended executable explicitly:
PATH resolution can differ by login shell or service environment; the explicit
path makes the selected installation deterministic.

```sh
OPENCODE="$HOME/.opencode/bin/opencode"
"$OPENCODE" --version
"$OPENCODE" acp --help
```

In the existing Buzz host configuration, use that absolute path as
`--agent-command` and `acp` as `--agent-args`. ACP communicates over stdio;
do not add a custom bridge or start a second workspace server for local use.
The CLI/help was checked without a model call; this does not certify provider
credentials or model availability. Do not pass signing keys into execution
processes to repair missing configuration.

`buzz-acp` injects the per-session **core** engram by default as `<core-memory>`;
`--no-memory` disables that injection, not storage. Other slugs require explicit
retrieval. The harness supports `--agent-command`, `--agent-args`, `--agents`,
`--session-policy channel|thread`, time limits, and owner/allowlist routing.
Use the existing host configuration; installing this document starts no daemon.

`buzz workflows create/update` accepts YAML, while `trigger`, `runs`, and
`approve` manage execution records and approvals. Inspect their `--help` before
an authorized change. The repository's `scripts/jtbd-workflow.yaml` uses
`send_message` and `request_approval`. Do not invent a workflow `shell` action:
an ACP agent with process tools executes Bend and reports its observed evidence.

## Keep the storage boundaries explicit
Local Bend snapshots preserve worker claims, result provenance, explicit
learning, and corrections in one private single-writer lineage. A selected Buzz
engram is a separate retained summary; it does not automatically merge those
snapshots or inherit their dependency checks. Recheck relevant source before
reuse. Engrams are agent/owner scoped, not an unrestricted shared memory pool.
No model weights change through either mechanism.

The former custom shared-registry runtime is retired from this path. Existing
registry files remain historical evidence; they have **not** been migrated into
Buzz. Buzz memory is not claimed to reproduce that registry's executable
admission, signed-bundle rollback protection, or revocation semantics. Keep old
evidence intact and transfer only deliberately selected, authorized findings.
