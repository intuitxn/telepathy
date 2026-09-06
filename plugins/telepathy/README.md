# Telepathy plugin for OpenCode v2

Pinned to OpenCode beta 19192. Run `npm ci && npm run setup` at the repository root. The root `index.ts` is the directory entrypoint used by the installed v2 loader; it re-exports the compiled implementation.

The plugin registers 11 tools:

- `telepathy_channels`: read available Buzz channels.
- `telepathy_post`, `telepathy_reply`, `telepathy_acknowledge`, `telepathy_resolve`, `telepathy_artifact`: prepare drafts locally, even without credentials. `draft:false` does not publish through these tools.
- The corresponding `_send` tools publish the reviewed action through the `telepathy_publish` permission. The v2 permission hook requires a human decision; explicit configured denials remain final.

Drafting and publishing are separate. Actual Buzz signing identity stays attributable to the configured agent; human ownership or approval is not a claim that the person signed the event.

Publication shells out to the Buzz CLI. Inject credentials in the service environment. Successful writes require the relay's `accepted:true` response. The Desk CLI adds durable outbox receipts and prevents automatic retries; direct plugin sends are interactive and do not have the Desk outbox's deduplication contract.

`npm run check` at the root checks types and runs the local behavior tests. See [setup](../../BUZZ_SETUP.md) for forum publishing, artifact review and job execution.
