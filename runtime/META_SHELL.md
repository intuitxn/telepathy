# Resident meta shell

`runtime/meta_shell.py` provides one local resident service for terminal input,
queued tasks, native ACP execution, and the kernel MCP interface. Its
Python dependencies are declared in the file and resolved by `uv`; ordinary
`python3` without those dependencies is insufficient.

```text
terminal / local MCP client
             |
      resident meta shell
      task queue + session routing
          /             \
 OpenCode or Codex ACP  Bend snapshots
 agent in one workspace one lineage per task
```

The default OpenCode backend loads its existing configuration and selects the
installed `meta` agent using ACP session mode. The optional `codex-acp` backend
uses the local Codex login, an explicitly selected Codex model, and `agent`
session mode. Both connect to the node's authenticated MCP endpoint. The harness
includes its installed `meta` charter in Codex's task prompt, along with the
node's Bend packet and operator request. The service does not start an
OpenCode HTTP server. No relay is connected by this service yet; `status`
reports that limitation.

## Terminal use

The installed launcher is `~/.local/bin/meta`; it uses the dedicated interpreter
at `~/.local/share/intuitxn-meta/venv/bin/python`, with `mcp==1.27.0` and
`agent-client-protocol==0.9.0`. Ensure `~/.local/bin` is on your shell's PATH.
Without that launcher, define a function in the current shell, adjusting the
checkout path if necessary:

```sh
meta() {
  uv run --script /Users/a3fckx/Desktop/Attri/telepathy/runtime/meta_shell.py "$@"
}

meta start
meta status
meta shell --project "$PWD" --conversation local:default
```

`meta` without a subcommand opens the shell. `start`, `shell`, and `submit`
start the node if needed. The shell accepts natural-language tasks and
`/status`, `/tasks`, `/task ID`, `/new`, and `/exit`. Ctrl-C detaches from a
waiting task; closing the terminal does not stop the resident node.

```sh
meta submit 'Inspect this project and report its test command; make no changes.' \
  --project "$PWD" \
  --acceptance 'Name the command and the file establishing it.' \
  --conversation inspection --request-id inspection-001 --wait

meta list
meta task TASK_ID
meta wait TASK_ID
meta kernel TASK_ID history
meta kernel TASK_ID packet
meta kernel TASK_ID memory
meta stop
```

Replace `TASK_ID` with the returned ID. Reusing a request ID with identical
input returns the existing task; conflicting input is rejected. `reported`
means an agent result was recorded, not independent acceptance or learned
memory. `submit --wait` and `wait` exit unsuccessfully for a terminal task
status other than `reported`.

Global options precede the subcommand: `--state`, `--source`, `--port`,
`--bend`, `--acp-agent`, and optional `--model`.
Defaults use the current checkout's `runtime/worker/system.bend`, port `47831`,
and the configured OpenCode model. Select absolute executable paths when
managing multiple agent installations. For Codex, point `--acp-agent` at an
installed `codex-acp` executable and set `--model` to a model your local login
can actually use; a listed model is not proof of access. An existing service
must be invoked with its configured settings; these flags do not reconfigure
it in place.

## Ownership, context, and recovery

The node executes one task at a time. Native agent delegation remains available
inside the selected ACP worker, but a running task must not wait for another task queued on
this node. The node owns all mutations to its private Bend snapshots.

At startup, the node pins the Bend source by SHA-256 and requires its checker
to return `All terms check.`. Each task records its pinned source and receives
a separate immutable snapshot lineage. Mutations are serialized, and the
current snapshot pointer advances only after the output can be inspected.
This avoids growing one node-wide history past Bend's bounded record limit.

The agent receives the Bend packet, full operator request, and acceptance
criteria. For projects outside jj, subsequent tasks using the same conversation label
and project load the saved ACP session. Managed jj tasks use a fresh ACP
session in their isolated workspace, with selected preceding task context
provided explicitly. Identical conversation labels in different projects
remain separate. `/new` chooses a fresh conversation; it does not erase old
state. Codex and OpenCode session keys are separate, so switching backends
does not try to load an incompatible session or delete the earlier context.

Queued work survives restart. Work that was running when the node stopped is
marked `interrupted` and is not automatically replayed. Inspect its task and
evidence before explicitly submitting a replacement: external actions may
already have happened. Unresolved ACP permission requests are denied and
recorded, and the task fails without widening permissions. The selected ACP
worker's sandbox and tool permissions continue to apply.

## Local MCP interface

The authenticated Streamable HTTP endpoint is
`http://127.0.0.1:47831/mcp`. It shares the resident service with the terminal
API. Its tools are:

- `meta_status`: node readiness, kernel revision, and task counts.
- `meta_submit`: enqueue authorized work without waiting.
- `meta_task`: inspect a task and its reported result or failure.
- `meta_kernel`: inspect a task's history, memory, or packet.
- `meta_workspace`: inspect a task's jj workspace and recorded revision.
- `meta_diff`: read the recorded patch against the task's pinned base.

```sh
meta mcp-config
```

This prints an OpenCode MCP configuration entry using a file reference for the
bearer token. Merge the entry into an existing `mcp` object when connecting
another local OpenCode instance; do not overwrite unrelated configuration.
The node supplies this connection to its own ACP worker automatically. Its
listener binds loopback and rejects missing authentication and browser Origin
headers. This does not isolate the executing agent from the user's filesystem.

## Private state and macOS service

Default state is `~/.local/state/intuitxn-meta/`:

| Path | Purpose |
| --- | --- |
| `node.sqlite3` and SQLite sidecars | Tasks, conversation routing, current snapshot references |
| `token` | Local bearer credential; do not copy into shared configuration |
| `node.lock` | Exclusive local state owner |
| `kernels/` | Source pinned by digest |
| `kernel-check.txt` | Startup checker output |
| `tasks/` | Immutable snapshots and private ACP event/stderr evidence |
| `node.log` | Service output and startup errors |

State directories use private permissions. Keep these files out of repositories
and published artifacts; event logs contain session and task content.

```sh
meta install
meta status
```

`install` creates and loads
`~/Library/LaunchAgents/space.intuitxn.meta.plist` for the logged-in macOS user.
It refuses to overwrite a differing service definition. Installation transfers
an existing idle standalone node to launchd; active or queued work must finish
first. The service starts at login and is configured to restart after an
unsuccessful exit. `meta stop` unloads the matching LaunchAgent so it stays
stopped; `meta start` loads it again. For a standalone node, stop requests
shutdown and waits for it to finish.

To uninstall the login service while preserving all task state:

```sh
launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/space.intuitxn.meta.plist"
mv "$HOME/Library/LaunchAgents/space.intuitxn.meta.plist" \
   "$HOME/Library/LaunchAgents/space.intuitxn.meta.plist.disabled"
```

Leave the private state directory intact for inspection and recovery. Removing
the login service does not remove any separately installed terminal launcher.

## Managed jj task workspaces

Telepathy now uses a colocated jj/Git repository at
`/Users/a3fckx/Desktop/Attri/telepathy`. Git remains the storage and remote
publication format; local changes and workspaces are managed with jj.

When the submitted project is inside a jj workspace, the node requires its
current working change to be empty and selects its single parent as the fixed
baseline. Dirty source files are preserved and the task fails with an actionable
message; the node never silently stashes or commits the operator's changes.
The node creates `meta-TASK_ID` under its private `workspaces/` directory and
executes the agent there. Native subagents work within that task's ownership
boundaries; independent tasks get independent workspaces.

After execution, the node snapshots the result, checks ancestry and conflicts,
records `meta/task/TASK_ID`, and starts an empty child change so subsequent edits
cannot silently amend the recorded candidate. A reported candidate is not
automatically integrated. Inspect it with:

```sh
meta workspace TASK_ID
meta diff TASK_ID
```

After reviewing and checking the exact result, integrate it with the two full
revision IDs returned by `meta workspace`:

```sh
meta integrate TASK_ID --base-commit BASE_ID --result-commit RESULT_ID
meta retire TASK_ID
```

Integration is a local fast-forward only. It refuses dirty canonical files,
changed candidate contents, conflicts, or a main bookmark that has moved away
from the reviewed base. It does not push to a remote. A stale candidate needs a
new integration/review cycle; no rebase is silently treated as already verified.

Retirement snapshots any later edits to a separate recovery bookmark, forgets
the jj workspace registration, and moves its entire directory to private
`retired/TASK_ID` storage. Ignored files are retained too. Failed or interrupted
workspaces remain available for inspection and are never automatically replayed.

The MCP interface additionally exposes read-only `meta_workspace` and
`meta_diff`. Integration and retirement are explicit terminal/API actions.
