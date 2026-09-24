# Engram drift table — DRAFT, NOT SENT

Read-only evidence only. Relay: `https://intuitxn.communities.buzz.xyz`.
Scopes read: owner `e43fcfd4…` → `[]` (0 entries); agent `df4f2c69…1cb49d4` → 22 entries;
agents `40e8ca5f…` and `becc2bbb…` → `(no memories besides core)`.
Methods used: `buzz mem ls/get/hash` (read-only), repo file reads, `shasum -a 256`.
No `mem set/patch/rm` was run.

Live kernel shas (2026-09-24, `shasum -a 256` in canonical checkout):
- `runtime/mundus.bend` = `c111398f3d1f7acf64a8dd00f933338420ce1ccc2a0e87a7ad97150981e14d8c`
- `runtime/worker/system.bend` = `1b8baaf9f8036024561b15d4c4a99df3f96c62e5ccdd5099b47bb14e6068f182`
- `runtime/worker/diffusion.bend` = `cbbe54a17f871a62ac81b1dc0082ca850062567cf42bd93fc52b13b6300098cb`
- `runtime/worker/history.bend` = `85d0fdf636585183836f699e28de03daba38fd4b7767d6840f817c45557e145c`

Live base-hashes (`buzz mem hash --agent df4f2c69…1cb49d4 <slug>`):
- `mem/kernels/memory-one-import` = `8c6b2c1d0cbf10c154a58a9233ff22488907fd9f5a6e2235e42d0facb8aeb602`
- `mem/kernels/policy` = `3d6e046c7758a23450b60ff71d4fdb6ee0b7e5a424155c51d8bdc197a39683fb`
- `mem/kernels/census` = `dbb0a614ea9598487d076474984e8796cbedef820d06ba96693d5f1aa7ed448f`
- `mem/mundus/runtime-2026-09-22` = `d52769bae5c6c8de95faf33e9a6304f8c70c41205c467d600130b9c079760e99`
- `mem/mundus/world-model-2026-09-22` = `e36850039519cdd47b3c8fb8b271331a3bd435bf2b16f1c81d860a2f2513e4eb`
- `mem/telepathy/in-buzz-setup` = `44596124f8b19eec0230ee10fd0b57a3aa871a9dd7a593c0484325400d35fabb`
- `mem/mundus/network-policy-flow` = `43ace4c8ce4fe3e428140ba463e8a4b92775978bf75ddc7bd83d2ce49ab8ceb4`
- `mem/mundus/passive-materialization` = `fcd05e84dfcfff2d9b2f43f1bf551c8ae93c50827fae481f40fac7cce16034f4`

## 1. mem/kernels/memory-one-import — STALE
- Stale claims: `runtime/memory.bend` is the ONE import; `runtime/mundus.bend` imports
  it and carries `Memory{}` through verb_of/action_of/dispatch/act/verb_list/usage;
  `scripts/memory-sync.sh` materializes.
- Live evidence: `runtime/memory.bend` ABSENT (`ls: No such file`);
  `scripts/memory-sync.sh` PRESENT; `runtime/mundus.bend` (live sha `c111398f…`)
  has 0 hits for `Memory`, `memory.bend`, `Mem.` via grep.
- Verdict: STALE on import + `Memory{}` claims; FRESH only on `scripts/memory-sync.sh` presence.
- Action: correction draft `corrected/mem---kernels---memory-one-import.md` (patch existing slug).

## 2. mem/kernels/policy — STALE
- Stale claims: evaluator lives at `runtime/policy.bend` (29 laws, 790 lines,
  sha `df05780d…`); policy data lives at relay `mem/policy/<name>`.
- Live evidence: `runtime/policy.bend` ABSENT; no relay slug starts with `mem/policy/`
  (agent JSON ls → `[]`); no `mem/policy` dir in checkout.
- Verdict: STALE on both paths.
- Action: correction draft `corrected/mem---kernels---policy.md` (patch; retains
  semantics as historical draft, marks both paths absent).

## 3. mem/kernels/census — FRESH (on the stated claim)
- Stale-candidate claim: host enumerator is `scripts/census.sh`; `./mundus census <root>` wires it.
- Live evidence: `scripts/census.sh` PRESENT. Body references worktree `@523c127`
  (historical context, not a live-path claim); no kernel sha is asserted.
- Verdict: FRESH — no correction draft. Re-check if census claims are extended later.

## 4. mem/mundus/runtime-2026-09-22 — STALE
- Stale claims: kernel inventory with old shas — `history.bend` sha
  `8a10714318347334a672ffda0b0098ce10115543ac26aa7cb792c6b25d459271`,
  `diffusion.bend` sha `3c1aaba806664e6a2e0d9b43c50501b54d7c2989c8861fdd47cfdaa396c61851`;
  `system.bend` law count without sha.
- Live evidence: `history.bend` = `85d0fdf6…`; `diffusion.bend` = `cbbe54a1…`;
  `system.bend` = `1b8baaf9…`; `mundus.bend` = `c111398f…`. All differ from recorded values.
- Verdict: STALE on recorded shas.
- Action: correction draft `corrected/mem---mundus---runtime-2026-09-22.md`
  (patch; keeps 2026-09-22 scope, appends live-sha correction block).

## 5. mem/mundus/world-model-2026-09-22 — STALE
- Stale claim: `runtime/worker/system.bend` sha256
  `6e224e26d47c56d3601b26b55ae77497ab4680cacda89846640380a1d9e69d74` (unchanged).
- Live evidence: `runtime/worker/system.bend` = `1b8baaf9f8036024561b15d4c4a99df3f96c62e5ccdd5099b47bb14e6068f182`.
  Grep over all 22 agent slugs: only this slug + `mem/telepathy/in-buzz-setup` contain `6e224e26`.
- Verdict: STALE on the pinned sha.
- Action: correction draft `corrected/mem---mundus---world-model-2026-09-22.md` (patch).

## 6. mem/telepathy/in-buzz-setup — STALE
- Stale claim: worker `runtime/worker/system.bend` sha256 `6e224e26…9e69d74`, `--check-only` green.
- Live evidence: same as §5 — live sha is `1b8baaf9…`; file PRESENT; old sha appears
  in exactly this slug and §5.
- Verdict: STALE on the pinned sha (setup observations otherwise retained as dated findings).
- Action: correction draft `corrected/mem---telepathy---in-buzz-setup.md` (patch).

## 7. mem/mundus/network-policy-flow — STALE
- Stale claims: draft spec at `docs/drafts/meta/network-policy-flow.md`; companion
  `mem/kernels/policy`; policy data `mem/policy/<name>` read via ONE import
  `runtime/memory.bend`; evaluator `runtime/policy.bend`.
- Live evidence: `docs/drafts/meta/network-policy-flow.md` ABSENT
  (22 files listed, name not among them); `runtime/memory.bend` ABSENT;
  `runtime/policy.bend` ABSENT; `mem/policy/*` ABSENT (relay ls → `[]`).
- Verdict: STALE on all four path claims; flow description itself is proposal prose, kept as such.
- Action: correction draft `corrected/mem---mundus---network-policy-flow.md` (patch).

## 8. mem/mundus/passive-materialization — STALE
- Stale claim: draft spec at `docs/drafts/meta/passive-materialization.md`.
- Live evidence: that path ABSENT (same 22-file listing); census wiring claim
  (`./mundus census`) is descriptive, `scripts/census.sh` itself is PRESENT.
- Verdict: STALE on the spec-file pointer only.
- Action: correction draft `corrected/mem---mundus---passive-materialization.md` (patch).

## 9. Owner-scope entries — NOT FOUND (no relay body, no repo body)
- Slugs checked: `mem/bend-invocations`, `mem/geist`, `mem/geist-recall-verified`,
  `mem/self-build-geist-enable`.
- Live evidence: owner ls `--json` → `[]`; agent `get` for each → `not_found`;
  repo grep for `bend-invocation|geist-recall|self-build-geist|mem/geist` (excl. `.git`,
  `node_modules`, `.jj`) → 0 slug hits (only unrelated `lorenz_geist_*` Bend symbols
  in snapshots and one `Geist` mention in a brief).
- Summaries (≤3 lines each, no body duplicated — there is no body to duplicate):
  - `mem/bend-invocations`: no live entry; name suggests a Bend-invocation log. No evidence; no write proposed.
  - `mem/geist`: no live entry; name overlaps the Lorenz `geist` planner verb (persona-file writer), but no engram body exists. No write proposed.
  - `mem/geist-recall-verified`: no live entry; name suggests a verified recall note. No evidence; no write proposed.
  - `mem/self-build-geist-enable`: no live entry; name suggests a self-build enable flag. No evidence; no write proposed.
- Verdict: NOT-FOUND — neither fresh nor stale; recorded here only. No correction
  draft (nothing to replace) and no relay write (no base-hash exists).
- Recommendation: leave absent; if re-creation is ever wanted it would be `mem set`
  (new slug), owner decision required — NOT drafted here.

## 10. system.bend sha 6e224e26… sweep — STALE in exactly 2 slugs
- Pattern `6e224e26` over all 22 agent slugs (read-only `get` + grep): HIT in
  `mem/mundus/world-model-2026-09-22` and `mem/telepathy/in-buzz-setup` only.
- Live sha `1b8baaf9…` recorded above. Both slugs get correction drafts (§5–§6).
- All other slugs: no occurrence → no action on this pattern.
