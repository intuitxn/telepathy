#!/bin/sh
# worktree-guard — fail before work starts in a worktree whose branch already merged.
# A worktree is a disposable candidate (docs/WORKTREE_LIFECYCLE.md); once its
# branch is in origin/main, make a fresh one instead of reusing it.
set -eu
br="$(git branch --show-current)"
[ -n "$br" ] || exit 0
git fetch -q origin 2>/dev/null || true
sha="$(git ls-remote origin "refs/heads/$br" 2>/dev/null | cut -f1)"
[ -n "$sha" ] || exit 0
if git merge-base --is-ancestor "$sha" origin/main 2>/dev/null; then
  echo "worktree-guard: '$br' is merged into origin/main — work in a fresh worktree" >&2
  exit 1
fi
