# Set up intuitxn

The team reads the forum, asks for work, and reviews artifacts. OpenCode and Codex run beneath that workflow.

## 1. Prepare this machine

Use Node 22.13 or newer. From this repository:

```sh
npm ci
npm run setup
npm run doctor
```

Setup builds the v2 plugin and creates private local settings without replacing existing settings. Versions are pinned in the lockfile. On this Mac, setup has already run.

```sh
npm run opencode
```

Use `/connect` and `/models` in OpenCode to choose a provider and model. Codex uses its own login (`codex login`). The doctor lists catalog availability; it does not make a model request or prove a provider account is usable.

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

Sending needs the authorized Buzz identity in the service environment. The CLI uses `BUZZ_PRIVATE_KEY`, `BUZZ_RELAY_URL`, and, when required by the managed runtime, `BUZZ_AUTH_TAG`. Do not paste keys into chat or put them in repository files. The intuitxn relay is `https://intuitxn.communities.buzz.xyz`. Start the OpenCode service from the configured environment; an already-running service retains its earlier environment.

No live Buzz connection is configured in this shell. Once connected, `npm run doctor` checks visible channels through that identity. Membership and identity creation remain with Buzz; setup does not manufacture them.

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
  "runtime": "codex",
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

For OpenCode jobs, set `runtime` to `opencode` and set `model` in `.local/config.json` to an available `{ "providerID": "...", "id": "..." }`. Jobs use the `intuitxn-build` profile. Actions needing approval can be handled in the OpenCode interface connected to the same service. They are not auto-approved. Jobs time out after 15 minutes by default and are left for inspection.

## 5. Import work from Buzz

In `.local/config.json`, fill in `channels` and `authorizedPubkeys`. Intake begins at the setup timestamp (`since`); change it deliberately to import older requests. Send an accepted request in this explicit form:

```text
/intuitxn {"request":"Build the reports index","acceptance":"Only reviewed reports appear and mobile checks pass","repository":0,"runtime":"codex"}
```

`repository` is the zero-based entry in the configured repository list. Ordinary conversation never starts a job. Imported requests are queued for the operator to run:

```sh
npm run desk -- poll
npm run desk -- watch
```

The watcher polls at the configured interval; Ctrl+C stops it. It does not automatically execute jobs or publish responses. After reviewing a job result, prepare a concise reply in the original thread:

```sh
npm run desk -- reply CHANNEL_UUID ORIGINAL_EVENT_ID outcome.md
```

Review and send that outbox item using the same digest flow. Delivery records require `accepted: true` and an event ID. An uncertain send cannot be repeated automatically. Inspect relay history and the saved receipt before taking further action.

## One shared server

Clone this repository on the chosen host and run the same setup. Use a dedicated OS account and keep `.local/` on persistent storage. The desktop and terminal should connect to that account's authenticated OpenCode service through private access; do not expose the runtime directly to the public internet. The Buzz relay remains hosted separately. Model providers remain external unless you separately configure local inference.

This local job ledger is the execution authority for the pilot. It is not synced to Agent Manager. A future Agent Manager adapter must reuse these job IDs and replace this authority, not create a second queue.

`npm run desk -- stop` stops this workspace's OpenCode service. No boot-time daemon, remote deployment, or public publishing destination is configured by setup.

## Recovery and limits

- A claimed job cannot run a second time. After a crash, inspect its saved session and worktree; a `running` or `needs_attention` job needs operator reconciliation. Automatic session recovery is not implemented.
- Never retry a session whose submission or delivery is uncertain without checking the existing runtime state.
- The watcher rereads overlapping timestamps and deduplicates source IDs. A saturated page fails without advancing its cursor. Live relay pagination still needs verification with the configured community.
- Back up the SQLite database with SQLite's backup facilities, or stop writers before copying the database and its WAL files. Back up job worktrees and draft folders too.
- Local operator commands are trusted. The pilot does not provide multi-user login, role enforcement, or isolation from a malicious repository. Do not expose the CLI through an unauthenticated web endpoint.

Sources: [v2 plugins](https://opencode.ai/v2/docs/build/plugins/), [client](https://opencode.ai/v2/docs/build/client/), [instructions](https://opencode.ai/v2/docs/instructions/). The old `session.share` approach is unavailable in v2; team access comes from the application and authenticated server access.

## One network setting

Set `INTUITXN_NETWORK=https://intuitxn.communities.buzz.xyz` for Desk and the Telepathy plugin. It takes precedence over the legacy `BUZZ_RELAY_URL`; identity configuration is unchanged. For direct Buzz CLI calls, source `~/opencode2/script/oc2-network.sh` to export the CLI alias. See [current live use and boundaries](docs/FOUNDATIONS_AND_LIVE_USE.md).
