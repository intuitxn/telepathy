# Accepted activity

This tree is the Git-synced, human-readable projection of accepted Telepathy outcomes.

It is not the execution ledger. Raw sessions, prompts, tool calls, transient status, secrets, and unaccepted artifacts do not belong here.

## Layout

```text
activity/<project>/<year>/<month>/<event-id>.md
```

One accepted event gets one immutable file. The source event ID is its idempotency key. A correction appends a new event rather than rewriting history.

Each file includes human initiator, owner, reviewer, exact artifact revision, verification evidence, limitations, and next action. OpenKnowledge, Obsidian, and Sites may render or curate this projection without becoming independent Job state stores.

For each accepted event, use one nonempty line for each of these labels (additional
Markdown is welcome): `Human initiator:`, `Owner:`, `Reviewer:`,
`Artifact revision:`, `Verification evidence:`, `Limitations:`, and
`Next action:`. Use the full 40- or 64-digit hexadecimal artifact revision.
The filename stem is the source event ID and must be unique across this tree.
`node scripts/validate-projections.mjs` checks the layout and these fields.

This tree is plain, Git-synced markdown; the source of truth is the accepted revision (a merged commit) and the Buzz thread it was resolved in.
