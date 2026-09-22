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
- **Private Bend Lorenz snapshots and telepathy-mailbox state** hold local worker and mailbox history.
- **Git** holds accepted revisions.

These stores keep human decisions, execution state, and accepted work traceable.

## 4. Human boundary

Humans remain the visible authors and accountable owners. Agents draft; humans accept. No agent may accept its own artifact, resolve a job, or send externally. The [team SOP](SOP.md) describes human review and explicit resolution.

## 5. Run the harness

From the repository root:

```bash
npm run check
make check
python3 scripts/workspace-service.py status
```

Use `npm run check` for the retained runtime check, `make check` for the kernels and the context equation, and the workspace service status command to inspect the retained workspace service. See the [README](README.md) for repository setup context.
