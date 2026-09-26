# Native review and auto-merge

Use OpenCode's retained `@reviewer` for an independent source review and GitHub's native
auto-merge for landing. The new DSH source route targets `deepseek-official/deepseek-flash`; its
score report does not replace the source review. Buzz remains the project discussion/review surface.
A Buzz approval is not automatically a GitHub approval; no relay-to-GitHub
signing bridge is introduced.

## Review agent

The repository's `.opencode/agents/reviewer.md` inherits the configured model
and permits only read/glob/grep. Supply full base/head commits, matching source
and diff, acceptance criteria and CI evidence. The agent reports `blocked`,
`changes_requested` or `no_findings`; missing evidence cannot produce a clean
review. A new head needs a new report. It cannot run commands, edit, post an
approval or merge. The report is evidence for a separately authorized reviewer.

The charter is a retained OpenCode role, not a newly registered Buzz identity
or an automatic GitHub reviewer. Verify the actual runtime and exact source
revision before relying on its report.

## Merge gate

The intended main-branch settings are:

- GitHub native auto-merge enabled, selected explicitly per PR.
- One independent approving review; dismiss stale approvals on new commits and
  require approval after the latest push.
- `Repository checks` succeeds on an up-to-date branch.
- Review conversations resolved; administrators follow the same requirements.
- No force push or branch deletion.

The workflow runs on every PR, without path filters: DSH/core and independent
benchmark tests with pinned Bend, program/gate tests, and site typecheck/tests/build. It has
read-only repository permissions, no model/signing secrets and no merge action.
It uses Node 24; the local Node 26 runtime's Web Storage behavior broke the
existing site test environment, while Node 24 passed. CI runs the Bend compiler
and the independent benchmark; a changed candidate still needs source-bound checker
and independent evaluation evidence in its review.

Enable native auto-merge for a specific PR only after these settings are active:

```sh
gh pr merge PR_NUMBER --auto --merge --match-head-commit FULL_HEAD_SHA
```

This queues GitHub's merge after all requirements are met. Do not use `--admin`
or replace an authenticated approval with a comment, emoji or agent verdict.
The match-head argument guards the enable request; later commits remain subject
to new CI and stale-review invalidation. Existing deployment workflows still
apply to merged changes in their configured paths.

## Identity and activation boundary

Confirm that a distinct authorized reviewer can approve the PR before relying
on native auto-merge. An agent report is evidence for review, not a GitHub
approval. Do not self-approve or create a bot identity implicitly.

Migration work does not bypass these gates. Host settings, reviewer identity,
successful CI and an actual completed merge are separate observations; report
each independently.
