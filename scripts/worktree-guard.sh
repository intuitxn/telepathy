#!/bin/sh
# worktree-guard — keep disposable worktrees from being reused after their branch merges.
#
# A worktree is a disposable candidate: create it from committed HEAD, remove it
# on merge (docs/WORKTREE_LIFECYCLE.md). This guard never touches the main
# worktree and never removes a worktree with local changes or recent writes.
#
# Usage:
#   scripts/worktree-guard.sh status        list worktrees: stable, disposable or active
#   scripts/worktree-guard.sh guard [DIR]   fail if DIR (default: cwd) sits in a disposable worktree
#   scripts/worktree-guard.sh prune [MIN]   remove clean, idle disposable worktrees (default 2 min)
#
# A branch is disposable when its tip is already in the base ref, or when its PR
# is merged (checked with gh when available). WORKTREE_GUARD_BASE overrides the
# base ref (default: origin/main).
set -eu

base="${WORKTREE_GUARD_BASE:-origin/main}"
base_branch="${base##*/}"

rows() {
  git worktree list --porcelain | awk '
    /^worktree / { p = $0; sub(/^worktree /, "", p) }
    /^branch /   { b = $0; sub(/^branch refs\/heads\//, "", b); print p "\t" b }
    /^detached/  { print p "\t(detached)" }
  '
}

current_root() { git rev-parse --show-toplevel 2>/dev/null; }

merged_pr() {
  [ -n "$1" ] || return 1
  command -v gh >/dev/null 2>&1 || return 1
  gh pr list --state merged --head "$1" --json number --jq 'length > 0' 2>/dev/null | grep -q true
}

disposable() {
  br="$1"
  [ -n "$br" ] || return 1
  [ "$br" = "(detached)" ] && return 1
  [ "$br" = "$base_branch" ] && return 1
  git rev-parse --verify --quiet "refs/heads/$br" >/dev/null 2>&1 || return 1
  if git merge-base --is-ancestor "refs/heads/$br" "$base" 2>/dev/null; then return 0; fi
  merged_pr "$br" && return 0
  return 1
}

label() {
  br="$1"
  if [ "$br" = "$base_branch" ]; then echo "stable"
  elif disposable "$br"; then echo "DISPOSABLE"
  else echo "active"
  fi
}

cmd_status() {
  rows | while IFS="$(printf '\t')" read -r path br; do
    printf '%-11s %-34s %s\n' "$(label "$br")" "$br" "$path"
  done
}

cmd_guard() {
  dir="$1"
  br="$(git -C "$dir" branch --show-current 2>/dev/null || true)"
  if disposable "$br"; then
    echo "worktree-guard: '$br' is already merged into $base." >&2
    echo "This worktree is disposable. Make a fresh one instead of working here:" >&2
    echo "  git worktree add <new-path> -b <new-branch> $base" >&2
    exit 1
  fi
  echo "worktree-guard: ok ($br)"
}

cmd_prune() {
  min="$1"
  here="$(current_root || true)"
  rows | while IFS="$(printf '\t')" read -r path br; do
    [ "$path" = "$here" ] && continue
    [ "$br" = "$base_branch" ] && continue
    disposable "$br" || continue
    if [ -n "$(git -C "$path" status --porcelain 2>/dev/null)" ]; then
      echo "skip  dirty:  $path"; continue
    fi
    if [ -n "$(find "$path" -type f -not -path '*/.git/*' -not -path '*/node_modules/*' -newermt "-${min} minutes" -print -quit 2>/dev/null)" ]; then
      echo "skip  active: $path (<${min}m)"; continue
    fi
    if git worktree remove "$path" 2>/dev/null; then
      echo "removed:      $path ($br)"
    else
      echo "skip  refused: $path"
    fi
  done
}

case "${1:-status}" in
  status) cmd_status ;;
  guard)  cmd_guard "${2:-$(pwd)}" ;;
  prune)  cmd_prune "${2:-2}" ;;
  *) echo "usage: worktree-guard.sh {status|guard [DIR]|prune [MIN]}" >&2; exit 2 ;;
esac
