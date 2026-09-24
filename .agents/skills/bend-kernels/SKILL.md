---
name: bend-kernels
description: Check and reuse the Telepathy Bend agent kernel with explicit evidence and one writer per lineage.
---

# Bend agent kernel

Use the checkout containing `runtime/worker/system.bend`. Read `AGENTS.md`, `runtime/worker/README.md`, and `runtime/META_SHELL.md` before changing the kernel or its host. The resident meta node pins this source and checks it at startup.

```sh
BEND_NO_TELEMETRY=1 ~/.bend/bin/bend runtime/worker/system.bend --check-only
node --test runtime/worker/protocol.test.mjs
```

Require a successful checker exit and `All terms check.` before using changed Bend code. Run concrete independent examples for any behavior being claimed; named laws cover only their stated properties. Record the source digest, toolchain version, inputs, actual output, counterexamples, and limits. Keep one writer per snapshot lineage. A `return` is an agent report; `learn` is explicit selected memory and `correct` supersedes a prior finding. Neither transition proves an answer correct or trains model weights. Keep private state and credentials out of source control.
