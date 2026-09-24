# Set up intuitxn

## Start with standard OpenCode, Buzz and Bend

Use standard OpenCode directly. Its native ACP interface works with Buzz's
existing harness; Bend holds the checked worker logic. An oc2 fork, beta build,
Desk ledger, workspace service on port 4110, or custom learning runtime is not
required. Begin with [the native guide](runtime/worker/BUZZ.md) and
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
account. Checking CLI help does not verify model credentials. In the existing
Buzz host configuration, select the absolute OpenCode path as the agent command
and `acp` as its arguments. Keep signing credentials with the owner-controlled
Buzz host; isolation from workers remains a deployment requirement to verify.

Check the Bend source before work:

```sh
BEND_NO_TELEMETRY=1 "$HOME/.bend/bin/bend" runtime/system.bend --check-only
BEND_NO_TELEMETRY=1 "$HOME/.bend/bin/bend" runtime/system.bend -- help
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

## Optional legacy Desk workflow

The following existing workflow remains for operators who explicitly choose
its local job ledger, outbox and artifact-review tools. It is not required for
the native baseline above. Preserve its private state and receipts; do not start
its service simply to run OpenCode or Bend. Check `npm run desk -- help` for the
current command interface before using historical operational instructions.

## 1. Prepare this machine

Use Node 22.13 or newer. From this repository:

```sh
npm ci
npm run setup
npm run doctor
```

Setup creates private local settings without replacing existing settings. New settings default to standard OpenCode. It builds no plugin, installs no agent profile, and starts no service.

```sh
npm run opencode
```

Use `/connect` and `/models` in OpenCode to choose a provider and model. Codex uses its own login (`codex login`). The doctor checks installed tool versions and, when an existing Buzz signing environment is available, reads visible channel membership. It does not query a model catalog, make a model request, or start a service. `npm run opencode` invokes the installed CLI with `BUZZ_PRIVATE_KEY` and `BUZZ_AUTH_TAG` removed from its environment; this is not a general credential sandbox.

## 2. Give the team one place to start

Read [Start here](forum/START_HERE.md) and [Writing as intuitxn](forum/WRITING.md). They are ready to copy into forum posts and pin in Buzz. Git holds the editable source; the forum holds the readable team copy.

To prepare a post without publishing it:

```sh
npm run desk -- queue CHANNEL_UUID forum/START_HERE.md
```

The command returns the exact content, destination and digest. After reviewing them:

```sh
npm run desk -- send OUTBOX_ID DIGEST
```

Sending needs the authorized Buzz identity in the owner-controlled signing environment. The CLI uses `BUZZ_PRIVATE_KEY`, `BUZZ_RELAY_URL`, and, when required by the managed runtime, `BUZZ_AUTH_TAG`. Do not paste keys into chat or put them in repository files. The intuitxn relay is `https://intuitxn.communities.buzz.xyz`. Do not inject signing credentials into OpenCode workers to make sending work; the legacy environment's credential isolation must be checked before use.

A live Buzz connection is not established by setup. Once configured, `npm run doctor` checks visible channels through that identity. Membership and identity creation remain with Buzz; setup does not manufacture them.

## 3. Make company writing

```sh
npm run desk -- new report "Report title"
```

Replace `report` with `announcement`, `blog`, `proposal`, or `writing`. The command returns a Markdown file. Edit it directly or ask your agent to prepare it from selected sources.

```sh
npm run desk -- review ARTIFACT_ID "Reviewer name"
npm run desk -- export ARTIFACT_ID
```

Review records the exact content hash. Export refuses a changed draft and produces a Markdown file plus a receipt in `.local/exports/`. Nothing is uploaded. To prepare a reviewed artifact for Buzz, use `npm run desk -- queue-artifact CHANNEL_UUID ARTIFACT_ID`, then review and send its outbox item. Publish to the selected website or other destination only when the exact content and destination are authorized.

## 4. Build an application

Save a job as JSON, using an absolute repository path:

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

Add the repository to `.local/config.json` under `repositories`, then:

```sh
npm run desk -- job request.json
npm run desk -- run JOB_ID
```

Each job starts from committed HEAD in a separate Git worktree. Uncommitted edits in the original checkout are not copied. Selected context files are explicitly copied into the job brief with hashes. The result, changes and runtime session stay in `.local/jobs/`. New files remain in that worktree; `changes.patch` covers tracked modifications, and the stored Git status lists untracked files. Human review follows runtime completion.

OpenCode jobs call the standard `opencode run` CLI directly. Optionally set `model` in `.local/config.json` to a `provider/model` string accepted by that CLI, or leave it null to use the configured default. Set `OPENCODE_BIN` to an absolute executable path when multiple installations exist. No custom build profile or resident service is required. The host's normal permissions apply; a failed or timed-out job is left for inspection. The default job timeout is 15 minutes.

## 5. Import work from Buzz

In `.local/config.json`, fill in `channels` and `authorizedPubkeys`. Intake begins at the setup timestamp (`since`); change it deliberately to import older requests. Send an accepted request in this explicit form:

```text
/intuitxn {"request":"Build the reports index","acceptance":"Only reviewed reports appear and mobile checks pass","repository":0,"runtime":"opencode"}
```

`repository` is the zero-based entry in the configured repository list. Ordinary conversation does not create a job. This legacy intake is optional and has external effects: it sends queued/status notifications, runs imported jobs when `autoRun` is enabled, and processes authorized acceptance replies that can land changes, commit and push. Use it only when those actions are intended and authorized:

```sh
npm run desk -- poll
npm run desk -- watch
```

The watcher polls at the configured interval; Ctrl+C stops it. Both `poll` and `watch` use the behavior described above; neither is a read-only preview. They are not needed by the native OpenCode/Buzz/Bend baseline. To draft a reply separately after reviewing a job result:

```sh
npm run desk -- reply CHANNEL_UUID ORIGINAL_EVENT_ID outcome.md
```

Review and send that outbox item using the same digest flow. Delivery records require `accepted: true` and an event ID. An uncertain send cannot be repeated automatically. Inspect relay history and the saved receipt before taking further action.

## Optional shared Desk host

Clone this repository on the chosen host and run the same setup. Use a dedicated OS account and keep `.local/` on persistent storage. Desk invokes local command-line workers; it does not create an authenticated shared service. Arrange host access separately and do not expose the CLI as a public endpoint. The Buzz relay remains hosted separately. Model providers remain external unless you configure local inference.

This local job ledger is the execution authority for the pilot. It is not synced to Agent Manager. A future Agent Manager adapter must reuse these job IDs and replace this authority, not create a second queue.

Setup configures no boot-time daemon, resident OpenCode service, remote deployment, or public publishing destination. Existing unrelated services remain independently managed.

## Recovery and limits

- A claimed job cannot run a second time. After a crash, inspect its saved session and worktree; a `running` or `needs_attention` job needs operator reconciliation. Automatic session recovery is not implemented.
- Never retry a session whose submission or delivery is uncertain without checking the existing runtime state.
- The watcher rereads overlapping timestamps and deduplicates source IDs. A saturated page fails without advancing its cursor. Live relay pagination still needs verification with the configured community.
- Back up the SQLite database with SQLite's backup facilities, or stop writers before copying the database and its WAL files. Back up job worktrees and draft folders too.
- Local operator commands are trusted. The pilot does not provide multi-user login, role enforcement, or isolation from a malicious repository. Do not expose the CLI through an unauthenticated web endpoint.

## Relay setting for existing Desk users

Desk and the Telepathy plugin accept `INTUITXN_NETWORK`, which takes precedence
over their legacy `BUZZ_RELAY_URL` fallback. The native Buzz CLI instead accepts
`--relay` or `BUZZ_RELAY_URL` directly, as shown above. No oc2 network script is
required. Identity configuration is separate; preserve the existing owner-managed
signing environment and reviewed-send boundary.
