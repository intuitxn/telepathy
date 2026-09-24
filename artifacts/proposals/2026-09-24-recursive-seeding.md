# Recursive seeding: seed format, budgets, recursion guard, adaptation loops

**Status: SPEC — draft for human review. No implementation authorized.**
**Date:** 2026-09-24 · **Owner:** Shubham
**Companion to:** `2026-09-24-routing-brain.md` (θ/beliefs/lessons), `2026-09-24-decentralized-mesh.md` (transport/phases).

---

## 1. Seed format (portable, executable, sufficiency-tested)

A seed is content-addressed (`sha256` digest), self-describing, and executable as kernel transitions — importable and runnable on any node from the digest alone.

```json
{
  "seed": "sha256:…",
  "version": 3,
  "parent": "sha256:…",
  "manifest": {
    "goal": "…",
    "charter": "digest-or-ref",
    "capabilities_needed": ["agent"],
    "policy_version": "digest",
    "kernel_version": "x.y.z",
    "budget": {"tokens": N, "time_s": T, "n_max": M}
  },
  "content": {
    "principles": ["…"],
    "deltas": ["… (what changed since parent)"],
    "exclusions": ["… (explicitly out of scope)"]
  },
  "sufficiency": {
    "test": "suite-ref",
    "last_verified": "…",
    "success_rate": 0.95
  }
}
```

**Sufficiency test (the "good enough" bar):** a seed is sufficient iff sessions booted from it — plus task input only — complete the task class within budget at success rate ≥ threshold (default 0.9 over ≥5 trials). Verified by trial, never asserted. `seed_0` floor = charter + capabilities + goal (must boot a trivial task or the lineage never starts).

**Distill rule (ablation-tested retention):** `seed_{k+1} = compress(seed_k + lessons_k)` — for each candidate element, drop it and re-run sufficiency; keep iff sufficiency drops without it. Keep deltas over rewrites (lineage stays readable). Never distill secrets, full transcripts, or unaccepted drafts into a seed.

## 2. Injection budget (into the session)

Per session, bounded and relevance-gated — injection is a budget, not a firehose:

| Slot | Cap | Gate |
|---|---|---|
| core (charter + identity) | fixed, always | none — the floor |
| task-activated engrams | top-K (default 5) | activation from task anchor ≥ threshold; rank, cut off |
| unread telepathy / mailbox | top-M (default 10) | addressed to this agent/session, in-window only |
| capability snapshot | 1 delta | only what this task's `needs` intersect |
| mid-session re-inject | ≤3 events | triggers: no-progress N turns, explicit request, new sub-goal |

Overspend rule: when the budget binds, task-anchored relevance wins; recency breaks ties; anything below threshold stays out even if the budget has room (relevance gates, budget caps — both must pass).

## 3. Diffusion budget (across graphs)

Same spread mathematics, two graphs, explicit cutoffs:

| Graph | Step cap | Decay / threshold | Stop rule |
|---|---|---|---|
| memory (retrieval) | ≤ S_m hops (default 3) | multiply γ per hop (default 0.5); drop activation < τ | marginal gain < ε or cap hit |
| machine (gossip) | T=1s rounds, F=2 fanout | TTL on fast state; retention windows on logs | digest-equal (converged) or TTL expiry |

A lesson that can't earn its spread (below threshold at every hop) dies locally — correctly. Diffusion is how relevance travels; budgets are how it stays affordable.

## 4. Recursion guard (good-enough fixed point)

```
seed_{k+1} = distill(seed_k + work_k + lessons_k)
  adopt iff  cost(seed_{k+1}) < cost(seed_k)
         AND sufficiency(seed_{k+1}) ≥ sufficiency(seed_k) − δ   (no silent regress)
  hold (stop) iff no improvement over window W generations
  lineage cap: max K generations per branch, then hold best
  rollback: parent digest (always available, one step)
```

Anti-regress is load-bearing: every candidate seed re-runs the sufficiency suite *before* adoption. A "better" seed that fails the suite is ash, however elegant. Parent digests make every step reversible — recursion without rollback is just drift with confidence.

## 5. Adaptation loops (yes — four timescales, plus meta)

| Loop | Timescale | What adapts | Signal | Update |
|---|---|---|---|---|
| T0 in-session | seconds | injection set, deliberation depth (N, refinement passes) | stakes, uncertainty, no-progress | re-inject / deepen / stop |
| T1 per-return | minutes | router weights, cost tables, verifier calibration | observed (job, node, latency, ok) | bandit/gradient step |
| T2 per-accept | hours/days | seeds (distill), harness shape (specialize hot, atrophy cold, guardrail incidents), bundle versions | accepted lessons, incident reports | distill + package + canary |
| T3 structural | days/weeks | capability offerings, price policy, fleet membership, kernel laws | sustained demand, repeated patterns, new hardware | proposal → verify → bundle |
| meta | ongoing | the update rules themselves (which verifier, N-by-stakes, diffusion budgets) | meta-evidence (which rules predicted well) | version the policy, revise on evidence |

Adaptation *adapts*: budgets, thresholds, and even the learning rules are versioned policy, not constants. When the workload shifts (new hardware, new task mix, new failure mode), the fast loops react in-session, the slow loops reshape the harness, and the meta loop revises how revision happens. That is the full meaning of "improves with use" — including improving *how it improves*.

## 6. Acceptance

1. **Sufficiency suite passes** for `seed_0` and every adopted seed (rate ≥ threshold over trials).
2. **Distill strictly compacts** (cost down) without losing sufficiency (anti-regress holds on every adoption).
3. **Fixed point holds** (lineage stops churning when nothing improves; rollback to parent works in one step).
4. **Import + run** on a second node from digest alone (no side-channel context) succeeds within budget.
5. **Budgets enforced** (injection/diffusion caps visible in logs; overspend impossible by construction, not by discipline).
6. **Adaptation visible** (router weights move with workload shifts; hot paths specialize; a seeded incident produces a guardrail law that prevents recurrence).
