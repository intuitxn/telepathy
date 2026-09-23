# jj workspaces and candidate changes

Local development uses Jujutsu (`jj`). Git worktree and branch switching are
retired. Git remains the storage/export format for GitHub publication and for
historical refs; do not use Git checkout, stash, reset, clean, or merge to manage
an active jj workspace.

One workspace has one writer. A workspace contains a working-copy change (`@`),
which jj snapshots automatically during ordinary commands. A stable change ID
survives revisions; a commit ID identifies the exact bytes and parents that
were checked. Neither an automatic snapshot nor an operation-log entry proves
correctness or establishes ownership.

## Start and work

```sh
jj status
jj log -r '@ | @-'
# Separate writable directory for an independent task, from an explicit revision:
jj workspace add --name TASK /absolute/path/to/task-workspace -r BASE_REVISION
# In the task workspace:
jj describe -m 'Concrete task and outcome'
# Edit only the files owned by this task, then inspect and check:
jj diff
npm run check
jj log -r @ --no-graph -T 'change_id ++ " " ++ commit_id ++ "\n"'
```

Replace the uppercase placeholders deliberately. The integration owner chooses
`BASE_REVISION`; do not silently default to a stale Git `main` bookmark. Use
`jj new` to start a subsequent change in your owned workspace. Do not edit a
workspace another agent is using. See [CONCURRENCY.md](CONCURRENCY.md).

`scripts/worktree-guard.sh` is a compatibility name for a jj workspace/status
check. It makes no network request and performs no remote-branch ancestry
policy. Status can snapshot local edits; it is not a claim or a lease.

## Recovery

`./mundus guard check` reports whether `@` has changes relative to its parents;
`./mundus guard snapshot` makes a local recovery tag and a private external
snapshot. Snapshot finalizes the current change with a tag and lets jj continue
in a new child change with the same files. The tag binds the original commit,
so later edits cannot move the recovery reference. Preserve operation history
and recovery tags. Use `jj op log`
and `jj op show` to inspect earlier operations before selecting a repair. Never
run a broad undo/restore against somebody else's work.

jj history does not protect ignored private state. The external recovery
archive includes ignored files while excluding `.git` and `.jj`; keep it
private because it can contain secrets. A recovery tag is local and is
not remote backup. Do not push recovery tags or use broad all-ref/all-tag publication.

## Integrate and publish

The integration owner combines verified changes and checks the resulting exact
revision. Resolve conflicts explicitly; do not treat a jj conflict as completed
integration. Record acceptance tests, source revision, reviewer findings, and
remaining limitations.

When publication is authorized, put a named bookmark on the intended revision:

```sh
jj bookmark create TASK -r VERIFIED_REVISION
jj git push --bookmark TASK
```

Use `jj bookmark set` when advancing an existing owned bookmark. A GitHub PR
still has a Git commit head, required checks, and review rules; publication is
not implied by local snapshotting. Preserve the user's existing authority and
any exact-revision review gate. `scripts/agit.py` no longer mutates Git job
branches, notes, tags, or merges. Historical agit records remain evidence.

After integration, the owner can forget a finished task workspace with
`jj workspace forget TASK`. This unregisters it; it does not delete its files.
Archive or remove the directory only after checking that it has no remaining
owned work or private state. Do not remove live pre-migration worktrees until
their owners have paused and their contents have been preserved.
