# Telepathy

Telepathy is Intuitxn's shared human context layer.

**Working setup:** use installed OpenCode directly (`opencode` or `opencode run "task"`), or connect Buzz to its native `opencode acp` command. Bend owns the local worker state; Buzz supplies coordination and memory. Follow the [Buzz/Bend guide](runtime/worker/BUZZ.md). No oc2 fork, custom plugin, SDK service, or npm setup is required for that path.

The retained system is standard OpenCode directly (native `opencode acp` for Buzz), the checked Bend worker, the telepathy-mailbox plugin, the website, and the declarative meta-agent registry. The previous Desk job ledger was retired on 2026-09-22; its history remains available in git. Read the [setup guide](./BUZZ_SETUP.md), [forum start page](./forum/START_HERE.md), and [company writing guide](./forum/WRITING.md).

The [active build plan](runtime/adaptive/HARNESS.md#what-the-system-should-build-toward) defines how findings become reusable, corrected, independently evaluated improvements.

**Live internal-alpha preview:** <https://intuitxn.github.io/telepathy/>

It gives Shubham, Om, and Kush one place to publish decisions, updates, questions, asks, and accepted outcomes. People remain the visible authors and owners. Agent Manager, worker agents, routing, summarization, and artifact processing operate beneath that surface.

## Mundus entry point

Use the native Lorenz worker through one host entry point:

```sh
./mundus <verb> <root> [args...]
```

| Verb | Effect |
| --- | --- |
| `init <root>` | create an immutable worker genesis snapshot |
| `capture <root> <task> [actor origin]` | retain the exact selected request |
| `work`, `worker`, `claim`, `return`, `learn`, `remember`, `correct` | checked Lorenz transitions; see `./mundus help` for arguments |
| `packet <root> <work>` | task, ownership, acceptance and active attributed memory |
| `status`, `history`, `memory`, `explain` | inspect actual worker records |
| `plan <root> <budget> <depth>` | separate abstract planning experiment; does not spawn agents |
| `retrieve <root>` | separate local graph experiment; does not fetch Buzz memory |
| `path <root> <verb>` | print the experimental kernel slot path |
| `op <args...>` | delegate to `runtime/ops/run.sh` |
| `guard <args...>` | delegate to `scripts/durability-guard.sh` |
| `memory sync\|ls\|get\|ensure <root> [slug]` | mirror Buzz memory to `<root>/memory.in` + `<root>/memory/` via `scripts/memory-sync.sh` |
| `help` | print supported host commands and arguments |

The shell creates private directories, acquires a local writer lock, freezes and
checks the one-file worker source, and publishes a successful immutable snapshot
by atomically replacing `<root>/head`. Bend owns ownership and memory semantics.
Failed attempts preserve evidence and leave the head unchanged. This is local
coordination, not distributed consensus or an execution sandbox. `BEND` overrides
the compiler path (default `$HOME/.bend/bin/bend`).

Run `scripts/install-meta.sh` to install both `/meta` and its agent role for fresh
OpenCode contexts; previous entries are backed up. Run `make check` for required
Bend checks and protocol tests. See [the worker guide](runtime/worker/README.md)
and [the architecture boundary](docs/META_NATIVE.md).

## Product rule

> Telepathy exists to improve human communication. It must not turn internal agent traffic into a product for people to monitor.

The first product has four visible objects:

- **Posts** for updates, decisions, questions, and announcements.
- **Replies** for focused human discussion.
- **Acknowledgements** that show important context landed.
- **Resolutions** that close a question or ask with an accountable outcome.

## Current release boundary

The first website is an internal alpha. It demonstrates the complete interaction model and persists activity in one browser. It is not yet a secure multi-user production workspace.

The preview also includes an **Interfaces** catalog for Prime, Build, Steward, Research, and Relationships. These are planned focused tools over shared Job and artifact machinery—not people, feed authors, or live agent endpoints.

Not yet shipped:

- authenticated member identities;
- shared server-side persistence and cross-device sync;
- production notification delivery;
- privacy and retention controls;
- an externally reachable harness.

These boundaries are tracked in the [Telepathy GitHub Project](https://github.com/orgs/intuitxn/projects/1) and the [Internal alpha milestone](https://github.com/intuitxn/telepathy/milestone/1).

## Repository

```text
site/                human communication product
runtime/worker/      one-file Bend worker logic and independent checks
runtime/adaptive/    active build plan and adaptive runtime
runtime/lorenz/      Lorenz snapshot lineage and evaluation
.opencode/agents/    native OpenCode role charters
plugins/             telepathy-meta-agents catalog + telepathy-mailbox
```

Read [PRODUCT.md](./PRODUCT.md) for the product contract, [SOP.md](./SOP.md) for the team operating model, and [CHANGELOG.md](./CHANGELOG.md) for release history.

## Development

```bash
cd site
npm install
npm run dev
```

Build and verification commands are defined inside each package. Deployment is tied to reviewed commits on `main`.
