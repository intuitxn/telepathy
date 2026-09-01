/**
 * harness/jobs.ts — Telepathy Job contract v0 (accepted steward message 124/128)
 *
 * Minimum message artifact defining Job, states, typed timeline, and hard invariants.
 * Authority: harness append-only ledger is truth; Job/Buzz are projections.
 * Agent Manager is linked via RunLink provider+session_id only; no state.db access.
 *
 * Implementation for task 70a2483e — wire into ledger.ts/socket.ts validation,
 * localhost-only default, tests covering valid trace + invalid rejections.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. Minimum record — exact types from contract v0
// ─────────────────────────────────────────────────────────────────────────────

export type JobState =
  | "Proposed"
  | "Ready"
  | "Active"
  | "Waiting"
  | "Review"
  | "Resolved"
  | "Cancelled";

export type ActorRef = {
  kind: "human" | "agent" | "system";
  id: string;
  label?: string;
};

export type WaitingReason = {
  kind: "dependency" | "decision" | "input" | "access" | "external" | "time";
  detail: string; // never only "blocked"
  blocked_on?: string[];
  resume_to: "Ready" | "Active" | "Review";
};

export type RunLink = {
  provider: "agent-manager";
  session_id: string; // canonical
  role: "owner" | "worker" | "reviewer";
  linked_at: string; // ISO-8601
  session_name_snapshot?: string; // display only
};

export type Artifact = {
  id: string;
  kind: string;
  ref: string; // immutable path/URL/content-addressed ref
  revision: string;
  state: "Candidate" | "Accepted";
  produced_by: ActorRef;
  run_session_id?: string;
  proposed_at: string;
  accepted_by?: ActorRef;
  accepted_at?: string;
};

export type ResolutionRecord = {
  outcome: "completed" | "no_change";
  summary: string;
  accepted_artifact_ids: string[]; // exact accepted revisions
  resolved_by: ActorRef;
  resolved_at: string;
};

export type Job = {
  id: string;
  project_id: string;
  title: string;
  objective: string;
  acceptance: string[];
  owner: ActorRef;
  reviewer: ActorRef;
  state: JobState;
  next_actor: ActorRef | null;
  waiting_reason: WaitingReason | null;
  run_links: RunLink[];
  artifacts: Artifact[];
  resolution: ResolutionRecord | null;
  timeline: TimelineEvent[];
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. Typed append-only timeline — discriminated events
// Every ledger entry maps: {id→event_id, ts→at, actor→actor, type→type, payload→payload+job_id}
// ─────────────────────────────────────────────────────────────────────────────

export type TimelineEventType =
  | "job.proposed"
  | "job.ready"
  | "job.activated"
  | "job.waiting"
  | "job.review_requested"
  | "job.next_actor_changed"
  | "run.linked"
  | "artifact.candidate"
  | "artifact.accepted"
  | "job.resolved"
  | "job.cancelled";

export interface BaseEvent {
  event_id: string;
  job_id: string;
  at: string;
  actor: ActorRef;
  type: TimelineEventType;
  payload: unknown;
}

// Payloads exactly as contract
export interface JobProposedPayload {
  to: "Proposed";
  title: string;
  objective: string;
  next_actor: ActorRef;
  project_id?: string;
  acceptance?: string[];
  owner?: ActorRef;
  reviewer?: ActorRef;
}

export interface JobReadyPayload {
  from: "Proposed" | "Waiting";
  to: "Ready";
  acceptance: string[];
  owner: ActorRef;
  reviewer: ActorRef;
  next_actor: ActorRef;
  title?: string;
  objective?: string;
}

export interface JobActivatedPayload {
  from: "Ready" | "Waiting" | "Review";
  to: "Active";
  next_actor: ActorRef;
  reason?: string;
}

export interface JobWaitingPayload {
  from: "Ready" | "Active" | "Review";
  to: "Waiting";
  waiting_reason: WaitingReason;
  next_actor: ActorRef;
}

export interface JobReviewRequestedPayload {
  from: "Active" | "Waiting";
  to: "Review";
  candidate_artifact_ids: string[];
  next_actor: ActorRef;
}

export interface JobNextActorChangedPayload {
  state: JobState;
  from_actor: ActorRef;
  to_actor: ActorRef;
  reason?: string;
}

export interface RunLinkedPayload {
  run: RunLink;
}

export interface ArtifactCandidatePayload {
  artifact: Artifact & { state: "Candidate" };
}

export interface ArtifactAcceptedPayload {
  artifact_id: string;
  revision: string;
  accepted_by: ActorRef;
  accepted_at: string;
  evidence?: string;
}

export interface JobResolvedPayload {
  from: "Review";
  to: "Resolved";
  resolution: ResolutionRecord;
  next_actor: null;
}

export interface JobCancelledPayload {
  from: "Proposed" | "Ready" | "Active" | "Waiting" | "Review";
  to: "Cancelled";
  reason: string;
  cancelled_by: ActorRef;
  next_actor: null;
}

export type TimelineEvent =
  | { type: "job.proposed"; payload: JobProposedPayload }
  | { type: "job.ready"; payload: JobReadyPayload }
  | { type: "job.activated"; payload: JobActivatedPayload }
  | { type: "job.waiting"; payload: JobWaitingPayload }
  | { type: "job.review_requested"; payload: JobReviewRequestedPayload }
  | { type: "job.next_actor_changed"; payload: JobNextActorChangedPayload }
  | { type: "run.linked"; payload: RunLinkedPayload }
  | { type: "artifact.candidate"; payload: ArtifactCandidatePayload }
  | { type: "artifact.accepted"; payload: ArtifactAcceptedPayload }
  | { type: "job.resolved"; payload: JobResolvedPayload }
  | { type: "job.cancelled"; payload: JobCancelledPayload };

// Ledger entry as stored (harness/ledger.jsonl)
export interface LedgerEntry {
  id: string;
  ts: string;
  type: string;
  actor: string;
  payload: unknown;
  seq?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Allowed transitions (contract 2)
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED: Record<JobState, JobState[]> = {
  Proposed: ["Ready", "Cancelled"],
  Ready: ["Active", "Waiting", "Cancelled"],
  Active: ["Waiting", "Review", "Cancelled"],
  Waiting: ["Ready", "Active", "Review", "Cancelled"], // but must equal resume_to
  Review: ["Active", "Waiting", "Resolved", "Cancelled"],
  Resolved: [],
  Cancelled: [],
};

function isAllowed(from: JobState, to: JobState): boolean {
  return (ALLOWED[from] ?? []).includes(to);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function isNonTerminal(s: JobState): boolean {
  return s !== "Resolved" && s !== "Cancelled";
}

function isValidActorRef(a: unknown): a is ActorRef {
  if (!a || typeof a !== "object") return false;
  const r = a as Record<string, unknown>;
  return (
    typeof r.kind === "string" &&
    ["human", "agent", "system"].includes(r.kind as string) &&
    typeof r.id === "string" &&
    r.id.length > 0
  );
}

function isValidWaitingReason(w: unknown): w is WaitingReason {
  if (!w || typeof w !== "object") return false;
  const r = w as Record<string, unknown>;
  return (
    typeof r.kind === "string" &&
    ["dependency", "decision", "input", "access", "external", "time"].includes(r.kind as string) &&
    typeof r.detail === "string" &&
    r.detail.trim().length > 0 &&
    r.detail.trim().toLowerCase() !== "blocked" &&
    typeof r.resume_to === "string" &&
    ["Ready", "Active", "Review"].includes(r.resume_to as string)
  );
}

function findArtifact(artifacts: Artifact[], id: string, revision?: string): Artifact | undefined {
  return artifacts.find((a) => a.id === id && (revision ? a.revision === revision : true));
}

// Build job fold from ledger entries for a given job_id
export function foldJob(job_id: string, entries: LedgerEntry[]): Job | null {
  const jobEntries = entries
    .filter((e) => {
      const p = e.payload as Record<string, unknown> | null;
      if (!p) return false;
      // job_id must be in payload or top-level? contract uses job_id in event
      return (p as Record<string, unknown>).job_id === job_id || (e.payload as Record<string, unknown>).jobId === job_id;
    })
    .sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));

  if (jobEntries.length === 0) return null;

  // Initialize from first proposed
  let job: Job | null = null;

  for (const e of jobEntries) {
    const p = e.payload as Record<string, unknown>;
    if (!p) continue;

    switch (e.type) {
      case "job.proposed": {
        if (job) break; // duplicate proposed ignored (would be rejected by validation)
        const payload = p as unknown as JobProposedPayload;
        job = {
          id: job_id,
          project_id: (payload.project_id as string) ?? (p.project_id as string) ?? "unknown",
          title: String(payload.title ?? job_id),
          objective: String(payload.objective ?? ""),
          acceptance: Array.isArray(payload.acceptance) ? [...(payload.acceptance as string[])] : [],
          owner: (payload.owner as ActorRef) ?? { kind: "system", id: "unknown" },
          reviewer: (payload.reviewer as ActorRef) ?? { kind: "system", id: "unknown" },
          state: "Proposed",
          next_actor: payload.next_actor as ActorRef,
          waiting_reason: null,
          run_links: [],
          artifacts: [],
          resolution: null,
          timeline: [],
        };
        job.timeline.push(e as unknown as TimelineEvent);
        break;
      }
      case "run.linked": {
        if (!job) break;
        const payload = p as unknown as RunLinkedPayload;
        if (payload.run && typeof payload.run.session_id === "string") {
          // provider must be agent-manager; enforce but also allow fold
          job.run_links.push(payload.run as RunLink);
        }
        job.timeline.push(e as unknown as TimelineEvent);
        break;
      }
      case "artifact.candidate": {
        if (!job) break;
        const payload = p as unknown as ArtifactCandidatePayload;
        const art = payload.artifact;
        if (art && art.id && art.revision) {
          job.artifacts.push({ ...art } as Artifact);
        }
        job.timeline.push(e as unknown as TimelineEvent);
        break;
      }
      case "artifact.accepted": {
        if (!job) break;
        const payload = p as unknown as ArtifactAcceptedPayload;
        const art = findArtifact(job.artifacts, String(payload.artifact_id), String(payload.revision));
        if (art) {
          art.state = "Accepted";
          art.accepted_by = payload.accepted_by as ActorRef;
          art.accepted_at = String(payload.accepted_at);
        } else {
          // If candidate not found, still create an accepted entry for tracking validation failure earlier, but fold as accepted
          // This mirrors that validation would have rejected, but fold still records
          job.artifacts.push({
            id: String(payload.artifact_id),
            kind: "unknown",
            ref: "",
            revision: String(payload.revision),
            state: "Accepted",
            produced_by: { kind: "system", id: "unknown" },
            proposed_at: e.ts,
            accepted_by: payload.accepted_by as ActorRef,
            accepted_at: String(payload.accepted_at),
          });
        }
        job.timeline.push(e as unknown as TimelineEvent);
        break;
      }
      default: {
        if (!job) break;
        // State-changing events
        const payload = p as Record<string, unknown>;
        const to = payload.to as JobState | undefined;
        if (to && typeof to === "string" && (ALLOWED[job.state] ?? []).includes(to)) {
          // Update state
          job.state = to as JobState;
          // Update next_actor / waiting_reason / etc per payload
          if ("next_actor" in payload) {
            job.next_actor = (payload.next_actor as ActorRef | null) ?? null;
          }
          if (e.type === "job.waiting" && payload.waiting_reason) {
            job.waiting_reason = payload.waiting_reason as WaitingReason;
          } else if (job.state !== "Waiting") {
            // Leaving waiting handled by transition; clear if not Waiting
            if (to !== "Waiting") job.waiting_reason = null;
          }
          if (e.type === "job.ready") {
            const pr = payload as unknown as JobReadyPayload;
            if (Array.isArray(pr.acceptance)) job.acceptance = [...pr.acceptance];
            if (pr.owner) job.owner = pr.owner as ActorRef;
            if (pr.reviewer) job.reviewer = pr.reviewer as ActorRef;
            if (pr.title) job.title = String(pr.title);
            if (pr.objective) job.objective = String(pr.objective);
          }
          if (e.type === "job.resolved") {
            const pr = payload as unknown as JobResolvedPayload;
            job.resolution = pr.resolution as ResolutionRecord;
          }
          if (e.type === "job.cancelled") {
            // terminal, no resolution
            job.next_actor = null;
          }
        }
        // For next_actor_changed, just track
        if (e.type === "job.next_actor_changed") {
          const pr = payload as unknown as JobNextActorChangedPayload;
          // state's next_actor updated but keep job.state as is per payload.state
          if (pr.to_actor) job.next_actor = pr.to_actor as ActorRef;
        }
        job.timeline.push(e as unknown as TimelineEvent);
        break;
      }
    }
  }

  return job;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation — deterministic, no SQLite, only ledger fold + payload checks
// ─────────────────────────────────────────────────────────────────────────────

export type ValidationResult = { ok: true } | { ok: false; error: string };

function requireNonEmptyString(v: unknown, name: string): string | null {
  if (typeof v !== "string" || v.trim().length === 0) return `${name} required non-empty string`;
  return null;
}

export function validateJobEvent(entry: LedgerEntry, allEntries: LedgerEntry[]): ValidationResult {
  const type = entry.type;
  const payload = entry.payload as Record<string, unknown> | null;
  if (!payload || typeof payload !== "object") {
    return { ok: false, error: `${type}: payload must be object` };
  }

  // All job timeline events must have job_id
  const job_id = (payload.job_id as string) ?? (payload.jobId as string);
  if (typeof job_id !== "string" || job_id.trim().length === 0) {
    // run.linked and artifact events also require job_id per contract
    if (["job.proposed", "job.ready", "job.activated", "job.waiting", "job.review_requested", "job.resolved", "job.cancelled", "run.linked", "artifact.candidate", "artifact.accepted", "job.next_actor_changed"].includes(type)) {
      return { ok: false, error: `${type}: missing job_id` };
    }
  }

  // Build current job fold EXCLUDING this entry (allEntries does not yet contain it)
  // For validation, we use allEntries as current history; entry is the new one
  const job = job_id ? foldJob(String(job_id), allEntries) : null;

  // Helper to check next_actor invariants after hypothetical transition
  function checkNextActorInvariants(state: JobState, nextActor: unknown): string | null {
    if (isNonTerminal(state)) {
      if (!isValidActorRef(nextActor)) return `next_actor required for nonterminal state ${state}`;
    } else {
      if (nextActor !== null) return `next_actor must be null for terminal state ${state}`;
    }
    return null;
  }

  switch (type) {
    case "job.proposed": {
      if (job) return { ok: false, error: `job ${job_id} already exists` };
      const p = payload as unknown as JobProposedPayload;
      const e1 = requireNonEmptyString(p.title, "title");
      if (e1) return { ok: false, error: e1 };
      const e2 = requireNonEmptyString(p.objective, "objective");
      if (e2) return { ok: false, error: e2 };
      if (p.to !== "Proposed") return { ok: false, error: `job.proposed to must be "Proposed"` };
      const e3 = checkNextActorInvariants("Proposed", p.next_actor);
      if (e3) return { ok: false, error: e3 };
      return { ok: true };
    }

    case "job.ready": {
      if (!job) return { ok: false, error: `job ${job_id} not found for job.ready` };
      const p = payload as unknown as JobReadyPayload;
      if (p.from !== job.state) return { ok: false, error: `job.ready from ${p.from} != current ${job.state}` };
      if (!isAllowed(job.state, "Ready")) return { ok: false, error: `transition ${job.state} -> Ready not allowed` };
      // Special: from must be Proposed or Waiting
      if (p.from !== "Proposed" && p.from !== "Waiting") return { ok: false, error: `job.ready from must be Proposed or Waiting` };
      if (p.to !== "Ready") return { ok: false, error: `job.ready to must be Ready` };
      if (!Array.isArray(p.acceptance) || p.acceptance.length === 0) return { ok: false, error: `job.ready acceptance required non-empty` };
      if (!isValidActorRef(p.owner)) return { ok: false, error: `job.ready owner invalid` };
      if (!isValidActorRef(p.reviewer)) return { ok: false, error: `job.ready reviewer invalid` };
      const e = checkNextActorInvariants("Ready", p.next_actor);
      if (e) return { ok: false, error: e };
      // If leaving Waiting, must match resume_to
      if (job.state === "Waiting" && job.waiting_reason && job.waiting_reason.resume_to !== "Ready") {
        return { ok: false, error: `leaving Waiting must go to ${job.waiting_reason.resume_to}, not Ready` };
      }
      return { ok: true };
    }

    case "job.activated": {
      if (!job) return { ok: false, error: `job ${job_id} not found for job.activated` };
      const p = payload as unknown as JobActivatedPayload;
      if (p.from !== job.state) return { ok: false, error: `job.activated from ${p.from} != current ${job.state}` };
      if (!isAllowed(job.state, "Active")) return { ok: false, error: `transition ${job.state} -> Active not allowed` };
      if (!["Ready", "Waiting", "Review"].includes(p.from)) return { ok: false, error: `job.activated from must be Ready|Waiting|Review` };
      if (p.to !== "Active") return { ok: false, error: `job.activated to must be Active` };
      const e = checkNextActorInvariants("Active", p.next_actor);
      if (e) return { ok: false, error: e };
      if (job.state === "Waiting" && job.waiting_reason && job.waiting_reason.resume_to !== "Active") {
        return { ok: false, error: `leaving Waiting must go to ${job.waiting_reason.resume_to}, not Active` };
      }
      return { ok: true };
    }

    case "job.waiting": {
      if (!job) return { ok: false, error: `job ${job_id} not found for job.waiting` };
      const p = payload as unknown as JobWaitingPayload;
      if (p.from !== job.state) return { ok: false, error: `job.waiting from ${p.from} != current ${job.state}` };
      if (!isAllowed(job.state, "Waiting")) return { ok: false, error: `transition ${job.state} -> Waiting not allowed` };
      if (!["Ready", "Active", "Review"].includes(p.from)) return { ok: false, error: `job.waiting from must be Ready|Active|Review` };
      if (p.to !== "Waiting") return { ok: false, error: `job.waiting to must be Waiting` };
      if (!isValidWaitingReason(p.waiting_reason)) return { ok: false, error: `job.waiting waiting_reason invalid — detail required, kind in dependency/decision/input/access/external/time, resume_to Ready|Active|Review` };
      const e = checkNextActorInvariants("Waiting", p.next_actor);
      if (e) return { ok: false, error: e };
      return { ok: true };
    }

    case "job.review_requested": {
      if (!job) return { ok: false, error: `job ${job_id} not found for job.review_requested` };
      const p = payload as unknown as JobReviewRequestedPayload;
      if (p.from !== job.state) return { ok: false, error: `job.review_requested from ${p.from} != current ${job.state}` };
      if (!isAllowed(job.state, "Review")) return { ok: false, error: `transition ${job.state} -> Review not allowed` };
      if (!["Active", "Waiting"].includes(p.from)) return { ok: false, error: `job.review_requested from must be Active|Waiting` };
      if (p.to !== "Review") return { ok: false, error: `to must be Review` };
      if (!Array.isArray(p.candidate_artifact_ids) || p.candidate_artifact_ids.length === 0) return { ok: false, error: `candidate_artifact_ids required non-empty` };
      // Must have at least one Candidate artifact in job
      const hasCandidate = job.artifacts.some((a) => a.state === "Candidate" || a.state === "Accepted");
      // Check that all candidate ids exist as Candidate/Accepted
      for (const cid of p.candidate_artifact_ids) {
        const art = job.artifacts.find((a) => a.id === cid);
        if (!art) return { ok: false, error: `candidate_artifact ${cid} not found as Candidate` };
        if (art.state !== "Candidate" && art.state !== "Accepted") return { ok: false, error: `candidate_artifact ${cid} not in Candidate state` };
      }
      if (!hasCandidate) return { ok: false, error: `Review requires at least one Candidate artifact` };
      const e = checkNextActorInvariants("Review", p.next_actor);
      if (e) return { ok: false, error: e };
      if (job.state === "Waiting" && job.waiting_reason && job.waiting_reason.resume_to !== "Review") {
        return { ok: false, error: `leaving Waiting must go to ${job.waiting_reason.resume_to}, not Review` };
      }
      return { ok: true };
    }

    case "job.next_actor_changed": {
      if (!job) return { ok: false, error: `job ${job_id} not found for next_actor_changed` };
      const p = payload as unknown as JobNextActorChangedPayload;
      if (p.state !== job.state) return { ok: false, error: `next_actor_changed state ${p.state} != current ${job.state}` };
      if (!isValidActorRef(p.from_actor)) return { ok: false, error: `from_actor invalid` };
      if (!isValidActorRef(p.to_actor)) return { ok: false, error: `to_actor invalid` };
      // from_actor should match current next_actor if present
      if (job.next_actor && (job.next_actor.id !== p.from_actor.id || job.next_actor.kind !== p.from_actor.kind)) {
        return { ok: false, error: `from_actor does not match current next_actor ${job.next_actor.id}` };
      }
      return { ok: true };
    }

    case "run.linked": {
      if (!job) return { ok: false, error: `job ${job_id} not found for run.linked` };
      const p = payload as unknown as RunLinkedPayload;
      const run = p.run;
      if (!run || typeof run !== "object") return { ok: false, error: `run.linked run required` };
      if (run.provider !== "agent-manager") return { ok: false, error: `run provider must be agent-manager` };
      if (typeof run.session_id !== "string" || run.session_id.trim().length === 0) return { ok: false, error: `run session_id required` };
      if (!["owner", "worker", "reviewer"].includes(run.role)) return { ok: false, error: `run role must be owner|worker|reviewer` };
      if (typeof run.linked_at !== "string" || isNaN(Date.parse(run.linked_at))) return { ok: false, error: `run linked_at must be ISO date` };
      // session_name_snapshot is display only, no check
      return { ok: true };
    }

    case "artifact.candidate": {
      if (!job) return { ok: false, error: `job ${job_id} not found for artifact.candidate` };
      const p = payload as unknown as ArtifactCandidatePayload;
      const art = p.artifact;
      if (!art || typeof art !== "object") return { ok: false, error: `artifact required` };
      if (typeof art.id !== "string" || art.id.trim().length === 0) return { ok: false, error: `artifact id required` };
      if (typeof art.kind !== "string" || art.kind.trim().length === 0) return { ok: false, error: `artifact kind required` };
      if (typeof art.ref !== "string" || art.ref.trim().length === 0) return { ok: false, error: `artifact ref required` };
      if (typeof art.revision !== "string" || art.revision.trim().length === 0) return { ok: false, error: `artifact revision required` };
      if (art.state !== "Candidate") return { ok: false, error: `artifact state must be Candidate` };
      if (!isValidActorRef(art.produced_by)) return { ok: false, error: `produced_by invalid` };
      if (typeof art.proposed_at !== "string" || isNaN(Date.parse(art.proposed_at))) return { ok: false, error: `proposed_at must be ISO date` };
      // id+revision must be unique (not already exists as Candidate/Accepted with same rev)
      if (job.artifacts.some((a) => a.id === art.id && a.revision === art.revision)) {
        return { ok: false, error: `artifact ${art.id} revision ${art.revision} already exists` };
      }
      return { ok: true };
    }

    case "artifact.accepted": {
      if (!job) return { ok: false, error: `job ${job_id} not found for artifact.accepted` };
      const p = payload as unknown as ArtifactAcceptedPayload;
      if (typeof p.artifact_id !== "string" || p.artifact_id.trim().length === 0) return { ok: false, error: `artifact_id required` };
      if (typeof p.revision !== "string" || p.revision.trim().length === 0) return { ok: false, error: `revision required` };
      if (!isValidActorRef(p.accepted_by)) return { ok: false, error: `accepted_by invalid` };
      if (typeof p.accepted_at !== "string" || isNaN(Date.parse(p.accepted_at))) return { ok: false, error: `accepted_at must be ISO date` };
      const art = findArtifact(job.artifacts, String(p.artifact_id), String(p.revision));
      if (!art) return { ok: false, error: `artifact ${p.artifact_id} revision ${p.revision} not found as Candidate` };
      if (art.state === "Accepted") return { ok: false, error: `artifact ${p.artifact_id} revision ${p.revision} already Accepted (append-only)` };
      // revision must match exactly
      if (art.revision !== String(p.revision)) return { ok: false, error: `revision mismatch: candidate ${art.revision} vs accepted ${p.revision}` };
      return { ok: true };
    }

    case "job.resolved": {
      if (!job) return { ok: false, error: `job ${job_id} not found for job.resolved` };
      const p = payload as unknown as JobResolvedPayload;
      if (p.from !== job.state) return { ok: false, error: `job.resolved from ${p.from} != current ${job.state}` };
      if (!isAllowed(job.state, "Resolved")) return { ok: false, error: `transition ${job.state} -> Resolved not allowed` };
      if (p.from !== "Review") return { ok: false, error: `job.resolved from must be Review` };
      if (p.to !== "Resolved") return { ok: false, error: `to must be Resolved` };
      if (p.next_actor !== null) return { ok: false, error: `job.resolved next_actor must be null` };
      const res = p.resolution as ResolutionRecord | undefined;
      if (!res || typeof res !== "object") return { ok: false, error: `resolution required` };
      if (!["completed", "no_change"].includes(res.outcome as string)) return { ok: false, error: `resolution outcome must be completed|no_change` };
      if (typeof res.summary !== "string" || res.summary.trim().length === 0) return { ok: false, error: `resolution summary required` };
      if (!Array.isArray(res.accepted_artifact_ids) || res.accepted_artifact_ids.length === 0) return { ok: false, error: `resolution accepted_artifact_ids required non-empty` };
      // All accepted_artifact_ids must resolve to Accepted artifacts
      for (const aid of res.accepted_artifact_ids) {
        const art = job.artifacts.find((a) => a.id === aid && a.state === "Accepted");
        if (!art) return { ok: false, error: `accepted_artifact ${aid} not found as Accepted` };
      }
      if (!isValidActorRef(res.resolved_by)) return { ok: false, error: `resolved_by invalid` };
      if (typeof res.resolved_at !== "string" || isNaN(Date.parse(res.resolved_at))) return { ok: false, error: `resolved_at must be ISO date` };
      return { ok: true };
    }

    case "job.cancelled": {
      if (!job) return { ok: false, error: `job ${job_id} not found for job.cancelled` };
      const p = payload as unknown as JobCancelledPayload;
      if (p.from !== job.state) return { ok: false, error: `job.cancelled from ${p.from} != current ${job.state}` };
      if (!isAllowed(job.state, "Cancelled")) return { ok: false, error: `transition ${job.state} -> Cancelled not allowed` };
      if (p.to !== "Cancelled") return { ok: false, error: `to must be Cancelled` };
      if (typeof p.reason !== "string" || p.reason.trim().length === 0) return { ok: false, error: `cancel reason required` };
      if (!isValidActorRef(p.cancelled_by)) return { ok: false, error: `cancelled_by invalid` };
      if (p.next_actor !== null) return { ok: false, error: `job.cancelled next_actor must be null` };
      // Ensure no resolution present (cancel has no ResolutionRecord)
      if ((payload as Record<string, unknown>).resolution) return { ok: false, error: `cancelled must not have resolution` };
      return { ok: true };
    }

    default:
      return { ok: false, error: `unknown job event type ${type}` };
  }
}

// List all jobs from ledger
export function listJobs(entries: LedgerEntry[]): Job[] {
  const ids = new Set<string>();
  for (const e of entries) {
    const p = e.payload as Record<string, unknown> | null;
    if (p && typeof (p as Record<string, unknown>).job_id === "string") ids.add((p as Record<string, unknown>).job_id as string);
    if (p && typeof (p as Record<string, unknown>).jobId === "string") ids.add((p as Record<string, unknown>).jobId as string);
  }
  const jobs: Job[] = [];
  for (const id of ids) {
    const j = foldJob(id, entries);
    if (j) jobs.push(j);
  }
  return jobs;
}

// ─────────────────────────────────────────────────────────────────────────────
// Docs
// ─────────────────────────────────────────────────────────────────────────────

export const JOB_CONTRACT_DOC = `
JobState: Proposed | Ready | Active | Waiting | Review | Resolved | Cancelled
ActorRef: {kind:"human"|"agent"|"system", id, label?}
WaitingReason: {kind:"dependency"|"decision"|"input"|"access"|"external"|"time", detail, blocked_on?, resume_to:"Ready"|"Active"|"Review"}
RunLink: {provider:"agent-manager", session_id, role:"owner"|"worker"|"reviewer", linked_at:ISO, session_name_snapshot?}
Artifact: {id, kind, ref, revision, state:"Candidate"|"Accepted", produced_by, run_session_id?, proposed_at, accepted_by?, accepted_at?}
ResolutionRecord: {outcome:"completed"|"no_change", summary, accepted_artifact_ids:string[], resolved_by:ActorRef, resolved_at:ISO}

Job: {id, project_id, title, objective, acceptance:string[], owner, reviewer, state, next_actor:ActorRef|null, waiting_reason, run_links, artifacts, resolution, timeline}

Allowed: Proposed->Ready|Cancelled, Ready->Active|Waiting|Cancelled, Active->Waiting|Review|Cancelled, Waiting->resume_to|Cancelled, Review->Active|Waiting|Resolved|Cancelled, Resolved/Cancelled terminal

Timeline events (ledger type → payload):
  job.proposed {to:"Proposed", title, objective, next_actor}
  job.ready {from,to, acceptance, owner, reviewer, next_actor}
  job.activated {from,to, next_actor}
  job.waiting {from,to, waiting_reason, next_actor}
  job.review_requested {from,to, candidate_artifact_ids, next_actor}
  job.next_actor_changed {state, from_actor, to_actor}
  run.linked {run:RunLink}
  artifact.candidate {artifact}
  artifact.accepted {artifact_id, revision, accepted_by, accepted_at}
  job.resolved {from,to,resolution,next_actor:null}
  job.cancelled {from,to,reason,cancelled_by,next_actor:null}

Invariants: next_actor required nonterminal/null terminal; waiting_reason iff Waiting + resume_to; Review requires Candidate; Candidate->Accepted append-only exact id+revision; Resolved only from Review with nonempty accepted_artifact_ids → Accepted; Cancelled requires reason no resolution terminal; RunLink provider+session_id canonical; run finish != Resolved
`.trim();
