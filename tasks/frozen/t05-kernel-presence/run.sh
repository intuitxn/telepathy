#!/usr/bin/env bash
# t05-kernel-presence/run.sh — runtime .bend kernel gate check.
set -u
start=$(date +%s)
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
name="t05-kernel-presence"
fail=0
for f in runtime/crdt.bend runtime/memory.bend runtime/policy.bend; do
  [ -f "$ROOT/$f" ] || fail=1
done
cost=$(($(date +%s) - start))
if [ "$fail" -eq 0 ]; then echo "PASS $name cost=${cost}s"; else echo "FAIL $name cost=${cost}s"; fi
exit "$fail"
