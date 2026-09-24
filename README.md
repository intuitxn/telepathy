# Telepathy

Telepathy is Intuitxn Labs' experimental local agent kernel. One resident `meta` process accepts terminal and MCP tasks, runs an ACP agent in a jj workspace, and records task and memory transitions in one checked Bend source. The agent language compiles readable programs into inspectable plans for that node.

```text
terminal / local MCP
        |
  meta_shell.py  -- ACP agent (OpenCode or Codex)
        |         -- jj task workspace
  worker/system.bend -- explicit snapshot lineage
        |
  agent program  -- typed plan (one node task)
```

The node's MCP endpoint is authenticated and bound to loopback; an optional SSH relay can forward explicit requests to another installed node. There is no cross-device scheduler, global consensus, neural-weight training, or proof that an agent's answer is correct. Model judgments are advisory; actual effects remain subject to the host and operator authority. See [the meta shell](runtime/META_SHELL.md) for setup and recovery, [the agent language](docs/designs/agent-program-language.md) for syntax and its limits, and [the Bend kernel](runtime/worker/README.md) for the checked contract.

[RRSI candidate review](docs/designs/rrsi.md) runs measured incumbent/candidate rounds in temporary node instances. The [agent-language protocol](docs/designs/intuitxn-language.md) now drives a bounded recursive proposal, critique, forward, feedback, and selection loop through the resident node. Selection advances only a private pinned incumbent; no candidate is automatically deployed.

```sh
uv run --script runtime/meta_shell.py start
uv run --script runtime/meta_shell.py status
uv run --script runtime/meta_shell.py shell --project "$PWD"
make check
```

`jj` is the local revision and workspace tool; Git is remote transport. [Workspace lifecycle](docs/WORKTREE_LIFECYCLE.md) and [concurrency rules](docs/CONCURRENCY.md) describe the single-writer boundary. Historical website, Nudge/oc2 host, duplicate kernels, evaluation fixtures, and old service code remain recoverable from Git history, but are not part of this active tree.
