# Telepathy Project item contract

The private [Intuitxn Telepathy Project](https://github.com/orgs/intuitxn/projects/1) is a human planning view over repository issues. It is not the Job ledger.

## Issue shape

```text
Outcome: <human-readable result>
Why now: <reason and evidence>
Owner: <accountable human>
Reviewer: <accountable human>
Acceptance:
- [ ] <observable gate>
Dependencies: <issue, decision, or access>
Known limits: <what this will not prove or ship>
```

Use the Project's native `Todo`, `In Progress`, and `Done` status for planning. Detailed execution states remain in the Telepathy Job contract:

```text
Proposed -> Ready -> Active -> Waiting -> Review -> Resolved | Cancelled
```

A board move does not mutate Job truth. A stopped agent does not imply completion. `Done` requires the issue acceptance criteria and a human-readable outcome.

## Launch labels

- `launch:v0`
- `area:product`
- `area:platform`
- `area:release`
- `priority:p0`
