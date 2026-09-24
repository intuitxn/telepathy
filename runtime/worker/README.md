# Bend agent kernel

`system.bend` is the single executable Bend source for the resident meta node. It contains local task and memory transitions and named laws. The node pins its SHA-256 at startup, runs the actual Bend checker, and serializes immutable snapshot transitions for each task.

```sh
BEND_NO_TELEMETRY=1 ~/.bend/bin/bend runtime/worker/system.bend --check-only
node --test runtime/worker/protocol.test.mjs
```

A successful checker proves only the stated Bend laws. A `return` records an attributed agent report; `learn` is an explicit selected finding, and `correct` supersedes stale memory. Neither a model answer nor a stored record is independent evidence of correctness. The node is local and single-writer; it does not provide cross-device consensus, authenticated actor identities, or neural-weight training. See [the meta shell](../META_SHELL.md) for the host protocol and MCP endpoint.
