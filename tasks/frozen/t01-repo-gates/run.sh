#!/usr/bin/env bash
# t01-repo-gates/run.sh — check required root files exist.
set -u
start=$(date +%s)
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
name="t01-repo-gates"
fail=0
for f in README.md SOP.md AGENTS.md HARNESS.md package.json; do
  [ -f "$ROOT/$f" ] || fail=1
done
cost=$(($(date +%s) - start))
if [ "$fail" -eq 0 ]; then echo "PASS $name cost=${cost}s"; else echo "FAIL $name cost=${cost}s"; fi
exit "$fail"
