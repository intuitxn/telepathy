# Harness state

The verified state of Intuitxn's job harness. Steward updates this file after every
accepted outcome; humans approve every entry. Checked facts only — mark uncertainty as such.

## What the harness is

- **Buzz relay** (`wss://intuitxn.communities.buzz.xyz`): human context layer — requests,
  threads, acceptance, receipts. Also git repos (NIP-34), projects (NIP-MP), issues,
  workflows, DMs.
- **Desk engine** (`runtime/desk`): local job engine. SQLite ledger (jobs, artifacts,
  outbox, cursors) at `.local/`. Commands via `npm run desk -- help`.
- **Runtimes:** Codex (default worker; sandboxed `codex exec`) and opencode2
  (isolated pilot, 7 models; default `nemotron-3-ultra-free` from `.local/config.json`).
- **Git:** accepted revisions. Worktrees at `.local/jobs/<id>/worktree` are disposable candidates.

## Lifecycle

```text
Proposed -> Ready -> Active -> Waiting -> Review -> Resolved | Cancelled
```

Job JSON: `owner`, `repository`, `runtime` (`codex`|`opencode`), `request`, `acceptance`,
optional `context` (repo-relative paths, sha256-snapshotted).

## Current status (updated 2026-09-06)

| Piece | State |
|---|---|
| `npm run setup` / `npm run doctor` | Working |
| Desk accept transition | Working — `npm run desk -- accept ID REVIEWER` completes Review -> Resolved |
| Job queue + Codex run | Working — first job 2026-09-06 (HARNESS.md candidate) |
| opencode2 runtime | Service healthy, sessions create — but execution fails: zen models unavailable (`ModelUnavailable`). Use Codex for execution; opencode2 stays for interactive planning only |
| Site alpha + registry catalog | Working — builds, 15 tests pass |
| Desk + plugin tests | Working — 4 desk + 2 plugin tests pass |
| Buzz relay writes | Verified 2026-09-06 — channels, projects, workflow, canvases, notes, members all accepted |
| Live intake (poll/watch) | Working — real Buzz message -> desk job `154ba928`, accepted by Shubham, landed as `docs/RELAY_SETUP.md` |
| Persistent runner | Running — launchd `com.intuitxn.telepathy-desk-watch` polls the relay every 15s (logs in `.buzz/WORK_LOGS/desk-watch*.log`) |

## Open gaps

1. (resolved) Watch loop runs as a launchd user agent on this Mac; identity comes from the Buzz environment export.
2. (resolved) Code pushed to the relay repo — `main` at `2780de7`, repo bound to the telepathy channel.
3. The telepathy channel's roster lost its owner role during the relay's earlier state; writes work, so this is cosmetic for now.
4. Jobs `200afc61`/`01a249cb` remain `needs_attention` evidence for the opencode2 model-unavailable finding.

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
