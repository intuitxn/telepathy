# Accepted activity

This tree is the Git-synced, human-readable projection of accepted Telepathy outcomes.

It is not the execution ledger. Raw sessions, prompts, tool calls, transient status, secrets, and unaccepted artifacts do not belong here.

## Layout

```text
activity/<project>/<year>/<month>/<event-id>.md
```

One accepted event gets one immutable file. The source event ID is its idempotency key. A correction appends a new event rather than rewriting history.

Each file includes human initiator, owner, reviewer, exact artifact revision, verification evidence, limitations, and next action. OpenKnowledge, Obsidian, and Sites may render or curate this projection without becoming independent Job state stores.

Validate the tree from the repository root:

```bash
node plugins/telepathy-meta-agents/scripts/validate.mjs
```
