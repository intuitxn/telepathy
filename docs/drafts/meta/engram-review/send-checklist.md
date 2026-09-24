# Send checklist — DRAFT ONLY. NOTHING BELOW HAS BEEN RUN.

All items: NEEDS HUMAN APPROVAL. Do NOT run until Shubham reviews the exact
payload (draft file) and destination (slug + scope) for each line.
Signing uses the owner-controlled signer environment (`BUZZ_PRIVATE_KEY` from the
keychain, `BUZZ_RELAY_URL=https://intuitxn.communities.buzz.xyz`); no secret
appears on any command line below. Agent scope pubkey (public):
`df4f2c699372ffe48cb7bfc0b1e509561e9143381f21d61bdf708fbfe1cb49d4`.

Rules at send time (read-only re-verify first):
1. Re-run `buzz mem hash --agent <pubkey> <slug>`; if the base-hash differs from
   the one below, STOP and regenerate the diff — do not reuse a stale base.
2. Generate the unified diff fresh: live `buzz mem get` vs the reviewed draft file.
3. Prefer `mem patch --base-hash` (safe); use `mem set` only if patch is rejected
   AND the human explicitly approves overwriting.
4. This review proposes ZERO `mem set` (new-slug) writes and ZERO `mem rm` writes.

## 1. mem/kernels/memory-one-import — PATCH — NEEDS HUMAN APPROVAL
- Why: stale `runtime/memory.bend` + `Memory{}` claims (see drift-table §1).
- Draft: `docs/drafts/meta/engram-review/corrected/mem---kernels---memory-one-import.md`
- Pre-check (read-only, run first):
  `BUZZ_RELAY_URL="https://intuitxn.communities.buzz.xyz" buzz mem hash --agent df4f2c699372ffe48cb7bfc0b1e509561e9143381f21d61bdf708fbfe1cb49d4 mem/kernels/memory-one-import`
  Expected (2026-09-24): `8c6b2c1d0cbf10c154a58a9233ff22488907fd9f5a6e2235e42d0facb8aeb602`
- Command (DO NOT RUN):
  `BUZZ_RELAY_URL="https://intuitxn.communities.buzz.xyz" buzz mem patch --agent df4f2c699372ffe48cb7bfc0b1e509561e9143381f21d61bdf708fbfe1cb49d4 mem/kernels/memory-one-import --base-hash 8c6b2c1d0cbf10c154a58a9233ff22488907fd9f5a6e2235e42d0facb8aeb602 < <fresh-unified-diff-live-vs-draft>`

## 2. mem/kernels/policy — PATCH — NEEDS HUMAN APPROVAL
- Why: `runtime/policy.bend` + `mem/policy/<name>` both absent (drift-table §2).
- Draft: `docs/drafts/meta/engram-review/corrected/mem---kernels---policy.md`
- Pre-check:
  `BUZZ_RELAY_URL="https://intuitxn.communities.buzz.xyz" buzz mem hash --agent df4f2c699372ffe48cb7bfc0b1e509561e9143381f21d61bdf708fbfe1cb49d4 mem/kernels/policy`
  Expected: `3d6e046c7758a23450b60ff71d4fdb6ee0b7e5a424155c51d8bdc197a39683fb`
- Command (DO NOT RUN):
  `BUZZ_RELAY_URL="https://intuitxn.communities.buzz.xyz" buzz mem patch --agent df4f2c699372ffe48cb7bfc0b1e509561e9143381f21d61bdf708fbfe1cb49d4 mem/kernels/policy --base-hash 3d6e046c7758a23450b60ff71d4fdb6ee0b7e5a424155c51d8bdc197a39683fb < <fresh-unified-diff-live-vs-draft>`

## 3. mem/mundus/runtime-2026-09-22 — PATCH — NEEDS HUMAN APPROVAL
- Why: recorded history/diffusion shas superseded (drift-table §4).
- Draft: `docs/drafts/meta/engram-review/corrected/mem---mundus---runtime-2026-09-22.md`
- Pre-check:
  `BUZZ_RELAY_URL="https://intuitxn.communities.buzz.xyz" buzz mem hash --agent df4f2c699372ffe48cb7bfc0b1e509561e9143381f21d61bdf708fbfe1cb49d4 mem/mundus/runtime-2026-09-22`
  Expected: `d52769bae5c6c8de95faf33e9a6304f8c70c41205c467d600130b9c079760e99`
- Command (DO NOT RUN):
  `BUZZ_RELAY_URL="https://intuitxn.communities.buzz.xyz" buzz mem patch --agent df4f2c699372ffe48cb7bfc0b1e509561e9143381f21d61bdf708fbfe1cb49d4 mem/mundus/runtime-2026-09-22 --base-hash d52769bae5c6c8de95faf33e9a6304f8c70c41205c467d600130b9c079760e99 < <fresh-unified-diff-live-vs-draft>`

## 4. mem/mundus/world-model-2026-09-22 — PATCH — NEEDS HUMAN APPROVAL
- Why: pinned `system.bend` sha `6e224e26…` superseded by `1b8baaf9…` (drift-table §5).
- Draft: `docs/drafts/meta/engram-review/corrected/mem---mundus---world-model-2026-09-22.md`
- Pre-check:
  `BUZZ_RELAY_URL="https://intuitxn.communities.buzz.xyz" buzz mem hash --agent df4f2c699372ffe48cb7bfc0b1e509561e9143381f21d61bdf708fbfe1cb49d4 mem/mundus/world-model-2026-09-22`
  Expected: `e36850039519cdd47b3c8fb8b271331a3bd435bf2b16f1c81d860a2f2513e4eb`
- Command (DO NOT RUN):
  `BUZZ_RELAY_URL="https://intuitxn.communities.buzz.xyz" buzz mem patch --agent df4f2c699372ffe48cb7bfc0b1e509561e9143381f21d61bdf708fbfe1cb49d4 mem/mundus/world-model-2026-09-22 --base-hash e36850039519cdd47b3c8fb8b271331a3bd435bf2b16f1c81d860a2f2513e4eb < <fresh-unified-diff-live-vs-draft>`

## 5. mem/telepathy/in-buzz-setup — PATCH — NEEDS HUMAN APPROVAL
- Why: same stale `6e224e26…` pin (drift-table §6).
- Draft: `docs/drafts/meta/engram-review/corrected/mem---telepathy---in-buzz-setup.md`
- Pre-check:
  `BUZZ_RELAY_URL="https://intuitxn.communities.buzz.xyz" buzz mem hash --agent df4f2c699372ffe48cb7bfc0b1e509561e9143381f21d61bdf708fbfe1cb49d4 mem/telepathy/in-buzz-setup`
  Expected: `44596124f8b19eec0230ee10fd0b57a3aa871a9dd7a593c0484325400d35fabb`
- Command (DO NOT RUN):
  `BUZZ_RELAY_URL="https://intuitxn.communities.buzz.xyz" buzz mem patch --agent df4f2c699372ffe48cb7bfc0b1e509561e9143381f21d61bdf708fbfe1cb49d4 mem/telepathy/in-buzz-setup --base-hash 44596124f8b19eec0230ee10fd0b57a3aa871a9dd7a593c0484325400d35fabb < <fresh-unified-diff-live-vs-draft>`

## 6. mem/mundus/network-policy-flow — PATCH — NEEDS HUMAN APPROVAL
- Why: spec file + `runtime/memory.bend` + `runtime/policy.bend` + `mem/policy/*`
  all absent (drift-table §7).
- Draft: `docs/drafts/meta/engram-review/corrected/mem---mundus---network-policy-flow.md`
- Pre-check:
  `BUZZ_RELAY_URL="https://intuitxn.communities.buzz.xyz" buzz mem hash --agent df4f2c699372ffe48cb7bfc0b1e509561e9143381f21d61bdf708fbfe1cb49d4 mem/mundus/network-policy-flow`
  Expected: `43ace4c8ce4fe3e428140ba463e8a4b92775978bf75ddc7bd83d2ce49ab8ceb4`
- Command (DO NOT RUN):
  `BUZZ_RELAY_URL="https://intuitxn.communities.buzz.xyz" buzz mem patch --agent df4f2c699372ffe48cb7bfc0b1e509561e9143381f21d61bdf708fbfe1cb49d4 mem/mundus/network-policy-flow --base-hash 43ace4c8ce4fe3e428140ba463e8a4b92775978bf75ddc7bd83d2ce49ab8ceb4 < <fresh-unified-diff-live-vs-draft>`

## 7. mem/mundus/passive-materialization — PATCH — NEEDS HUMAN APPROVAL
- Why: spec-file pointer absent (drift-table §8).
- Draft: `docs/drafts/meta/engram-review/corrected/mem---mundus---passive-materialization.md`
- Pre-check:
  `BUZZ_RELAY_URL="https://intuitxn.communities.buzz.xyz" buzz mem hash --agent df4f2c699372ffe48cb7bfc0b1e509561e9143381f21d61bdf708fbfe1cb49d4 mem/mundus/passive-materialization`
  Expected: `fcd05e84dfcfff2d9b2f43f1bf551c8ae93c50827fae481f40fac7cce16034f4`
- Command (DO NOT RUN):
  `BUZZ_RELAY_URL="https://intuitxn.communities.buzz.xyz" buzz mem patch --agent df4f2c699372ffe48cb7bfc0b1e509561e9143381f21d61bdf708fbfe1cb49d4 mem/mundus/passive-materialization --base-hash fcd05e84dfcfff2d9b2f43f1bf551c8ae93c50827fae481f40fac7cce16034f4 < <fresh-unified-diff-live-vs-draft>`

## Explicitly NOT proposed (no command)
- `mem/kernels/census`: FRESH on the stated `scripts/census.sh` claim — no write.
- `mem/bend-invocations`, `mem/geist`, `mem/geist-recall-verified`,
  `mem/self-build-geist-enable`: NOT-FOUND live (owner `[]`, agent `not_found`,
  repo grep 0) — no base-hash exists, no `set`/`patch`/`rm` drafted or authorized.
- No `mem rm` (tombstone) is proposed for any slug in this review.
- No `mem set` (new slug or blind overwrite) is proposed; all 7 items above are
  `patch --base-hash` against existing slugs.

## Proof of no writes (this session)
- Relay commands run were read-only: `buzz mem ls` (incl. `--json`, `--owner`,
  `--agent`) / `buzz mem get` / `buzz mem hash` only.
- No `buzz mem set`, `buzz mem patch`, or `buzz mem rm` was executed in this session.
- No commit was created.
