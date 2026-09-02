# Telepathy — opencode plugin

Telepathy is Intuitxn's shared human context layer. This is its harness, written as a
**real opencode plugin** (`@opencode-ai/plugin`), not a parallel server.

Reference: [Meta-Harness](https://yoonholee.com/meta-harness/) — the harness is the runtime
surface around the agent: the tools it can call and the context it runs in. That surface is
here, and nowhere else.

## Principle

> Truth lives in the hosts. This plugin only extends them.

| Host | Owns |
|---|---|
| **Buzz** | channels, threads, canvas — the human-visible surface |
| **Agent Manager** | sessions, tasks, reservations — execution |
| **git** | accepted revisions — an "accepted artifact" is a merged commit |

There is no custom socket, ledger, job state machine, or reservation store. The tools shell
out to the `buzz` CLI and draft by default so a human reviews before anything is published.

## Tools

| Tool | Human product object | Buzz backing |
|---|---|---|
| `telepathy_channels` | (navigation) | `buzz channels list` |
| `telepathy_post` | Post — update / decision / question / announcement | `buzz messages send` |
| `telepathy_reply` | Reply | `buzz messages send --reply-to` |
| `telepathy_acknowledge` | Acknowledgement | `buzz reactions add` |
| `telepathy_resolve` | Resolution (completed / no_change) | `buzz messages send --reply-to` |
| `telepathy_artifact` | Candidate artifact + review request | `buzz messages send` |

Every write tool is **draft-first**: it returns the composed content for review unless
`draft: false` is passed. Humans remain the visible authors; agent transcripts, prompts, and
tool calls never surface.

## Configuration

The plugin shells out to the Buzz CLI, which reads these environment variables:

```bash
BUZZ_PRIVATE_KEY=…        # required (hex or nsec) — never commit this
BUZZ_RELAY_URL=…          # optional, default http://localhost:3000
```

If `BUZZ_PRIVATE_KEY` is unset the tools fail with a clear guidance message instead of a raw
auth error.

## Load in opencode

Reference the plugin in your opencode config, e.g. `opencode.json`:

```json
{ "plugin": ["./plugins/telepathy/src/index.ts"] }
```

## Develop

```bash
npm install
npm run check   # tsc --noEmit
npm run build   # tsc → dist/
```
