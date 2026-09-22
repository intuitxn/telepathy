---
description: Coordinate Lorenz workers and retain evaluated task outcomes
agent: general
---

Execute the requested meta-agent task using runtime/adaptive/META.md in the
Telepathy checkout. Prefer the current checkout when that document and
runtime/worker/system.bend exist. Otherwise resolve the real path of this
command at ~/.config/opencode/commands/meta.md (it may be a symlink); the
checkout is three directory levels above the command file. Read META.md there
before starting. Use absolute checkout paths for its commands while preserving
the user's project as the task workspace. If resolution fails, report that
the Telepathy checkout must be installed; do not invent a replacement runtime.
This command accepts:

    /meta agents TASK AND ACCEPTANCE CRITERIA

Request supplied by the user:
$ARGUMENTS

Resolve the one-file Lorenz worker source as documented. Keep one coordinator
writing its snapshot lineage. Use its worker, claim, packet, return and learn
commands for worker state; do not replace that protocol with the separate
shared-registry Lorenz core. When shared registry use is relevant, use its
existing lifecycle before/after commands for bounded retrieval and selected
outcomes. Delegate only concrete
independent work authorized by the request, using available host tools or the
native Bend OpenCode delivery to an existing local session. Evaluate returned
work before closeout. Report exact evidence, source paths and outstanding work.
Keep raw conversations, receipts and session identifiers private. A reported
worker result and an explicitly learned finding are not a verified code bundle.
