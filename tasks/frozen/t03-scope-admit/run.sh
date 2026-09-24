#!/usr/bin/env bash
# t03-scope-admit/run.sh — frozen scope admit/deny fixture check.
set -u
export LC_ALL=C # byte-wise charset matching, locale-independent verdicts
start=$(date +%s)
HERE="$(cd "$(dirname "$0")" && pwd)"
name="t03-scope-admit"
admit() {
  case "$1" in
    read:*|compute:*) ;;
    *) return 1 ;;
  esac
  res="${1#*:}"
  case "$res" in ""|admin|root) return 1 ;; esac
  case "$res" in *[!a-z0-9_-]*) return 1 ;; esac
  return 0
}
fail=0
tmp="/tmp/learn-loop-t03-scope-admit-got.txt"
: > "$tmp"
while IFS= read -r scope || [ -n "$scope" ]; do
  if admit "$scope"; then echo "admit" >> "$tmp"; else echo "deny" >> "$tmp"; fi
done < "$HERE/input.txt"
cmp -s "$tmp" "$HERE/expected.txt" || fail=1
rm -f "$tmp"
cost=$(($(date +%s) - start))
if [ "$fail" -eq 0 ]; then echo "PASS $name cost=${cost}s"; else echo "FAIL $name cost=${cost}s"; fi
exit "$fail"
