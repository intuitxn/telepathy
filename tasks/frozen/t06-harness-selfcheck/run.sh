#!/usr/bin/env bash
# t06-harness-selfcheck/run.sh — harness completeness gate.
set -u
start=$(date +%s)
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
name="t06-harness-selfcheck"
fail=0
[ -x "$ROOT/tasks/frozen/score.sh" ] || fail=1
[ -x "$ROOT/scripts/learn-loop.sh" ] || fail=1
for d in "$ROOT"/tasks/frozen/t*/; do
  [ -d "$d" ] || continue
  [ -f "${d}task.md" ] || fail=1
  [ -x "${d}run.sh" ] || fail=1
done
cost=$(($(date +%s) - start))
if [ "$fail" -eq 0 ]; then echo "PASS $name cost=${cost}s"; else echo "FAIL $name cost=${cost}s"; fi
exit "$fail"
