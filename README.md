# Telepathy

Telepathy is an experimental local agent kernel. One resident `meta` process accepts terminal and MCP tasks, runs an ACP agent in a jj workspace, and records task and memory transitions in one checked Bend source. The agent language compiles readable programs into inspectable plans for that node.

```text
terminal / local MCP
        |
  meta_shell.py  -- ACP agent (OpenCode or Codex)
        |         -- jj task workspace
  worker/system.bend -- explicit snapshot lineage
        |
  agent program  -- typed plan (one node task)
```

The live node is local only. It does not provide cross-device scheduling, global consensus, neural-weight training, or proof that an agent's answer is correct. Its MCP endpoint is authenticated and bound to loopback. Model judgments are advisory; actual effects remain subject to the host and operator authority. See [the meta shell](runtime/META_SHELL.md) for setup and recovery, [the agent language](docs/designs/agent-program-language.md) for syntax and its limits, and [the Bend kernel](runtime/worker/README.md) for the checked contract.

[RRSI candidate review](docs/designs/rrsi.md) runs a measured incumbent/candidate round in temporary node instances and applies an evidence-based admission gate. Recursive proposal, independent criticism and promotion are not running in the resident node.

```sh
uv run --script runtime/meta_shell.py start
uv run --script runtime/meta_shell.py status
uv run --script runtime/meta_shell.py shell --project "$PWD"
make check
```

`jj` is the local revision and workspace tool; Git is remote transport. [Workspace lifecycle](docs/WORKTREE_LIFECYCLE.md) and [concurrency rules](docs/CONCURRENCY.md) describe the single-writer boundary. Historical website, Nudge/oc2 host, duplicate kernels, evaluation fixtures, and old service code remain recoverable from Git history, but are not part of this active tree.
