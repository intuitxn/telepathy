> Design proposal — not shipped. Prepared as a bounded design pass on 2026-09-18.
> Owner review required before any implementation starts.
> This file is the only artifact of this pass. It changes no runtime code.

> Update 2026-09-18: body below is the original design record — `cli.py`
> has since gained `bend-gate`/`gen-runner` and a v1.1 single-run rewrite,
> and the gate is bare `bend PROOF.bend` on 2.0.5 (no `bend check`).

> Status update (2026-09-22): `runtime/desk` (and the `runtime/desk/src/cli.js` +
> `jobs.js` paths cited below) was retired 2026-09-22 and the oc2 fork
> (`runtime/opencode-v2`) was retired on the same date. Those citations are
> historical design references; retained execution is standard OpenCode + native
> Buzz ACP + the checked Bend worker (`runtime/adaptive/HARNESS.md`,
> `runtime/worker/`). The design body is preserved.

# Agentic-git: git as the state store on top of Nudge + Bend

**Status:** design proposal · **Base:** `HARNESS.md`, `docs/PROJECTS.md`, `docs/SHARED_PRODUCT.md`, `runtime/programs/README.md` + `LIVE_RUN.md`, `runtime/desk/src/cli.js` + `jobs.js`

## 0. Frame

Today state is split three ways (`HARNESS.md` §3):

| Store | Holds |
|---|---|
| Buzz relay | human requests and acceptance |
| Desk SQLite in `.local/` | job, artifact, outbox execution state |
| Git | accepted revisions only |

Problem: the middle store is private, mutable, and unreviewable. A job's path from
`Proposed -> Ready -> Active -> Waiting -> Review -> Resolved | Cancelled`
(`docs/PROJECTS.md`) exists only as SQLite rows. Anyone auditing later sees the
landed commit (`land <id>: … — accepted by <reviewer>`, `jobs.js:landJob`) but not
the transitions, the exact `PromptBundle` digest that produced the candidate, or
the proof result behind it.

Proposal: **git becomes the state store for agents.** Every state transition is a
git object — commit, note, or tag — carrying three things:

1. **PromptBundle digest** (`sha256:…` from `telepathy-program compile`, Nudge thin compiler),
2. **Bend proof result** (`PROOF.bend` check outcome — Bend proves, Nudge does not),
3. **human acceptance** (named reviewer + exact revision, never an agent).

Division of labor, stated once:

- **Nudge stays thin.** `ProgramSource Markdown -> compile_program -> immutable
  PromptBundle -> HarnessAdapter -> ProgramResult`. No approval logic, no merge
  logic, no identity logic in Nudge. `runtime/programs/cli.py` is untouched by this design.
- **Bend proves correctness.** Each job ships a small `PROOF.bend` declaring checkable
  laws over the candidate (exact-revision law, source-separation law, human-authorship
  law, acceptance-shape law — §4). `bend check` emits a machine-readable result.
  The proof gate is a pure function of (candidate bytes, bundle digest, proof source).
  Model text claiming approval is not evidence (`runtime/programs/README.md` §"Learning").
- **Git stores.** Desk SQLite stays as a local execution cache/index. Buzz stays the
  human request/acceptance channel. Git becomes the durable, reviewable, immutable
  record both of them point at.

Non-goals: no new DSL, VM, scheduler, or model-based compiler; no change to Nudge
core files; no credentials, transcripts, session IDs, or private source IDs in git
objects (existing guards in `cli.py` + `README.md` apply to notes/tags too); no
agent self-accept; no automatic merge.

## 1. State → git mapping table

One job = one state branch + appended notes + terminal tags. The working tree
candidate still lives in `.local/jobs/<id>/worktree` (disposable); the *record*
lives in git.

| Job state | Git object | Written by | Must carry (§2–§3) |
|---|---|---|---|
| `Proposed` | commit on `agit/job-<id>` (branch init, contains `JOB.nudge.md` intent + `PROOF.bend` skeleton, no candidate) | operator / `agit propose` | bundle digest of the program that will run (or `none` + reason), job intent hash |
| `Proposed -> Ready` | `git notes` on that commit, ref `refs/notes/agit-state` | operator | readiness receipt: repo allowlisted, context snapshots sha256, base commit |
| `Ready -> Active` | commit on `agit/job-<id>` (run envelope: `brief.md` hash, worktree base, model + adapter identity) | `agit run` wrapper | `PromptBundle` digest, `telepathy-program` receipt id |
| `Active -> Waiting` | `git notes` on the run commit, ref `refs/notes/agit-proof` | proof gate | Bend `PROOF.bend` result: `pass`/`fail`, proof digest, evaluated laws |
| `Waiting -> Review` | commit on `agit/job-<id>` (candidate patch hash + `result.md` hash, never full transcript) | worker | candidate digest, bundle digest, proof digest, `scoreStatus` |
| `Review -> Resolved` | merge commit to `main` (or `land` commit, keeping current `land <id>:` message) **+** annotated tag `agit/<id>/resolved` | human-authorized `agit accept` | reviewer identity, exact candidate digest, proof `pass` digest, trailers (§2) |
| `* -> Cancelled` | annotated tag `agit/<id>/cancelled` on last state commit + closing note | human | canceller, reason, exact state closed |
| `lesson proposal` (sub-flow) | commit carrying `{source,parentDigest,candidateDigest}` triple | `telepathy-program` validate path | frozen-source check outcome; activation still requires exact-digest promotion (§5, rule 2) |

`Resolved` and `Cancelled` are the only terminal states. An agent stopping, a model
returning text, or a proof passing is never resolution — only the `Review ->
Resolved` merge commit with a named human reviewer resolves a job (`HARNESS.md` §2).

Desk SQLite rows (`queued`, `running`, `needs_review`, `needs_attention`,
`resolved` in `jobs.js`) become a *projection* of this git record, rebuildable with
`agit state <id>`. If SQLite and git disagree, git wins and the discrepancy is
surfaced, never silently repaired.

## 2. Object model

### 2.1 Commit message format

All agit commits (state-branch commits and land/merge commits) use one format:

```text
<verb> <job-id>: <short intent, ≤80 cols> — <stage>

Job: <full-job-id>
Stage: proposed|ready|active|waiting|review|resolved|cancelled
Bundle-Digest: sha256:<64 hex> | none (reason in body)
Proof-Digest: sha256:<64 hex> | none (not-yet-evaluated)
Proof-Result: pass|fail|not-evaluated
Candidate-Digest: sha256:<hex of canonical candidate bytes> | none
Receipt-Id: <telepathy-program receipt uuid> | none
Reviewer: <human name> | none
Parent-Digest: sha256:<…> (lesson sub-flow only)

<body: what changed, evidence paths by hash, never transcripts>
```

Trailer rules: trailers are the machine-readable record; the subject line is human
summary only. `Bundle-Digest`, `Proof-Digest`, `Proof-Result`, and
`Candidate-Digest` are mandatory from `Active` onward. `Reviewer` is mandatory on
`resolved`, forbidden (must be `none`) on every earlier stage — an agent cannot
pre-fill acceptance. The existing land message (`land <id>: … — accepted by
<reviewer>`) is kept as the subject line of the `Review -> Resolved` commit for
back-compatibility; the trailers are added beneath it.

### 2.2 Notes refs

State that annotates a commit without rewriting it goes in notes refs, never in
rewritten messages:

| Ref | Content | Example |
|---|---|---|
| `refs/notes/agit-state` | readiness / waiting metadata: base commit, context snapshot sha256s, worktree identity, model + adapter | `base: 05afab1\ncontext: [.. sha256 ..]\nmodel: opencode-go/deepseek-v4-flash\nadapter: telepathy-oc2-cli/v1` |
| `refs/notes/agit-proof` | Bend proof result envelope: proof source digest, per-law outcomes, evaluator version | `{"proofDigest":"sha256:…","result":"pass","laws":{"exact-revision":"pass","source-separation":"pass"},"bend":"<version>"}` |
| `refs/notes/agit-review` | human review record: reviewer, exact candidate digest reviewed, verdict, timestamp | `reviewer: Shubham\ncandidate: sha256:…\nverdict: accept\nat: 2026-09-…` |

Notes are fetched/pushed explicitly (`+refs/notes/agit-*:refs/notes/agit-*`).
A transition commit without its required note is incomplete and the proof gate
rejects the *next* transition until it exists (§5).

### 2.3 Tag scheme

```text
agit/<job-id>/resolved    annotated tag on the land/merge commit
agit/<job-id>/cancelled   annotated tag on the last state commit
agit/<job-id>/review-<n>  lightweight tag on each Review-stage commit (n = 1,2,…)
```

Tag messages for terminal tags repeat the commit trailers (reviewer, candidate,
bundle, proof digests). Tags are the stable pointers Buzz resolution replies and
the changelog quote — never a SQLite row id alone. Deleting or moving an
`agit/<id>/resolved` tag is treated as history tampering: the gate refuses to
resolve the job twice and a human must intervene with a new job.

## 3. CLI sketch

No changes to `telepathy-program` or `desk`. `agit` is a thin wrapper that calls
them and writes the git record. The proof gate is a separate pure check both paths
go through.

```sh
# Nudge stays thin: compile + run exactly as today.
runtime/programs/telepathy-program compile artifact-design
printf '%s' '{"title":"…","body":"…","sourceIds":[]}' \
  | runtime/programs/telepathy-program run artifact-design --input - > result.json

# Bend proves: PROOF.bend over the candidate. Gate output is JSON on stdout,
# exit nonzero on fail. It never merges, accepts, or publishes.
bend check .local/jobs/<id>/PROOF.bend --candidate .local/jobs/<id>/result.md > proof.json

# agit records: every transition is a git object. agit never invents digests;
# it copies them from result.json (receipt.bundleDigest) and proof.json.
agit propose --job <id> --program artifact-design --request request.json
agit ready   --job <id>                       # writes refs/notes/agit-state
agit run     --job <id>                       # Active commit (bundle digest + receipt id)
agit prove   --job <id> --proof proof.json    # Waiting note (refs/notes/agit-proof)
agit review  --job <id>                       # Review commit (candidate digest)
agit accept  --job <id> --reviewer "Name"     # proof gate re-check + merge + tag
agit cancel  --job <id> --by "Name" --reason "…"

# Read-only inspection (rebuilds state from git; SQLite is not consulted):
agit log   <id>        # transition history: commits + notes + tags, one line per stage
agit state <id>        # current stage + required digests + what blocks the next stage
```

`agit accept` runs the proof gate inline before merging:

```text
agit accept(ID, reviewer):
  1. load Review commit trailers + refs/notes/agit-proof + refs/notes/agit-review
  2. gate: proof.result == pass AND proof.candidate == review.candidate
           AND review.candidate == merge.candidate (exact-revision law)
           AND reviewer is human, != worker (§5 rule 1)
           AND bundle digest == active compile digest (stale-digest rule)
           AND no law open (§5 rule 3)
  3. only then: merge --no-ff agit/job-ID -> main, tag agit/ID/resolved
  4. emit Buzz resolution reply quoting commit + tag (human sends)
```

Failure at any gate step aborts with no merge, no tag, and a note explaining which
rule fired. The existing `desk accept ID REVIEWER` semantics (Review -> Resolved
only from `needs_review`, named reviewer) are preserved; `agit accept` adds the
digest + proof + law checks on top.

## 4. PROOF.bend sketch (what Bend checks)

`PROOF.bend` is job-scoped, small, and declarative. Suggested initial law set —
each law is `pass`/`fail`, and any non-`pass` is an *open law*:

| Law | Checks |
|---|---|
| `exact-revision` | reviewed candidate bytes == merged candidate bytes (prevents stale approval, cf. `SHARED_PRODUCT.md` acceptance evidence) |
| `source-separation` | candidate contains no supplied `sourceIds`, no receipt ids, no transcript text (extends the existing host guard in `cli.py`) |
| `human-authorship` | commit author/committer and `Reviewer:` trailer resolve to a human; worker identity ≠ reviewer |
| `acceptance-shape` | candidate carries the job's acceptance fields (title/body present, typed contract valid per Nudge output schema) |
| `lineage` | bundle digest chains to the active program digest; lesson candidates additionally satisfy frozen-source + parent-digest equality |

Bend evaluates these over bytes and digests only. It never calls a model, never
reads credentials, never touches the network. `scoreStatus: not_evaluated` (Nudge
evaluation protocol) and proof `pass` are orthogonal claims recorded side by side,
never conflated.

## 5. Rejection rules (the gate)

These are hard rejects. Any violation aborts the transition with no partial write.

1. **No self-accept.** The worker identity (model/adapter/session that produced the
   candidate) can never satisfy `Reviewer:`. `agit accept` requires a named human
   reviewer distinct from the worker; an empty, agent, or model-claimed reviewer
   fails. Model text claiming approval is not evidence.
2. **No stale digest promotion.** Every advancing transition revalidates exact
   digests: bundle digest == currently active compile digest; candidate digest ==
   reviewed digest == merged bytes; lesson `{parentDigest, candidateDigest}` pair
   revalidated under lock exactly as `promote-candidate` does today. Stale parent,
   mismatched candidate, or unchanged-candidate promotion fails.
3. **No merge on open law.** If any Bend law is `fail` or `not-evaluated`, or the
   required `refs/notes/agit-proof` note is missing, `agit accept` refuses to
   merge or tag. Clearing a law means fixing the candidate and recording a new
   `Review` commit + fresh proof — never editing the old proof note.
4. **No transcript/credential leakage.** Commits, notes, and tags carry digests and
   verdicts only. Full prompts, model transcripts, `BUZZ_PRIVATE_KEY`, keyfiles,
   source conversation text, and private source IDs are rejected by a pre-commit
   scan (same exact-supplied-ID guard as the host). A violation fails the transition.
5. **No silent repair.** If SQLite disagrees with git, `agit state` reports both and
   blocks advancement until a human reconciles. The gate never rewrites history to
   match the cache.

## 6. Verification (before this ships)

1. `agit state <id>` on the already-resolved smoke jobs rebuilds their stage from
   git alone (backfill test: land commits gain trailers retroactively in notes, history untouched).
2. Golden-file test: a fixture job walks all six states; assert exact commit subjects,
   trailers, notes refs, and tag names byte-for-byte.
3. Rejection tests, one per §5 rule: self-accept, stale digest, open-law merge,
   leakage scan, and SQLite/git divergence each fail with the named error and leave
   no partial object.
4. `npm run check` (runtime + plugin) still passes; `telepathy-program` unit tests
   untouched; no new network, credential, or scheduler surface.

## 7. Open questions for the owner

1. Backfill depth: notes-only annotation of historical land commits, or leave history verbatim and start agit from the next job?
2. Notes fetch policy: explicit refspec on operator machines only, or also on the Buzz relay repo remotes?
3. Should `agit/<id>/review-<n>` tags be pushed by default, or stay local until resolution?
