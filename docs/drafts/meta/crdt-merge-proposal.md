# DRAFT — CRDT-like merge: concurrent agents/sessions improve and merge with the system through Telepathy

Status: draft, agent-authored (Prime, project steward) · 2026-09-24 · **Not published, not sent, not merged. No external effect.**
Written for human review; a named human accepts a specific revision. Nothing here is acceptance.
A passing Bend check is never acceptance (`docs/drafts/meta/op-dispatch-convention.md:154-157`).

Human intent: make the system CRDT-like so concurrent agents/sessions improve and merge with the system through Telepathy.

What changed / why it matters / what is needed: this draft scopes each surface to one job, names per-artifact convergent state and merge semantics, sets a deterministic quarantine-first conflict policy, keeps named human gates, and lists checkable acceptance plus open owner decisions — concrete enough that `@build` can start without re-deriving intent.

## 1. Outcome + owning scope per surface

| Surface | Role | Owns | Must NOT do |
|---|---|---|---|
| Telepathy (mailbox: `telepathy_send` / `telepathy_inbox` / `telepathy_status`) | Ephemeral delta transport ONLY | Carry candidate deltas + provenance (sender, session, base revision, artifact key) from worker to coordinator | Never durable memory; never merge, accept, or resolve |
| Buzz engram + git | Where merged state lives | Engram: durable knowledge records keyed by slug; git: revision authority for exact bytes | Neither auto-accepts: a write/record is not acceptance |
| Bend (`runtime/mundus.bend`, `runtime/memory.bend`, `runtime/policy.bend`, `runtime/worker/history.bend`) | The merge math | Pure, deterministic, compiler-checked merge/admit/quarantine decisions over handed-in values | No IO, clock, network, mkdir, hashing, spawn, or send |

Evidence:

- "Telepathy is **coordination only, never durable memory**" — `docs/drafts/meta/self-improvement-and-scale.md:35-36`; repeated as transport-vs-durable split at `:94` and limits at `:174-177`.
- "git remains the revision authority" + "coordinator merges" + "no worker writes the merged output" — `docs/drafts/meta/self-improvement-and-scale.md:53-59`.
- "An artifact is not 'done' until it is committed on a branch OR written to the Buzz engram" — `docs/drafts/meta/durability-guard.md:10-14`.
- Kernel boundary: pure core + effectful shell; Base has no `mkdir`; checker proves terms, not truth/acceptance — `runtime/mundus.bend:1-35` (header) and `docs/drafts/meta/mundus-kernel-laws.md:68-73,77-87,290-299`.
- Op/driver split (effects stay outside the kernel) — `docs/drafts/meta/op-dispatch-convention.md:82-104`; mustNot list (no accept/merge/push/publish/send/resolve from op or driver) at `:193-204`.
- "Tools prepare, humans accept" — `docs/drafts/meta/buzz-project-management.md:144-146`; reviewer-must-differ + approval≠merge at `:128-146`.

## 2. Convergent state per artifact type + merge semantics

Convergence rule: only the named canonical form below converges. Everything else is a proposal carried with provenance until a human accepts the exact revision.

| Artifact type | Convergent state (key) | Merge semantics (Bend math) | Source |
|---|---|---|---|
| Engram entries | `slug → body`, index line `slug\|digest`, sorted by slug; body at `<root>/memory/<slug>` with `/`→`__` | `parse_index`: sorted + deduped; malformed (`no \|`, `a\|b\|c`, `\|d`, `s\|`) and duplicate slugs QUARANTINED, first file-order wins, never silently merged; empty lines skipped | `docs/drafts/meta/memory-source-laws.md:8-17,20-28`; 20 laws at `:29-36` |
| Buzz history / relay deltas | Per-UTC-day `DayHistory{day, entries}`; ordering key `(day, thread, src)` | Canonical = `dedupe(sort(entries))`; `classify`: unknown kind / insane minute / src-regression → `Quarantine`, duplicate src → `Dedupe` (never silent merge), else `Admit`; structural digest reorder-invariant | `docs/drafts/meta/buzz-mem-history-laws.md:44-54,58-83`; 23 laws at `:85-118` |
| Plans / delegation shapes | Coordinator manifest row: `subtask_id, deliverable, acceptance, owned_files (distinct), owner, state, budget`; op run dir `ops/runs/<op>-<id>/{brief, candidate.patch, evidence, verdict}` | No auto-merge: workers RETURN artifacts, coordinator merges checked rows only; shared-file-free (distinct `owned_files`); RED halts its row only | `docs/drafts/meta/self-improvement-and-scale.md:38-50,53-69`; `docs/drafts/meta/op-dispatch-convention.md:127-140` |
| Verdicts | Folded verdict `Green / Yellow / Red` | `fold_verdicts`: empty→Green; Red dominates; `worse` commutative + associative; order witness | `docs/drafts/meta/mundus-kernel-laws.md:124-135`; `runtime/mundus.bend:479-607` |
| Census retirement proposals | Enumerator output `<root>/census.in`, one `kind\|path\|refcount\|digest` line per record | Host enumerates (`mkdir -p` + write `census.in` only); kernel classifies; proposal only — retirement itself is human-gated | `scripts/census.sh:2-18`; retirement flow per `docs/drafts/meta/engram-review/corrected/mem---mundus---passive-materialization.md:36-51` (unverified beyond cited lines — re-check live before build) |
| Policy rules | Rule entries e.g. `default-builder-read` etc.; decision = deny-by-default, first-match-wins on `(role,action)` + subset scope + review gate | Union of rule sets converges only as a sorted, slug-keyed set (same quarantine rules as engram entries); conflicting same-slug rules quarantine (never first-wins-silent); `decide` itself stays deny-by-default | Proposed content at `docs/drafts/meta/policy-decision.md:8-25`; slug rule at `:40`; open questions at `:42-48` (all draft, human-decided) |

Explicitly does NOT merge automatically (stays a proposal + human gate):

- Acceptance of any artifact (compiler GREEN / gate pass is never acceptance).
- Relay sends (`buzz` publish, notes, canvas, channel membership, issues/PR opens).
- Retirements (census proposals, `Retire`/`Spend` policy actions).
- Commits / merges / pushes / worktree cleans (git authority; durability-guard gate).
- Policy content changes (rule add/edit/remove).
- No agent accepts its own artifact or resolves a job (`docs/drafts/meta/buzz-project-management.md:217-229`; `docs/drafts/meta/self-improvement-and-scale.md:128-131`).

## 3. Conflict policy (deterministic, no silent drops)

Default stance: deterministic merge function + quarantine over silent merge. Every concurrent write carries `(key, base-revision, actor/session, payload)`; the merger never invents a winner silently.

| Conflict | Policy |
|---|---|
| Concurrent same-key writes, same body | Idempotent admit: same `slug\|digest` → one entry (dedupe, cf. `fixture_dedupe_duplicate` in `docs/drafts/meta/buzz-mem-history-laws.md:109`) |
| Concurrent same-key writes, different bodies | QUARANTINE both under `quarantine/<slug>/<actor-session>-<base>`; keep first-file-order readable entry per `mem_duplicate_first_wins` (`docs/drafts/meta/memory-source-laws.md:29-36`); coordinator surfaces the pair to the human; no last-writer-wins |
| Malformed delta (bad line, unknown kind, insane minute, src regression) | QUARANTINE with reason; never coerce or drop (`docs/drafts/meta/memory-source-laws.md:25-27`; `docs/drafts/meta/buzz-mem-history-laws.md:73-83,120-128`) |
| Deletes vs tombstones | No silent delete: a delete is a `Tombstone{slug, base, actor, reason}` proposal, itself human-gated; live entry stays readable until the tombstone is accepted; resurrected writes (newer base) quarantine against the tombstone rather than overwriting it (proposed — unverified, no implementing kernel exists yet) |
| Structured-value merges (manifest rows, run dirs, policy sets) | Field-wise only where a law already covers it (verdict fold assoc/comm; canonical sort/dedupe); otherwise whole-record quarantine: conflicting rows/dirs/rules do not field-merge without a named new law (proposed — unverified) |
| Claim collision (two workers, same `owned_files`) | Reject the later claim; reassign distinct files; preserve the first (`docs/drafts/meta/self-improvement-and-scale.md:63-68`) |
| RED anywhere in a row | Stop that row; do not merge; record evidence; nonzero exit (`docs/drafts/meta/op-dispatch-convention.md:142-153`) |
| Missing base / unknown predecessor | Quarantine (ordering integrity), cf. source-regression quarantine (`docs/drafts/meta/buzz-mem-history-laws.md:108`) |

Required properties of the future merge kernel (acceptance §5 restates as checks): determinism (same inputs → identical canonical output), commutativity/associativity of the fold where claimed, order-invariance of digests, and a falsification case proving quarantine fires.

## 4. What stays human-gated, by name

No agent accepts its own artifact or resolves a job. GREEN is never acceptance.

| # | Gated action | Gate holder | Note |
|---|---|---|---|
| G1 | Acceptance of any artifact (exact revision) | Named human reviewer (distinct from author) | `docs/drafts/meta/buzz-project-management.md:128-146`; `docs/drafts/meta/self-improvement-and-scale.md:128-131` |
| G2 | Relay sends (posts, notes, canvas, member adds, issue/PR creates/assigns, PR status) | Owner-controlled signer (`BUZZ_PRIVATE_KEY` environment) | Agent drafts only; `scripts/setup-programs.sh:9-13,28-30` per `docs/drafts/meta/buzz-project-management.md:103-110,178-191` |
| G3 | Retirements (census cleanup, `default-orchestrator-retire`, `default-orchestrator-spend`) | Named human, review-gated (`review: true` in `docs/drafts/meta/policy-decision.md:18-19`) | Retirement flow human-gated per `mem---mundus---passive-materialization.md:37-41` |
| G4 | Commits / merges / pushes / sync-clean in shared worktrees | Owning human / coordinator + durability-guard `check` gate | `docs/drafts/meta/durability-guard.md:42-54,56-78` |
| G5 | Policy content (rule add/edit/remove, budgets, scopes, review flags) | Named owner (unresolved — see O1) | Draft content only at `docs/drafts/meta/policy-decision.md:1-6,42-48` |
| G6 | Job resolution (`Review → Resolved`) and publication | Human only | `docs/drafts/meta/buzz-project-management.md:225-229` |

## 5. Acceptance criteria (all checkable)

| # | Criterion | Check |
|---|---|---|
| A1 | Merge-law checks pass | New/proposed `runtime/merge.bend` (or extension point named by O6): `bend <file> --check-only` → `All terms check.` covering §3 rows claimed as laws (determinism, same-key same-body idempotence, different-body quarantine, malformed quarantine, tombstone non-delete, digest reorder-invariance); plus one recorded failing mutation (falsification), cf. `docs/drafts/meta/mundus-kernel-laws.md:231-251` method |
| A2 | Convergence demo on concurrent fixtures | Deterministic script over two concurrent fixture histories with same-key conflicts: both orders produce byte-identical canonical output; conflicting bodies both present under `quarantine/`; exit 0; fixtures + digests recorded in `evidence` |
| A3 | Replay / provenance | Canonical output replays from `(key, base, actor/session, payload)` log; every admitted entry traces to its source event id (cf. `provenance_round_trip` in `docs/drafts/meta/buzz-mem-history-laws.md:91`); quarantine entries carry reason + source |
| A4 | Human-gate presence | Grep-level: merge path contains no accept/send/retire/commit/publish call; G1–G6 each map to a named human step in the run record; author≠reviewer on the accepted revision |
| A5 | No-durable-Telepathy | Telepathy layer writes no durable file; durable state appears only via engram write path or git commit (durability-guard `check` clean-tree semantics, `docs/drafts/meta/durability-guard.md:42-45`) |
| A6 | Rollback drill | Delete/tombstone + restore drill on scratch: pre-merge git SHA restores exact bytes (`git diff` empty after restore); snapshot dir restores untracked set |

Unverified at drafting time: no merge kernel file exists yet (A1 subject is proposed, not present); tombstone and structured-merge rows in §3 are proposed semantics without laws; `max_minute` placeholder and hex/pubkey mapping remain open per `docs/drafts/meta/buzz-mem-history-laws.md:150-164`.

## 6. Risks / limits and rollback

| Risk / limit | Handling |
|---|---|
| No distributed exclusive claims, merge safety, or global ordering today | Coordinator-only merge + one-writer-per-lineage + distinct `owned_files`; do not fan out non-independent work (`docs/drafts/meta/self-improvement-and-scale.md:98-106`; `docs/drafts/meta/op-dispatch-convention.md:107-119`) |
| Merge explosion (N divergent outputs) | Cap width per wave; waves budgeted before fan-out; coordinator merges checked rows only (`docs/drafts/meta/self-improvement-and-scale.md:80-96`) |
| Concurrent sync wipe of untracked work | Durability rule (§1) + `scripts/durability-guard.sh check` pre-sync gate + `snapshot` before destructive ops (`docs/drafts/meta/durability-guard.md:56-78`); gate is bypassable — pair with one-writer rule (`:91-105`) |
| Silent merge / last-writer-wins by accident | Quarantine-first policy (§3); duplicate/malformed witnesses in `docs/drafts/meta/memory-source-laws.md:29-36` and `docs/drafts/meta/buzz-mem-history-laws.md:102-128` |
| Structural digest is not sha256; shell owns real hashing | Keep shell-side sha256==digest + body-existence checks (`docs/drafts/meta/memory-source-laws.md:40-45`; `docs/drafts/meta/buzz-mem-history-laws.md:138-148`) |
| GREEN mistaken for acceptance | G1 + author≠reviewer; status `merged` is a label, not proof Git merged (`docs/drafts/meta/buzz-project-management.md:132-146`) |
| Rollback | Git is the rollback: merge lands as a commit on a branch from committed HEAD; revert is `git revert`/re-apply of pre-merge SHA; untracked quarantine sets restore from `durability-guard.sh snapshot` tarball; engram tombstones restore by accepting the re-admit proposal (human-gated) |

## 7. Numbered OPEN OWNER DECISIONS

1. Owner + independent reviewer for this proposal (named humans).
2. Merge kernel home: new `runtime/merge.bend` vs extension of `runtime/memory.bend` / `runtime/worker/history.bend` vs `runtime/mundus.bend` verb (O6 in §5/A1 depends on this).
3. Same-key different-body rule: quarantine-both (draft default) vs last-writer-wins with log vs human-picks-winner inline.
4. Tombstone shape and who may propose/accept a delete (actor roles, required reason fields).
5. Structured-merge scope: whole-record quarantine only, or named field-wise laws for manifest rows / policy rules.
6. Canonical ordering key: keep `(day, thread, src)` (`docs/drafts/meta/buzz-mem-history-laws.md:60-61`) or adopt `(date, actor, channel, thread, src)` (open question at `:152-154`).
7. Conflicting-duplicate handling in history: `Dedupe` vs `Quarantine` for same-`src`-different-body (open question at `docs/drafts/meta/buzz-mem-history-laws.md:152-154`).
8. Policy content: confirm default rule set, budget units, scope model, and review thresholds (`docs/drafts/meta/policy-decision.md:42-48`).
9. Coordinator manifest store location (`docs/drafts/meta/self-improvement-and-scale.md:154-170`, O-decision 3).
10. Scale caps: complexity-cost unit, `policy_cap`, wave size, stall policy (re-spawn vs escalate) (`docs/drafts/meta/self-improvement-and-scale.md:154-170`, O-decisions 1/2/4).
11. Frozen task set + measurement plan for the convergence demo (A2/A3 tasks, controls, budgets).
12. Rollback authority: who may revert a merged commit and who may accept a tombstone re-admit.

Non-claims: this draft invents no metrics, customers, or shipped features; no merge kernel exists yet; all citations are to drafts unless a checker/file observation is quoted; items marked unverified above are unverified.
