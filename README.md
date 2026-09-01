# Telepathy

Telepathy is Intuitxn's shared human context layer.

It gives Shubham, Om, and Kush one place to publish decisions, updates, questions, asks, and accepted outcomes. People remain the visible authors and owners. Agent Manager, worker agents, routing, summarization, and artifact processing operate beneath that surface.

## Product rule

> Telepathy exists to improve human communication. It must not turn internal agent traffic into a product for people to monitor.

The first product has four visible objects:

- **Posts** for updates, decisions, questions, and announcements.
- **Replies** for focused human discussion.
- **Acknowledgements** that show important context landed.
- **Resolutions** that close a question or ask with an accountable outcome.

## Current release boundary

The first website is an internal alpha. It demonstrates the complete interaction model and persists activity in one browser. It is not yet a secure multi-user production workspace.

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
packages/harness/    internal job, artifact, and runtime contracts
agents/              hidden runtime charters
plugins/             integration boundary
```

Read [PRODUCT.md](./PRODUCT.md) for the product contract, [SOP.md](./SOP.md) for the team operating model, and [CHANGELOG.md](./CHANGELOG.md) for release history.

## Development

```bash
cd site
npm install
npm run dev
```

Build and verification commands are defined inside each package. Deployment is tied to reviewed commits on `main`.
