# How projects happen in Telepathy

## Planning and execution

| Surface | Owns |
|---|---|
| Telepathy workspace | Durable human communication and accepted outcomes |
| GitHub Project | Backlog, priority, milestone, and planning status |
| GitHub issues | Outcome, acceptance criteria, dependencies, and discussion tied to code |
| Telepathy Job | Execution state, next actor, waiting reason, candidate and accepted artifacts |
| Agent Manager | Live workers, worktrees, terminals, and RunLinks |
| Accepted activity tree | Immutable human-readable outcome projection in Git |

The current organization Project is private, linked to the public repository, and contains the Internal alpha backlog. Its native status is intentionally simple: `Todo`, `In Progress`, and `Done`.

The Job contract is more precise because it governs execution:

```text
Proposed -> Ready -> Active -> Waiting -> Review -> Resolved | Cancelled
```

Never infer Job state from a Project card or agent session. Project views are for humans; typed Job events are for execution integrity.

## Meta-agent work

Every meta-agent request starts with a human owner and reviewer. Prime may propose the Job, Build may create a candidate, and Steward may project an accepted outcome. None may accept its own artifact, impersonate a human author, or send an external message.

See [`../plugins/telepathy-meta-agents/registry.json`](../plugins/telepathy-meta-agents/registry.json) for the current declarative catalog.
