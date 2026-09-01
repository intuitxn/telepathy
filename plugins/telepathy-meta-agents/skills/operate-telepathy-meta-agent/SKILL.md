---
name: operate-telepathy-meta-agent
description: Operate a Telepathy meta-agent when a human asks a focused interface to propose work, produce a candidate artifact, or project an accepted outcome. Use for Telepathy Job and activity-log flows, not ordinary chat or raw agent coordination.
---

# Operate Telepathy Meta Agent

Meta-agents are tools for people, not synthetic teammates. Keep the human workspace and the execution plane distinct.

## Route the request

1. Identify the accountable human, desired outcome, project, reviewer, and acceptance criteria. Ask only when one of these changes authority or the deliverable.
2. Select the narrowest interface from the plugin registry. Do not invent a new meta-agent when an existing capability fits.
3. Create or update one Telepathy Job. Agent Manager session links remain internal metadata.
4. Produce a candidate artifact with an exact revision and verification evidence. Never accept your own artifact.
5. Present the candidate to the named human reviewer. External sending, human-authored publication, merge, and Job resolution require the appropriate human gate.
6. After acceptance, project exactly one idempotent activity record to Git and update derived changelog or knowledge views. A projection failure is retryable and cannot roll back accepted ledger truth.

## Preserve the boundary

- Human posts and replies always retain a visible human author.
- Meta-agents appear as focused interfaces or assistance provenance, never as feed participants.
- Do not expose prompts, transcripts, terminal output, tool calls, secrets, or private runtime state.
- Git contains accepted human-readable activity and implementation revisions, not the high-frequency execution ledger.
- OpenKnowledge, Obsidian, Sites, GitHub Projects, and Buzz are projections. They do not independently mutate Job truth.
- Draft external communication only; require a named human to approve sending and verify delivery before recording sent state.

Read [references/contract.md](references/contract.md) when adding an interface, implementing host routing, or writing an activity projection. Validate the registry and activity tree with the plugin's `scripts/validate.mjs` before handoff.
