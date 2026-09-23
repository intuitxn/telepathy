# Native review and auto-merge

Use OpenCode's `@reviewer` for an independent source review and GitHub's native
auto-merge for landing. Buzz remains the project discussion/review surface.
A Buzz approval is not automatically a GitHub approval; no relay-to-GitHub
signing bridge is introduced.

## Review agent

The repository's `.opencode/agents/reviewer.md` inherits the configured model
and permits only read/glob/grep. Supply full base/head commits, matching source
and diff, acceptance criteria and CI evidence. The agent reports `blocked`,
`changes_requested` or `no_findings`; missing evidence cannot produce a clean
review. A new head needs a new report. It cannot run commands, edit, post an
approval or merge. The report is evidence for a separately authorized reviewer.

Buzz's inspected global preference is `opencode`, but existing Fizz/Honey/Pollen
entries still contain `codex-acp` overrides. A changed global default is not
proof that an existing agent is running OpenCode. Select the native OpenCode
runtime in the existing host, with this repository as its workspace, before
claiming the repo reviewer is available in that Buzz session. The charter is
not a newly registered Buzz identity.

## Merge gate

The intended main-branch settings are:

- GitHub native auto-merge enabled, selected explicitly per PR.
- One independent approving review; dismiss stale approvals on new commits and
  require approval after the latest push.
- `Repository checks` succeeds on an up-to-date branch.
- Review conversations resolved; administrators follow the same requirements.
- No force push or branch deletion.

The workflow runs on every PR, without path filters: the retained runtime check
(`npm run check`), program/gate tests, and site typecheck/tests/build. It has
read-only repository permissions, no model/signing secrets and no merge action.
It uses Node 24; the local Node 26 runtime's Web Storage behavior broke the
existing site test environment, while Node 24 passed. These checks do not run
the Bend compiler. A Bend change still needs source-bound checker and independent
evaluation evidence in the review.

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

The inspected GitHub connection is `a3fckx`, also the PR author; the other listed
collaborator has read access. No distinct approval identity with write access
was established. Do not self-approve or create a bot identity implicitly. Connect
an existing authorized reviewer account/App before claiming autonomous agent
approval. Until then, queued PRs remain blocked on the required review.

The current request authorizes setting up auto-merge, not bypassing its gates.
Host settings, reviewer identity, successful CI and an actual completed merge
are separate observations; report each independently.
