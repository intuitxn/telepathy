# Telepathy and Labs: current product and use

Verified on 2026-09-08. This is an engineering status and usage guide, not a team announcement.

Telepathy is a team workspace for turning discussion into reviewed work. People share updates, decisions and questions; an explicit request can become a job; a local agent prepares a candidate; a human accepts the outcome. Labs distributes and runs the local agent infrastructure.

## What is live

- https://intuitxn.github.io/telepathy/ — the human-facing alpha. Now, composer, replies, acknowledgements, resolutions, People and Interfaces render. Activity stays in one browser; identity switching is a demo, not authentication. It is not connected to the shared Buzz feed or Desk jobs.
- https://labs.intuitxn.com/ — the runtime status and distribution page. The page, `team.json` and `/join/oc2-join.sh` respond successfully. `/oc2-join.sh` is now also generated as a compatibility alias.
- This Mac's authenticated node on port 4096 and gateway on port 4099 are healthy. The resident node completed a real OpenCode model call and called Codex, which returned `CODEX_NODE_OK` with exit 0.
- The Desk watcher runs from the main Telepathy checkout and polls cleanly. Its ledger contains 7 resolved jobs, 2 historical needs_attention jobs and 1 uncertain outbox delivery. The earlier OpenCode smoke job's `world.txt` contains `hello world`.
- The recreated changelog channel exists, has the owner and two other members, and contains the reported September 8 entry. GitHub and Buzz remote heads matched the local repositories before this change.

## Two foundation milestones

A2A M2 adds `INTUITXN_NETWORK`: canonical URL first, legacy `BUZZ_RELAY_URL` second, Intuitxn's relay as default. Node and agent launchers export the CLI alias and derive the WebSocket scheme. The node LaunchAgent persists the canonical URL. Desk and both Buzz adapters honor the same precedence. Signing-key handling is unchanged.

UX M1 extracts `tokens.css`, adds all specified color, spacing, type, radius and motion tokens, adds four program accent families and `setEnvTheme`, sets `data-env=telepathy` by default, and respects reduced motion. The DSL compiler and app renderer remain later milestones. Light/dark appearance was compared against the live alpha using every element's layout, color, background, font, border, padding and margin; both comparisons matched.

## Use the alpha

Open the Telepathy URL. Choose a demo identity, select **Add to Now**, and write an update or question. Open a reply, acknowledge another person's post, or resolve a question. Refresh to check local persistence. Use Buzz for real shared team discussion today; an alpha post is not delivered to teammates.

## Use real team jobs

In Buzz Desktop, use the Intuitxn relay and the program's channel. An admitted, authorized human can submit:

```text
/intuitxn {"repository":0,"request":"Describe the exact change","acceptance":"Describe the check that proves it works","runtime":"opencode"}
```

The repository number indexes this host's configured allowlist; confirm it refers to the intended project. `codex` is the other supported Desk runtime. `opencode-sandbox` is a node adapter, not a Desk intake runtime. The watcher only executes automatically when `autoRun` is enabled. Inspect the returned candidate and verification, then reply `accept` in the source thread when you intend to land it. This acceptance can commit and push to the configured remotes.

For local operator work:

```sh
cd ~/Desktop/Attri/telepathy
npm run desk -- list
npm run desk -- show job <full-job-id>
npm run desk -- run <unique-job-prefix>
```

For a direct task through the resident node:

```sh
sh ~/opencode2/script/oc2-node.sh status
sh ~/opencode2/script/oc2-agent.sh 'Reply exactly OK; do not change files' --node
```

For a shell using one network setting (Buzz identity must already be configured):

```sh
export INTUITXN_NETWORK=https://intuitxn.communities.buzz.xyz
. ~/opencode2/script/oc2-network.sh
buzz channels list
```

The Buzz binary itself reads `BUZZ_RELAY_URL`; sourcing the helper sets that compatibility alias. Merely exporting `INTUITXN_NETWORK` cannot change an unmodified third-party CLI.

## Honest limits from the audit

- The running node has an inherited Buzz signing identity. Its channel-list tool succeeds, but the design's claim that the node holds no signing key is not true on this host. A clean process without an identity fails channel listing. M2 changes URL selection, not credential isolation.
- Desk's OpenCode path runs the fork in a separate Git worktree; it does not automatically apply macOS seatbelt. The gateway and explicit `oc2-agent.sh --sandbox` path apply seatbelt. The Labs example and isolation description were corrected accordingly.
- Historical resolved job records may retain old error text. The current run code clears stale errors for new attempts; old records were preserved.
- The Apple Silicon Mac installer is served, but a fresh-machine installation and automatic-update recovery were not validated in this audit. Its existence is not proof of teammate onboarding.
- The public Pages alpha is live independently of the Mac Docker deployment. A2A peer discovery, signed ACP bridges, cross-node delegation, the environment DSL and shared authenticated web persistence are not shipped by these foundations.
- LaunchAgents run after login; this is not proof of service availability before FileVault unlock.
