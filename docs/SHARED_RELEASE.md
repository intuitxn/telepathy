# Shared Telepathy release — 2026-09-08

Telepathy is now a first-party team workspace that turns selected conversation into reviewed, shareable pages. Its artifact and learning operations are typed Markdown programs compiled with Nudge and executed through the existing OpenCode fork.

## Use

Open https://telepathy.intuitxn.com with a personal invitation. Shubham can create personal invitations for Om and Kush in People. Invitations are private one-use credentials; never post them to a public page or shared channel.

Start a thread, collect replies, select relevant messages, and choose Create page. Save the draft, optionally choose Design draft with Nudge, inspect Preview saved page, then review and publish the exact saved content. Copy the public `/p/<slug>` link into Buzz. Updating preserves its URL; Unpublish withdraws it. Public readers need no account. Private discussions, drafts, source identifiers and learning receipts are not included in public pages. Metadata supports link previews, but Buzz's visible rich-card rendering has not been established.

In Learning, record feedback tied to actual source material and request a program proposal. Review its complete source and exact digest. Only Shubham can activate a global program change. Acceptance is not evidence that quality improved; comparative evaluation remains future work.

## Program boundary

`programs/*.nudge.md` declares artifact-design, lesson-proposal and lesson-review. Canonical Nudge compilation yields immutable PromptBundles; the host binds inputs and validates results. `telepathy-program list`, `telepathy-program compile artifact-design`, and `telepathy-program run artifact-design --input -` expose the catalog as an OS command. OpenCode exposes `programs_list`, `programs_compile`, and `programs_run` with no publication or approval authority.

The host owns processes, SQLite persistence, sessions, publication, review and active-version pointers. Nudge remains a typed transaction compiler. This release does not turn arbitrary Markdown into arbitrary OS applications or add a new scheduler. Network configuration uses `INTUITXN_NETWORK`; federated A2A execution, Buzz signature login, and automatic Buzz-to-workspace conversation ingestion are not implemented.

## Validation

Seven backend tests cover independent sessions, identity attribution, private/public separation, exact revision publication, withdrawal, invitation controls and recoverable activation. Twelve program tests cover compiler determinism, typed I/O, frozen-source candidate validation, exact-digest activation and private source-reference rejection. Browser verification used separate Shubham and Om sessions on a disposable database, persistence across server restart, source selection, actual model design, preview, publication and withdrawal. Withdrawn URL returned HTTP 404.

The first model design test exposed a source-ID leak; both the program instruction and host output acceptance now reject it. A corrected live OpenCode run passed; one malformed-JSON run failed safely. Full evidence, model identifier and digests are in `runtime/programs/LIVE_RUN.md`. No production learning proposal was automatically promoted.

## Operations

Build with `npm --prefix site run build`, then run `python3 scripts/workspace-service.py install`. Installation creates a content-addressed runtime snapshot outside Desktop and a user LaunchAgent, binding loopback port 4110 behind the existing Cloudflare tunnel. `python3 scripts/workspace-service.py status` verifies the backend. State and initial invitation file live under `~/.local/share/telepathy-workspace` with private permissions. The service starts in the logged-in user launchd domain; pre-login startup is not asserted.

The existing GitHub Pages alpha remains the separate browser-local demo. Labs and its earlier technical report remain independently available. The shared service is owned by this repository and runs without the unrelated Docker deployment stack.

Current limits include bounded workspace retrieval without pagination, no write idempotency key for uncertain network retries, basic safe Markdown rendering, single-host persistence, and no measured self-improvement claim.
