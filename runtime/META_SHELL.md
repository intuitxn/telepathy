# Resident meta shell

`runtime/meta_shell.py` provides one local resident service for terminal input,
queued tasks, native OpenCode ACP execution, and the kernel MCP interface. Its
Python dependencies are declared in the file and resolved by `uv`; ordinary
`python3` without those dependencies is insufficient.

```text
terminal / local MCP client
             |
      resident meta shell
      task queue + session routing
          /             \
 OpenCode ACP          Bend snapshots
 installed meta agent  one lineage per task
```

The service loads the existing OpenCode configuration, selects the installed
`meta` agent using ACP session mode, and adds its local MCP connection. It does
not replace the global meta charter, `/meta` command, skills, or Telepathy
plugin. It does not start another OpenCode HTTP server. No relay is connected
by this service yet; `status` reports that limitation.

## Terminal use

The installed launcher is `~/.local/bin/meta`; it uses the dedicated interpreter
at `~/.local/share/intuitxn-meta/venv/bin/python`, with `mcp==1.27.0` and
`agent-client-protocol==0.9.0`. Ensure `~/.local/bin` is on your shell's PATH.
Without that launcher, define a function in the current shell, adjusting the
checkout path if necessary:

```sh
meta() {
  uv run --script /Users/a3fckx/Desktop/Attri/telepathy-meta/runtime/meta_shell.py "$@"
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
`--bend`, `--opencode`, and optional `--model`. Defaults use the current
checkout's `runtime/worker/system.bend`, port `47831`, and the configured
OpenCode model. Select absolute executable paths when managing multiple
OpenCode or Bend installations. An existing service must be invoked with its
configured settings; these flags do not reconfigure it in place.

## Ownership, context, and recovery

The node executes one task at a time. Native agent delegation remains available
inside OpenCode, but a running task must not wait for another task queued on
this node. The node owns all mutations to its private Bend snapshots.

At startup, the node pins the Bend source by SHA-256 and requires its checker
to return `All terms check.`. Each task records its pinned source and receives
a separate immutable snapshot lineage. Mutations are serialized, and the
current snapshot pointer advances only after the output can be inspected.
This avoids growing one node-wide history past Bend's bounded record limit.

The agent receives the Bend packet, full operator request, and acceptance
criteria. Subsequent tasks using the same conversation label and project load
the saved ACP session. Identical conversation labels in different projects
remain separate. `/new` chooses a fresh conversation; it does not erase old
state.

Queued work survives restart. Work that was running when the node stopped is
marked `interrupted` and is not automatically replayed. Inspect its task and
evidence before explicitly submitting a replacement: external actions may
already have happened. Unresolved ACP permission requests are denied and
recorded, and the task fails without widening permissions. Existing OpenCode
tool permissions continue to apply.

## Local MCP interface

The authenticated Streamable HTTP endpoint is
`http://127.0.0.1:47831/mcp`. It shares the resident service with the terminal
API. Its tools are:

- `meta_status`: node readiness, kernel revision, and task counts.
- `meta_submit`: enqueue authorized work without waiting.
- `meta_task`: inspect a task and its reported result or failure.
- `meta_kernel`: inspect a task's history, memory, or packet.

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
unsuccessful exit. `meta stop` requests shutdown; unloading the LaunchAgent is
the explicit way to stop launchd management.

To uninstall the login service while preserving all task state:

```sh
launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/space.intuitxn.meta.plist"
mv "$HOME/Library/LaunchAgents/space.intuitxn.meta.plist" \
   "$HOME/Library/LaunchAgents/space.intuitxn.meta.plist.disabled"
```

Leave the private state directory intact for inspection and recovery. Removing
the login service does not remove any separately installed terminal launcher.
