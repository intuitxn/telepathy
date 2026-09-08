# Intuitxn Telepathy topology

## Current assets

- Public source repository: [`intuitxn/telepathy`](https://github.com/intuitxn/telepathy)
- Private planning Project: [`intuitxn / Telepathy`](https://github.com/orgs/intuitxn/projects/1)
- Internal alpha milestone: [`Internal alpha`](https://github.com/intuitxn/telepathy/milestone/1)
- Verified GitHub Pages preview: [`intuitxn.github.io/telepathy`](https://intuitxn.github.io/telepathy/)
- Intended root product: `telepathy.intuitxn.com`

GitHub Projects Classic is deprecated and is not part of this system.

## Domain navigation

One application and one backend should resolve focused interfaces from the host. Until wildcard Cloudflare routing is verified, path fallbacks remain canonical and deployable through GitHub Pages.

| Intended host | Path fallback | Interface |
|---|---|---|
| `telepathy.intuitxn.com` | `/` | Human workspace |
| `agents.telepathy.intuitxn.com` | `/agents` | Meta-agent catalog |
| `atlas.telepathy.intuitxn.com` | `/agents/atlas` | Job proposal |
| `forge.telepathy.intuitxn.com` | `/agents/forge` | Candidate build and verification |
| `ledger.telepathy.intuitxn.com` | `/agents/ledger` | Resolution and projections |
| `scout.telepathy.intuitxn.com` | `/agents/scout` | Evidence-backed research |
| `diplomat.telepathy.intuitxn.com` | `/agents/diplomat` | Reviewed external-conversation drafts |

Project navigation remains path-based at `/projects/:project` so project slugs cannot collide with agent hosts.

The subdomains are not live merely because they appear in this map. Each requires authoritative DNS, managed HTTPS, access control, and verified host routing.

The GitHub Pages URL is the only verified public preview. It is not evidence of production authentication, shared persistence, notification delivery, custom-domain routing, or live meta-agent endpoints.
