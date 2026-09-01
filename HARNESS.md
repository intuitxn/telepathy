# Telepathy harness boundary

The harness is infrastructure, not the human communication surface.

It may coordinate Jobs, reservations, run links, candidate artifacts, and accepted artifacts. It must not render worker transcripts, prompts, tool calls, or synthetic agents as teammates.

## Authority

- Human-authored posts and explicit human actions are the source of intent.
- Agent Manager owns execution-session state.
- The append-only harness ledger owns Job and artifact-event history.
- Git owns accepted implementation revisions.
- Telepathy projects only the human-relevant owner, next action, status, evidence, and resolution.

An artifact remains a candidate until a named human accepts its exact revision. A Job cannot become Resolved without an accepted artifact or an explicit no-change resolution.

The current socket transport is localhost-only. Network exposure requires a separate threat review and is not part of the internal-alpha website.
