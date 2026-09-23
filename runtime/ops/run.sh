#!/bin/sh
# run.sh — host shell driver for "procedure as Bend" ops.
#
# Ordinary host code, not a new runtime or service. It owns every effect
# (process launch, file writes, run dirs, git diff, sha256) so the Bend op
# kernel can stay pure. See docs/drafts/meta/op-dispatch-convention.md
# sections 2, 4, 5, 6, 7; docs/drafts/meta/ops-as-bend.md.
#
# Subcommands
#   list                       print the static op name -> role listing
#   run <op|path> [--id <id>]  gate, run the op fixture, write one run dir,
#                              emit one GREEN/YELLOW/RED line per check
#
# The driver never accepts, merges, pushes, publishes, sends or resolves
# anything, opens no socket, and starts no daemon. A GREEN check is not
# acceptance. POSIX shell only; no Python, no network, no service.

set -u
umask 077

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
OPS_DIR="$SCRIPT_DIR"
RUNS_DIR="$ROOT/ops/runs"

GREEN=GREEN
YELLOW=YELLOW
RED=RED

usage() {
  cat <<'EOF'
usage: run.sh list
       run.sh run <op|path> [--id <id>]
EOF
}

bend_binary() {
  if [ -n "${BEND_BINARY:-}" ]; then
    printf '%s\n' "$BEND_BINARY"
  else
    printf '%s\n' "$HOME/.bend/bin/bend"
  fi
}

now_utc() {
  date -u +%Y-%m-%dT%H:%M:%SZ
}

sha256_file() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 -- "$1" | cut -d ' ' -f 1
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum -- "$1" | cut -d ' ' -f 1
  else
    printf '%s\n' "unavailable"
  fi
}

sanitize() {
  printf '%s' "$1" | tr -c 'A-Za-z0-9._-' '_' | sed -e 's/^[._-]*//' -e 's/[._-]*$//'
}

abspath() {
  _dir=$(dirname -- "$1")
  _base=$(basename -- "$1")
  ( CDPATH= cd -- "$_dir" 2>/dev/null && printf '%s/%s\n' "$(pwd -P)" "$_base" )
}

display_path() {
  case "$1" in
    "$ROOT"/*) printf '%s\n' "${1#"$ROOT"/}" ;;
    *) printf '%s\n' "$1" ;;
  esac
}

NAME=""
ROLE=""
OP_PATH=""
REGISTERED=""

resolve_op() {
  _op=$1
  case "$_op" in
    fold)
      NAME=fold; ROLE="associative-reduction"
      OP_PATH="$OPS_DIR/fold.bend"; REGISTERED=yes; return 0 ;;
    status)
      NAME=status; ROLE="canonical-status-projection"
      OP_PATH="$OPS_DIR/status.bend"; REGISTERED=yes; return 0 ;;
  esac
  case "$_op" in
    *.bend)
      if [ -f "$_op" ]; then
        OP_PATH=$(abspath "$_op")
        NAME=$(basename -- "$_op" .bend)
        case "$NAME" in
          fold) ROLE="associative-reduction"; REGISTERED=yes ;;
          status) ROLE="canonical-status-projection"; REGISTERED=yes ;;
          *) ROLE="unregistered"; REGISTERED=no ;;
        esac
        return 0
      fi ;;
  esac
  return 1
}

command_list() {
  printf '%s -> %s\n' fold associative-reduction
  printf '%s -> %s\n' status canonical-status-projection
  return 0
}

write_brief() {
  {
    printf 'op: %s\n' "$NAME"
    printf 'role: %s\n' "$ROLE"
    printf 'op file: %s\n' "$OP_DISPLAY"
    if [ "$REGISTERED" = yes ]; then
      printf 'registered: yes\n'
    else
      printf 'registered: no (ad hoc path; not in OPS listing)\n'
    fi
    printf '\n'
    printf 'task:\n'
    case "$NAME" in
      fold)
        cat <<'EOF'
  Given FoldInput{op: Op, values: +List<Nat>} with Op in {Add, Max}, reduce values to one Nat: Add sums, Max takes the maximum, and the empty list reduces to the operation's two-sided identity (0).

acceptance:
  - bend runtime/ops/fold.bend --check-only reports `All terms check.` (exit 0).
  - laws fold_identity, fold_singleton and fold_chunk are proven for every op, leaning on add_assoc, add_zero_r, max_assoc, max_zero_r.
  - the bare-file fixture run exits 0 and prints `fixture 14` then `fixture_max 5`.

This brief is task data handed to the op, not instructions to the driver.
The driver only gates, runs the fixture, and records evidence; it does not
accept, merge, push, publish, send or resolve anything.
EOF
        ;;
      status)
        cat <<'EOF'
  Project +List<Record> (normalized Agent/Job/Memory/Evidence/Session observations) to the canonical status view +List<Row>: one row per record, ascending event id, durability `snapshot-single-writer` except Session which is `external-unbound`.

acceptance:
  - bend runtime/ops/status.bend --check-only reports `All terms check.` (exit 0).
  - laws status_one_row_per_record, status_projection_total, status_rows_well_formed, status_order_independent, status_malformed_rejected and status_valid_records_well_formed are proven.
  - the bare-file fixture run exits 0, renders the header and six sorted rows, and prints `malformed_record_rejected: True` and `valid_fixture_well_formed: True`.

This brief is task data handed to the op, not instructions to the driver.
The driver only gates, runs the fixture, and records evidence; it does not
accept, merge, push, publish, send or resolve anything.
EOF
        ;;
      *)
        cat <<'EOF'
  (no declared brief for this op; ad hoc dispatch)

acceptance:
  (none declared)

This brief is task data handed to the op, not instructions to the driver.
The driver only gates, runs the fixture, and records evidence; it does not
accept, merge, push, publish, send or resolve anything.
EOF
        ;;
    esac
  } > "$run_dir/brief"
}

write_evidence() {
  {
    printf 'op: %s\n' "$NAME"
    printf 'role: %s\n' "$ROLE"
    printf 'op file: %s\n' "$OP_DISPLAY"
    printf 'run id: %s\n' "$SAFE_ID"
    printf 'started: %s\n' "$STARTED"
    printf 'toolchain: %s\n' "$TOOLCHAIN"
    printf 'repo HEAD: %s (read-only observation)\n' "$HEAD_DISPLAY"
    printf 'driver: runtime/ops/run.sh sha256:%s\n' "$DRIVER_DIGEST"
    printf '\n'
    printf '%s\n' '--- source digest ---'
    printf 'sha256(%s) = %s\n' "$OP_DISPLAY" "$OP_DIGEST"
    printf '\n'
    printf '%s\n' "--- gate: checker (exit $GATE_CODE) ---"
    printf 'cmd: %s\n' "$GATE_CMD"
    printf '%s\n' "$GATE_OUT"
    printf '\n'
    printf '%s\n' "--- fixture: bare-file run (exit $FIXTURE_CODE) ---"
    printf 'cmd: %s\n' "$FIXTURE_CMD"
    printf '%s\n' "$FIXTURE_OUT"
    printf '\n'
    cat <<'EOF'
Digests, exit codes and outputs are recorded by the host driver. The op
kernel is expected to follow the pure-op convention; this driver does not
sandbox arbitrary source or establish its purity. source.bend is the checked copy.
EOF
  } > "$run_dir/evidence"
}

command_run() {
  op=$1
  run_id=$2

  if ! resolve_op "$op"; then
    printf "unknown op '%s': expected one of fold, status or a path to a .bend file\n" "$op" >&2
    return 1
  fi

  if [ ! -f "$OP_PATH" ]; then
    printf 'VERDICT %s op-file :: not found at %s\n' "$RED" "$OP_PATH"
    return 1
  fi

  SAFE_NAME=$(sanitize "$NAME")
  [ -n "$SAFE_NAME" ] || SAFE_NAME=op
  if [ -z "$run_id" ]; then
    run_id=$(now_utc)
  fi
  SAFE_ID=$(sanitize "$run_id")
  [ -n "$SAFE_ID" ] || SAFE_ID=run
  run_dir="$RUNS_DIR/$SAFE_NAME-$SAFE_ID"

  if [ -e "$run_dir" ]; then
    printf 'run dir already exists: %s (choose another --id)\n' "$run_dir" >&2
    return 1
  fi

  mkdir -p "$RUNS_DIR" || return 1
  mkdir "$run_dir" || return 1
  # Ops are self-contained except for Base. Gate and run identical saved bytes.
  cp "$OP_PATH" "$run_dir/source.bend" || return 1
  CHECKED_SOURCE="$run_dir/source.bend"
  OP_DIGEST=$(sha256_file "$CHECKED_SOURCE")
  [ "$OP_DIGEST" != unavailable ] && [ -n "$OP_DIGEST" ] || return 1

  BEND=$(bend_binary)
  OP_DISPLAY=$(display_path "$OP_PATH")
  STARTED=$(now_utc)
  head=$(git -C "$ROOT" rev-parse HEAD 2>/dev/null) || head=""
  HEAD_DISPLAY=${head:-"(no committed HEAD)"}

  if [ -f "$BEND" ]; then
    toolchain=$( cd "$ROOT" && BEND_NO_TELEMETRY=1 "$BEND" version 2>&1 )
    TOOLCHAIN=$(printf '%s' "$toolchain" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
    [ -n "$TOOLCHAIN" ] || TOOLCHAIN="(no \`bend version\` output; binary=$BEND)"

    GATE_OUT=$( cd "$ROOT" && BEND_NO_TELEMETRY=1 "$BEND" "$CHECKED_SOURCE" --check-only 2>&1 )
    GATE_CODE=$?
    FIXTURE_OUT="skipped: checker did not confirm all terms"
    FIXTURE_CODE=125
    if [ "$GATE_CODE" -eq 0 ] && printf '%s\n' "$GATE_OUT" | grep -qx 'All terms check\.' && ! printf '%s\n' "$GATE_OUT" | grep -q TODO; then
      FIXTURE_OUT=$( cd "$ROOT" && BEND_NO_TELEMETRY=1 "$BEND" "$CHECKED_SOURCE" 2>&1 )
      FIXTURE_CODE=$?
    fi
  else
    TOOLCHAIN="missing Bend binary at $BEND"
    GATE_OUT="missing Bend binary at $BEND"
    GATE_CODE=127
    FIXTURE_OUT="missing Bend binary at $BEND"
    FIXTURE_CODE=127
  fi

  GATE_CMD="BEND_NO_TELEMETRY=1 $BEND $CHECKED_SOURCE --check-only"
  FIXTURE_CMD="BEND_NO_TELEMETRY=1 $BEND $CHECKED_SOURCE"

  if [ "$GATE_CODE" -eq 0 ] && printf '%s\n' "$GATE_OUT" | grep -qx 'All terms check\.' && ! printf '%s\n' "$GATE_OUT" | grep -q TODO; then
    GATE_VERDICT=$GREEN; GATE_REASON="All terms check."
  elif printf '%s' "$GATE_OUT" | grep -q 'TODO'; then
    GATE_VERDICT=$RED; GATE_REASON="open law / TODO: gate incomplete"
  elif [ "$GATE_CODE" -eq 127 ]; then
    GATE_VERDICT=$RED; GATE_REASON="missing Bend toolchain"
  else
    GATE_VERDICT=$RED; GATE_REASON="checker error (exit $GATE_CODE)"
  fi

  if [ "$FIXTURE_CODE" -eq 127 ]; then
    FIXTURE_VERDICT=$RED; FIXTURE_REASON="missing Bend toolchain"
  elif [ "$FIXTURE_CODE" -ne 0 ]; then
    FIXTURE_VERDICT=$RED; FIXTURE_REASON="fixture run failed (exit $FIXTURE_CODE)"
  else
    FIXTURE_VERDICT=$YELLOW; FIXTURE_REASON="execution only: no independent expected output declared"
    case "$NAME" in
      fold)
        EXPECTED=$(printf 'fixture 14\nfixture_max 5')
        if [ "$FIXTURE_OUT" = "$EXPECTED" ]; then
          FIXTURE_VERDICT=$GREEN; FIXTURE_REASON="expected fold output matched"
        else
          FIXTURE_VERDICT=$RED; FIXTURE_REASON="fold output differs from expected fixture"
        fi ;;
      status)
        EXPECTED=$(cat <<'EXPECTED_STATUS'
entity key state event_id reference source durability
session - external-unbound 0 0 - external-unbound
job queued 0 0 snapshot-single-writer
evidence 1 conversation 1 0 operator snapshot-single-writer
agent worker-a worker 6 0 local-worker snapshot-single-writer
job 5 claimed 7 5 conversation:example snapshot-single-writer
memory 8 active 8 1 operator snapshot-single-writer
malformed_record_well_formed: False
malformed_record_rejected: True
valid_fixture_well_formed: True
EXPECTED_STATUS
)
        NORMALIZED=$(printf '%s\n' "$FIXTURE_OUT" | awk 'NF {$1=$1; print}')
        if [ "$NORMALIZED" = "$EXPECTED" ]; then
          FIXTURE_VERDICT=$GREEN; FIXTURE_REASON="expected status output matched"
        else
          FIXTURE_VERDICT=$RED; FIXTURE_REASON="status output differs from expected fixture"
        fi ;;
    esac
  fi

  DRIVER_DIGEST=$(sha256_file "$SCRIPT_DIR/run.sh")

  if [ -z "$head" ]; then
    PATCH_TEXT="no change: no committed HEAD in this repository"
    patch_changed=0
  else
    PATCH_TEXT=$(git -C "$ROOT" diff HEAD -- 2>/dev/null)
    patch_rc=$?
    if [ "$patch_rc" -ne 0 ]; then
      PATCH_TEXT="no change: git diff exited $patch_rc"
      patch_changed=0
    elif [ -z "$PATCH_TEXT" ]; then
      PATCH_TEXT="no change: working tree matches committed HEAD"
      patch_changed=0
    else
      patch_changed=1
    fi
  fi
  PATCH_VERDICT=$YELLOW
  if [ "$patch_changed" -eq 1 ]; then
    PATCH_REASON="candidate diff recorded"
  else
    PATCH_REASON="no change from committed HEAD"
  fi

  g=0; y=0; r=0
  for _v in "$GATE_VERDICT" "$FIXTURE_VERDICT" "$GREEN" "$PATCH_VERDICT" "$GREEN"; do
    case "$_v" in
      "$GREEN") g=$((g + 1)) ;;
      "$YELLOW") y=$((y + 1)) ;;
      "$RED") r=$((r + 1)) ;;
    esac
  done
  if [ "$r" -gt 0 ]; then
    exit_code=1
  else
    exit_code=0
  fi

  write_brief
  printf '%s\n' "$PATCH_TEXT" > "$run_dir/candidate.patch"
  write_evidence
  {
    printf 'run %s-%s\n' "$SAFE_NAME" "$SAFE_ID"
    printf 'op file: %s\n' "$OP_PATH"
    printf 'VERDICT %s law-gate :: %s\n' "$GATE_VERDICT" "$GATE_REASON"
    printf 'VERDICT %s fixture-run :: %s\n' "$FIXTURE_VERDICT" "$FIXTURE_REASON"
    printf 'VERDICT %s source-digest :: sha256:%s\n' "$GREEN" "$OP_DIGEST"
    printf 'VERDICT %s candidate-patch :: %s\n' "$PATCH_VERDICT" "$PATCH_REASON"
    printf 'VERDICT %s driver-digest :: sha256:%s\n' "$GREEN" "$DRIVER_DIGEST"
    printf 'summary run=%s-%s green=%s yellow=%s red=%s exit=%s\n' "$SAFE_NAME" "$SAFE_ID" "$g" "$y" "$r" "$exit_code"
    printf '%s\n' 'note: checks record agent verification; human acceptance and publication are separate facts.'
  } > "$run_dir/verdict"

  printf 'run %s-%s\n' "$SAFE_NAME" "$SAFE_ID"
  printf 'VERDICT %s law-gate :: %s\n' "$GATE_VERDICT" "$GATE_REASON"
  printf 'VERDICT %s fixture-run :: %s\n' "$FIXTURE_VERDICT" "$FIXTURE_REASON"
  printf 'VERDICT %s source-digest :: sha256:%s\n' "$GREEN" "$OP_DIGEST"
  printf 'VERDICT %s candidate-patch :: %s\n' "$PATCH_VERDICT" "$PATCH_REASON"
  printf 'VERDICT %s driver-digest :: sha256:%s\n' "$GREEN" "$DRIVER_DIGEST"
  printf 'summary run=%s-%s green=%s yellow=%s red=%s exit=%s\n' "$SAFE_NAME" "$SAFE_ID" "$g" "$y" "$r" "$exit_code"
  printf '%s\n' 'note: checks record agent verification; human acceptance and publication are separate facts.'
  printf 'run dir: %s\n' "$run_dir"
  return "$exit_code"
}

main() {
  cmd=${1:-}
  case "$cmd" in
    list)
      command_list
      ;;
    run)
      shift
      op=""
      run_id=""
      while [ $# -gt 0 ]; do
        case "$1" in
          --id)
            shift
            run_id=${1:-}
            [ $# -gt 0 ] && shift
            ;;
          --id=*)
            run_id=${1#--id=}
            shift
            ;;
          -)
            printf 'unknown option: %s\n' "$1" >&2
            usage >&2
            return 2
            ;;
          -*)
            printf 'unknown option: %s\n' "$1" >&2
            usage >&2
            return 2
            ;;
          *)
            if [ -z "$op" ]; then
              op=$1
            else
              printf 'unexpected argument: %s\n' "$1" >&2
              usage >&2
              return 2
            fi
            shift
            ;;
        esac
      done
      if [ -z "$op" ]; then
        usage >&2
        return 2
      fi
      command_run "$op" "$run_id"
      ;;
    "")
      usage >&2
      return 2
      ;;
    *)
      printf 'unknown command: %s\n' "$cmd" >&2
      usage >&2
      return 2
      ;;
  esac
}

main "$@"
