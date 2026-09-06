# Telepathy harness

## 1. What the harness is

The harness is the job and artifact machinery below Telepathy's human product surface. It organizes execution, prepares candidate artifacts, and keeps review evidence. People see useful context and accountable outcomes, as described in the [product contract](PRODUCT.md).

## 2. Job lifecycle

Jobs follow the lifecycle in [the project model](docs/PROJECTS.md):

```text
Proposed -> Ready -> Active -> Waiting -> Review -> Resolved | Cancelled
```

An agent stopping does not mean a job is resolved. Review and human acceptance are explicit steps.

## 3. Where state lives

- **Buzz relay** holds human requests and acceptance.
- **Desk SQLite in `.local/`** holds job, artifact, and outbox state.
- **Git** holds accepted revisions.

These stores keep human decisions, execution state, and accepted work traceable.

## 4. Human boundary

Humans remain the visible authors and accountable owners. Agents draft; humans accept. No agent may accept its own artifact, resolve a job, or send externally. The [team SOP](SOP.md) describes human review and explicit resolution.

## 5. Run the harness

From the repository root:

```bash
npm run setup
npm run doctor
npm run desk -- help
```

Use setup to prepare the local environment, doctor to check it, and Desk help to see the available commands. See the [README](README.md) for repository setup context.
