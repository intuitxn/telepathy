# First continuous circuit: operate → observe → learn → deploy, air + mini

**Status: SPEC — draft for human review. No implementation authorized.**
**Date:** 2026-09-24 · **Owner:** Shubham
**Companion to:** `2026-09-24-decentralized-mesh.md` (Phase 0 handoff target), `2026-09-24-routing-brain.md` (θ update), `2026-09-24-recursive-seeding.md` (distill).

---

## 1. What this is

The smallest closed loop that proves continuity: one recurring job dispatched between air and mini, observed on return, learned from on accept, deployed as a digest flip — running without anyone touching it. Not a phase, not a milestone: a circuit that, once started, never stops. Everything after this widens the circuit; nothing replaces it.

## 2. The circuit (four stations, all local-timer driven, no barriers)

```
OPERATE  →  OBSERVE  →  LEARN  →  DEPLOY  →  (back to OPERATE)
```

**OPERATE (every H hours, H=6 to start).** A standing recurring job: pick the cheapest agreed task (e.g., re-embed a fixed probe corpus on mini, or run the kernel check suite on air). Dispatch via `run --attach` to whichever node the router (cold-start: static price) picks. Bounded: timeout, retry cap 1, sandbox as configured. No quorum, no waiting — if the peer is down, run local and log it.

**OBSERVE (on every return).** Append `(job features, node, latency, ok, verifier score)` to the local observation G-set; gossip on the next tick. Verifier `V` per kind (execution success to start; tests where they exist). No batching — one return, one record, immediately.

**LEARN (on every accept).** Bandit/policy step on θ (`θ ← θ + η·r·∇log π`, `r = quality − cost`); distill accepted lesson into seed deltas only if it passes the ablation rule (keep iff sufficiency drops without it). Rejected or failed jobs train nothing except the failure counters. Learning never blocks the next OPERATE tick.

**DEPLOY (standing canary).** Bundle current state (config + policy + seeds) into a digest; canary on self first (adopt locally, run one OPERATE tick, compare verifier score within tolerance); on pass, gossip the digest as available — the peer adopts on its own cadence. On fail, parent digest stays; the failure itself becomes an observation. Rollback is always one digest back, always available, never a procedure.

## 3. Operating rules (what makes it continuous, not periodic)

- **No global anything:** no synchronized rounds, no barrier waits, no coordinated upgrades. Each station runs on local monotonic timers; joins are idempotent so skew is harmless.
- **Degradation, not stoppage:** peer down → run local + log; gossip stalled → local-only learning continues; deploy canary fails → keep parent digest. Every failure mode sheds load, never halts.
- **Budgets bind everything:** per-tick token/time caps, per-day spend cap, N-by-stakes (N=1 for the probe job). The circuit cannot spend unboundedly by construction.
- **Audit is the dashboard:** every operate/observe/learn/deploy event appends `(what, where, when, kind, score, digest)` to the local log. Continuity is *observed* (log cadence unbroken), not asserted.

## 4. Acceptance (the untouched week)

1. **Seven consecutive days** with zero human interventions (no restarts, no config edits, no manual dispatches) — verified from the audit log, not from memory.
2. **Job completion rate ≥ 95%** over the week (local fallbacks count as completed-with-degradation, logged as such).
3. **Router movement observed:** θ or cost state differs from cold-start prior in the direction of evidence (the system demonstrably learned something, however small).
4. **At least one digest flip** adopted via canary (deploy path exercised, not just specified), with parent digest retained.
5. **One injected fault survived:** kill the peer mid-week (or lose network for an hour) — circuit degrades, recovers, log shows continuity gap bounded and explained, no manual restart.
6. **No secret or credential appears** in any log, record, or gossiped delta (audit grep passes).

Fail any check → the circuit, not the operators, is fixed: the failing station gets a guardrail law, and the week restarts. Passing once proves continuity is achievable; the circuit then stays on permanently and widens (more job kinds, more nodes) without re-approval of the loop itself.

## 5. Handoff

Requires Phase 0 complete on air (serve bound, tailnet-reachable) and mini on stock serve. Standing policy approved (or this circuit runs under explicit one-time authorization with the audit log as its leash). First tick starts on approval; the week starts at the first unassisted OPERATE.
