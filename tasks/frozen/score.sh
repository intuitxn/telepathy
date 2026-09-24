#!/usr/bin/env bash
# score.sh — run all frozen tasks, print passed=N total=M cost=Ss.
# Exits nonzero iff any task fails. No network, no side effects.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
passed=0
total=0
cost=0
for d in "$HERE"/t*/; do
  [ -d "$d" ] || continue
  [ -x "${d}run.sh" ] || continue
  total=$((total + 1))
  out="$("${d}run.sh" 2>&1)"
  printf '%s\n' "$out"
  if printf '%s\n' "$out" | grep -q '^PASS '; then
    passed=$((passed + 1))
  fi
  c="$(printf '%s\n' "$out" | grep -o 'cost=[0-9]*s' | tail -1 | tr -dc '0-9')"
  [ -n "$c" ] || c=0
  cost=$((cost + c))
done
echo "passed=$passed total=$total cost=${cost}s"
[ "$passed" -eq "$total" ]
