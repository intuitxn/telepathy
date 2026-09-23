Telepathy Project→Job→Timeline — Minimum Contract (6d237531) — to 8bda7e6d

> Status update (2026-09-22): `runtime/desk` was retired 2026-09-22. The
> `runtime/desk/*` implementation paths cited below are historical design
> references; retained execution is standard OpenCode + native Buzz ACP + the
> checked Bend worker (`runtime/adaptive/HARNESS.md`, `runtime/worker/`). The
> contract body is preserved as a design record.

Owner: workspace-sync / Reviewer:intuition-telepathy-harness. Authority: read-only, no pushes/deploy/membership/config. Ledger harness/ledger.jsonl {id,ts,type,actor,payload} is truth; typed job events layered on top. Implementation: runtime/desk/src/jobs.js + .archive/harness/jobs.ts (fold+validate), verified via runtime/desk/test/jobs.test.js (4 tests). Agent Manager is navigation only (task/sessions/reservations + send/read), no SQLite direct, localhost-only.

1. Project→Job→Timeline
Project {id, displayName, buzzChannel hint, linkedGroups hint} groups work (intuitxn/telepathy). Job 1:1 with task id (desk SQLite jobs). Timeline append-only typed events → fold→Job. Project cards are Todo/In Progress/Done for humans (docs/PROJECTS.md); Job states are execution truth.

2. Job fields (minimum)
Job {id,project_id,title,objective,acceptance[], owner:ActorRef, reviewer:ActorRef, state, next_actor:ActorRef|null (REQUIRED, null only terminal), waiting_reason:WaitingReason|null (REQUIRED when Waiting), run_links:RunLink[], artifacts:Artifact[] (Candidate|Accepted), resolution:ResolutionRecord|null, timeline:TimelineEvent[]}
ActorRef {kind:human|agent|system, id, label?}

3. States (7 deterministic)
Proposed→Ready→Active→Waiting→Review→Resolved | Cancelled
Allowed: Proposed[Ready,Cancelled] Ready[Active,Waiting,Cancelled] Active[Waiting,Review,Cancelled] Waiting[Ready,Active,Review,Cancelled] (must==resume_to) Review[Active,Waiting,Resolved,Cancelled] Resolved[] Cancelled[].
Desk enforces via ALLOWED map + isAllowed; claim queued→running, runJob→needs_review, acceptJob needs_review→resolved with human reviewer, landJob copies worktree.

4. Next actor + waiting reason
next_actor mandatory every state; Waiting/Review must be specific human/agent; terminal→null.
waiting_reason only when Waiting: {kind:dependency|decision|input|access|external|time, detail:string (never just "blocked"), blocked_on?:string[], resume_to:Ready|Active|Review}

5. Typed timeline (8 core types, each = ledger entry type:job.* with job_id)
job.proposed→Proposed, job.ready→Ready, job.activated→Active, job.waiting→Waiting, job.review_requested→Review, artifact.candidate→Candidate, artifact.accepted→Candidate→Accepted, run.linked→RunLink, job.next_actor_changed (handoff), job.resolved→Resolved, job.cancelled→Cancelled.
Ledger mapping: ledger {id:event_id, ts:at, type:TimelineEventType, actor:ActorRef.id, payload:{job_id,...}}.

6. Agent Manager run links
RunLink {provider:"agent-manager", session_id, role:owner|worker|reviewer, linked_at:ISO, session_name_snapshot}
Linked on activate; multiple allowed. Example ids: d6815bbc (codex worker), 0fafd435 telepathy-harness, 38b27dbe intuitxn-telepathy-system. Provider must be agent-manager.

7. Artifacts candidate/accepted
Artifact {id,kind,ref,revision,state:Candidate|Accepted, produced_by, run_session_id?, proposed_at, accepted_by?, accepted_at?}
Candidate in .local/jobs/<id>/worktree (disposable) + changes.patch; main repo untouched until land. Only Accepted may be in resolution.accepted_artifact_ids; accepted only by human != producer with evidence.

8. Resolution (one of accepted_artifact|decision|cancelled|next_owner)
ResolutionRecord {outcome:completed|no_change, summary, accepted_artifact_ids[], resolved_by:ActorRef, resolved_at}
Gate (hard reject): (a) ≥1 accepted artifact IDs all Accepted OR explicit decision, (b) verification passed (tests/build evidence before review), (c) human verifier unless autoResolveAuthorized, (d) no remainingWork OR followUpJobIds present.

9. Example — Shubham, Om, Kush + agents (job 5046e555 landed 05afab1, accepted by Shubham)
Project intuitxn/telepathy (#telepathy), Job 5046e555 title "Add Agent activity model to docs/AGENT_MAP.md" owner Shubham reviewer Shubham acceptance ["checked facts only"].

Timeline:
1 job.proposed Shubham→Proposed next_actor Shubham
2 job.ready Shubham→Ready next_actor Kush owner Shubham reviewer Om
3 run.linked system d6815bbc worker (codex exec)
4 job.activated→Active next_actor Kush
5 artifact.candidate ag-map-01 rev abc ref .local/jobs/.../docs/AGENT_MAP.md Candidate by agent:Kush
6 job.waiting→Waiting reason {kind:input detail:"needs Om live review of diagram" resume_to:Review} next_actor Om
7 live participation Om+Kush session 38b27dbe → run.linked reviewer + next_actor_changed to Om
8 job.review_requested→Review candidate_ids [ag-map-01] next_actor Om
9 artifact.accepted ag-map-01 rev abc by human:Shubham evidence "site builds 15 tests pass"
10 job.resolved→Resolved resolution {outcome:completed summary:"AGENT_MAP updated" accepted_ids[ag-map-01] resolved_by human:Shubham} next_actor null; landJob copies worktree→repo commit 05afab1 pushes origin+buzz.

All criteria: states covered, next_actor always, waiting_reason explicit, 11 typed events, run_links to Agent Manager, Candidate→Accepted, resolution gate (accepted artifact + verification + human + no remaining).

Full detail: /tmp/memo.md (9756b) and implementation files above. Task 6d237531 already done by job-contract-verifier; delivering memo to satisfy DELIVERY.

— job-contract-designer (ses_fa1734319ffeAZH2yXbyED3p19) workspace-sync
