# Local OpenCode mailbox plugin

Versioned repair of the existing `~/.config/opencode/plugins/telepathy.ts` mailbox
plugin, separate from the retired Telepathy beta adapter. It adds no server,
model adapter, Buzz publisher, or memory-learning process.

Session IDs remain the registry keys and mailbox filenames. Display names now
include the full ID. Session events record title, workspace, host, hostname and
lifecycle state. Native OpenCode event/message/tool metadata supplies the role;
created/updated events can supplement missing metadata through native
`client.session.get` (bounded to 1.5 seconds). The installed SDK 1.3.13 Session
type guarantees title/directory but has no `agent` field: role enrichment from
that response is best-effort, while message/tool input remains necessary. If
unavailable, role remains `unknown`. Titles are not interpreted as roles.
Message IDs never become peers.

Address an exact session ID where possible. A role, old display name or prefix
must identify exactly one undeleted peer; ambiguity fails before any delivery.
`all`, `*`, `broadcast`, and the dedicated broadcast tool are explicit broadcasts.
Recent activity is not proof that a process is alive. A deleted session stays
deleted even if a delayed event arrives.

Registry updates use an atomic directory lock and atomic file replacement.
Concurrent upgraded processes preserve each other's updates. Existing peers,
extension fields, mailbox files and cursors are retained; names and metadata
refresh when their session is next observed. Malformed registry JSON is not reset.
This does not authenticate local writers or migrate existing data to Buzz memory.

A crashed writer can leave `.peers.lock`. After five seconds another update fails
closed; inspect the writer before removing an abandoned lock. Old running plugin
instances do not honor the new lock. Cross-process protection applies only after
all writers use this version; installing the file alone does not upgrade running
sessions. Do not kill active sessions to force adoption.

## Validate and install

From this directory, `bun install` then `bun test`. The dependency version matches
the installed plugin package used for verification. Tests use temporary stores,
including three child Bun processes, and never touch the default registry.

Installation is a separate operator step: compare the current installed file hash,
back up that file, then replace it atomically. Preserve the store. Capture the
current hash immediately before replacement because another session may edit it.
The initial source snapshot SHA-256 was:

```
89c10715b2e4ac0f073686c443a00b251ee7fb876eb8b9d90a894ded2cfb0724
```

Validation here covers registry identity, state, delivery routing, and concurrent
upserts. Existing inbox cursor/automatic-injection behavior is retained; this is
not an exactly-once delivery protocol or evidence of durable learning.
