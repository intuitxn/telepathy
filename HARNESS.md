# Telepathy harness

The harness executes algorithm candidates and keeps evidence beneath Telepathy's human product surface. People see useful context and accountable outcomes, as described in [PRODUCT.md](PRODUCT.md). The new source route is the pinned [DeepSeek Harness integration](runtime/dsh/README.md) with model `deepseek-official/deepseek-flash`. Operational cutover is pending a live credentialed run and the remaining migration gates.

A candidate is normally one self-contained Bend file. [`runtime/core/telepathy.bend`](runtime/core/telepathy.bend) is the executable core; DSH provides sessions, scoped tools, source archives, bounded execution, and receipts. [`benchmarks/core/`](benchmarks/core/README.md) owns independent expected results and scoring. The model proposes and predicts; observation and evaluation decide what survives. A selected version affects future sessions while existing sessions keep their pin. [The algorithm harness guide](runtime/adaptive/HARNESS.md) defines the closed loop and its measurement limits.

Human Jobs still follow the [project lifecycle](docs/PROJECTS.md): `Proposed -> Ready -> Active -> Waiting -> Review -> Resolved | Cancelled`. An agent finishing a turn or passing a benchmark does not resolve a human Job. Buzz holds human requests and acceptance; private `DSH_HOME` holds algorithm sessions and receipts; jj/Git holds code revisions. Private credentials and raw transcripts do not belong in public artifacts. The website, forum, workspace service, programs, and reviewer stay separate from the local algorithm engine.

```sh
npm run check       # DSH and evaluator checks, Bend when installed
make check          # requires Bend and both benchmark suites
make benchmark      # executable core against frozen core cases
make integration-check # pinned DSH keyless sessions plus Bend checks
```

Use [OPERATE.md](OPERATE.md) for private DSH configuration, [WORKTREE_LIFECYCLE.md](docs/WORKTREE_LIFECYCLE.md) for jj recovery, and [AUTO_MERGE.md](docs/AUTO_MERGE.md) for exact revision review. A keyless DSH headless cycle is checked; a live DeepSeek API turn requires its own credential and verification.
