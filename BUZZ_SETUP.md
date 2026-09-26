# Set up Telepathy

The new algorithm source uses a self-contained Bend candidate, a pinned DeepSeek Harness (DSH) build, and an independent host evaluator. The production model route is `deepseek-official/deepseek-flash`. Operational cutover is pending: this source guide does not stop an installed older service or move its private state.

## Check the source

From an owned jj workspace in this repository:

```sh
npm run check
make check
make benchmark
node scripts/check-operator-docs.mjs
```

`make check` requires Bend. `make integration-check` also requires a built copy of the pinned DSH checkout and its `TELEPATHY_DSH_CLI_BIN` and `TELEPATHY_DSH_LLM_MODULE` entrypoints. See the [DSH setup guide](runtime/dsh/README.md) for the upstream commit, build commands, private roots, tool boundary, and exact-revision release gate. A passing keyless check is not a live DeepSeek turn.

Keep `DSH_HOME`, provider credentials, case sets, evaluator bytes, and task state outside model-writable workspaces. The trusted host opens the task and funds its grants. Only after the checked release and private task profile exist can the host use the [resident ingress](runtime/dsh/README.md#funded-research-task-program):

```sh
node /path/to/checked/release/runtime/dsh/resident-ingress.mjs --config /private/ingress.json submit < /private/request.json
node /path/to/checked/release/runtime/dsh/resident-ingress.mjs --config /private/ingress.json status REQUEST_ID
node /path/to/checked/release/runtime/dsh/resident-ingress.mjs --config /private/ingress.json list
node /path/to/checked/release/runtime/dsh/resident-ingress.mjs --config /private/ingress.json run-next
```

These commands are local host operations, not Buzz relay intake. The request refers to a reviewed profile; the current ingress supports research and analysis. `reported` means the program reached its checkpoint, not that its goal was independently accepted. The DSH guide describes recovery of ambiguous attempts and the separate live migration gates.

## Human workspace and Buzz

The [website](https://intuitxn.github.io/telepathy/) is an alpha preview with local browser state; it is not authenticated team discussion or a DSH job console. People remain the visible authors and accountable owners. Read the [product contract](PRODUCT.md), [team SOP](SOP.md), and [forum instructions](forum/START_HERE.md) before preparing company content. The [relay setup record](docs/RELAY_SETUP.md) documents earlier channels and membership; it is not a command to start an old watcher or import relay messages into DSH.

## Earlier hosts

Desk, the OpenCode `/meta` command, the Meta shell, Mundus, and the mailbox plugin are recoverable from earlier revisions. Their setup commands are not supplied by the current root `package.json`. Keep installed processes and private records intact until a deliberate migration with a coherent backup and rollback path. The [local-main reconciliation](docs/designs/local-main-reconciliation.md) records how the retained capabilities map to the DSH machine and which historical behaviors remain outside it.
