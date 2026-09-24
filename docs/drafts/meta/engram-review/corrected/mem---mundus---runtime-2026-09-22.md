# DRAFT - NOT SENT — proposed replacement body for `mem/mundus/runtime-2026-09-22`

Source evidence (read-only, 2026-09-24, `shasum -a 256` in canonical checkout):
- `runtime/mundus.bend` = `c111398f3d1f7acf64a8dd00f933338420ce1ccc2a0e87a7ad97150981e14d8c`
- `runtime/worker/system.bend` = `1b8baaf9f8036024561b15d4c4a99df3f96c62e5ccdd5099b47bb14e6068f182`
- `runtime/worker/diffusion.bend` = `cbbe54a17f871a62ac81b1dc0082ca850062567cf42bd93fc52b13b6300098cb`
- `runtime/worker/history.bend` = `85d0fdf636585183836f699e28de03daba38fd4b7767d6840f817c45557e145c`
- Relay base-hash: `d52769bae5c6c8de95faf33e9a6304f8c70c41205c467d600130b9c079760e99`
- Old recorded shas (now superseded): history `8a107143…25d459271`, diffusion `3c1aaba8…a396c61851`

---

# Mundus runtime — architecture, 2026-09-22 (sha correction 2026-09-24)

Owner/reviewer: Shubham. Status: draft architecture; kernel pieces check, the
integrated runtime is not yet wired. Engram entry is a retained summary, not
acceptance. Scope remains the 2026-09-22 observation; shas below are corrected
to live values without re-asserting the 2026-09-22 checks.

## CORRECTION (2026-09-24 — live shas; historical values kept for traceability)
- `runtime/worker/history.bend`: recorded `8a10714318347334a672ffda0b0098ce10115543ac26aa7cb792c6b25d459271`
  → live `85d0fdf636585183836f699e28de03daba38fd4b7767d6840f817c45557e145c`. STALE → corrected.
- `runtime/worker/diffusion.bend`: recorded `3c1aaba806664e6a2e0d9b43c50501b54d7c2989c8861fdd47cfdaa396c61851`
  → live `cbbe54a17f871a62ac81b1dc0082ca850062567cf42bd93fc52b13b6300098cb`. STALE → corrected.
- `runtime/worker/system.bend`: no sha was recorded; live is
  `1b8baaf9f8036024561b15d4c4a99df3f96c62e5ccdd5099b47bb14e6068f182` (see also
  world-model / in-buzz-setup drafts for the old `6e224e26…` pin).
- `runtime/mundus.bend`: live `c111398f3d1f7acf64a8dd00f933338420ce1ccc2a0e87a7ad97150981e14d8c`.
- Law counts / line counts below are 2026-09-22 values, NOT re-verified live.

## Five principles (falsifiable) (unchanged, 2026-09-22)
1. Memory is task-scoped, not ambient. An agent's memory ops touch only the
   engrams its work requires; retrieval is permissioned and relevance-gated.
2. Retrieval is diffusion, not lookup. Activation spreads over the memory graph
   from task anchors with a bounded step budget — not a full scan. (Prior state:
   bounded lexical matching, `runtime/adaptive/LEARNING.md:86-88`.)
3. Kernels and ops are programs, not code paths. New capability = a new program
   file (Bend op / workflow YAML / prompt bundle); the runtime source is
   unchanged. (Contract: `docs/drafts/meta/op-dispatch-convention.md:23-38` —
   that contract file is PRESENT live.)
4. The runtime is the learning loop. Delegation shape is a policy learned from
   observed outcomes, stored as data; the Lorenz learn/correct lineage is the
   substrate.
5. Complexity is the currency. Complexity is either cost (overhead to minimize)
   or fuel (substrate for adaptation); the harness measures it and spends it
   deliberately.

## Kernel inventory (2026-09-22 checks; shas corrected to live)
- `runtime/worker/system.bend` — Lorenz worker protocol, 78 named laws (2026-09-22 count).
- `runtime/worker/history.bend` — BuzzEvent -> HistoryEntry -> DayHistory,
  23 laws (2026-09-22 count), live sha256 `85d0fdf636585183836f699e28de03daba38fd4b7767d6840f817c45557e145c`
  (recorded 2026-09-22 value `8a107143…` superseded).
- `runtime/worker/diffusion.bend` — diffusion retrieval, 35 laws, 924 lines
  (2026-09-22 counts), live sha256 `cbbe54a17f871a62ac81b1dc0082ca850062567cf42bd93fc52b13b6300098cb`
  (recorded 2026-09-22 value `3c1aaba8…` superseded).
- `runtime/ops/fold.bend`, `runtime/ops/status.bend` — ops-as-programs (presence not re-verified here).
- KNOWN GAP (2026-09-22): `runtime/programs/retrieval/*.bend` was authored for Bend 2.0.5 and
  currently fails on 2.0.21 (`graph.bend:60`, `(a + b : Nat)`).

## Boundary (unchanged)
- Buzz engram = durable memory/events; Bend = pure kernels and checks; program
  files = ops; git = accepted revisions; the harness = orchestration (one
  coordinator, one writer).
- Non-goals: no auto-send/publish, no secrets, no weight training, no reviving
  the retired JS registry/lifecycle stack, no unbounded fan-out, git stays the
  revision authority.

## Open owner decisions (carried forward)
1. Where the diffusion graph lives (engram edges / Bend lineage / derived index).
2. What anchors a task.
3. Where the learned policy is stored.
4. The unit of "complexity cost".
5. Which ops become programs first.
6. Whether diffusion runs in Bend or as a program over Bend output.
7. Who ports `runtime/programs/retrieval/*` to 2.0.21.
