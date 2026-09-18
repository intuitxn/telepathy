# ops/loops — unattended propose-to-review loops (drafts, not installed)

Two read-only sweeps that re-run the lab's propose-to-review gates without
human hands. They surface REDs for human review; they never resolve anything.

## What each loop does

### bend-forge-loop.sh (proposed cadence: every 60 min)

Re-runs the Bend proof gates exactly as the toolchain pins them
(`runtime/programs/bend-laws/TOOLCHAIN.md`, Bend 2.0.5, absolute path
`/Users/a3fckx/.bend/bin/bend` with `BEND_NO_TELEMETRY=1`):

1. Toolchain pin: `bend --version` must print `bend 2.0.5`.
2. Bare-file gates (there is no `bend check` in 2.0.5):
   - `runtime/programs/bend-laws/PROOF.bend` → expect `All terms check.`
   - `runtime/programs/retrieval/PROOF.bend` → expect `All terms check.`
3. Program fences via `telepathy-program bend-gate NAME` for
   `artifact-design`, `lesson-proposal`, `lesson-review`
   (registry mirrors `REGISTRY` in `runtime/programs/cli.py`).

Verdicts: `GREEN` = proven; `YELLOW` = bend-gate `open` (no law yet —
informational, does not fail the loop); `RED` = anything else, including
TODOs left in a `PROOF.bend`. Any RED → exit 1.

### relay-keeper-loop.sh (proposed cadence: every 15 min)

Read-only infra health sweep. Nothing here restarts, installs, publishes,
or touches credentials:

1. `python3 scripts/workspace-service.py status` (status subcommand only).
2. Doctor-equivalent checks that work without credentials:
   `node runtime/desk/src/cli.js doctor`, plus bend/node/launcher presence
   and read-only service-plist / state-dir observations.
3. Read-only probes: loopback HTTP GET to `127.0.0.1:4110/api/health`
   (stdlib python, 5 s timeout) and one read-only HTTPS GET to the public
   URL's `/api/health` (10 s timeout; failure is `YELLOW` since tunnel-down
   vs local-egress needs human triage).

Verdicts: `GREEN` / `RED` / `YELLOW` are recorded per check. This loop is a
reporter: it exits 0 whenever the sweep completes and writes its log. RED
findings are data for the review pile, not loop failures; nonzero exit means
the loop itself broke.

## Outputs

- `ops/runs/bend-forge-<UTC-timestamp>.log` and
  `ops/runs/relay-keeper-<UTC-timestamp>.log`: full transcripts with
  per-gate `VERDICT` lines and a closing summary line.
- `ops/runs/bend-forge-latest.log` / `ops/runs/relay-keeper-latest.log`:
  symlinks to the most recent run. `ops/runs/` holds run output only.

## What these loops never do

No accept / publish / send / merge / tag / resolve / push. No service
restarts (`install`/`restart`/`kickstart`/`bootstrap`/`bootout` are never
invoked). No credential access (`BUZZ_PRIVATE_KEY`, keyfiles, invitation
secrets), no membership/invites/auth changes, no new ports or network
rewiring, no code installs, no writes outside `ops/runs/`. A green gate is
never acceptance — only a named human reviewing the exact candidate
revision resolves anything.

Review pile-up is the intended output: REDs accumulate in `ops/runs/` until
a human triages them.

## Install instructions (human runs these; the agent must not)

The plists in this directory are drafts. They are NOT installed. To install:

```sh
cd /Users/a3fckx/Desktop/Attri/telepathy
cp ops/loops/com.intuitxn.telepathy-bend-forge-loop.plist ~/Library/LaunchAgents/
cp ops/loops/com.intuitxn.telepathy-relay-keeper-loop.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.intuitxn.telepathy-bend-forge-loop.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.intuitxn.telepathy-relay-keeper-loop.plist
```

Verify:

```sh
launchctl print gui/$(id -u)/com.intuitxn.telepathy-bend-forge-loop | head -20
launchctl print gui/$(id -u)/com.intuitxn.telepathy-relay-keeper-loop | head -20
tail -5 ops/runs/bend-forge-launchd.log ops/runs/relay-keeper-launchd.log
```

Unload (does not delete run history):

```sh
launchctl bootout gui/$(id -u)/com.intuitxn.telepathy-bend-forge-loop
launchctl bootout gui/$(id -u)/com.intuitxn.telepathy-relay-keeper-loop
```

Manual single run (no install needed):

```sh
sh ops/loops/bend-forge-loop.sh; echo "exit=$?"
sh ops/loops/relay-keeper-loop.sh; echo "exit=$?"
```

## Test record (2026-09-18, before handoff)

- `bend-forge-loop.sh` → exit 1. Exactly one RED: the `retrieval`
  `PROOF.bend` gate reports `Error: 1 TODO found` (bend exit 1) — the known
  open leaf documented in that file's header (P2 work). GREEN: toolchain pin
  (`bend 2.0.5`), `bend-laws` (`All terms check.`). YELLOW ×3: all three
  `bend-gate` programs report `open` / `no_law` (no inline `bend-law`
  fences yet — informational).
- `relay-keeper-loop.sh` → exit 0. RED: service status (connection refused —
  workspace service not running) and loopback `:4110` probe (same cause).
  GREEN: doctor, bend binary, program launcher. YELLOW: public-URL probe and
  any absent plist/state observations, per the triage rule above.
