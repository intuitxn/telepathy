# Git worktrees: candidate isolation

A worktree is where a candidate is prepared. It is not where knowledge lives.

## What it is

One repository, several working directories. Every worktree shares the clone's
object store, refs and remote; each has its own HEAD and index. It is an
isolation unit, not an OS sandbox ([report](../artifacts/reports/2026-09-08-telepathy-labs-technical-report.md)).

Use one worktree per parallel candidate: a job, an agent, an experiment. The
stable checkout stays on `main`; the candidate works on its own branch with no
stashing or branch switching.

## Lifecycle

```
create from committed HEAD -> branch per candidate -> work -> verify
  -> candidate + evidence + exact revision -> human accepts that revision
  -> merge -> remove worktree -> delete branch
```

| Layer | Primitive | Lifetime |
| --- | --- | --- |
| Candidate code | worktree + branch | disposable |
| Accepted code | `main` after merge | durable |
| Learning | attributed memory | durable, separate |

- **Worktree: disposable.** Remove it when the candidate is merged or rejected.
- **Branch / Candidate: durable until accepted**, carrying the exact revision.
- **Learning: never the worktree.** It is attributed memory ([META.md](../runtime/adaptive/META.md)).
- Commit from committed HEAD and never leave a worktree half-dirty; the design
  creates each job from committed HEAD ([BUZZ.md](../runtime/worker/BUZZ.md)).

## When to merge

Only when the candidate passes its checks and a named human accepts that exact
revision ([SOP.md](./SOP.md), [HARNESS.md](../runtime/adaptive/HARNESS.md)).
Reject means discard the branch and remove the worktree: an experiment that
scored zero.

A candidate may **auto-merge** once it is in a mergeable state: checks green on an
up-to-date branch, one independent approving review, and no unresolved
conversations. Native auto-merge is enabled per PR and pinned to the reviewed
head (`gh pr merge <n> --auto --merge --match-head-commit <sha>`); a new commit
re-runs checks and invalidates the stale review. Auto-merge lands the *reviewed
state*; it is not self-approval and not acceptance. A reviewer identity and the
check workflow are defined separately (native review and auto-merge; see
`docs/AUTO_MERGE.md`). A green gate alone is never enough.

## Guard

`scripts/worktree-guard.sh` enforces the disposable half:

```sh
scripts/worktree-guard.sh status   # mark each worktree: stable / DISPOSABLE / active
scripts/worktree-guard.sh guard .  # fail if the current worktree's branch already merged
scripts/worktree-guard.sh prune 2  # remove clean, idle (>=2m) disposable worktrees
```

`guard` is the preflight that stops reuse of a merged worktree; it exits nonzero
before any work starts. `prune` never touches the stable checkout or a worktree
that is dirty or has writes in the last `MIN` minutes.

## Limits

- A worktree is **not** a security boundary ([report](../artifacts/reports/2026-09-08-telepathy-labs-technical-report.md)).
- Branches do not enforce exclusive claims; concurrent agents still need the
  worker `claim` discipline ([META.md](../runtime/adaptive/META.md)).
- A merge is evidence a finding can point to; it does not retain the finding.
