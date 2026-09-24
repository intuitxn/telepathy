# DRAFT - NOT SENT — proposed replacement body for `mem/mundus/world-model-2026-09-22`

Source evidence (read-only, 2026-09-24):
- `runtime/worker/system.bend` live sha256 `1b8baaf9f8036024561b15d4c4a99df3f96c62e5ccdd5099b47bb14e6068f182`
  (`shasum -a 256`); recorded value `6e224e26d47c56d3601b26b55ae77497ab4680cacda89846640380a1d9e69d74` is superseded
- Pattern `6e224e26` occurs in exactly 2 of 22 agent slugs: this one + `mem/telepathy/in-buzz-setup`
- Relay base-hash: `e36850039519cdd47b3c8fb8b271331a3bd435bf2b16f1c81d860a2f2513e4eb`
- Scope remains the 2026-09-22 checkout/machine state; no new checks are asserted

---

# BUZZ MEMORY DRAFT — for Shubham's review. NOT SENT, NOT PUBLISHED. (sha corrected 2026-09-24)

Proposed slug: `mundus-world-model-2026-09-22`
Proposed action: `buzz mem set "mundus-world-model-2026-09-22" - < this-file`
Sender: owner-controlled Buzz signer, only after exact-payload review.

Source revision: checkout `telepathy-shared-learning` @ git `c8eb09a`; kernel
`runtime/worker/system.bend` sha256
`6e224e26d47c56d3601b26b55ae77497ab4680cacda89846640380a1d9e69d74` (2026-09-22 value).

CORRECTION (2026-09-24): live `runtime/worker/system.bend` sha256 is
`1b8baaf9f8036024561b15d4c4a99df3f96c62e5ccdd5099b47bb14e6068f182`.
The `6e224e26…` pin above is HISTORICAL and no longer matches the live file.
No re-check of the 2026-09-22 observations against the live kernel is claimed here.

Observed checks (run 2026-09-22, unchanged):
- `~/.bend/bin/bend runtime/worker/system.bend --check-only` → `All terms check.` (Bend 2.0.21)
- `node --test runtime/worker/protocol.test.mjs` → 2/2 pass
- Independent read-only host-agent audit (codex exec): 9 claims checked, 7 confirmed, 2 disputed then corrected
- Fresh Bend packet on a new conversation re-injected the learned finding (retrieval verified)

Finding (2026-09-22, unchanged):
telepathy-shared-learning is a checked single-file Bend worker. Protocol:
worker → claim → packet → return → explicit learn, over immutable single-writer
snapshots. `return` is a reported result, not verified truth; labels are
unauthenticated; no automatic snapshot merge. Buzz owns memory/ACP and stores
reviewed engrams; Bend owns local state/flow. The custom JavaScript
registry/lifecycle stack is retired at `d7a6c7b0` and its registry data is
historical, not migrated. Recorded learning-benefit evidence is null
(74/74 and 652/652 in both arms, identical normalized code). Bend Base has no OS
subprocess primitive; the `opencode` connector is loopback TCP with HTTP-204
submission acknowledgement only.

Doc drift reported, not fixed (D1–D5) (unchanged): `runtime/desk/README.md:8,16` still assert
a pinned-service client and a shell-permission profile that `runtime/desk/src/runtime.js:1-2`
and `runtime/desk/src/jobs.js:46-48` no longer implement;
`docs/drafts/meta/one-file-bend-command.md:104` should say "no OS subprocess"
(IO.spawn exists at `base.bend:211`); PATH resolution of `opencode` is not stated
(1.18.32 wins over Homebrew 1.14.20); in-tree drafts remain uncommitted.

Scope: this checkout and the machine state at 2026-09-22. It does not claim
weight training, credential isolation, distributed exclusive claims, or automatic
Buzz↔Bend sync.

Counterexamples / limits: correctness of arbitrary worker answers is out of
scope (`runtime/worker/README.md:8-9`); PATH and git-head facts can drift; D1–D5
are unfixed.

Intended audience: Intuitxn/Mundus maintainers; reviewer Shubham.

Evidence pointer (private): `.local/meta-20260922-worldmodel-sync/` snapshot
lineage and `audit-return.md`. In-tree: `docs/drafts/meta/world-model.md`.
