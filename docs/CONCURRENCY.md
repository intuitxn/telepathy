# One writer per unit of work

Use one jj workspace per independent writer and one explicit owner per shared
file, task, or runtime snapshot lineage. A jj workspace gives separate files;
it is not a filesystem sandbox, a lease service, or a distributed lock.

1. State the task, workspace, owned paths, base revision, and acceptance check
   before editing. Coordinate ownership through the existing host; a prose
   claim does not enforce exclusivity.
2. Keep each worker's writes in its owned workspace. The integration owner owns
   shared surfaces and integration changes. Workers propose changes to shared
   files rather than racing to update the same copy.
3. Inspect `jj status` before work. Unknown edits require coordination with
   their owner; do not stash, restore, abandon, or include them silently.
4. Snapshot and describe your own change. Preserve its change ID, checked commit
   ID, and evidence. A later edit invalidates evidence bound to earlier bytes.
5. One integration owner combines verified changes and resolves conflicts.
   Recheck the resulting revision. Remote GitHub publication uses explicit
   bookmarks and the existing authorization/review rules.

Never use Git checkout, stash, reset, clean, or merge inside the active jj
workflow. Never remove another agent's workspace or rewrite its change without
coordination. Old worktrees remain untouched until their owners pause and a
migration preserves their dirty files, unique commits, and private state.

For Bend, one coordinator still writes each lineage of immutable snapshots.
Parallel workers return results to that coordinator. jj history does not make
Bend state writes atomic or grant globally exclusive worker claims.

See [WORKTREE_LIFECYCLE.md](WORKTREE_LIFECYCLE.md) for commands and recovery,
[AUTO_MERGE.md](AUTO_MERGE.md) for GitHub landing rules, and
[../runtime/AUTONOMY.md](../runtime/AUTONOMY.md) for execution authority.
