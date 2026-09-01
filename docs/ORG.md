# Intuitxn Telepathy topology

## Current assets

- Public source repository: [`intuitxn/telepathy`](https://github.com/intuitxn/telepathy)
- Private planning Project: [`intuitxn / Telepathy`](https://github.com/orgs/intuitxn/projects/1)
- Internal alpha milestone: [`Internal alpha`](https://github.com/intuitxn/telepathy/milestone/1)
- Intended root product: `telepathy.intuitxn.com`

GitHub Projects Classic is deprecated and is not part of this system.

## Domain navigation

One application and one backend should resolve focused interfaces from the host. Until wildcard Cloudflare routing is verified, path fallbacks remain canonical and deployable through GitHub Pages.

| Intended host | Path fallback | Interface |
|---|---|---|
| `telepathy.intuitxn.com` | `/` | Human workspace |
| `agents.telepathy.intuitxn.com` | `/agents` | Meta-agent catalog |
| `prime.telepathy.intuitxn.com` | `/agents/prime` | Job proposal |
| `build.telepathy.intuitxn.com` | `/agents/build` | Candidate build and verification |
| `steward.telepathy.intuitxn.com` | `/agents/steward` | Resolution and projections |
| `research.telepathy.intuitxn.com` | `/agents/research` | Evidence-backed research |
| `relationships.telepathy.intuitxn.com` | `/agents/relationships` | Reviewed external-conversation drafts |

Project navigation remains path-based at `/projects/:project` so project slugs cannot collide with agent hosts.

The subdomains are not live merely because they appear in this map. Each requires authoritative DNS, managed HTTPS, access control, and verified host routing.
