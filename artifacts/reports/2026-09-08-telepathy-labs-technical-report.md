# Telepathy and Intuitxn Labs: what we have built

Technical report · 8 September 2026

Prepared by Codex and shared at Shubham's request. Verification refers to the September 8 implementation and live checks; it is not a claim of production readiness.

## Product and current release

We have built the foundations of a team workspace that turns human discussion into reviewed agent work. A person supplies a request and acceptance criteria, an agent prepares a candidate in a separate working directory, evidence returns to the discussion, and an authorized human accepts the outcome.

Two usable surfaces exist today:

- **Buzz + Desk + the local node:** the operational shared-work loop. Buzz holds team discussion and identity; Desk persists jobs and coordinates execution; OpenCode and Codex perform the work.
- **Telepathy web alpha:** the intended human communication interface. It supports updates, decisions, questions, announcements, replies, acknowledgements and resolutions, with browser-local persistence.

These surfaces are not connected end to end through the web UI yet. Posting in the alpha does not publish to Buzz or create a Desk job. Labs is the runtime status and distribution surface, rather than the finished team workspace.

## Architecture

```text
Authorized person in a Buzz project thread
  -> explicit /intuitxn request + acceptance criteria
  -> Desk intake and persistent job ledger
  -> repository allowlist + separate Git worktree
  -> OpenCode fork or Codex execution
  -> candidate and verification returned to the thread
  -> human acceptance
  -> configured commit/push and outcome receipt

Telepathy web alpha -> browser-local workspace data
Labs -> runtime status, manifest and Mac installer distribution
```

**Buzz is the shared context layer.** Channels, profiles, project metadata, notes and threaded messages provide team context. Normal conversation does not implicitly start a job: intake checks the authorized sender and the explicit request format.

**Desk is the execution coordinator.** It maintains durable job state, imports requests, creates worktrees, runs the selected runtime, captures candidate changes and verification, and handles acceptance. Outgoing messages use a persisted outbox and exact-content digest; uncertain delivery is retained rather than blindly resent. The installed watcher is configured to poll and execute eligible requests automatically. Human acceptance remains a separate action and can commit and push the candidate to configured remotes.

**The resident node is the local execution service.** The OpenCode 2 fork runs in a profile with separate configuration, data, cache and state. Plugins expose runtime execution, routing, relay reads and drafts, navigation and other local capabilities. Codex is an additional execution adapter. LaunchAgents restart the services after login and on process failure; this does not establish pre-unlock availability.

**Labs distributes the runtime.** The public page, team manifest and Apple Silicon Mac installer are served through the host's tunnel. Serving an installer is distinct from validating installation and recovery on a fresh teammate machine.

## What changed in this delivery

### One network setting

A2A milestone M2 introduces `INTUITXN_NETWORK`. Resolution order is:

1. `INTUITXN_NETWORK`;
2. legacy `BUZZ_RELAY_URL`;
3. the Intuitxn relay default.

Node and task launchers load a common shell helper. It exports the Buzz CLI alias and derives `ws://` or `wss://` from the HTTP(S) base URL. The node LaunchAgent persists the canonical setting; Desk and both Buzz adapters honor its precedence. The third-party Buzz CLI still reads its original variable, so direct shell use requires sourcing the helper. Identity configuration remains separate.

### Theme foundation without a redesign

UX milestone M1 moves the existing visual tokens into `tokens.css`, adds spacing, typography, radius, motion and semantic colors, and defines accent families for Telepathy, Sansara, Iktara and Nudge. `setEnvTheme` supplies the program selection, with Telepathy as the default. Reduced-motion preferences are respected.

The existing alpha remains visually unchanged. This ships theme infrastructure; it does not yet ship the environment Markdown compiler, generated app shells, intent cues or cross-program applications.

### Runtime and usage fixes verified

- Labs loads, and its manifest and installer download successfully. The canonical installer path is `/join/oc2-join.sh`; the root path now has a compatibility copy.
- The node completed an OpenCode model call and invoked Codex successfully through its runtime tool. The Codex response was `CODEX_NODE_OK`, with exit code 0.
- The watcher runs from the main checkout and polls cleanly. The earlier OpenCode file-writing smoke result was inspected and matched its expected content.
- GitHub and Buzz mirrors contain the new commits. The recreated changelog channel and its three members were verified, as were the seven refreshed knowledge-base notes.
- The Labs request example now uses the supported Desk runtime name `opencode`. `opencode-sandbox` belongs to the node adapter interface and was rejected by Desk intake.

## Verification and evidence

The delivery passed 26 existing tests across Desk, the plugin and the site, plus network configuration checks for defaults, legacy fallback, precedence, WebSocket derivation and invalid schemes. Site type checking and production build passed. GitHub Pages build and deployment succeeded.

Browser checks confirmed posting and refresh persistence. Light and dark renderings were compared with the prior live alpha across element geometry, colors, backgrounds, fonts, borders, padding and margins; both comparisons matched. The deployed public page was then checked for the new theme tokens and default environment attribute.

Sources:

- [Telepathy implementation: 05b73db](https://github.com/intuitxn/telepathy/commit/05b73db541a80aa1a6525182b7c337b8ed971a7e)
- [Runtime implementation: 038432954](https://github.com/intuitxn/oc2/commit/038432954a23da65780073b1c431c452b87c1a4b)
- [Successful Pages workflow](https://github.com/intuitxn/telepathy/actions/runs/34216042808)
- [Desk execution and acceptance implementation](https://github.com/intuitxn/telepathy/blob/05b73db541a80aa1a6525182b7c337b8ed971a7e/runtime/desk/src/jobs.js)
- [Product contract](https://github.com/intuitxn/telepathy/blob/05b73db541a80aa1a6525182b7c337b8ed971a7e/PRODUCT.md)

## Boundaries that matter

**Shared web product:** authentication, shared server-side persistence, cross-device synchronization and production notifications are still missing from the alpha. Its identity selector is a demo control.

**Isolation:** a separate Git worktree is not an OS security boundary. Desk's OpenCode path does not automatically apply macOS seatbelt. The gateway and explicit sandbox entry apply seatbelt. The running host also inherits a Buzz identity, contrary to the design's no-signing-key assertion; network unification did not implement credential isolation. No credential values are included in this report.

**Distribution:** fresh-Mac installation and automatic-update recovery remain unverified. The network change is active on the current host and available in source; this delivery does not certify a refreshed installer bundle on teammate machines.

**A2A:** a designed topology is not a running multi-node network. Peer directory, signed ACP bridges and cross-node delegation remain future milestones. The same applies to the environment DSL and its app renderer.

## How the team can use it now

Open [Telepathy](https://intuitxn.github.io/telepathy/) to try the communication interface. Select **Add to Now**, write an update or question, reply, acknowledge, or resolve. Activity remains in that browser.

For real shared work, use the relevant project channel in Buzz. An authorized member can submit:

```text
/intuitxn {"repository":0,"request":"Describe the exact change","acceptance":"Describe the check that proves it works","runtime":"opencode"}
```

Confirm the repository number against the host's configured allowlist before submitting. `codex` is the other supported Desk runtime. Inspect the candidate and evidence, then reply `accept` in its source thread only when ready to land the change.

Use [Labs](https://labs.intuitxn.com/) to inspect the runtime and distribution entry points. New-machine onboarding should be treated as a validation task, not assumed complete.

## Recommended next product milestone

Connect the human workspace to authenticated shared Buzz/Desk data, then verify one complete journey: an admitted teammate submits a scoped request, sees a candidate in context, reviews evidence, accepts it, and another teammate sees the same outcome. That would make the existing working parts a single shared product. Fresh-machine recovery and credential boundaries should be validated alongside that work. This is a recommendation, not a claim that those milestones have been started.
