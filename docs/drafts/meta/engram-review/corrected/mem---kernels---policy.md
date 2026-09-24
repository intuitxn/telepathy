# DRAFT - NOT SENT — proposed replacement body for `mem/kernels/policy`

Source evidence (read-only, 2026-09-24):
- `runtime/policy.bend`: ABSENT (`ls: No such file or directory`)
- Relay slugs starting `mem/policy/`: NONE (agent `df4f2c69…1cb49d4` JSON ls → `[]`)
- No `mem/policy` dir in checkout
- Relay base-hash: `3d6e046c7758a23450b60ff71d4fdb6ee0b7e5a424155c51d8bdc197a39683fb`
- `runtime/memory.bend` (cited as the read path): ABSENT (see memory-one-import draft)

---

# Policy kernel — runtime/policy.bend (corrected 2026-09-24; file absent live)

2026-09-22. Worktree `telepathy-mundus` @ 7e5d0b8. Policies are DATA; this file
was the MATH. STATUS 2026-09-24: the file does NOT exist in the live checkout
and no `mem/policy/<name>` entry exists on the relay. Everything below is
retained design history, NOT a live path. Owner decision needed: restore the
file and re-check, or retire this entry.

## CORRECTION (2026-09-24)
- `runtime/policy.bend` is ABSENT live. The `bend runtime/policy.bend --check-only`
  verification below cannot be reproduced without restoring the file.
- `mem/policy/<name>` entries: ABSENT live (relay ls shows none).
- The "read through the ONE import `runtime/memory.bend`" clause is doubly stale:
  that file is also ABSENT live.
- Recorded sha `df05780d968d5561ef0a3fde40e0d56772bb95d73e7dc54968fc0d14de8d8a32`
  refers to the historical 790-line file, not to any live file.

## What it was (HISTORICAL)
A pure Bend evaluator: `decide(policy, request) -> Decision`.
- Types: `Role` (Orchestrator/Forge/Builder/Reviewer/Scout), `Action` (Read/Write/
  Delegate/Publish/Retire/Spend), `Request{actor, actor_scope, action,
  target_scope, budget}`, `Rule{role, action, max_scope, max_budget,
  requires_review}`, `Policy = +List<Rule>`, `Decision` = Allow{scope,budget} |
  Deny{reason} | NeedReview{reason}.
- Semantics: DENY BY DEFAULT (no match -> Deny); FIRST MATCH WINS by (role,
  action); SCOPE CONTAINMENT (target outside rule.max_scope -> Deny); REVIEW GATE
  (Publish/Retire/Spend with requires_review -> NeedReview, never Allow);
  otherwise Allow{scope = target_scope, budget = min(requested, rule.max_budget)}.
- `route` returns an explicit None when unmatched — never a default.

## Verified (HISTORICAL, 2026-09-22 only)
- `bend runtime/policy.bend --check-only` -> `All terms check.` (exit 0).
- 29 named laws; 790 lines;
  sha256 df05780d968d5561ef0a3fde40e0d56772bb95d73e7dc54968fc0d14de8d8a32
- Demo: read allowed; publish -> NeedReview; scope escalation -> Deny;
  no matching rule -> Deny. Flow witness prints a deterministic
  Allow/NeedReview/Deny chain.
- Falsification: mutating `policy_first_match_wins` and the grant-min
  implementation each fail at the guarding law (exit 1).
- Review gate and the grant-budget bound are UNIVERSAL (proof by cases over the
  scope Bool and Nat induction).

## "Policies in the network" (PROPOSAL, not live)
The policy was to be an engram entry `mem/policy/<name>`, materialized like memory
(`scripts/memory-sync.sh` -> `<root>/memory.in` + `<root>/memory/<slug>`) and
read through the ONE import `runtime/memory.bend`. So the network (relay)
carries its own rules; the kernel carries only the decision function.
Neither side of this wiring exists live (see CORRECTION).

## Not proven / limits (carried forward)
Hashing, materialization, identity roster, text parsing and ordering are
host/shell concerns. A green check is not authorization, not truth, not human
acceptance. The host could ignore a Deny — policy is only as strong as the
driver that enforces it.
