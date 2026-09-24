# Telepathy agent kernel

`runtime/meta_shell.py` is the one resident local node. It owns task intake, ACP execution, the authenticated loopback MCP endpoint, jj task workspaces, and serialized Bend snapshots. `runtime/worker/system.bend` is the executable kernel. Agent programs compile into plans for this node; they do not start another service.

Carry an authorized request through implementation and verification. Use `jj` for local revisions and managed workspaces; read `docs/WORKTREE_LIFECYCLE.md` and `docs/CONCURRENCY.md`. One writer owns each Bend lineage. Preserve candidate revisions and private evidence before retiring a workspace. Git is remote transport; respect branch protection and review gates.

Use `runtime/AUTONOMY.md` for execution authority. Model decisions and generated text are proposals, not verified facts or permission grants. Check Bend source with the actual compiler before reuse, and distinguish a reported agent result from independent acceptance or learned memory. Do not publish secrets, transcripts, credentials, or private node state.
