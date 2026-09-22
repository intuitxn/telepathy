#!/bin/sh
# relay-keeper-loop — unattended read-only infra health sweep.
#
# DOES (read-only; no credentials, no network writes, no restarts):
#   1. Workspace service status via `python3 scripts/workspace-service.py status`
#      (the status subcommand only; never install/restart).
#   2. Toolchain presence checks that work without credentials: bend binary +
#      version, node version, telepathy-program launcher, and read-only service
#      plist / state-dir observations. The retired Desk doctor sweep
#      (`node runtime/desk/src/cli.js doctor` / `npm run doctor`) was removed
#      2026-09-22 with the Desk engine.
#   3. Tunnel/port probes, read-only: loopback TCP+HTTP GET to
#      127.0.0.1:4110/api/health (stdlib python, 5s timeout) and one
#      read-only HTTPS GET to the public URL's /api/health (10s timeout).
#   4. Appends the full timestamped transcript to ops/runs/ with a VERDICT
#      line per check.
#
# NEVER DOES: restart/bootout/bootstrap anything, publish a post, accept an
#   artifact, resolve a job, send anything externally, touch credentials
#   (BUZZ_PRIVATE_KEY, keyfiles, invitation secrets), membership/invites/auth,
#   open ports, rewire the network, merge/push code, or install anything.
#   Review pile-up is the intended output.
#
# Verdicts: GREEN = check passed. RED = check failed (needs human triage).
#   YELLOW = unverifiable from here / absent-by-design (e.g. public URL not
#   reachable from this network, service plist not installed). This loop is a
#   reporter: it exits 0 whenever the sweep itself completes and writes its
#   log; RED findings are data for the review pile, not loop failures.
#   Nonzero exit means the loop itself broke (e.g. ops/runs unwritable).
set -u

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
RUNS="$ROOT/ops/runs"
PORT=4110
PUBLIC='https://telepathy.intuitxn.com'
TS="$(date -u +%Y%m%dT%H%M%SZ)"

mkdir -p "$RUNS"
OUT="$RUNS/relay-keeper-$TS.log"
: > "$OUT"

RED=0
YELLOW=0

log() {
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$OUT"
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

bump_red() { RED=$((RED + 1)); }
bump_yellow() { YELLOW=$((YELLOW + 1)); }

log "=== relay-keeper-loop start ts=$TS ==="
HEAD="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || printf 'unknown')"
log "repo HEAD=$HEAD (read-only observation)"

# --- 1. workspace service status (read-only subcommand) --------------------
log "--- check: workspace-service status"
tmp="$(mktemp /private/var/folders/61/b705h_dd3_lggk6zs8jzcnx80000gn/T/relay-svc-XXXXXX)"
(python3 "$ROOT/scripts/workspace-service.py" status >"$tmp" 2>&1); code=$?
cat "$tmp" >> "$OUT"
last="$(tail -n 3 "$tmp" | tr '\n' '|' | cut -c1-300)"
rm -f "$tmp"
if [ "$code" -eq 0 ]; then
  log "VERDICT GREEN service-status exit=$code :: $last"
else
  log "VERDICT RED service-status exit=$code :: $last"
  bump_red
fi

# --- 2. toolchain presence (no creds, no network) ---------------------------
log "--- check: toolchain presence"
if [ -x /Users/a3fckx/.bend/bin/bend ]; then
  BEND_VER="$(BEND_NO_TELEMETRY=1 /Users/a3fckx/.bend/bin/bend version 2>&1)"; code=$?
  if [ "$code" -eq 0 ]; then
    log "VERDICT GREEN bend-binary exit=$code :: $BEND_VER"
  else
    log "VERDICT RED bend-binary exit=$code :: $BEND_VER"
    bump_red
  fi
else
  log "VERDICT RED bend-binary :: missing executable at /Users/a3fckx/.bend/bin/bend"
  bump_red
fi
NODE_VER="$(node --version 2>&1 || printf 'node missing')"
log "node version: $NODE_VER"
if [ -x "$ROOT/runtime/programs/telepathy-program" ]; then
  log "VERDICT GREEN program-launcher :: present at runtime/programs/telepathy-program"
else
  log "VERDICT RED program-launcher :: missing at runtime/programs/telepathy-program"
  bump_red
fi
PLIST="$HOME/Library/LaunchAgents/com.intuitxn.telepathy-workspace.plist"
if [ -f "$PLIST" ]; then
  log "service plist: present at $PLIST (read-only observation; not modified)"
else
  log "service plist: absent at $PLIST (read-only observation; install is a human decision)"
  bump_yellow
fi
STATE="$HOME/.local/share/telepathy-workspace"
if [ -d "$STATE" ]; then
  log "service state dir: $(ls -ld "$STATE" 2>/dev/null || printf 'unstatable')"
else
  log "service state dir: absent at $STATE (read-only observation)"
  bump_yellow
fi

# --- 3a. loopback port probe (read-only GET, stdlib only, 5s timeout) -------
log "--- check: loopback probe 127.0.0.1:$PORT"
tmp="$(mktemp /private/var/folders/61/b705h_dd3_lggk6zs8jzcnx80000gn/T/relay-loopback-XXXXXX)"
PORT="$PORT" python3 -c '
import os, urllib.request
req = urllib.request.Request(
    "http://127.0.0.1:%s/api/health" % os.environ["PORT"],
    headers={"Host": "telepathy.intuitxn.com"})
try:
    with urllib.request.urlopen(req, timeout=5) as r:
        print(r.status)
except Exception as e:
    print("probe_failed: %s" % e)
' >"$tmp" 2>&1; code=$?
cat "$tmp" >> "$OUT"
last="$(tr -d '\n' < "$tmp" | cut -c1-300)"
rm -f "$tmp"
case "$last" in
  200) log "VERDICT GREEN loopback-$PORT :: HTTP $last" ;;
  *) log "VERDICT RED loopback-$PORT :: $last"; bump_red ;;
esac

# --- 3b. public URL probe (read-only GET, 10s timeout; YELLOW on failure) ---
log "--- check: public probe $PUBLIC (read-only GET)"
tmp="$(mktemp /private/var/folders/61/b705h_dd3_lggk6zs8jzcnx80000gn/T/relay-public-XXXXXX)"
PUBLIC="$PUBLIC" python3 -c '
import os, urllib.request
try:
    with urllib.request.urlopen(os.environ["PUBLIC"] + "/api/health", timeout=10) as r:
        print(r.status)
except Exception as e:
    print("probe_failed: %s" % e)
' >"$tmp" 2>&1; code=$?
cat "$tmp" >> "$OUT"
last="$(tr -d '\n' < "$tmp" | cut -c1-300)"
rm -f "$tmp"
case "$last" in
  200) log "VERDICT GREEN public-url :: HTTP $last" ;;
  *) log "VERDICT YELLOW public-url :: $last (tunnel-down vs local-egress needs human triage)"; bump_yellow ;;
esac

log "=== relay-keeper-loop summary ts=$TS red=$RED yellow=$YELLOW log=$OUT ==="
ln -sfn "$OUT" "$RUNS/relay-keeper-latest.log"
exit 0
