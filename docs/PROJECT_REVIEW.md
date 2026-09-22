# Review inside the existing Buzz project

Use the existing project's repository and review conversation. A candidate names
an immutable Git commit, the proposed change, verification evidence and unresolved
issues. Human review follows that exact revision. This document defines the native
workflow; it does not claim that a live review has already been created.

Prepared for the current change: [candidate at fa56d57](drafts/project-review/candidate-fa56d57.md)
and [project task](drafts/project-review/task.md). These files are ready to submit
from the existing authorized agent identity; they are not submission receipts.

Setup observation on 2026-09-22: the signed-in Desktop exposed Projects and a
Telepathy repository entry, but stable project/owner coordinates were not obtained.
The shell has no configured signing identity; a normal read-only relay query
returned HTTP 401 (`missing Nostr auth`). No project, task or PR was created or
approved by this setup attempt. Existing Desktop state and credentials remain intact.

## Identify the existing destination

In the signed-in Buzz Desktop, open the existing project and confirm its owner,
repository, project channel and current candidate. Read-only CLI equivalents, when
run inside an already authorized signing environment, are:

```sh
buzz projects list --owner OWNER_PUBKEY
buzz projects get PROJECT_SLUG --owner OWNER_PUBKEY
buzz repos get --owner REPO_OWNER --id REPO_ID
buzz pr list --repo-owner REPO_OWNER --repo-id REPO_ID
buzz pr get --event PR_EVENT_ID
```

Project and repository owners/identifiers are distinct coordinates; use the actual
linked repository rather than guessing from a project display name. Read an existing
PR before creating another. Do not export private keys from Desktop to a worker.

The installed CLI supports issues and PRs, but no separate `tasks`, `review`,
`pr comment` or `pr review` command. Its project-channel issue shorthand may create
a repository when none is bound. For existing-project work, use the explicit
verified repository owner/identifier to avoid that side effect.

## Candidate and task records

An issue can track the work and its acceptance criteria:

```sh
buzz issues create --repo-owner REPO_OWNER --repo-id REPO_ID --channel PROJECT_CHANNEL --title 'Review the candidate' --content - < task.md
buzz issues get --event ISSUE_EVENT_ID
```

Issue states are `open`, `resolved`, `closed`, `draft`. These are lifecycle labels,
not proof checks or exact-revision review decisions. Assignment is available through
`buzz issues assign --issue ISSUE_EVENT_ID --repo-owner REPO_OWNER --repo-id REPO_ID --assignee REVIEWER_PUBKEY`;
installed help says clients trust assignments from the issue author/repo owner,
with self-assignment also permitted. A display name alone does not establish authority.

Create or update the repository PR with the actual fetchable Git tip:

```sh
buzz pr open --repo-owner REPO_OWNER --repo-id REPO_ID --subject 'Candidate review' --commit COMMIT_SHA --clone CLONE_URL --branch-name BRANCH --channel PROJECT_CHANNEL --to REVIEWER_PUBKEY --body-file candidate.md
buzz pr update --repo-owner REPO_OWNER --repo-id REPO_ID --pr PR_EVENT_ID --pr-author PR_AUTHOR_PUBKEY --commit NEW_COMMIT_SHA --clone CLONE_URL --body-file revision.md
```

The body should name the full commit, base commit, changed paths, exact checks and
results, known failures, linked task, intended reviewer and acceptance criteria.
For non-code artifacts include immutable artifact location and content digest;
putting a digest in prose does not cause Buzz to validate that artifact automatically.

Only use these mutation commands under the user's authorization for the existing
project and through the established signer. They do not substitute for approval.
After submitting, fetch the returned event and confirm repository, author, tip,
clone URL and intended recipients. A sent command or display name is not readback.

## Native Desktop review

Open the PR in Buzz Desktop, inspect its Files Changed and conversation, and use
its review-request and approve/request-changes actions. The inspected upstream
implementation records a review decision as a signed, labeled comment tied to the
PR, repository and commit. It treats PR-author/repository-owner review requests as
trusted and counts decisions from requested reviewers or the repository owner.
It excludes the PR author as their own reviewer.

Consequently, an agent candidate should retain the real agent author identity and
request the authorized human reviewer. If the human authored the PR, the native
client will not let that same identity approve it. Never relabel an owner-signed
event as agent-authored to evade this rule. An explicit human acceptance reply can
record a decision in a project thread, but is a separate convention and must not
be described as a native PR approval.

When a PR tip changes, old-commit approvals do not count toward the current tip in
the inspected Desktop parser. Request a new review and inspect the updated diff.
Read back the accepted review's signer, root PR reference, repository and commit;
ensure the displayed current tip still matches. If it changed, return to review.

Approval and landing are separate. `buzz pr status --status merged` records a status;
it is not evidence that Git merged code, and it does not enforce an expected-tip
comparison. Desktop's ordinary lifecycle action omits `merged`; the source says
merges happen through Git. Before landing, independently verify the reviewed tip,
actual target and applicable tests. A status label cannot substitute for this check.

## Opening the native surface

The installed application registers the `buzz` URL scheme. Inspected upstream
source supports these navigation-only shapes:

```text
buzz://project?owner=PROJECT_OWNER&d=PROJECT_SLUG&tab=prs
buzz://pr?owner=REPO_OWNER&d=REPO_ID&id=PR_EVENT_ID
```

Encode query values and use actual coordinates. These links navigate; they do not
create a candidate, request a review, grant authority or accept a revision. No
native PR-review draft deep link was established in this inspection. The CLI's
owner-reviewed agent/channel draft commands are different operations.

## Verified scope and remaining checks

CLI syntax above comes from the installed `buzz ... --help` output. Native review
behavior was inspected in public upstream source at commit
`77729abfb692b25a0f4ec4a69add86af2e32c0dd`:

- [Review actions and reviewer eligibility](https://github.com/block/buzz/blob/77729abfb692b25a0f4ec4a69add86af2e32c0dd/desktop/src/features/projects/pullRequestReviews.ts).
- [Trusted updates and current-commit decision selection](https://github.com/block/buzz/blob/77729abfb692b25a0f4ec4a69add86af2e32c0dd/desktop/src/features/projects/projectPullRequests.mjs).
- [Validated native navigation links](https://github.com/block/buzz/blob/77729abfb692b25a0f4ec4a69add86af2e32c0dd/desktop/src-tauri/src/deep_link.rs).

These establish source-level client behavior, not that the installed Desktop is
identical or that the relay enforces a server-side merge/approval transaction.
Confirm the installed UI and live project before reporting successful setup.
No custom review server, signing adapter, memory database or automatic acceptance
is introduced. Keep session logs, private signing material and raw conversations
out of public candidate records.

## OpenCode reviewer and GitHub auto-merge

Use the repo's `@reviewer` for a read-only assessment of the exact candidate.
[Auto-merge setup](AUTO_MERGE.md) describes the separate GitHub checks and
approval requirements. A Buzz review or an OpenCode `no_findings` report does
not automatically satisfy GitHub's required independent approval.
