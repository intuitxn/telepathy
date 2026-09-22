#!/bin/sh
# durability-guard.sh — protect uncommitted/untracked work in a shared worktree.
#
# Why: on 2026-09-22 a concurrent sync ran a stash + cherry-pick + reset + clean
# of untracked files in the shared checkout and silently destroyed checked Bend
# kernels and six draft docs. Untracked files in a shared worktree are ephemeral.
# See docs/drafts/meta/durability-guard.md and
# .local/engram/incident-sync-wipe.md.
#
# Modes:
#   check              (default) print what a sync/clean would destroy; exit 1 if
#                      there is uncommitted or untracked work, exit 0 when clean.
#   snapshot           write a durable copy of the working state OUTSIDE the
#                      worktree; print the snapshot path. Never destructive.
#   verify <dir>       report the contents of an existing snapshot.
#
# Safety: never deletes anything, never rewrites git history, never forces.
# It runs only git read commands (status/diff/ls-files/rev-parse) plus tar.
#
# Env:
#   MUNDUS_SNAPSHOT_DIR   snapshot root (default: $HOME/.local/share/mundus-snapshots)
#
# POSIX shell, no dependencies beyond git, tar, date, mkdir, sed.

set -eu

usage() {
	cat <<'EOF'
usage: durability-guard.sh [check | snapshot | verify <snapshot-dir>]

  check              (default) fail nonzero if the worktree has uncommitted or
                     untracked work, printing exactly what would be lost.
  snapshot           copy the working state to a timestamped directory outside
                     the worktree; print the snapshot path.
  verify <dir>       report what a snapshot contains.
EOF
}

mode="${1:-check}"
snapshot_root="${MUNDUS_SNAPSHOT_DIR:-$HOME/.local/share/mundus-snapshots}"

# --- locate the worktree (check/snapshot only; verify reads a stored dir) ---
enter_worktree() {
	root=$(git rev-parse --show-toplevel 2>/dev/null) || {
		echo "durability-guard: not inside a git worktree" >&2
		exit 2
	}
	[ -n "$root" ] || { echo "durability-guard: empty worktree path" >&2; exit 2; }
	cd "$root" || exit 2
}

list_tracked_changes() {
	# Tracked files with staged or unstaged changes relative to HEAD.
	if git rev-parse --verify -q HEAD >/dev/null 2>&1; then
		git diff --name-only HEAD
	else
		git diff --cached --name-only
		git diff --name-only
	fi
}

list_untracked() {
	# Files git would remove with `git clean -fd` (ignored files excluded).
	git ls-files --others --exclude-standard
}

# --- check -----------------------------------------------------------------
do_check() {
	enter_worktree
	tracked=$(list_tracked_changes)
	untracked=$(list_untracked)

	if [ -z "$tracked" ] && [ -z "$untracked" ]; then
		echo "durability-guard: CLEAN — no uncommitted or untracked work in $root"
		echo "durability-guard: a sync/clean here would lose nothing."
		exit 0
	fi

	echo "durability-guard: DIRTY — a sync/clean here would destroy the following:" >&2
	if [ -n "$tracked" ]; then
		printf '%s\n' "== uncommitted tracked changes ==" >&2
		printf '%s\n' "$tracked" >&2
	fi
	if [ -n "$untracked" ]; then
		printf '%s\n' "== untracked files (not in git history, unrecoverable) ==" >&2
		printf '%s\n' "$untracked" >&2
	fi
	echo "durability-guard: refusing. Run 'snapshot' first, or commit/stage the work." >&2
	exit 1
}

# --- snapshot --------------------------------------------------------------
do_snapshot() {
	enter_worktree
	utc=$(date -u +%Y%m%dT%H%M%SZ)
	base=$(basename "$root")
	snap="$snapshot_root/$base-$utc"
	# Collision guard (same second): add a suffix, never overwrite.
	n=1
	while [ -e "$snap" ]; do
		snap="$snapshot_root/$base-$utc.$n"
		n=$((n + 1))
	done
	mkdir -p "$snap" || { echo "durability-guard: cannot create $snap" >&2; exit 2; }

	head=$(git rev-parse HEAD 2>/dev/null || echo "none")
	branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "none")
	tracked=$(list_tracked_changes)
	untracked=$(list_untracked)
	tracked_n=$(printf '%s\n' "$tracked" | grep -c . || true)
	untracked_n=$(printf '%s\n' "$untracked" | grep -c . || true)

	# Provenance manifest.
	{
		echo "worktree=$root"
		echo "branch=$branch"
		echo "head=$head"
		echo "utc=$utc"
		echo "tracked_changes=$tracked_n"
		echo "untracked_files=$untracked_n"
	} > "$snap/MANIFEST"

	# Full porcelain status for human reading.
	git status --porcelain > "$snap/status.txt" 2>/dev/null || true

	# Tracked changes as a patch (staged + unstaged vs HEAD).
	if git rev-parse --verify -q HEAD >/dev/null 2>&1; then
		git diff HEAD > "$snap/tracked.patch" 2>/dev/null || true
	else
		: > "$snap/tracked.patch"
		echo "durability-guard: no HEAD commit; tracked.patch is empty" >&2
	fi

	# Untracked files as a tar, paths relative to the worktree root.
	: > "$snap/untracked.list"
	if [ -n "$untracked" ]; then
		printf '%s\n' "$untracked" | sed 's|^|./|' > "$snap/untracked.list"
		# Run inside the worktree so tar records paths relative to it. A
		# filename containing a newline is not representable here (see limits).
		(
			cd "$root" || exit 1
			tar -czf "$snap/untracked.tar.gz" -T "$snap/untracked.list"
		) || { echo "durability-guard: tar failed; see $snap" >&2; exit 2; }
	fi

	# Recovery notes — read-only guidance, executed by a human, never by us.
	cat > "$snap/README.txt" <<EOF
Snapshot of $root taken $utc (branch $branch, head $head).

Contents:
  MANIFEST        metadata (worktree, branch, head, counts)
  status.txt      git status --porcelain at capture time
  tracked.patch   git diff HEAD (staged + unstaged tracked changes)
  untracked.list  paths of untracked files
  untracked.tar.gz  tar of the untracked files (root-relative paths)

Restore (review first; this repo's guard never runs these):
  git apply --check  "$snap/tracked.patch" && git apply "$snap/tracked.patch"
  tar -tzf "$snap/untracked.tar.gz"        # inspect before extracting
  tar -xzf "$snap/untracked.tar.gz" -C "$root"

This snapshot is a copy of the working state, not a commit. It is only as
durable as this filesystem; it is not a substitute for committing or for the
Buzz engram.
EOF

	echo "$snap"
	echo "durability-guard: snapshot written ($tracked_n tracked, $untracked_n untracked)" >&2
}

# --- verify ----------------------------------------------------------------
do_verify() {
	dir="${1:-}"
	if [ -z "$dir" ] || [ ! -d "$dir" ]; then
		echo "durability-guard: verify needs an existing snapshot directory" >&2
		exit 2
	fi
	echo "durability-guard: snapshot $dir"
	if [ -f "$dir/MANIFEST" ]; then
		sed 's|^|  |' "$dir/MANIFEST"
	else
		echo "  (no MANIFEST)" >&2
	fi
	if [ -f "$dir/untracked.list" ]; then
		echo "untracked files:"
		sed 's|^|  |' "$dir/untracked.list"
	fi
	if [ -f "$dir/untracked.tar.gz" ]; then
		echo "untracked.tar.gz members:"
		tar -tzf "$dir/untracked.tar.gz" 2>/dev/null | sed 's|^|  |'
	fi
	if [ -s "$dir/tracked.patch" ]; then
		echo "tracked.patch summary:"
		git apply --stat "$dir/tracked.patch" 2>/dev/null | sed 's|^|  |' || \
			echo "  (could not stat patch)" >&2
	else
		echo "tracked.patch: empty"
	fi
}

case "$mode" in
	check) do_check ;;
	snapshot) do_snapshot ;;
	verify) shift; do_verify "${1:-}" ;;
	-h | --help | help) usage ;;
	*)
		echo "durability-guard: unknown mode '$mode'" >&2
		usage >&2
		exit 2
		;;
esac
