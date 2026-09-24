#!/bin/sh
# scripts/census.sh — deterministic repo artifact enumerator.
# Usage: census.sh <root>
# Writes <root>/census.in with one `kind|path|refcount|digest` line per record.
# kind in {kernel, op, program, host, doc, test}. Sorted by path (LC_ALL=C).
# Skips: .git, node_modules, .local, ops/runs (any level).
# Kinds:
#   kernel  = runtime/*.bend + runtime/worker/**/*.bend
#   op      = runtime/ops/*.bend (top level only)
#   program = runtime/programs/**/*.bend (recursive)
#   host    = mundus, runtime/ops/run.sh, scripts/*.sh (if present)
#   doc     = docs/**/*.md (recursive) + root *.md (top level only)
#   test    = any *test* basename file (excluding skipped dirs); wins on overlap.
# refcount = number of OTHER repo files containing the relpath or basename
#            (fixed-string, repo-root-relative; count files not lines; self excluded;
#             output root excluded when inside repo; skipped dirs excluded).
# digest = sha256 hex via sha256sum/shasum, else `-`.
# Effects: mkdir -p <root>; write <root>/census.in only. No delete, no network, no daemon.
set -eu

usage() {
  echo "usage: census.sh <root>" >&2
}

if [ "$#" -ne 1 ]; then
  usage
  exit 64
fi

OUT_ROOT="$1"
if [ -z "$OUT_ROOT" ]; then
  usage
  exit 64
fi

mkdir -p "$OUT_ROOT"

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
OUT_FILE="$OUT_ROOT/census.in"

TMP_KINDS="$(mktemp /tmp/census.kinds.XXXXXX)"
TMP_RECS="$(mktemp /tmp/census.recs.XXXXXX)"
trap 'rm -f "$TMP_KINDS" "$TMP_RECS"' EXIT INT TERM

# Return 0 if basename contains "test" (case-sensitive).
is_test_name() {
  case "$(basename -- "$1")" in
    *test*) return 0 ;;
    *) return 1 ;;
  esac
}

add_record() {
  # $1=kind $2=relpath (repo-relative, no leading ./)
  printf '%s|%s\n' "$1" "$2" >> "$TMP_KINDS"
}

# ---- kernel: runtime/*.bend ----
for f in "$REPO_ROOT"/runtime/*.bend; do
  [ -f "$f" ] || continue
  rel=${f#"$REPO_ROOT"/}
  if is_test_name "$rel"; then
    continue
  fi
  add_record "kernel" "$rel"
done

# ---- kernel: runtime/worker/**/*.bend ----
if [ -d "$REPO_ROOT/runtime/worker" ]; then
  find "$REPO_ROOT/runtime/worker" -type f -name "*.bend" -print 2>/dev/null | while IFS= read -r f; do
    rel=${f#"$REPO_ROOT"/}
    case "$rel" in
      *".git"*|*"node_modules"*|*".local"*|*"ops/runs"*) continue ;;
    esac
    if is_test_name "$rel"; then
      continue
    fi
    printf 'kernel|%s\n' "$rel" >> "$TMP_KINDS"
  done
fi

# ---- op: runtime/ops/*.bend (top level) ----
for f in "$REPO_ROOT"/runtime/ops/*.bend; do
  [ -f "$f" ] || continue
  rel=${f#"$REPO_ROOT"/}
  if is_test_name "$rel"; then
    continue
  fi
  add_record "op" "$rel"
done

# ---- program: runtime/programs/**/*.bend ----
if [ -d "$REPO_ROOT/runtime/programs" ]; then
  find "$REPO_ROOT/runtime/programs" -type f -name "*.bend" -print 2>/dev/null | while IFS= read -r f; do
    rel=${f#"$REPO_ROOT"/}
    case "$rel" in
      *".git"*|*"node_modules"*|*".local"*|*"ops/runs"*) continue ;;
    esac
    if is_test_name "$rel"; then
      continue
    fi
    printf 'program|%s\n' "$rel" >> "$TMP_KINDS"
  done
fi

# ---- host: mundus, runtime/ops/run.sh, scripts/*.sh ----
if [ -f "$REPO_ROOT/mundus" ]; then
  if ! is_test_name "mundus"; then
    add_record "host" "mundus"
  fi
fi
if [ -f "$REPO_ROOT/runtime/ops/run.sh" ]; then
  if ! is_test_name "runtime/ops/run.sh"; then
    add_record "host" "runtime/ops/run.sh"
  fi
fi
for f in "$REPO_ROOT"/scripts/*.sh; do
  [ -f "$f" ] || continue
  rel=${f#"$REPO_ROOT"/}
  if is_test_name "$rel"; then
    continue
  fi
  add_record "host" "$rel"
done

# ---- doc: docs/**/*.md + root *.md ----
if [ -d "$REPO_ROOT/docs" ]; then
  find "$REPO_ROOT/docs" -type f -name "*.md" -print 2>/dev/null | while IFS= read -r f; do
    rel=${f#"$REPO_ROOT"/}
    case "$rel" in
      *".git"*|*"node_modules"*|*".local"*|*"ops/runs"*) continue ;;
    esac
    if is_test_name "$rel"; then
      continue
    fi
    printf 'doc|%s\n' "$rel" >> "$TMP_KINDS"
  done
fi
for f in "$REPO_ROOT"/*.md; do
  [ -f "$f" ] || continue
  rel=${f#"$REPO_ROOT"/}
  if is_test_name "$rel"; then
    continue
  fi
  add_record "doc" "$rel"
done

# ---- test: any *test* file excluding skipped dirs ----
find "$REPO_ROOT" \( -path "$REPO_ROOT/.git*" -o -path "*/node_modules*" -o -path "*/.local*" -o -path "*/ops/runs*" \) -prune -o -type f -name "*test*" -print 2>/dev/null | while IFS= read -r f; do
  rel=${f#"$REPO_ROOT"/}
  # Never enumerate our own output when root lives inside the repo.
  case "$f" in
    "$OUT_FILE") continue ;;
    "$OUT_ROOT"/*) continue ;;
  esac
  printf 'test|%s\n' "$rel" >> "$TMP_KINDS"
done

sha_hex() {
  # $1 = absolute file path; prints hex or `-`.
  if [ ! -f "$1" ] || [ ! -r "$1" ]; then
    printf -- '-'
    return 0
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -- "$1" 2>/dev/null | cut -d ' ' -f 1 || printf -- '-'
    return 0
  fi
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 -- "$1" 2>/dev/null | cut -d ' ' -f 1 || printf -- '-'
    return 0
  fi
  printf -- '-'
}

ref_count() {
  # $1 = relpath; prints count of OTHER files referencing relpath or basename.
  rel="$1"
  base=$(basename -- "$rel")
  self="$REPO_ROOT/$rel"
  raw=""
  if command -v rg >/dev/null 2>&1; then
    raw=$(rg -l -F --no-messages -e "$rel" -e "$base" "$REPO_ROOT" \
      --glob '!**/.git/**' --glob '!**/node_modules/**' \
      --glob '!**/.local/**' --glob '!**/ops/runs/**' 2>/dev/null || true)
  else
    raw=$(grep -rlF --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=.local --exclude-dir=runs \
      -e "$rel" -e "$base" "$REPO_ROOT" 2>/dev/null || true)
  fi
  if [ -z "$raw" ]; then
    printf '0'
    return 0
  fi
  n=0
  printf '%s\n' "$raw" | while IFS= read -r hit; do
    [ -n "$hit" ] || continue
    # Exclude self.
    if [ "$hit" = "$self" ]; then
      continue
    fi
    # Exclude output file / output root inside repo.
    if [ "$hit" = "$OUT_FILE" ]; then
      continue
    fi
    case "$hit" in
      "$OUT_ROOT"/*) continue ;;
    esac
    printf 'x\n'
  done | wc -l | tr -d ' '
}

# Deduplicate kinds by relpath (test already wins via skip above), sort by path.
SORTED_KINDS="$(mktemp /tmp/census.sorted.XXXXXX)"
trap 'rm -f "$TMP_KINDS" "$TMP_RECS" "$SORTED_KINDS"' EXIT INT TERM
LC_ALL=C sort -t '|' -k 2,2 -u "$TMP_KINDS" > "$SORTED_KINDS"

: > "$TMP_RECS"
while IFS='|' read -r kind rel; do
  [ -n "$kind" ] || continue
  [ -n "$rel" ] || continue
  case "$kind" in
    kernel|op|program|host|doc|test) ;;
    *) continue ;;
  esac
  rc=$(ref_count "$rel")
  dg=$(sha_hex "$REPO_ROOT/$rel")
  printf '%s|%s|%s|%s\n' "$kind" "$rel" "$rc" "$dg" >> "$TMP_RECS"
done < "$SORTED_KINDS"

LC_ALL=C sort -t '|' -k 2,2 "$TMP_RECS" > "$OUT_FILE"
