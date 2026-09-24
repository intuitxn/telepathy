#!/bin/sh
# bend-forge-loop — unattended re-run of the Bend proof gates.
#
# DOES (read-only + check-only):
#   - Records repo HEAD (read-only), Bend version pin (expect bend 2.0.21).
#   - Re-runs `bend FILE --check-only` over
#     runtime/programs/bend-laws/PROOF.bend and
#     runtime/system.bend (the consolidated system DSL).
#   - Re-runs program fences via `telepathy-program bend-gate NAME`
#     for each registry program (artifact-design, lesson-proposal,
#     lesson-review).
#   - Appends the full timestamped transcript to ops/runs/ and prints
#     a VERDICT line per gate. Exits 0 iff no gate is RED, else 1.
#
# NEVER DOES: accept, publish, send, merge, tag, resolve, push, install,
#   restart services, touch credentials, or write anywhere outside ops/runs/.
#   A passing gate is never acceptance. Review pile-up is the intended output.
#
# Verdicts: GREEN = "All terms check." (bend files) / status=proven
#   (bend-gate). YELLOW = bend-gate status=open (no law yet / open laws:
#   known state, surfaced for review, does not fail the loop).
#   RED = anything else (checker error, TODOs in a PROOF.bend, missing
#   toolchain, launcher failure). Any RED -> exit 1.
set -u

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
RUNS="$ROOT/ops/runs"
BEND=${BEND:-"$HOME/.bend/bin/bend"}
export BEND_NO_TELEMETRY=1
TS="$(date -u +%Y%m%dT%H%M%SZ)"

mkdir -p "$RUNS"
OUT="$RUNS/bend-forge-$TS.log"
: > "$OUT"

RED=0
YELLOW=0

log() {
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$OUT"
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

bump_red() { RED=$((RED + 1)); }
bump_yellow() { YELLOW=$((YELLOW + 1)); }

log "=== bend-forge-loop start ts=$TS ==="
HEAD="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || printf 'unknown')"
log "repo HEAD=$HEAD (read-only observation)"

# --- toolchain pin -------------------------------------------------------
if [ -x "$BEND" ]; then
  BEND_VER="$("$BEND" version 2>&1)"
  log "bend version: $BEND_VER"
  case "$BEND_VER" in
    "bend 2.0.21") log "VERDICT GREEN toolchain-pin :: $BEND_VER" ;;
    *) log "VERDICT RED toolchain-pin :: expected 'bend 2.0.21', got '$BEND_VER'"; bump_red ;;
  esac
else
  log "VERDICT RED toolchain-pin :: missing executable at $BEND"
  bump_red
fi

# --- Bend checker gates --------------------------------------------------
gate_bend() {
  name="$1"
  rel="$2"
  log "--- gate: $name ($rel)"
  tmp="$(mktemp "${TMPDIR:-/tmp}/bend-forge-XXXXXX")"
  if [ -x "$BEND" ]; then
    (cd "$ROOT" && "$BEND" "$rel" --check-only >"$tmp" 2>&1); code=$?
  else
    printf 'missing Bend binary at %s\n' "$BEND" >"$tmp"; code=127
  fi
  cat "$tmp" >> "$OUT"
  last="$(tail -n 3 "$tmp" | tr '\n' '|' | cut -c1-300)"
  if [ "$code" -eq 0 ] && grep -q 'All terms check\.' "$tmp" 2>/dev/null; then
    log "VERDICT GREEN $name exit=$code :: $last"
  else
    log "VERDICT RED $name exit=$code :: $last"
    bump_red
  fi
  rm -f "$tmp"
}

gate_bend "bend-laws" "runtime/programs/bend-laws/PROOF.bend"
gate_bend "system" "runtime/system.bend"

# --- program fences via bend-gate -----------------------------------------
gate_program() {
  name="$1"
  log "--- gate: bend-gate $name"
  tmp="$(mktemp "${TMPDIR:-/tmp}/bend-gate-XXXXXX")"
  ("$ROOT/runtime/programs/telepathy-program" bend-gate "$name" >"$tmp" 2>&1); code=$?
  cat "$tmp" >> "$OUT"
  status="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("status","parse_error"))' "$tmp" 2>/dev/null || printf 'parse_error')"
  rm -f "$tmp"
  case "$status" in
    proven) log "VERDICT GREEN bend-gate/$name launcher_exit=$code status=$status" ;;
    open) log "VERDICT YELLOW bend-gate/$name launcher_exit=$code status=$status (no law or open laws; informational)"; bump_yellow ;;
    *) log "VERDICT RED bend-gate/$name launcher_exit=$code status=$status"; bump_red ;;
  esac
}

# Registry names mirror REGISTRY in runtime/programs/cli.py.
gate_program "artifact-design"
gate_program "lesson-proposal"
gate_program "lesson-review"

log "=== bend-forge-loop summary ts=$TS red=$RED yellow=$YELLOW log=$OUT ==="
ln -sfn "$OUT" "$RUNS/bend-forge-latest.log"
if [ "$RED" -gt 0 ]; then
  exit 1
fi
exit 0
