#!/bin/sh
# Offline acceptance test only: no Buzz writes, model calls, or runtime adapter.
set -eu
export BEND_NO_TELEMETRY=1
engram_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
source_file=${1:-"$engram_dir/../../lorenz/system.bend"}
bend_bin=${BEND:-"$HOME/.bend/bin/bend"}
expected=64e1ebf7c5937ccec96697dddeb7bf62c621c545af0c4ed7485b9038524fe15d
[ "$(shasum -a 256 "$source_file" | cut -d ' ' -f 1)" = "$expected" ] || { echo 'source digest mismatch' >&2; exit 1; }
[ "$("$bend_bin" version)" = 'bend 2.0.21' ] || { echo 'toolchain version mismatch' >&2; exit 1; }
engram_scratch=$(mktemp -d "${TMPDIR:-/tmp}/lorenz-engram.XXXXXXXX")
chmod 700 "$engram_scratch"
trap 'rm -r "$engram_scratch"' EXIT HUP INT TERM
cp "$source_file" "$engram_scratch/system.bend"
cmp "$source_file" "$engram_scratch/system.bend"
[ "$(shasum -a 256 "$engram_scratch/system.bend" | cut -d ' ' -f 1)" = "$expected" ]
"$bend_bin" "$engram_scratch/system.bend" --check-only > "$engram_scratch/check.txt"
grep -q '^All terms check\.$' "$engram_scratch/check.txt"
call() { "$bend_bin" "$engram_scratch/system.bend" -- "$@"; }
call init "$engram_scratch/0" > /dev/null
call capture "$engram_scratch/0" "$engram_scratch/1" retain operator engram:example 'Investigate retry behavior' > /dev/null
call remember "$engram_scratch/1" "$engram_scratch/2" 1 0 agent 'All retries are safe' > /dev/null
call remember "$engram_scratch/2" "$engram_scratch/3" 1 2 agent 'Retry writes automatically' > /dev/null
call memory "$engram_scratch/3" > "$engram_scratch/before.txt"
grep -q 'All retries are safe' "$engram_scratch/before.txt"
grep -q 'Retry writes automatically' "$engram_scratch/before.txt"
call correct "$engram_scratch/3" "$engram_scratch/4" 2 0 reviewer 'Narrow the unsupported claim' 'Retries require idempotency or explicit reconciliation' > /dev/null
call memory "$engram_scratch/4" > "$engram_scratch/active.txt"
grep -q 'Retries require idempotency or explicit reconciliation' "$engram_scratch/active.txt"
if grep -Eq 'All retries are safe|Retry writes automatically' "$engram_scratch/active.txt"; then echo 'stale memory remained active' >&2; exit 1; fi
call history "$engram_scratch/4" > "$engram_scratch/history.txt"
grep -q 'id=2 kind=2 status=superseded' "$engram_scratch/history.txt"
grep -q 'id=3 kind=2 status=needs-review' "$engram_scratch/history.txt"
# Immutable predecessor remains independently readable.
call memory "$engram_scratch/3" > "$engram_scratch/predecessor.txt"
cmp "$engram_scratch/before.txt" "$engram_scratch/predecessor.txt"
if call correct "$engram_scratch/4" "$engram_scratch/invalid" 999 0 reviewer invalid rejected > "$engram_scratch/rejected.txt" 2>&1; then echo 'invalid correction accepted' >&2; exit 1; fi
[ ! -e "$engram_scratch/invalid" ]
printf '%s\n' '{"source_sha256":"64e1ebf7c5937ccec96697dddeb7bf62c621c545af0c4ed7485b9038524fe15d","toolchain":"bend 2.0.21","check":"passed","fresh_copy_bytes":"identical","correction":"passed","dependent_invalidation":"passed","old_history_preserved":"passed","invalid_correction_rejected":"passed","remote_transfer":"not_attempted"}'
