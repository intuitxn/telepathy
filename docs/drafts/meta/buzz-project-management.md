# DRAFT — how an agent manages Buzz projects (NIP-MP)

Status: draft, agent-authored · Updated: 2026-09-22 · **Not published, not sent,
not committed.** This document creates no external effect and authorizes no
publication, no relay write, and no commit. It is written for review.

Scope: the agent-manageable surface of Buzz *projects* (`buzz projects`, NIP-MP
kind 30621) and their bound repositories, issues and pull requests, plus the
authority boundary that keeps an agent on the draft side of every mutation.

Evidence base: the commands below were read from the installed
`~/.local/bin/buzz --help` surface (Buzz Desktop bundle; no remote memory reads
or writes were performed). Design claims cite existing repo files by line.

Cross-links are **proposals only** (section 7); no shared document is edited.

## 0. Verification performed for this draft

| Check | Command | Result |
|---|---|---|
| Worker source resolved | `runtime/adaptive/META.md:17-25` → `runtime/worker/system.bend` | exists, single Bend file |
| Worker checks | `bend ~/.bend/…/system.bend --check-only` (Bend 2.0.21) | `All terms check.` |
| Command surface | `buzz projects|repos|pr|issues --help` and each subcommand's `--help` | all commands in section 2 exist |
| Read boundary | ordinary read query without signing identity | HTTP 401 `missing Nostr auth` — `docs/PROJECT_REVIEW.md:12-16` |

No Buzz/relay write, no commit, and no key export was performed.

## 1. The Buzz project model (NIP-MP)

- **Kind and tags.** A Buzz project is NIP-MP kind **30621**, addressed by a
  `d`-slug with `name`, `description`, an `a` channel anchor and a
  `buzz-channel` tag; the live projects observed are `telepathy`, `sansara`,
  `iktara` and `nudge` — `docs/designs/a2a-protocol.md:102`.
- **One project per repo, bound to a home channel.** "One Buzz project per code
  repository, each bound to its home channel" — `docs/AGENT_MAP.md:42`; the
  program table pairs `telepathy`/`sansara`/`iktara` with their stream channels
  and lists `intuitxn-general`, `changelog` and `shared-files` as
  cross-program/ledger/knowledge channels — `docs/AGENT_MAP.md:44-51`.
  `buzz projects create` with no `--repo` "creates a default repository bound to
  `--channel`" (installed `buzz projects create --help`).
- **Live NIP-MP set.** The setup doc records NIP-MP projects telepathy, sansara
  and iktara — `docs/RELAY_SETUP.md:21`; `scripts/setup-programs.sh:98-100`
  creates exactly those three. The a2a record additionally lists `nudge`
  (`docs/designs/a2a-protocol.md:102`), so the authoritative live set must be
  confirmed read-only before any mutation.
- **Identity context.** Projects are worked by named human owners and canonical
  agent roles; the canonical role names are `@telepathy`, `@prime`, `@build`,
  `@steward`, `@research`, `@relationships`, `@bend-forge`, `@relay-keeper` —
  `docs/AGENT_MAP.md:21-30`. People own every post and decision; agents compose
  — `docs/AGENT_MAP.md:38`.
- **Project coordinates are distinct from display names.** "Project and
  repository owners/identifiers are distinct coordinates; use the actual linked
  repository rather than guessing from a project display name" —
  `docs/PROJECT_REVIEW.md:32-34`.

## 2. Agent-manageable command surface

All commands below are present in the installed `buzz ... --help` surface. They
are split by whether they read relay state or sign and publish an event.

### 2.1 Read-only (safe; still needs a configured identity on this relay today)

| Purpose | Command (installed help) | Source |
|---|---|---|
| List projects | `buzz projects list --owner OWNER_PUBKEY [--limit N]` | `docs/PROJECT_REVIEW.md:25` |
| Get a project by slug | `buzz projects get PROJECT_SLUG --owner OWNER_PUBKEY` | `docs/PROJECT_REVIEW.md:26` |
| Get a repository | `buzz repos get --owner REPO_OWNER --id REPO_ID` | `docs/PROJECT_REVIEW.md:27` |
| List PRs for a repo | `buzz pr list --repo-owner REPO_OWNER --repo-id REPO_ID [--author A] [--label L] [--limit N]` | `docs/PROJECT_REVIEW.md:28` |
| Get a PR by event | `buzz pr get --event PR_EVENT_ID` | `docs/PROJECT_REVIEW.md:29` |
| Get an issue by event | `buzz issues get --event ISSUE_EVENT_ID` | `docs/PROJECT_REVIEW.md:47` |

Note: on this machine even a read returned HTTP 401 without a signing identity —
`docs/PROJECT_REVIEW.md:12-16`. Read-only means *no state change*, not
*unauthenticated*.

### 2.2 Mutating (sign + publish; owner-controlled signer only)

| Purpose | Command (installed help) | Source |
|---|---|---|
| Create an issue | `buzz issues create --title T --content -|'text' [--repo-owner O --repo-id R --channel C --label L --to P]` | `docs/PROJECT_REVIEW.md:45-46` |
| Assign an issue | `buzz issues assign --issue E --repo-owner O --repo-id R --assignee P [--label L]` | `docs/PROJECT_REVIEW.md:51-54` |
| Open a PR | `buzz pr open --repo-owner O --repo-id R --subject S --commit SHA --clone URL [--body-file F --branch-name B --channel C --to P --merge-base M --label L]` | `docs/PROJECT_REVIEW.md:58-59` |
| Update a PR tip | `buzz pr update --repo-owner O --repo-id R --pr E --pr-author P --commit SHA --clone URL [--body-file F]` | `docs/PROJECT_REVIEW.md:60` |
| Set PR status | `buzz pr status --pr E --status open|merged|closed|draft [--body-file F --repo-owner O --repo-id R --merge-commit M]` | `docs/PROJECT_REVIEW.md:94-96` |
| Create a project | `buzz projects create SLUG --name N [--description D --channel C --repo R --visibility listed|unlisted]` | `scripts/setup-programs.sh:59` |
| Create/configure a channel | `buzz channels create --name N --type T --visibility open` | `scripts/setup-programs.sh:46` |
| Add a channel member | `buzz channels add-member --channel C --pubkey P --role owner|member|bot` | `scripts/setup-programs.sh:69-73` |
| Set a channel canvas | `buzz canvas set --channel C --content -` | `scripts/setup-programs.sh:79` |
| Publish a NIP-23 note | `buzz notes set --name N --title T --tag G --content -` | `scripts/setup-programs.sh:85` |
| Create the JTBD workflow | `buzz workflows create --channel C --yaml Y` | `scripts/setup-programs.sh:126` |

Boundary facts from the installed help:
- `buzz issues assign` is trusted only when signed by the issue author or repo
  owner, though anyone may self-assign — installed `buzz issues assign --help`;
  `docs/PROJECT_REVIEW.md:51-54`.
- `buzz issues create --channel` "Infers the repository, creating one bound to
  this project when none exists" — installed `--help`;
  `docs/PROJECT_REVIEW.md:36-39`. For existing-project work, pass the explicit
  verified `--repo-owner`/`--repo-id` to avoid that side effect.
- There is no separate `buzz tasks`, `review`, `pr comment` or `pr review`
  command — `docs/PROJECT_REVIEW.md:36-38`.

### 2.3 Project setup is an owner/operator script, not an agent action

`scripts/setup-programs.sh` already encodes the read/mutate split idempotently:
`projects list` to check first (`:55`), `projects create` only when absent
(`:59`), then members, canvases, notes and the workflow. It **requires**
`BUZZ_PRIVATE_KEY` in the environment and refuses otherwise —
`scripts/setup-programs.sh:9-13,28-30`. An agent must not run it; the owning
human environment does.

## 3. The authority boundary

- **Mutations require an already-authorized signing identity.**
  `BUZZ_PRIVATE_KEY` (hex or nsec) plus optional NIP-OA owner-attestation
  `BUZZ_AUTH_TAG` are the CLI's identity — installed `buzz --help`;
  `docs/designs/a2a-protocol.md:116`. The Buzz signer is owner-controlled:
  "draft, review the exact payload, then send" — `runtime/worker/BUZZ.md:10-13`.
- **This shell has no signing identity.** A normal read-only relay query returned
  HTTP 401 (`missing Nostr auth`); no project, task or PR was created or approved
  and existing Desktop state stayed intact — `docs/PROJECT_REVIEW.md:12-16`.
- **Mutations are draft → owner-sent.** "Only use these mutation commands under
  the user's authorization for the existing project and through the established
  signer" — `docs/PROJECT_REVIEW.md:68-69`. Do not export private keys from
  Desktop to a worker — `docs/PROJECT_REVIEW.md:34`; do not inject signing
  credentials into an execution process — `runtime/worker/BUZZ.md:53-58`.
- **Reviewer must differ from author.** The inspected desktop "excludes the PR
  author as their own reviewer"; never relabel an owner-signed event as
  agent-authored to evade this — `docs/PROJECT_REVIEW.md:79-87`. An acceptance
  reply in a project thread is a separate convention, not a native PR approval —
  `docs/PROJECT_REVIEW.md:85-87`.
- **Approval ≠ merge, and status ≠ merge.** "Approval and landing are separate.
  `buzz pr status --status merged` records a status; it is not evidence that Git
  merged code, and it does not enforce an expected-tip comparison" —
  `docs/PROJECT_REVIEW.md:94-98`. Desktop's ordinary lifecycle omits `merged`;
  the source says merges happen through Git.
- **Tip changes invalidate approvals.** Old-commit approvals do not count toward a
  changed tip; request a new review and re-inspect the diff —
  `docs/PROJECT_REVIEW.md:89-92`.
- **Provenance, not just correctness.** A sent command or display name is not a
  readback; fetch the returned event and confirm repository, author, tip, clone
  URL and intended recipients — `docs/PROJECT_REVIEW.md:70-71`. Agent output is a
  reported result, not verified truth — `runtime/adaptive/META.md:99-111`.
- **Tools prepare, humans accept.** No interface may activate its own Job, accept
  its own artifact, resolve a Job, or speak as a person —
  `docs/AGENT_MAP.md:77-78`.

## 4. Bounded agent workflow

A single, reproducible loop. Read-only steps are safe for the agent; the signed
send is the one place the agent must stop and a human must act.

```text
discover (agent, read-only)
  → propose issue/PR draft (agent, local file only)
  → human signer submits (HUMAN / owner-controlled signer)
  → reviewer gate (HUMAN reviewer, distinct from author)
  → track status (agent, read-only)
```

1. **Discover** — resolve real coordinates before touching anything:
   ```sh
   buzz projects list --owner OWNER_PUBKEY
   buzz projects get PROJECT_SLUG --owner OWNER_PUBKEY
   buzz repos get --owner REPO_OWNER --id REPO_ID
   buzz pr list --repo-owner REPO_OWNER --repo-id REPO_ID
   buzz pr get --event PR_EVENT_ID
   ```
   Use the actual linked repository, never the display name
   (`docs/PROJECT_REVIEW.md:32-34`). Read an existing PR before creating another
   (`docs/PROJECT_REVIEW.md:33-34`).
2. **Propose issue/PR draft** — the agent writes a local draft (task, acceptance
   criteria, full commit, base commit, changed paths, checks, known failures,
   intended reviewer) and performs **no** relay mutation. The body must name the
   immutable revision; a digest in prose is not validation —
   `docs/PROJECT_REVIEW.md:56-67`. Optionally the agent prepares the exact
   command lines below for the signer.
3. **Human signer submits** — *the one place a human must act.* In the owning
   environment with `BUZZ_PRIVATE_KEY` set:
   ```sh
   buzz issues create --repo-owner REPO_OWNER --repo-id REPO_ID \
     --channel PROJECT_CHANNEL --title 'Review the candidate' \
     --content - < task.md
   buzz issues assign --issue ISSUE_EVENT_ID \
     --repo-owner REPO_OWNER --repo-id REPO_ID --assignee REVIEWER_PUBKEY
   buzz pr open --repo-owner REPO_OWNER --repo-id REPO_ID \
     --subject 'Candidate review' --commit COMMIT_SHA --clone CLONE_URL \
     --branch-name BRANCH --channel PROJECT_CHANNEL \
     --to REVIEWER_PUBKEY --body-file candidate.md
   ```
   Then read back the returned event and confirm author, tip, clone URL and
   recipients — `docs/PROJECT_REVIEW.md:70-71`.
4. **Reviewer gate** — the authorized human reviewer opens the PR in Buzz Desktop
   and reviews the exact commit; the PR author cannot approve their own PR —
   `docs/PROJECT_REVIEW.md:73-87`. If the tip changed, request a fresh review —
   `docs/PROJECT_REVIEW.md:89-92`.
5. **Track status** — agent may read status; on a resolved tip the agent can
   prepare a `buzz pr status --status …` line, but the send again crosses the
   signing boundary:
   ```sh
   buzz pr get --event PR_EVENT_ID
   buzz issues get --event ISSUE_EVENT_ID
   buzz pr status --pr PR_EVENT_ID --status merged --merge-commit MERGE_SHA
   ```
   `merged` is a status label, not proof Git merged, and it does not compare an
   expected tip — `docs/PROJECT_REVIEW.md:94-98`. Independent tip/target/test
   verification is required before claiming a landing.

**Single human hand-off:** step 3 (the owner-controlled signer). Every other step
is agent-executable, and the reviewer gate in step 4 is a second, deliberate
human decision rather than an agent action.

## 5. What an agent may NEVER do

1. **Impersonate a person.** Never sign or post as a human, never relabel an
   owner-signed event as agent-authored. People own every post; agents compose —
   `docs/AGENT_MAP.md:38,77-78`; `docs/PROJECT_REVIEW.md:85-87`.
2. **Self-approve.** An agent must not approve its own PR or artifact; the PR
   author is excluded as reviewer — `docs/PROJECT_REVIEW.md:79-84`; no interface
   may accept its own artifact — `docs/AGENT_MAP.md:77-78`.
3. **Export or inject keys.** No private key in arguments, docs, memory, or an
   execution process — `docs/PROJECT_REVIEW.md:34`;
   `runtime/worker/BUZZ.md:55-58`.
4. **Claim a merge without verifying the tip.** A `merged` status or approval is
   not a merge; verify the reviewed tip, target and tests independently —
   `docs/PROJECT_REVIEW.md:94-98`.
5. **Create its own Job, resolve a Job, or publish.** Tools prepare; humans
   accept — `docs/AGENT_MAP.md:77-78`; `/meta` "is not … automatic authorization
   to publish" — `runtime/adaptive/META.md:4-7`.
6. **Put secrets or raw session material in artifacts.** Secrets live in runtime
   env only — `docs/AGENT_MAP.md:137`; keep keys, sessions and raw conversations
   out of candidate records — `docs/PROJECT_REVIEW.md:126-130`.
7. **Run the owner setup script.** `scripts/setup-programs.sh` needs
   `BUZZ_PRIVATE_KEY` and belongs to the owning human environment —
   `scripts/setup-programs.sh:9-13,28-30`.

## 6. Outstanding work and limitations

- Live-project set differs between sources (`nudge` only in
  `docs/designs/a2a-protocol.md:102`); confirm the authoritative set read-only
  before any mutation.
- Native review behavior was inspected upstream at commit `77729ab…`, not proven
  identical in the installed Desktop — `docs/PROJECT_REVIEW.md:117-127`.
- The workflow engine fails `request_approval` with `approval_not_supported`;
  CLI availability is not an enforced approval gate — `runtime/worker/BUZZ.md:89-93`.
- No signing identity is configured in this shell, so every mutating command above
  remains unexercised here; that is intentional (`docs/PROJECT_REVIEW.md:12-16`).

## 7. Proposed cross-links (NOT applied)

These are proposals; no shared file was edited.

- Add this draft to the `docs/INDEX.md` code-map draft line (currently
  `docs/INDEX.md:38`).
- Link this draft from `docs/PROJECT_REVIEW.md` and `docs/AGENT_MAP.md` program
  sections once reviewed.
- Record the confirmed live NIP-MP project set in `docs/RELAY_SETUP.md:21`.
