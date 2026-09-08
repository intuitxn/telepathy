# Shared workspace service

Python standard-library HTTP service with SQLite persistence. Run behind the loopback Cloudflare tunnel; the exact configured external Host and mutation Origin are required.

```sh
python3 runtime/workspace/server.py init
python3 runtime/workspace/server.py serve --public-url https://telepathy.intuitxn.com
python3 runtime/workspace/server.py status
python3 -m unittest discover -s runtime/workspace -v
```

The default database and initial one-use invitations are under `~/.local/share/telepathy-workspace/`, mode 0600. Initialization creates Shubham, Om, and Kush, with no synthetic discussion. Initial invitation codes are in the private `invites.json`, never console output. Cookies are HttpOnly, SameSite Strict, Secure on HTTPS, expire after 30 days; one-use invitations expire after seven days. Shubham can issue replacement teammate invitations from People. Local operator recovery: `invite --person shubham --invites /private/new-file.json`. Tokens are bearer credentials: send personal invitations privately.

`/api/config`, `/api/health`, `/api/me`, `/api/login`, `/api/logout` support app boot and sessions. `/api/workspace` returns people, latest 200 posts (up to 200 replies each), latest 100 artifacts and lessons. Other resources remain persisted; pagination is not yet exposed. Each write derives its actor from the session, ignoring caller identity fields. Shared team membership grants read access to all private discussions and drafts.

Posts support update, decision, question and announcement; updates need no title. Replies remain attached to their thread; acknowledgements toggle and cannot target one's own post. Only thread authors can resolve their thread. Source selection for a draft or lesson requires 1–30 existing post/reply IDs. Post creation currently has no idempotency key, so retrying after an uncertain network failure can duplicate an operation.

Only artifact owners edit/design/publish/withdraw their artifacts. Saves require the current integer revision. Publish requires the canonical JSON title/body digest and a stable slug. Public pages expose the explicit published title and body, publication revision and human publisher name, plus generic PNG metadata; source IDs, private messages, lessons and receipts are not public. Draft edits never alter the public snapshot; withdrawal returns 404. Markdown rendering supports escaped paragraphs, headings, basic inline emphasis/code and HTTP(S) links, with no raw HTML. A rich link card still depends on the sharing client's support.

The explicit Design action invokes the real Nudge `artifact-design` program with the saved draft. A failed run or revision conflict preserves the existing draft. All generated drafts require human review and explicit publication.

Learning has two paths: informational practice notes accepted by their authors, and artifact-design program proposals. Program proposals run the Nudge learning proposer, preserve the complete candidate source, and validate frozen program structure plus the current parent digest. Only Shubham may activate a global program change. Acceptance records the authenticated reviewer and exact candidate digest durably before changing the private runtime pointer. Interruption after activation is recoverable: retry inspects the active digest, and startup reconciles pending approved records whose candidate is already active. A pending approval with a different active digest remains pending and fails safely on stale-parent validation. Acceptance means the reviewed program is active, not that an evaluation established improvement.

`TELEPATHY_PROGRAM_PYTHON` selects the existing Nudge interpreter; `TELEPATHY_PROGRAM_STATE_ROOT` optionally selects the private active-program store. No Buzz relay credentials are exposed to the browser; current workspace identity is invite/session identity, not Buzz signature verification. This service is a first-party team backend, not yet a federated multi-node workspace or a general-purpose OS program scheduler.
