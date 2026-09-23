# DRAFT — current world model of the Intuitxn/Mundus system

Status: draft, agent-authored · Updated: 2026-09-22 · **Not published, not sent.**
This document is the reconciled single-source world model for the
`telepathy-shared-learning` checkout. It creates no external effect and authorizes
no publication. Every claim carries file:line or an observed command.

Coordinator snapshot lineage (private, single writer):
`.local/meta-20260922-worldmodel-sync/` — worker protocol `init → capture → work →
worker → claim → packet → return → learn`.

## 1. Coordinates

| Item | Value | Evidence |
|---|---|---|
| Checkout | `/Users/a3fckx/Desktop/Attri/telepathy-shared-learning` | symlink `~/.config/opencode/commands/meta.md` → `.opencode/commands/meta.md` |
| Command | `/meta agents TASK AND ACCEPTANCE CRITERIA` | `.opencode/commands/meta.md`; `runtime/adaptive/META.md:1-16` |
| Kernel | `runtime/worker/system.bend` | `runtime/adaptive/META.md:17-25`; `runtime/worker/README.md:1-9` |
| Kernel digest | sha256 `6e224e26d47c56d3601b26b55ae77497ab4680cacda89846640380a1d9e69d74` (92130 bytes) | `shasum -a 256`; matches `runtime/worker/README.md:5` |
| Toolchain | Bend 2.0.21 at `~/.bend/bin/bend` | `bend version` |
| Checker | `bend FILE --check-only` → `All terms check.` | observed in this session |
| Host tests | `node --test runtime/worker/protocol.test.mjs` → 2/2 pass | observed in this session |
| Head revision | `c8eb09a` (moved from `fa56d57` mid-run by a concurrent writer) | `git log -1` |

## 2. Runtime protocol (what the system actually is)

`worker → claim → packet → return → explicit learn`, plus `correct`. Command
surface: `runtime/worker/system.bend` `-- help`.

- Snapshots are **immutable, single-writer**; `OUT` must be new
  (`system.bend:1312-1328`).
- `return` records a **reported result**, not verified truth or human acceptance
  (`system.bend:1534-1569`).
- `learn` is a separate, explicit step; no implicit learning from a return.
- Labels are **not authenticated identities**; there is **no automatic snapshot
  merge**; independent branches do not enforce globally exclusive claims
  (`system.bend:1829`; `runtime/worker/README.md:41-44`).
- The `opencode IN WORK PORT SESSION RECEIPT` connector is **explicit loopback
  delivery over TCP** to an already-running server (`system.bend:1769`,
  `:1713-1720`). HTTP 204 acknowledges submission only and never imports model
  output (`system.bend:1601-1603`).
- Bend Base has **no OS subprocess / Git / SHA / atomic rename** primitive
  (`system.bend:864`). Note: `base.bend:211` defines `IO.spawn`, but it schedules
  a concurrent Bend IO action (`effs/spawn.c`), not an OS process.

## 3. Host and memory plane

- Buzz owns agent identity, routing and persisted engrams; Bend owns local
  state/flow and explicit transitions (`runtime/adaptive/HARNESS.md:16-19`).
- Buzz exposes native memory `mem ls/get/set/hash/patch/rm`; `buzz-acp` injects
  the per-session **core** engram by default, other slugs need explicit retrieval
  (`runtime/worker/BUZZ.md:108-110`).
- Reviewer is **Shubham**; the owner-controlled Buzz signer sends only after the
  exact payload is reviewed (`runtime/worker/BUZZ.md:66-69,88-93`).
- OpenCode executable: `$HOME/.opencode/bin/opencode` → **1.18.32**; the
  Homebrew Cellar binary `/opt/homebrew/bin/opencode` → **1.14.20**. On this
  machine `command -v opencode` resolves to the 1.18.32 install
  (`runtime/worker/BUZZ.md:90-99`).

## 4. Retired and preserved

- The custom JavaScript registry / lifecycle / Git-sync / delegate-opencode stack
  is **retired** from the active tree; preserved at commit
  `d7a6c7b0930f6d91b691e58df84b775479380c0d` (`runtime/adaptive/HARNESS.md:27-46`).
- Existing registry data, signed bundles and the learning branch are retained as
  **historical evidence**, **not migrated** into Buzz (`runtime/worker/BUZZ.md:128-132`).
- Buzz engrams do **not** reproduce the retired stack's bundle-admission,
  rollback-protection or revocation guarantees (`runtime/adaptive/HARNESS.md:33-35`).

## 5. Recorded learning-benefit evidence (null)

- Codex→OpenCode cross-harness trial: **74/74 both arms**, identical normalized
  code sha (`3b55d085…107274`), memory arm slower 4608 ms vs 13773 ms
  (`runtime/evaluation/cross-harness-report.json`).
- Fresh-session follow-up: **652/652 both arms**, zero tool calls
  (`runtime/evaluation/workflow-transfer-report.json`).
- No weight training; saved text alone is not learning performance
  (`runtime/adaptive/HARNESS.md:48-53`).

## 6. Drift inventory (doc vs code)

Each item is a doc-vs-code contradiction with the exact path and reason.

| # | Doc claim | Code reality | Action |
|---|---|---|---|
| D1 | `runtime/desk/README.md:8` — "authenticated connection to the pinned OpenCode service using its official client" | `runtime/desk/src/runtime.js:1-2` selects the installed CLI (`OPENCODE_BIN \|\| 'opencode'`); `runtime/desk/src/jobs.js:46-48` runs `opencode run`. Pinned-service client is gone. | Correct README |
| D2 | `runtime/desk/README.md:16` — "OpenCode worker uses a profile that leaves shell permissions pending" | `runtime/desk/src/jobs.js:46-48` passes no permission profile; it uses native OpenCode config. | Correct README |
| D3 | `docs/drafts/meta/one-file-bend-command.md:104` — Base "lacks subprocess/spawn" | `base.bend:211` defines `IO.spawn` (concurrent Bend IO, `effs/spawn.c`); only **OS subprocess** is absent. Wording is imprecise. | Clarify wording to "no OS subprocess" |
| D4 | `runtime/worker/BUZZ.md:90-99` — implies PATH Homebrew 1.14.20 is what runs | On this machine `command -v opencode` → `~/.opencode/bin/opencode` (1.18.32); Homebrew Cellar holds 1.14.20 but is not first on PATH. | Note PATH resolution explicitly |
| D5 | In-tree draft state is unrecorded | `docs/AGENT_DIRECTORY.md`, `docs/drafts/meta/` untracked; `docs/INDEX.md`, `runtime/adaptive/README.md` modified; `docs/PROJECT_REVIEW.md` became tracked at `c8eb09a` mid-run. | Commit drafts deliberately |

## 7. Open limitations (do not claim)

- D1–D5 are reported, not yet fixed. No doc was silently rewritten.
- A reported worker result and an explicitly learned finding are **not** a verified
  code bundle (`runtime/adaptive/META.md:120-124`).
- No credential isolation, no distributed exclusive claims, no automatic Buzz↔Bend
  sync; the deployment boundary is unverified (`runtime/adaptive/HARNESS.md:93-96`).
- D4/D5 depend on machine state at 2026-09-22 and may drift again.

## 8. Sources

`runtime/adaptive/META.md` · `runtime/adaptive/HARNESS.md` ·
`runtime/worker/README.md` · `runtime/worker/BUZZ.md` · `runtime/worker/system.bend` ·
`runtime/evaluation/cross-harness-report.json` ·
`runtime/evaluation/workflow-transfer-report.json` · `docs/AGENT_DIRECTORY.md` ·
`docs/drafts/meta/one-file-bend-command.md`. Independent audit by a host agent
(read-only) in `.local/meta-20260922-worldmodel-sync/audit-return.md`.
