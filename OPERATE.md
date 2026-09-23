# Telepathy — operate

Use the canonical checkout at `/Users/a3fckx/Desktop/Attri/telepathy` or an owned
jj workspace based on its current integration revision. Local code ownership
uses jj; runtime task ownership uses the resident meta shell and Bend. GitHub
remains the publication/review destination.

## Inspect and isolate work

```sh
jj status
jj log -r '@ | @-'
```

Follow [docs/WORKTREE_LIFECYCLE.md](docs/WORKTREE_LIFECYCLE.md) and
[docs/CONCURRENCY.md](docs/CONCURRENCY.md). Use a separate jj workspace for an
independent writer. Do not use Git worktree, checkout, stash, reset, clean, or
merge for the local lifecycle. Existing pre-migration work remains preserved
until its owners coordinate migration.

## Run the meta shell

```sh
meta status
meta shell --project "$PWD"
meta submit 'Describe the requested task here' --project "$PWD" --wait
meta list
meta task TASK_ID
```

See [runtime/META_SHELL.md](runtime/META_SHELL.md) for installation, private
state, MCP, conversation recovery, and interruption behavior. The shell uses
the installed OpenCode meta agent. Results are attributed reports; a completed
agent turn is not independent verification. Relay status must be inspected;
do not infer a network connection from a live local service.

For direct Bend operations:

```sh
./mundus help
BEND_NO_TELEMETRY=1 "$HOME/.bend/bin/bend" version
BEND_NO_TELEMETRY=1 "$HOME/.bend/bin/bend" runtime/worker/system.bend --check-only
```

Require exit zero and `All terms check.`. Use the worker protocol documented in
[runtime/adaptive/META.md](runtime/adaptive/META.md), with one writer and a new
snapshot output at every transition. Do not mutate node-owned snapshots from
another process.

## Verify and retain

```sh
npm run check
# Stronger local gate, including all required kernels:
make check
# Website changes have a separate gate:
npm --prefix site run check
```

Run checks relevant to the change, record their results and exact candidate
revision, and preserve failures. Select reusable findings explicitly; raw
transcripts and private task metadata are not published artifacts. Native Buzz
memory remains agent-owner scoped; follow [runtime/worker/BUZZ.md](runtime/worker/BUZZ.md).

`scripts/agit.py` is retired and rejects old job lifecycle operations. Do not
use its historical Git branch/note/tag workflow for new tasks. Its old records
remain evidence, and its source is retained in repository history.

## Recover and publish

```sh
./mundus guard check
./mundus guard snapshot
jj op log
```

Recovery snapshots and tags are private local evidence, not automatic
remote backups. Inspect recovery operations before applying them. The
integration owner combines checked changes and resolves conflicts, then
publishes only the authorized bookmark through `jj git push`. GitHub checks
and exact-revision reviews still apply where configured; local jj commands do
not claim human acceptance or authorize external communication.

The governing execution policy is [runtime/AUTONOMY.md](runtime/AUTONOMY.md).
Complete authorized work, distinguish verification from acceptance, and report
actual results and limitations. Read `forum/WRITING.md` before company artifacts.
