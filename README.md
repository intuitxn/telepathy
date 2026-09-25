# Telepathy

Telepathy is Intuitxn's shared human context layer. The [internal alpha preview](https://intuitxn.github.io/telepathy/) shows posts, replies, acknowledgements, and resolutions in one browser. People remain the visible authors and accountable owners. The preview is not a secure multi-user production workspace; see [PRODUCT.md](PRODUCT.md) for its release boundary.

## Algorithm machine

The new algorithm source target is one self-contained Bend candidate where possible, a pinned DeepSeek Harness (DSH) session, and an independent evaluator. The [architecture contract](docs/designs/dsh-algorithm-machine.md) defines prediction, observation, causal event flow, bounded compute, and version selection. Its implementation is split at the trust boundary:

```text
runtime/core/telepathy.bend     executable algorithm and simulation
runtime/dsh/core.mjs           session tools, source archive, receipts, selection
runtime/dsh/cordis.patch.yml   DSH model route and plugin registration
benchmarks/core/              frozen cases and independent evaluator
```

The DSH source route is pinned to `deepseek-official/deepseek-flash`. Supply `DEEPSEEK_API_KEY` through a private process environment or DSH's private credential store. Keep `DSH_HOME` outside the repository. [DSH setup and exact tool contract](runtime/dsh/README.md) pins the upstream Harness revision and shows the CLI/session commands. A keyless headless DSH cycle has been checked; a live DeepSeek API turn still requires configured credentials and its own verification.

One session can propose source plus a predicted check, build, and case result. The plugin archives exact source bytes and execution receipts. The evaluator reruns the archived source against host-pinned cases; selection requires a strict score gain without losing a passing case on the same evaluator and toolchain. A selected digest is read by future sessions. Prior Bend experiments remain as candidate source, not active host entry points.

```sh
npm run check                 # checks DSH, historical evaluator, and Bend when installed
make check                    # requires Bend and the independent algorithm benchmark
make benchmark                # JSON report for the executable core's frozen cases
make reference-benchmark      # check the separate adapter reference fixture
make integration-check        # require the built pinned DSH keyless session tests
node scripts/jj-gate.mjs FULL_JJ_COMMIT_ID  # check an exact revision before task-head adoption
sh scripts/durability-guard.sh check
```

Use an owned `jj` workspace for a change. Read [WORKTREE_LIFECYCLE.md](docs/WORKTREE_LIFECYCLE.md) and [OPERATE.md](OPERATE.md). Keep private session state and credentials out of commits. The Meta shell, Mundus wrapper, mailbox, and op driver are recoverable from earlier revisions and retired from the new source tree. Operational cutover to live DSH is pending; this source cleanup does not stop installed services or touch their private state.

## Product rule

> Telepathy exists to improve human communication. It must not turn internal agent traffic into a product for people to monitor.

The website and focused interface catalog remain separate from the algorithm machine. The catalog describes planned Prime, Build, Steward, Research, and Relationships tools, not live agent endpoints. Read [SOP.md](SOP.md) for the team operating model, [forum/START_HERE.md](forum/START_HERE.md) for forum instructions, and [CHANGELOG.md](CHANGELOG.md) for release history.

```sh
cd site
npm install
npm run dev
```

Deployment is tied to reviewed commits on `main`; the [exact revision review rules](docs/AUTO_MERGE.md) still apply.
