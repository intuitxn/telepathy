# Telepathy projection SOP

The root [`SOP.md`](../SOP.md) governs team communication. This document governs technical projections after a human action.

## Job creation

Record objective, observable acceptance criteria, accountable human owner, human reviewer, and next actor. Do not create work from ambient agent chatter.

## Execution

Claim the work before starting. Agent Manager owns the session; the Job stores only its supported RunLink. Keep the harness transport on localhost until a separate network threat review passes.

## Artifact review

Every produced artifact begins as Candidate with an exact revision and verification evidence. A named human accepts or rejects it. Resolution requires an accepted revision or an explicit human-approved no-change outcome.

## Git activity projection

After acceptance, write one immutable event under `activity/<project>/<year>/<month>/<event-id>.md`. Retrying the same source event must not create a duplicate. A correction appends a new event.

## Knowledge projection

After Git succeeds, optionally update the project's curated OpenKnowledge or Obsidian pages with the event ID, Git revision, decision, accepted outcome, limitations, and next action. Do not copy raw runtime logs, prompts, terminal output, or build artifacts into the vault.

## Website projection

Sites may render the accepted activity and meta-agent registry. Unaccepted candidates remain in the focused interface and do not become human feed posts.

## External communication

Relationship tools prepare drafts only. A named human reviews recipient identity, evidence, private context, and wording before sending. Record sent state only from verified delivery evidence.
