# Telepathy agents

The product's agent layer: one main agent and five focused meta-agents, defined in
opencode's native agent format (markdown + frontmatter). They are spawnable by
opencode2 and ship with this repo.

## Model

```
              human (Shubham, Om, Kush)
                      │
              @telepathy (main, primary)
        routes to the narrowest interface
   ┌──────────┬──────────┬──────────┬──────────┬──────────┐
 @atlas     @forge     @ledger    @scout     @diplomat
 propose    produce    project    prepare    draft
 work       artifact   accepted   evidence   external
                      work                  messages
```

## Rule that holds the whole thing together

Humans own the outcomes; actual signing identity remains visible. Every write tool in the `@telepathy/opencode-plugin`
uses separate draft and `_send` tools, and publishing requires explicit human approval (opencode's
permission gate). The meta-agents compose; the human decides.

## Authority (enforced by the agent charter + the plugin's permission gate)

| Agent | May | Must not |
|---|---|---|
| `@atlas` | read context, draft a job proposal | execute, publish, accept, send |
| `@forge` | implement, verify, draft an artifact review | accept own work, merge, resolve |
| `@ledger` | draft resolution, changelog, activity | author posts, change accepted history |
| `@scout` | retrieve sources, draft a dossier | assert unverified claims, publish |
| `@diplomat` | draft external messages from approved context | send, record unverified delivery |

Buzz is the source of truth (channels, threads, canvas). Git commits are accepted
revisions. The local Desk ledger owns pilot jobs; Agent Manager integration is not configured. The plugin (`plugins/telepathy/`) exposes
these as `telepathy_*` tools.
