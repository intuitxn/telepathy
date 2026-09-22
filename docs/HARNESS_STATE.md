# Harness state

The verified state of Intuitxn's job harness. Ledger updates this file after every
accepted outcome; humans approve every entry. Checked facts only — mark uncertainty as such.

## Current baseline — 2026-09-22

Standard OpenCode executes directly or through native Buzz ACP; a checked Bend
worker (`runtime/worker/`) owns local kernel logic and explicit learn/correct
transitions; Buzz holds selected shared findings. The Desk engine (`runtime/desk`)
was **retired 2026-09-22** — its npm workspace, `setup`/`doctor`/`desk`/`opencode`
scripts and watch service were removed, and its history remains in git. The
retired oc2 pilot (`runtime/opencode-v2`) and the custom `plugins/telepathy`
integration were removed on the same date. No oc2 fork, custom plugin, fixed
provider/model, or second managed service is required. The separate workspace
service (`runtime/workspace`, `scripts/workspace-service.py`, port 4110) is
retained for its own use and is not part of this retirement.

Source verification: root `npm run check` now runs `node scripts/check.mjs`. It
guards the retirement (no `runtime/desk`, `scripts/desk-watch.sh`,
`runtime/opencode-v2`, `plugins/telepathy`), verifies the retained runtime paths
(`runtime/worker/`, `runtime/adaptive/`, `runtime/lorenz/`, the retained plugins
and agent charters, `site/`, `activity/`) and the post-Desk root package shape,
always runs the pure-Node evaluation test, and runs the Bend-backed checks when a
Bend binary is available. The earlier `npm run check` = 12 desk tests figure is
retired with the engine. A native ACP initialize handshake previously returned
OpenCode 1.18.32/protocol 1. See [the build plan](../runtime/adaptive/HARNESS.md)
for the remaining live demonstration and learning evaluation.

The following September 8 deployment report and accepted lessons are historical.
They do not establish that a watcher, provider, relay connection or credential
boundary is working now. Preserve the observations; do not run their retired
service recipes (Desk, `npm run setup`/`npm run doctor`, the oc2 node scripts) as
current setup instructions.

## Historical deployment report — 2026-09-08

## What the harness is

- **Buzz relay** (`wss://intuitxn.communities.buzz.xyz`): human context layer — requests,
  threads, acceptance, receipts. Also git repos (NIP-34), projects (NIP-MP), issues,
  workflows, DMs.
- **Desk engine** (`runtime/desk`): local job engine. SQLite ledger (jobs, artifacts,
  outbox, cursors) at `.local/`. Commands via `npm run desk -- help`.
- **Runtimes:** Codex (default worker; sandboxed `codex exec`) and opencode
  (the oc2 fork binary, headless `opencode run` with the authenticated
  `opencode-go` provider; default `opencode-go/deepseek-v4-flash`).
- **Git:** accepted revisions. Worktrees at `.local/jobs/<id>/worktree` are disposable candidates.

## Lifecycle

```text
Proposed -> Ready -> Active -> Waiting -> Review -> Resolved | Cancelled
```

Job JSON: `owner`, `repository`, `runtime` (`codex`|`opencode`), `request`, `acceptance`,
optional `context` (repo-relative paths, sha256-snapshotted).

## Historical status — 2026-09-08 (retired Desk engine)

| Piece | State |
|---|---|
| `npm run setup` / `npm run doctor` | Working |
| Desk accept transition | Working — `npm run desk -- accept ID REVIEWER` completes Review -> Resolved |
| Job queue + Codex run | Working — first job 2026-09-06 (HARNESS.md candidate) |
| opencode runtime | Working — desk jobs run the oc2 fork binary with the authenticated `opencode-go` provider (default `opencode-go/deepseek-v4-flash`); live smoke job `3138987b` resolved 2026-09-08 |
| Site alpha + registry catalog | Working — builds, 15 tests pass |
| Desk + plugin tests | Working — 4 desk + 2 plugin tests pass |
| Buzz relay writes | Verified 2026-09-06 — channels, projects, workflow, canvases, notes, members all accepted |
| Live intake (poll/watch) | Working — real Buzz message -> desk job `154ba928`, accepted by Shubham, landed as `docs/RELAY_SETUP.md` |
| Persistent runner | Running — launchd `com.intuitxn.telepathy-desk-watch` polls every 15s; auto-runs queued jobs; chat `accept` lands them |
| Autonomous loop | Live — job `5046e555` went Buzz message -> queue -> Codex -> candidate reply -> chat accept -> commit `05afab1` -> pushed origin+buzz -> resolution reply, all unattended |

## Historical open gaps — 2026-09-08

1. (resolved) Watch loop runs as a launchd user agent on this Mac; identity comes from the Buzz environment export.
2. (resolved) Code pushed to the relay repo — `main` at `2780de7`, repo bound to the telepathy channel.
3. The telepathy channel's roster lost its owner role during the relay's earlier state; writes work, so this is cosmetic for now.
4. Jobs `200afc61`/`01a249cb` remain `needs_attention` evidence for the historical opencode2 model-unavailable finding (fixed 2026-09-08 by switching desk opencode jobs to the oc2 fork binary).

## Lesson log

Lessons are dated, specific, and written only after a human accepts the outcome.

- **2026-09-06 (accepted by Shubham)** — Codex is the proven execution runtime; opencode2's
  free zen models fail with `ModelUnavailable` in live jobs. Keep opencode2 for interactive
  planning only.
- **2026-09-06 (accepted by Shubham)** — The opencode2 session API requires a `provider/model`
  reference, not a bare model string. Fixed in `runtime/desk/src/jobs.js`.
- **2026-09-06 (accepted by Shubham)** — The Job lifecycle was missing its final transition.
  Added `desk accept` (Review -> Resolved) with a named reviewer and timestamp; covered by a test.
- **2026-09-06 (accepted by Shubham)** — Relay git push works with the official helper from Buzz Desktop
  (`/Applications/Buzz.app/Contents/MacOS/git-credential-nostr`) plus `credential.useHttpPath=true` and
  `nostr.keyfile`. `buzz repos bind` fails with a timestamp error on old announcements — publish the
  bind event yourself (kind 30617 with a `buzz-channel` tag) via `POST /events`.
