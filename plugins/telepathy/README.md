# Telepathy plugin for OpenCode v2

Historical optional source, retired from the active workspace. Standard OpenCode
and native Buzz replace this integration; see [setup](../../BUZZ_SETUP.md).
The root install, setup and checks no longer load, build or test this plugin.
The behavior below describes the old beta 19192 implementation only.

The plugin registers 11 tools:

- `telepathy_channels`: read available Buzz channels.
- `telepathy_post`, `telepathy_reply`, `telepathy_acknowledge`, `telepathy_resolve`, `telepathy_artifact`: prepare drafts locally, even without credentials. `draft:false` does not publish through these tools.
- The corresponding `_send` tools publish the reviewed action through the `telepathy_publish` permission. The v2 permission hook requires a human decision; explicit configured denials remain final.

Drafting and publishing are separate. Actual Buzz signing identity stays attributable to the configured agent; human ownership or approval is not a claim that the person signed the event.

Publication shells out to the Buzz CLI. Inject credentials in the service environment. Successful writes require the relay's `accepted:true` response. The Desk CLI adds durable outbox receipts and prevents automatic retries; direct plugin sends are interactive and do not have the Desk outbox's deduplication contract.

The old package retains its own scripts for historical reproduction; it is not
compatible with the current setup by implication.
