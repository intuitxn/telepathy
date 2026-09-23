# Local jj migration

The canonical checkout is `/Users/a3fckx/Desktop/Attri/telepathy`. The resident
`meta` service, installed agent prompts and Bend skill resolve to this checkout.
Local revision and workspace operations use jj 0.45.1 with Git storage. Existing
remote branches have not been published or rewritten by this migration.

The previous directories were Git worktrees sharing one repository, rather than
nine independent copies of its history. The agent-registration, ctx, policy,
review, wt-docs, wt-validator, meta and mundus worktrees have been retired into
private storage.
Their branches and complete directory contents, including ignored files, remain
recoverable. The retired custom `agit` commands now reject mutations.

The shared-learning worktree remains temporarily in place because another
session is still writing there. Mundus and shared-learning also have unique
experimental commits. Their preservation snapshots are recovery records, not
evidence that those experiments were integrated or verified. Once its writer
has stopped, capture any later shared-learning changes and archive its complete
directory before removing its Git worktree registration. Do not force-remove it.

Private migration evidence lives under
`~/.local/state/intuitxn-meta/migrations/20260924-003121-jj/`:

- `before-migration.tar.gz` and its SHA-256 file preserve the original trees.
- `all-refs.bundle` preserves committed history and captured unfinished changes.
- `preserved-wip.json` identifies the captured revisions.
- `retired-worktrees.json` maps archived directories to their original paths.
- `host-before/` and `host-links-before.json` preserve the former service setup.

Do not restore the full archive over a running checkout. Extract into a separate
private directory, inspect the desired branch/files, and import only the required
content with jj. The old host setup requires its original paths to be restored
before use; it must not be loaded beside the current service on the same port.

See [WORKTREE_LIFECYCLE.md](WORKTREE_LIFECYCLE.md) for revision operations and
[META_SHELL.md](../runtime/META_SHELL.md) for terminal task execution, exact
revision integration and workspace retirement. The resident node exposes a local
MCP interface; distributed relay intake remains a separate, unfinished feature.
