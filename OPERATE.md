# Telepathy — operate

Use an owned `jj` workspace based on the integration revision. In the new source path, DSH owns algorithm sessions, Bend executes the source, and `jj` owns local code revisions. Operational cutover is pending; do not stop the installed legacy service as part of source cleanup. The website, forum, programs, and reviewer remain separate. Do not infer a live DeepSeek connection or agent identity from a local session or a saved receipt.

## Inspect and isolate work

```sh
jj status
jj log -r '@ | @-'
sh scripts/durability-guard.sh check
```

Follow [WORKTREE_LIFECYCLE.md](docs/WORKTREE_LIFECYCLE.md) and [CONCURRENCY.md](docs/CONCURRENCY.md). Give each independent writer a separate `jj` workspace. Preserve candidate revisions and ignored private state before retiring a workspace. The recovery command is `sh scripts/durability-guard.sh snapshot`; it creates a private archive and local recovery tag. It does not publish or merge.

## Start the algorithm session

The intended DSH route is `deepseek-official/deepseek-flash`. Build the exact upstream revision and use the [DSH setup guide](runtime/dsh/README.md). Set `DEEPSEEK_API_KEY` in the private process environment or DSH private credential store, and put `DSH_HOME` outside this checkout. The plugin uses the host-pinned evaluator and case set:

```sh
export DSH_HOME=/path/to/private/telepathy-dsh-state
export TELEPATHY_DSH_WORKSPACE="$PWD"
export TELEPATHY_DSH_EVALUATOR="$PWD/benchmarks/core/run.mjs"
export TELEPATHY_DSH_CASE_SET="$PWD/benchmarks/core/kernel-cases.json"
export TELEPATHY_DSH_EVALUATOR_SHA256="$(shasum -a 256 "$TELEPATHY_DSH_EVALUATOR" | cut -d ' ' -f 1)"
export TELEPATHY_DSH_CASE_SET_SHA256="$(shasum -a 256 "$TELEPATHY_DSH_CASE_SET" | cut -d ' ' -f 1)"
node /path/to/deepseek-harness/apps/cli/lib/bin.js --profile headless --patch runtime/dsh/cordis.patch.yml --json 'Evaluate the Bend candidate against the pinned case set.'
```

Replace the private paths with actual owned locations. `kernel-cases.json` is the frozen suite for the executable core; `cases.json` is a separate reference-fixture suite. Pin one case set per scoring generation and rescore both candidate and incumbent before comparing under a changed case set. The CLI and plugin revision are pinned in the setup guide. A direct `algorithm_run` receipt records source digest, prediction, check/build, bounded exploratory cases, and observations. `algorithm_score` independently reruns the archived source using the host-owned cases; it does not trust the model's expected output. `algorithm_select` compares score digests and updates the pointer for future sessions only. The keyless headless test verifies this flow without a provider key; a live DeepSeek API turn needs a configured key and its own observation.

## Verify and retain

```sh
npm run check
make check
npm --prefix site run check   # website changes
```

`make check` requires Bend and runs the core compiler and independent benchmark. Record the exact candidate revision, source/evaluator/case digests, per-case failures, toolchain, check/build/runtime times, and prediction discrepancies. Selected findings carry evidence and limits; raw private transcripts are not public artifacts. The historical workflow-transfer evaluator remains available for its own original comparison, not as a DSH score.

`scripts/agit.py` rejects old job lifecycle operations. Do not revive its Git branch/note/tag workflow. Old Meta shell and Mundus host records are retained in revision history; this cleanup does not stop installed services or delete their private state.

## Review and publication

The integration owner combines checked `jj` changes, resolves conflicts, and verifies the exact resulting revision. Publish only an authorized bookmark. GitHub's current checks and exact-head review requirements remain in [AUTO_MERGE.md](docs/AUTO_MERGE.md). A passing algorithm benchmark is not a human acceptance or external publication.

The governing execution policy is [AUTONOMY.md](runtime/AUTONOMY.md). Read [forum/WRITING.md](forum/WRITING.md) before preparing company artifacts.
