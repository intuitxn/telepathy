# One writer per unit of work

Concurrency rule for multiple agents in one repository. Isolation is covered by
[WORKTREE_LIFECYCLE.md](./WORKTREE_LIFECYCLE.md), landing by
[AUTO_MERGE.md](./AUTO_MERGE.md), execution by [../runtime/AUTONOMY.md](../runtime/AUTONOMY.md).
This file covers the gap those leave: **exclusive ownership**, so two agents never
write the same thing at the same time.

## Rule order

```
worktree isolation  >  exclusive claim  >  single-writer state  >  serialized merge
```

If the first holds, the rest are cheap. The failure this file exists to stop is
two agents editing one checkout, one stashing the other's work, PRs opened and
closed under each other, and the run entry point drifting.

## One writer per unit

- Every unit of work — a branch, a file, a job, a snapshot — has **exactly one
  writer** at a time.
- **Claim before you write.** If you cannot claim it, do not write it.
- A claim carries a **lease**. A stale lease is reclaimed, never shared.

Prior art already in the system: Desk's `claim-once` transition; the Bend worker
snapshot rule (`OUT` must be new, single writer — [META.md](../runtime/adaptive/META.md));
the telepathy peer registry (one writer per store).

## Shared files

- Shared surfaces — `main`, `docs/INDEX.md`, `package.json`, `Makefile` — are
  owned by the **integration owner**. Other agents **propose** changes (a PR, a
  note); they do not edit them directly.
- Write your own work under your own namespace: your worktree, or
  `docs/drafts/<agent>/`.
- One branch is checked out in one worktree only; do not reuse a branch another
  worktree holds.

## Never rewrite another agent's work

- Do not `git stash` a tree you do not own. A shared checkout is **read-only**
  unless you hold its claim.
- To retire or absorb a branch, **close it as `SUPERSEDED`** and prove containment
  (`git merge-base --is-ancestor <tip> <integration-head>`). Do not force-push,
  rebase, or delete another agent's branch.

## Detection

- Refuse to start if the checkout you were given is dirty and not yours.
- Before editing, confirm the branch is not already merged
  (`scripts/worktree-guard.sh`).
- If you find uncommitted changes you did not author, **stop and hand off**; do
  not commit them.

## Serialized integration

One integration owner lands to `main`, one PR at a time. A superseded branch is
kept (its commits stay in history) and closed, not merged twice. Small owned PRs,
not one large consolidation.
