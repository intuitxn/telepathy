# Telepathy agents

The product's agent layer: one main agent and focused meta-agents, defined in
opencode's native agent format (markdown + frontmatter). They are spawnable by
opencode and ship with this repo.

Canonical names live in `.opencode/agents/` and `plugins/telepathy-meta-agents/registry.json`
(see [AGENT_MAP.md](AGENT_MAP.md)). The retired design names `@atlas`, `@forge`,
`@ledger`, `@scout`, `@diplomat` map to `@prime`, `@build`, `@steward`, `@research`,
`@relationships`. `@bend-forge` and `@relay-keeper` are additional subagents.

## Model

```
              human (Shubham, Om, Kush)
                      │
              @telepathy (main, primary)
        routes to the narrowest interface
   ┌──────────┬──────────┬──────────┬──────────┬──────────┐
 @prime     @build     @steward   @research  @relationships
 propose    produce    project    prepare    draft
 work       artifact   accepted   evidence   external
                       work                  messages
```

## Rule that holds the whole thing together

Humans own the outcomes; actual signing identity remains visible. Workers draft
results and findings. Shubham reviews the exact outbound content/revision, and
the owner-controlled Buzz signer sends it. Agent charters describe this boundary;
they do not prove credential isolation or enforce every tool permission.

## Role boundaries

| Agent | May | Must not |
|---|---|---|
| `@prime` | read context, draft a job proposal | execute, publish, accept, send |
| `@build` | implement, verify, draft an artifact review | accept own work, merge, resolve |
| `@steward` | draft resolution, changelog, activity, lessons | author posts, change accepted history |
| `@research` | retrieve sources, draft a dossier | assert unverified claims, publish |
| `@relationships` | draft external messages from approved context | send, record unverified delivery |

Buzz holds shared discussion and selected memory. Bend snapshots hold local
worker transitions; Git holds source revisions. Standard OpenCode executes the
roles. Desk is optional for its existing local ledger. The old custom Telepathy
plugin is retired from the active configuration.
