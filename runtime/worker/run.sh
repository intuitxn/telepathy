#!/bin/sh
# Thin local host adapter for system.bend. No transition logic lives here.
# A lock serializes one local root. Outputs are fresh, never overwritten;
# successful Bend transitions publish via an atomic head rename. Interrupted
# or unpublished attempts remain available for inspection.
set -eu
umask 077
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BEND="${BEND:-$HOME/.bend/bin/bend}"
SOURCE="${INTUITXN_WORKER_SOURCE:-$HERE/system.bend}"
case "$SOURCE" in /*) ;; *) echo 'mundus: worker source must be absolute' >&2; exit 64 ;; esac
export BEND_NO_TELEMETRY=1
fail() { echo "mundus: $*" >&2; exit 1; }
usage() { echo 'mundus: wrong arguments; run mundus help' >&2; exit 64; }
[ "$#" -ge 2 ] || usage
verb=$1
root=$2
[ -n "$root" ] || usage
case "$root" in /*) ;; *) root="$PWD/$root" ;; esac
shift 2
mutate=0
case "$verb" in
    init) [ "$#" -eq 0 ] || usage; mutate=1 ;;
    capture) [ "$#" -ge 1 ] && [ "$#" -le 3 ] || usage; mutate=1 ;;
    work|learn|remember) [ "$#" -eq 4 ] || usage; mutate=1 ;;
    worker|claim) [ "$#" -eq 3 ] || usage; mutate=1 ;;
    return|correct) [ "$#" -eq 5 ] || usage; mutate=1 ;;
    history|memory|status) [ "$#" -eq 0 ] || usage ;;
    packet|explain) [ "$#" -eq 1 ] || usage ;;
    opencode) [ "$#" -eq 4 ] || usage ;;
    *) usage ;;
esac
load_head() {
    [ -f "$root/head" ] || fail "no worker history at $root; run init first"
    head=$(cat "$root/head")
    case "$head" in step.?*) ;; *) fail 'invalid snapshot head' ;; esac
    case "$head" in *[!a-zA-Z0-9._-]*|*..*) fail 'invalid snapshot head' ;; esac
    input="$root/snapshots/$head/state"
    [ -f "$input" ] || fail 'snapshot head is missing; inspect preserved attempts'
}
if [ "$mutate" -eq 0 ]; then
    load_head
    case "$verb" in
        status) exec "$BEND" "$SOURCE" -- history "$input" ;;
        *) exec "$BEND" "$SOURCE" -- "$verb" "$input" "$@" ;;
    esac
fi
if [ "$verb" = init ]; then
    mkdir -p "$root"
else
    [ -d "$root" ] || fail 'no worker root; run init first'
fi
mkdir "$root/.writer-lock" 2>/dev/null || fail 'writer lock exists; inspect the owning process before recovery'
cleanup() { rmdir "$root/.writer-lock"; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if [ "$verb" = init ]; then
    [ ! -e "$root/head" ] || fail 'worker history already initialized'
else
    load_head
fi
mkdir -p "$root/snapshots"
attempt=$(mktemp -d "$root/snapshots/step.XXXXXXXX")
output="$attempt/state"
# The one-file worker must be identical for checking, hashing and execution,
# even when another session edits the checkout during this transition.
cp "$SOURCE" "$attempt/source.bend"
SOURCE="$attempt/source.bend"
"$BEND" "$SOURCE" --check-only > "$attempt/check.txt" 2>&1 || {
    cat "$attempt/check.txt" >&2
    fail "worker check failed; evidence at $attempt"
}
grep -qx 'All terms check\.' "$attempt/check.txt" || fail 'worker checker did not confirm all terms'
if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$SOURCE" > "$attempt/source.sha256"
else
    sha256sum "$SOURCE" > "$attempt/source.sha256"
fi
case "$verb" in
    init) set -- init "$output" ;;
    capture)
        task=$1; actor=${2:-codex}; origin=${3:-local:mundus}
        set -- capture "$input" "$output" retain "$actor" "$origin" "$task"
        ;;
    *) set -- "$verb" "$input" "$output" "$@" ;;
esac
if "$BEND" "$SOURCE" -- "$@" > "$attempt/result.txt" 2>&1; then
    [ -f "$output" ] || fail "transition produced no snapshot; evidence at $attempt"
    printf '%s\n' "${attempt##*/}" > "$attempt/head.next"
    mv "$attempt/head.next" "$root/head"
    cat "$attempt/result.txt"
else
    rc=$?
    cat "$attempt/result.txt" >&2
    echo "mundus: transition failed; head unchanged; evidence at $attempt" >&2
    exit "$rc"
fi
