#!/usr/bin/env bash
# learn-loop.sh — frozen learning-loop harness runner.
# Usage: learn-loop.sh [baseline|remeasure]
# Runs tasks/frozen/score.sh, prints the score line, appends one JSONL
# line per run to /tmp/learn-loop-runs.log (mirrored at
# tasks/frozen/runs.log, gitignored). No network, no daemon, no auto-update.
set -u
MODE="${1:-baseline}"
case "$MODE" in
  baseline|remeasure) ;;
  *) echo "usage: learn-loop.sh [baseline|remeasure]" >&2; exit 2 ;;
esac
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCORE_OUT="$("$ROOT/tasks/frozen/score.sh" 2>&1)"
STATUS=$?
printf '%s\n' "$SCORE_OUT"
SUMMARY="$(printf '%s\n' "$SCORE_OUT" | grep -E 'passed=[0-9]+ total=[0-9]+ cost=[0-9]+s' | tail -1)"
P="$(printf '%s' "$SUMMARY" | grep -o 'passed=[0-9]*' | cut -d= -f2)"
T="$(printf '%s' "$SUMMARY" | grep -o 'total=[0-9]*' | cut -d= -f2)"
C="$(printf '%s' "$SUMMARY" | grep -o 'cost=[0-9]*s' | tail -1 | cut -d= -f2)"
TS="$(date -u +%FT%TZ)"
LINE="$(printf '{"ts":"%s","mode":"%s","passed":%s,"total":%s,"cost":"%s"}' "$TS" "$MODE" "${P:-0}" "${T:-0}" "${C:-0s}")"
printf '%s\n' "$LINE" >> /tmp/learn-loop-runs.log
printf '%s\n' "$LINE" >> "$ROOT/tasks/frozen/runs.log"
printf '%s\n' "$LINE"
exit "$STATUS"
