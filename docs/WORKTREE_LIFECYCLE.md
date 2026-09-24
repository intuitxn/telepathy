# jj task workspaces

Use Jujutsu (`jj`) for local revisions. Each independent writer owns a separate workspace; Git is remote transport. A jj workspace is not a filesystem sandbox or a distributed lock. The resident meta node creates task workspaces from an explicit revision, records a result bookmark, and keeps integration separate from the agent's reported result.

```sh
jj status
jj log -r '@ | @-'
jj workspace add --name TASK /absolute/path/to/task-workspace -r BASE_REVISION
# Work only in that task workspace, then inspect its exact revision:
jj diff
jj describe -m 'Concrete outcome'
jj log -r @ --no-graph -T 'commit_id ++ "\n"'
```

Do not use Git checkout, stash, reset, clean, or merge to manage an active jj workspace. Preserve unknown edits and ignored private files before retiring a workspace. `jj op log` and `jj op show` help recover local revisions, but do not back up ignored state. A reported result needs independent verification; a later edit requires checks against the new commit.

The integration owner combines candidate revisions, resolves conflicts, rechecks the exact integrated commit, and advances an owned bookmark. Push only an intended bookmark. GitHub branch protection, checks, and review requirements still govern landing. After preserving the candidate and private state, use `jj workspace forget TASK` to unregister an unused workspace; that command does not remove its files.
