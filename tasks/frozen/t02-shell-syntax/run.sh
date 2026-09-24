#!/usr/bin/env bash
# t02-shell-syntax/run.sh — bash -n over key shell files.
set -u
start=$(date +%s)
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
name="t02-shell-syntax"
fail=0
for f in scripts/census.sh scripts/memory-sync.sh scripts/worktree-guard.sh scripts/learn-loop.sh tasks/frozen/score.sh; do
  if [ ! -f "$ROOT/$f" ] || ! bash -n "$ROOT/$f" 2>/dev/null; then
    fail=1
  fi
done
cost=$(($(date +%s) - start))
if [ "$fail" -eq 0 ]; then echo "PASS $name cost=${cost}s"; else echo "FAIL $name cost=${cost}s"; fi
exit "$fail"
