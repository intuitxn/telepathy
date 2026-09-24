#!/usr/bin/env bash
# t04-memory-parse/run.sh — frozen KEY=VALUE lookup fixture check.
set -u
start=$(date +%s)
HERE="$(cd "$(dirname "$0")" && pwd)"
name="t04-memory-parse"
lookup() {
  v="$(grep -E "^$1=" "$HERE/mem.txt" 2>/dev/null | head -1 | cut -d= -f2-)"
  printf '%s=%s\n' "$1" "$v"
}
fail=0
tmp="/tmp/learn-loop-t04-memory-parse-got.txt"
{
  lookup engram.alpha
  lookup kernel.mundus
  lookup scope.default
  lookup policy.version
  lookup nope.missing
} > "$tmp"
cmp -s "$tmp" "$HERE/expected.txt" || fail=1
rm -f "$tmp"
cost=$(($(date +%s) - start))
if [ "$fail" -eq 0 ]; then echo "PASS $name cost=${cost}s"; else echo "FAIL $name cost=${cost}s"; fi
exit "$fail"
