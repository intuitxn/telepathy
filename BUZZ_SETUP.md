# Set up intuitxn

## Start with standard OpenCode, Buzz and Bend

Use standard OpenCode directly. Its native ACP interface works with Buzz's
existing harness; Bend holds the checked worker logic. An oc2 fork, beta build,
alternative job ledger, workspace service on port 4110, or custom learning
runtime is not required. Begin with [the native guide](runtime/worker/BUZZ.md) and
[/meta agents](runtime/adaptive/META.md).

On this Mac, the explicitly checked binary at `~/.opencode/bin/opencode` is
1.18.32; Homebrew also has a 1.14.20 installation. PATH selection can differ
between login shells and services. Use an explicit path for deterministic setup:

```sh
OPENCODE="$HOME/.opencode/bin/opencode"
"$OPENCODE" --version
"$OPENCODE" acp --help
"$OPENCODE"
```

Use OpenCode's provider connection and model selection with your existing
account. Checking CLI help does not verify model credentials. Codex is another
configured worker option and uses its own login (`codex login`).

## 1. Connect Buzz with `opencode acp`

In the existing Buzz host configuration, select the absolute OpenCode path as the
agent command and `acp` as its arguments. Use `/connect` and `/models` in
OpenCode to choose a provider and model. Keep signing credentials with the
owner-controlled Buzz host; isolation from workers remains a deployment
requirement to verify.

Check the Bend source before work:

```sh
BEND_NO_TELEMETRY=1 "$HOME/.bend/bin/bend" runtime/worker/system.bend --check-only
BEND_NO_TELEMETRY=1 "$HOME/.bend/bin/bend" runtime/worker/system.bend -- help
"$HOME/.local/bin/buzz" mem --help
"$HOME/.local/bin/buzz" workflows --help
```

Require successful checker exit and `All terms check.`. Buzz's native memory
and workflow YAML provide retained findings and coordination. Core-memory
injection does not imply retrieval of every other memory slug. Draft selected
findings or posts, have Shubham review the exact content/destination, and send
through the owner-controlled signer. Existing registry data is not migrated.

Read [Start here](forum/START_HERE.md) and [Writing as intuitxn](forum/WRITING.md).
No new identity, remote connection, or publishing permission is created by these
instructions. In an already authorized Buzz signing environment, a read-only
connectivity check uses the installed CLI directly:

```sh
"$HOME/.local/bin/buzz" --relay "https://intuitxn.communities.buzz.xyz" channels list --member
```

The CLI also accepts `BUZZ_RELAY_URL`; no oc2 shell script is needed. Membership
and signing identity belong to the existing Buzz configuration. Never paste
private keys into chat, command arguments, or repository files.

## 2. Give the team one place to start

Read [Start here](forum/START_HERE.md) and [Writing as intuitxn](forum/WRITING.md). They are ready to copy into forum posts and pin in Buzz. Git holds the editable source; the forum holds the readable team copy.

To prepare a post without publishing it, keep the draft as a Markdown file in the
repository; it names the exact content, destination and intended audience. After
reviewing them, send through the existing owner-controlled Buzz signer within its
grants.

Sending needs the authorized Buzz identity in the owner-controlled signing
environment. The CLI uses `BUZZ_PRIVATE_KEY`, `BUZZ_RELAY_URL`, and, when
required by the managed runtime, `BUZZ_AUTH_TAG`. Do not paste keys into chat or
put them in repository files. The intuitxn relay is
`https://intuitxn.communities.buzz.xyz`. Do not inject signing credentials into
OpenCode workers to make sending work; the owner-controlled signer and the
worker environment stay separate.

A live Buzz connection is not established by installing OpenCode. Membership and
identity creation remain with Buzz; these instructions do not manufacture them.

## 3. Make company writing

Create a Markdown file directly, or ask your agent to prepare it from selected
sources. Name the kind — `report`, `announcement`, `blog`, `proposal`, or
`writing` — and keep it in the repository.

Before publishing, review the exact content and record its digest. Publish to the
selected website or other destination only when the exact content and destination
are authorized. Drafting alone publishes nothing.

## 4. Build an application

Work in the owning repository, or in a detached Git worktree at the selected base
revision. Use standard OpenCode directly; Codex is another configured worker
option. State a job as one JSON object, using an absolute repository path:

```json
{
  "runtime": "opencode",
  "repository": "/absolute/path/to/application",
  "owner": "Accountable person",
  "request": "Build the requested feature using the linked requirements.",
  "acceptance": "Describe the concrete behavior and checks that must pass.",
  "context": ["docs/requirements.md"]
}
```

Each job starts from committed HEAD in a separate Git worktree. Uncommitted edits
in the original checkout are not copied. Selected context files are copied into
the job brief with hashes. New files remain in that worktree; a `changes.patch`
covers tracked modifications, and the stored Git status lists untracked files.
Human review follows runtime completion.

OpenCode jobs call the standard `opencode run` CLI directly. Optionally set
`model` to a `provider/model` string accepted by that CLI, or leave it unset to
use the configured default. Set `OPENCODE_BIN` to an absolute executable path
when multiple installations exist. No custom build profile or resident service
is required. The host's normal permissions apply; a failed or timed-out job is
left for inspection. The default job timeout is 15 minutes.

Requests arrive as Buzz threads or NIP-34 issues in the home channel and route
through the declarative meta-agent registry (`.opencode/agents/`). Ordinary
conversation does not create a job. Human review and acceptance follow runtime
completion.

## Relay setting

The native Buzz CLI accepts `--relay` or `BUZZ_RELAY_URL` directly, as shown
above. No oc2 network script is required. Identity configuration is separate;
preserve the existing owner-managed signing environment and reviewed-send
boundary. The telepathy-mailbox plugin uses the same authorized relay access for
agent coordination and is not a durable store.

## Recovery and limits

- Preserve job worktrees and draft folders. After a failure, inspect the saved
  session and diff before retrying.
- Never retry a session whose submission or delivery is uncertain without
  checking the existing runtime state. Inspect the saved result and worktree
  before taking further action.
- Local operator commands are trusted. The pilot does not provide multi-user
  login, role enforcement, or isolation from a malicious repository. Do not
  expose the runtime through an unauthenticated web endpoint.
- Git holds accepted revisions; a commit alone is not human acceptance. Record
  agent verification separately from any actual human acceptance.
