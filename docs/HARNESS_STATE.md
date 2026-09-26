# Harness state

This file keeps dated harness evidence and lessons. The current source target is
the checked DSH algorithm machine; a source check does not prove that the live
DeepSeek provider, installed service, or old relay intake has switched.

## Current source baseline — 2026-09-26

`runtime/core/telepathy.bend` is the self-contained algorithm candidate.
`runtime/dsh/` contains the pinned DeepSeek Harness plugin, host task control,
source archives, independent settlement, and a local resident ingress for
research and analysis. The intended provider route is
`deepseek-official/deepseek-flash`. The exact source and keyless checks are
specified in the [DSH guide](../runtime/dsh/README.md); the operator sequence
is in [OPERATE.md](../OPERATE.md). A live DeepSeek turn and migration from the
old resident service still need their separate gates. Keep the old private
ledger, sessions, and reviewable workspaces during that transition.

The root `npm run check` checks source with optional local Bend; `make check`
requires Bend; `make integration-check` additionally requires a built pinned
DSH checkout. These commands are source checks, not human acceptance or a
claim of current provider connectivity.

The 2026-09-22 OpenCode/Buzz baseline and the 2026-09-08 deployment report below
are historical. They do not establish that the watcher, provider, relay
connection, or credential boundary is working now. Do not run their retired
service recipes as current setup instructions.

## Historical deployment report — 2026-09-08

## What the harness is

- **Buzz relay** (`wss://intuitxn.communities.buzz.xyz`): human context layer — requests,
  threads, acceptance, receipts. Also git repos (NIP-34), projects (NIP-MP), issues,
  workflows, DMs.
- **Desk engine** (`runtime/desk`): local job engine. SQLite ledger (jobs, artifacts,
  outbox, cursors) at `.local/` in the earlier deployment. Its CLI is retired from this source tree.
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

## Status reported on 2026-09-08

| Piece | State |
|---|---|
| Desk setup and doctor | Reported working on 2026-09-08; commands retired from this source tree |
| Desk accept transition | Reported working on 2026-09-08; historical Review -> Resolved flow |
| Job queue + Codex run | Working — first job 2026-09-06 (HARNESS.md candidate) |
| opencode runtime | Working — desk jobs run the oc2 fork binary with the authenticated `opencode-go` provider (default `opencode-go/deepseek-v4-flash`); live smoke job `3138987b` resolved 2026-09-08 |
| Site alpha + registry catalog | Working — builds, 15 tests pass |
| Desk + plugin tests | Working — 4 desk + 2 plugin tests pass |
| Buzz relay writes | Verified 2026-09-06 — channels, projects, workflow, canvases, notes, members all accepted |
| Live intake (poll/watch) | Working — real Buzz message -> desk job `154ba928`, accepted by Shubham, landed as `docs/RELAY_SETUP.md` |
| Persistent runner | Running — launchd `com.intuitxn.telepathy-desk-watch` polls every 15s; auto-runs queued jobs; chat `accept` lands them |
| Autonomous loop | Live — job `5046e555` went Buzz message -> queue -> Codex -> candidate reply -> chat accept -> commit `05afab1` -> pushed origin+buzz -> resolution reply, all unattended |

## Open gaps

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
  reference, not a bare model string. Fixed in the historical Desk implementation, now absent from this source tree.
- **2026-09-06 (accepted by Shubham)** — The Job lifecycle was missing its final transition.
  Added `desk accept` (Review -> Resolved) with a named reviewer and timestamp; covered by a test.
- **2026-09-06 (accepted by Shubham)** — Relay git push works with the official helper from Buzz Desktop
  (`/Applications/Buzz.app/Contents/MacOS/git-credential-nostr`) plus `credential.useHttpPath=true` and
  `nostr.keyfile`. `buzz repos bind` fails with a timestamp error on old announcements — publish the
  bind event yourself (kind 30617 with a `buzz-channel` tag) via `POST /events`.
