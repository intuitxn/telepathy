# DRAFT - NOT SENT — proposed replacement body for `mem/mundus/passive-materialization`

Source evidence (read-only, 2026-09-24):
- `docs/drafts/meta/passive-materialization.md`: ABSENT (22-file listing has no such name)
- `scripts/census.sh`: PRESENT (census wiring itself is live)
- Relay base-hash: `fcd05e84dfcfff2d9b2f43f1bf551c8ae93c50827fae481f40fac7cce16034f4`

---

# Passive materialization — pull, not push; the system fixes itself

2026-09-22. Draft spec: docs/drafts/meta/passive-materialization.md.
CORRECTION (2026-09-24): that spec file does NOT exist live (ABSENT). The
reference is unfulfilled; the model description below is retained as proposal
prose, not as a pointer to a live document.

## The model (unchanged)
- Capability is materialized ON DEMAND, not bundled up front. Pre-consolidating
  every kernel is paying complexity for unused capability — a violation of the
  project's own principle "complexity is cost or fuel" (P5).
- The kernel DECLARES what it needs; a missing capability becomes a `need`
  packet, which is just another Task, so the existing pure `plan` handles it. No
  new mechanism.
- Three need kinds: DECLARED (static), DISCOVERED (a verb fails because a
  capability is absent), RETIREMENT (a capability is unreferenced).

## Capability lifecycle (unchanged)
DECLARED -> MATERIALIZED (an op file exists and checks) -> REFERENCED ->
UNREFERENCED -> RETIRE-PROPOSED -> RETIRED (human-accepted).

## Self-healing loop (applied to the system itself) (unchanged)
observe (census/status) -> attribute -> detect instability (orphan, duplicate,
drift, unfalsifiable law, silent task failure) -> propose a stabilization as a
PROGRAM OR CHECK (never prose) -> independent check -> human review -> project.

## What cleans up — census (unchanged; tool present live)
`./mundus census <root>`: host enumerates, kernel classifies, emits a retirement
PROPOSAL. Nothing is deleted by an agent — an agent deleting its own work is
self-acceptance, which is forbidden. Acceptance = `git rm` on a branch
(reversible) by a named human. The durability guard runs `snapshot` then `check`
BEFORE any cleanup. (`scripts/census.sh` is PRESENT live; kernel-side behavior
is 2026-09-22 scoped.)

## Worked example of the loop (2026-09-22) (unchanged)
The census capability was added, then measured: exponential (n=15 >60s). The
instability was detected by measurement, attributed to non-sharing recursion,
and stabilized as a fix PLUS a work-bound law (`census_work_bound_20`) so the
blowup cannot regress. That is the pattern: instability -> check, not a note.

## Open owner decisions (carried forward)
need-packet shape; who may raise a need; lifecycle authority; census verb home;
refcount definition; near-duplicate class; census scope; proposal format;
first cleanup batch; whether the drift check ships with census.
Plus 2026-09-24: restore vs retire the absent spec-file pointer.
