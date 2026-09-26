# Telepathy and Labs: September 2026 foundation record

This document preserves observations verified on 2026-09-08. They describe the earlier Desk and oc2 deployment and are not current setup or service-health claims. The current source path is the [DSH algorithm machine](../runtime/dsh/README.md); operational cutover is still pending. Its local [resident ingress](../runtime/dsh/README.md#funded-research-task-program) does not consume the old Desk ledger or Buzz threads.

## Observed product surface

The [Telepathy alpha](https://intuitxn.github.io/telepathy/) showed a composer, replies, acknowledgements, resolutions, People, and Interfaces in one browser. Demo identity switching was not authentication, and alpha posts were not delivered to teammates. The Labs runtime status and distribution page responded at the time of this report. The website remains separate from DSH task state; use Buzz for shared team conversation only through an authorized account.

## Earlier deployment observations

At the 2026-09-08 check, the authenticated Mac node and gateway responded; a resident OpenCode call reached Codex and returned `CODEX_NODE_OK`. The Desk watcher polled without an error, and its ledger recorded seven resolved jobs, two historical needs-attention jobs, and one uncertain outbox delivery. The recreated changelog channel held a reported entry. These facts do not establish that those services or relay heads are current now.

The A2A M2 work set `INTUITXN_NETWORK` as the canonical URL for the earlier node launchers, with `BUZZ_RELAY_URL` compatibility. UX M1 added the alpha design tokens and program accents. The DSL compiler, app renderer, authenticated shared persistence, A2A peer discovery, signed ACP bridges, and cross-node delegation remained unshipped in that audit.

## Audit limits that still matter during migration

- The earlier node inherited a Buzz signing identity. Its channel read worked, but the claimed credential isolation did not hold on that host.
- Desk's OpenCode path used a separate Git worktree without automatically applying macOS Seatbelt. Do not infer DSH or current jj isolation from that record.
- Earlier resolved jobs could retain old error text. Preserve their receipts and investigate uncertain outbox delivery before any retry.
- A served Mac installer had not passed a fresh-machine installation and update-recovery test.
- LaunchAgents started after login; the report did not prove availability before FileVault unlock.

For current code work use an [owned jj workspace](WORKTREE_LIFECYCLE.md) and the [operator guide](../OPERATE.md). For the product boundary, see [PRODUCT.md](../PRODUCT.md).
