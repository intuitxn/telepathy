# Telepathy: the internal product we are building

## First complete journey

A named team member starts a persistent thread. Another member replies from a separate session. The author selects source material, creates an editable artifact, reviews its public preview, and publishes it to a real domain. The page has a stable URL and preview metadata. Updating and withdrawing the page are explicit actions.

The shared product keeps the existing human workspace design. Its author comes from an authenticated server session; it cannot be changed with the demo identity picker. The GitHub Pages demo remains a separate demonstration.

## Programs, host, and shared network

Nudge's core contract stays `ProgramSource Markdown -> compile_program -> immutable PromptBundle -> HarnessAdapter -> ProgramResult`. Typed inputs, outputs, prompt messages and finite declared limits belong to `.nudge.md` source. Program compilation is deterministic; model execution is a separate step.

The host owns OS processes, authentication, persistence, permissions, effects and receipts. The shared network is configured with `INTUITXN_NETWORK`. A domain is a publishing destination; it is not an authentication mechanism or a substitute for shared state.

The first program catalog covers artifact design and proposed learning changes. Meta-agent roles scope those jobs; they do not become human feed authors. Source selections and output validation remain explicit. Runtime output and model explanations are not proof of correctness.

## Learning loop

1. Record the artifact revision, source selection, program digest and observed result.
2. A human supplies feedback or a concrete failure is recorded.
3. A typed program proposes a small change, including rationale and evidence.
4. Review the candidate against the incumbent on identified cases.
5. A human approves an exact revision before promotion.

A stored lesson is a proposed improvement, not proof that behavior improved. No model may approve its own changes or rewrite published history. Any later evaluation claim must identify its cases, evaluator, coverage and comparison.

## Acceptance evidence

- Two independently authenticated sessions see the same thread and replies.
- Data remains after the server restarts.
- Unauthenticated clients cannot read or mutate private workspace data.
- Authenticated identity controls attribution; callers cannot impersonate another member.
- Publishing uses an exact draft revision/digest, preventing stale approval.
- Public pages contain the reviewed artifact, not the underlying private thread or runtime metadata.
- Updates retain the URL; withdrawal makes the page unavailable.
- A valid Nudge program compiles, runs through the configured real runtime and validates its typed result.
- Learning proposals remain pending until an explicit human action.
- The existing demo still builds and its behavior remains clearly labeled.

This document records the accepted implementation target. Completed behavior and live verification will be recorded separately, with any remaining limits.
