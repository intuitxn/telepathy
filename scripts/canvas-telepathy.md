# Telepathy — program home

Shared human context layer for Intuitxn. This channel is the working surface of the
Telepathy program.

## What happens here

- Human updates, decisions, questions, and announcements (what changed / why it matters / what you need).
- Job requests: post a message starting with `/intuitxn` followed by `request` and `acceptance`
  (repository and runtime optional), or open an issue on the program repo.
- The telepathy bot replies in-thread with candidates, evidence, and the exact revision.
- A named human accepts the revision; Steward drafts the resolution and changelog entry.

## Rules

- Tools prepare; humans accept. No agent may accept its own artifact, resolve a job, or speak as a person.
- Mention people only when they must act.
- Changelog entries go to the `changelog` channel; canonical shared files live in `shared-files`.

Program file: `programs/telepathy.md` (repo). Agent map: `docs/AGENT_MAP.md`.
