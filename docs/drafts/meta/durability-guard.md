# DRAFT — durability guard for shared worktrees

Status: draft, agent-authored (relay-keeper) · Updated: 2026-09-22 · **Not published, not sent.**
This proposes an infra guard and the rule behind it. It creates no external effect
and authorizes no publication. Evidence is the incident record plus commands run
in this session.

## The rule

**Untracked is ephemeral.** An artifact is not "done" until it is committed on a
branch or written to the Buzz engram. In a shared worktree, uncommitted and
untracked files are scratch, not work: any concurrent writer may `clean` them
away. A sync or clean must refuse to run in a worktree that has uncommitted or
untracked work unless the owning session has coordinated and a durable copy exists.

## The failure it prevents

This is the 2026-09-22 incident in `.local/engram/incident-sync-wipe.md`.
At ~13:05 a process outside the session ran a sync against the shared worktree
`telepathy-shared-learning` (branch `refactor/buzz-native-bend`): a stash
("preserve shared-learning before removal"), a cherry-pick (`cae1141`), a
`reset`, and a clean of untracked files. Untracked artifacts were destroyed
silently:

- `runtime/worker/diffusion.bend` — 924 lines, 35 named laws, checked clean
  (sha256 `3c1aaba806664e6a2e0d9b43c50501b54d7c2989c8861fdd47cfdaa396c61851`).
- `runtime/worker/history.bend` — 484 lines, 23 laws
  (sha256 `8a10714318347334a672ffda0b0098ce10115543ac26aa7cb792c6b25d459271`).
- Draft docs: `mundus-runtime-proposal`, `diffusion-retrieval-laws`,
  `buzz-mem-history-laws`, `buzz-mem-daily-history`, `self-improvement-and-scale`,
  `status-kernel-notes`.

Only files with a copy (a temp file, or a stash) survived. Root cause: untracked
artifacts in a shared worktree are ephemeral and there is no single-writer
discipline across concurrent sessions. The guard makes that failure loud and
recoverable instead of silent.

## The guard

`scripts/durability-guard.sh` — POSIX shell, no dependencies beyond git and tar.

- `check` (default): runs `git status --porcelain` semantics and **exits nonzero**
  if there is uncommitted or untracked work, printing exactly what a sync/clean
  would destroy (tracked changes and untracked files separately). Clean tree →
  exit `0`. This is the pre-sync gate.
- `snapshot`: before a destructive operation, writes a durable copy **outside**
  the worktree to `$HOME/.local/share/mundus-snapshots/<worktree>-<UTC>` (override
  with `MUNDUS_SNAPSHOT_DIR`) and prints the path. It captures `tracked.patch`
  (`git diff HEAD`), `untracked.list` + `untracked.tar.gz`, `status.txt`,
  `MANIFEST`, and restore notes in `README.txt`.
- `verify <snapshot-dir>`: reports what a snapshot contains. Reads a stored
  directory and does not need to be inside a worktree.
- Safety: never deletes, never rewrites git history, never forces. It only runs
  git read commands (`status`/`diff`/`ls-files`/`rev-parse`) plus `tar`.

## Wiring it as a pre-sync gate

Refuse the sync when the worktree is dirty, and snapshot first as the recovery
affordance:

```sh
#!/bin/sh
set -eu
guard="scripts/durability-guard.sh"
# 1. Capture a durable copy before anything destructive.
"$guard" snapshot
# 2. Refuse to proceed while uncommitted/untracked work exists.
"$guard" check || {
  echo "sync refused: worktree has uncommitted/untracked work" >&2
  exit 1
}
# 3. ... only now run the sync/clean ...
```

Put step 2 at the top of any script that runs `git clean`, `git reset`,
`git checkout`, or `git stash` in a shared checkout, and in the session wrapper
before a `worker`/sync step. `check` returning nonzero is a hard stop, not a
warning.

## Evidence (commands run this session)

- Clean tree: `scripts/durability-guard.sh check` → `CLEAN — no uncommitted or
  untracked work`, exit `0`.
- Dirty tree (untracked `runtime/worker/diffusion.bend`): `check` → prints the
  untracked file under "not in git history, unrecoverable", exit `1`.
- `snapshot` in that tree → `.../mundus-snapshots/dirty.Jre9uk-20260922T090929Z`,
  containing `MANIFEST`, `README.txt`, `status.txt`, `tracked.patch`,
  `untracked.list`, `untracked.tar.gz`; `tar -tzf` lists
  `./runtime/worker/diffusion.bend`.

## Limits

- A gate is only effective if the destructive actor runs it; a process that
  ignores the gate can still wipe the tree. Pair it with the one-writer rule.
- The snapshot is a **local copy** — only as durable as this filesystem. It is
  not off-site, not a commit, and not a substitute for committing or the engram.
  The engram preserves knowledge, not exact source bytes.
- `untracked.list` is newline-delimited, so a filename containing a newline is
  not representable and would be skipped by the tar step.
- Ignored files are excluded (matching `git clean -fd`); a `git clean -fdx` would
  also remove ignored files, which this guard does not snapshot.
- Restoring `tracked.patch` needs `git apply` and may conflict with later
  changes; extraction writes into the worktree and must be done deliberately.
- It observes a point in time. It does not lock the worktree, detect a
  concurrent writer, or capture `.git` internals or submodule state.
