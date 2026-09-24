# Agent standing policy: route / sample / share / audit

**Status: DRAFT for human review. No implementation authorized.**
**Date:** 2026-09-24 · **Owner:** Shubham
**Companion to:** `2026-09-24-routing-brain.md` (kinds / needs / router vocabulary)

**Fleet (as given):** tailnet (`a3fckx-air`, `a3fckx-mini` online) + SSH tier (`runpod`, `mi300x`, `lightning`, `dashboard` in `~/.ssh/config`). `opencode serve :4096` per mesh node, passwordless (perimeter = tailnet membership; username mapping deferred). Moves via `export --sanitize` / `import` / `share: manual`. Files via Taildrop + git. Routing via gossip directory + capability records with `access:{mesh|ssh}`.

---

## 1. Route / move / delegate

- Check `must_be_local` first: secrets, local fs, keychain → run `LOCAL`, never route.
- Classify to `kind` (`ml.train`, `ml.embed`, `ml.infer`, `code.exec`, `research`, `move`, `default`); match `needs ⊆ offers` and `alive(node)`; sample/argmax `π(job,cands;θ)` (cold-start prior = price).
- Use mesh for sessions and moves: `run --attach`, `prompt_async` to `access.mesh`.
- Use SSH direct exec (`ssh <host> '<cmd>'`) for bounded compute to `access.ssh`.
- Open a tunnel only when an SSH box needs a session; close it when done.
- Move the agent (`export` → transfer → `import`) only when context is the expensive thing; otherwise delegate the step and keep context local.

## 2. N-by-stakes

| Stakes | N | Verifier `V` |
|---|---|---|
| trivia / fast | N=1, π-argmax (cold-start: cheapest price prior) | execution success |
| important | N=3–5, diverse (see §3) | per kind: tests for `code.exec`, critic agent for prose/`research`, execution success for tools/`ml.*`, human for judgment |
| any | never unbounded | record `V` score; highest-V pass wins; ties broken by r=quality−cost |

## 3. Diversity requirement

- Force N samples to differ on at least one axis: node, model, temperature/seed, or decomposition.
- Reject N identical votes; reroll the axis before spending more compute.

## 4. Never-share list

- Never place in any transcript that moves: keys, credentials, tokens, personal data, `~/.ssh`, `.env`, keychains, mesh password, anything secret-bearing. Ever.

## 5. Sanitize-before-select

- Run `export --sanitize` by default on every cross-node / cross-trust export or share.
- Select and verify on sanitized candidates only; the verifier never sees unsanitized input.

## 6. Audit format

- Log every share / export / move / claim as: `what, from, to, when, kind, verifier-score`.
- Review logs after the fact; never gate execution on pre-approval (except §7 escalations).

## 7. Autonomy bounds

- Run under this standing authorization; require no human gate for §§1–6.
- Escalate only on: new spending/access, scope expansion, destructive/irreversible effects, publish/send externally, or policy conflict.
- Bound every execution: set budgets, timeouts, and retry caps; never retry infinitely.

---
DRAFT — human reviews; agents run on it only after explicit approval.
