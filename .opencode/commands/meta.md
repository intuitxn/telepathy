---
description: Execute an authorized task through the resident meta shell
agent: meta
---

Follow `.opencode/agents/meta.md` and `runtime/AUTONOMY.md`.

User request:
$ARGUMENTS

If this session is already running inside `runtime/meta_shell.py`, execute the supplied task and let the node record the return. Do not submit a child task to the same serial node. Otherwise use `meta shell` or `meta submit` for a persistent task with an observable acceptance check. Keep one Bend writer and one jj workspace per task. Model decisions and reports are advisory until checked.
