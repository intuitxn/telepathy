# DRAFT — self-building loop: kernel-first bundle, activate/rollback, learn→bundle

Status: draft, agent-authored (Prime, project steward) · 2026-09-24 · **Not published, not sent, not merged. No external effect.**
Written for human review; a named human accepts a specific revision. Nothing here is acceptance.
A passing check is never acceptance (`docs/drafts/meta/op-dispatch-convention.md:142-157`; `docs/drafts/meta/ops-as-bend.md:34`).
This draft invents no metrics, customers, or shipped features. Items marked **unverified** were not re-checked live in this run. Humans own the outcome.

Human intent: define one kernel-first redesign in which the kernel decides versioned bundle transitions, the host executes and attests effects, and accepted lessons become bundle changes only through a frozen-set gate.

Prime three answers (what changed / why it matters / what is needed):
- **What changed:** this one file defines the bundle manifest, `activate`/`rollback` transitions, four new kernel ops/laws, the CLI contract, the trust boundary, the learn→bundle pipeline, break-glass, and v1/v2 staging — all cited, no new code.
- **Why it matters:** today derivation, effects, and learning sit in separate drafts with an unassigned `mkdir`/effect boundary (`docs/drafts/meta/mkdir-gap-and-boundary.md:32-57`) and noting mislabeled as learning (`docs/drafts/meta/self-learning-loop.md:37-48`). Without a versioned bundle plus a frozen-set gate, self-change is unreviewable.
- **What is needed:** numbered owner decisions below (bundle members, canonicalization, N, signer, canary, break-glass persons, v2 entry); then `@build` can implement without re-deriving intent.

Context read (cheap only): `docs/drafts/meta/mundus-kernel-laws.md` (300 lines); `docs/drafts/meta/op-dispatch-convention.md` (227 lines); `docs/drafts/meta/self-learning-loop.md` (124 lines); `runtime/adaptive/META.md` (151 lines); `docs/drafts/meta/mkdir-gap-and-boundary.md` (224 lines); `docs/drafts/meta/ops-as-bend.md` (36 lines); corrected memos for passive-materialization / network-policy-flow. `GEIST.md`: absent in this checkout — **unverified**. Top-level `docs/drafts/meta/passive-materialization.md` and `docs/drafts/meta/network-policy-flow.md`: absent per corrected memos — **unverified** live here.

---

## 1. BUNDLE MANIFEST schema

```json
{
  "name": "<bundle-name>",
  "version": "<bundle-version>",
  "digest": "sha256:<hex-of-canonical-manifest>",
  "contents": [
    {"path": "<repo-relative-path>", "sha256": "<hex>"}
  ],
  "requires": {"bend": "2.0.21", "opencode": "<version-UNVERIFIED>"},
  "policy": "<policy-slug>@<digest-UNVERIFIED-shape>"
}
```

| Field | Type | Rule |
|---|---|---|
| `name` | string | bundle identity (e.g. proposal: `mundus-single-node`) |
| `version` | string | monotonic bundle version; bump on any member change |
| `digest` | string | `sha256` of the **canonical manifest** (definition below); the bundle id |
| `contents` | array | one `{path, sha256}` per member, sorted by `path` ascending; `path` repo-relative, `sha256` hex of file bytes |
| `requires.bend` | string | exact Bend version (observed `2.0.21` at `docs/drafts/meta/mundus-kernel-laws.md:3,9`) |
| `requires.opencode` | string | exact host toolchain id — value **unverified** (owner decision D3) |
| `policy` | string | policy slug + digest governing this bundle — shape **unverified** (owner decision D4) |

**Digest definition (proposal).** `digest = sha256(canonical_manifest_bytes)` where canonical manifest = the manifest object with the `digest` field removed, keys sorted lexicographically, `contents` sorted by `path`, UTF-8, no insignificant whitespace (exact canonicalization = owner decision D2; current statement is the proposal, **unverified** against an implementation).

| COVERED by the bundle (versioned, hashed, gated) | NOT covered (never hashed into `digest`) |
|---|---|
| kernel files (e.g. `runtime/worker/system.bend` per `runtime/adaptive/META.md:40-48`; `runtime/mundus.bend` per `docs/drafts/meta/mundus-kernel-laws.md:7`) | secrets / credentials / keychain contents (never in bundle; host-side only) |
| ops (`runtime/ops/*.bend`, shape at `docs/drafts/meta/ops-as-bend.md:8-17`) incl. the four new ops in §3 | relay state / Buzz memory / engrams (provenance only, per `runtime/adaptive/META.md:143-146`) |
| scripts + entry point (e.g. `scripts/census.sh` per corrected passive-materialization memo `:36-42`; `./mundus` shim proposal at `docs/drafts/meta/mkdir-gap-and-boundary.md:94-107` — shim itself **unverified** live) | worktrees / run dirs / snapshots (`ops/runs/` output only per `docs/drafts/meta/op-dispatch-convention.md:125-140`; worktrees disposable per `:107-119`) |
| frozen tasks + scorer revision pin (`frozen.manifest.json` shape at `docs/drafts/meta/self-learning-loop.md:23-31`) | per-cycle artifacts (`baseline.json`, `remeasure.json`, `delta.json` — evidence, not bundle members) |

Exact member list for v1 = owner decision D1.

---

## 2. ACTIVATE / ROLLBACK transitions (single-node only)

Fleet gossip / multi-node canary is explicitly **OUT OF SCOPE for v1** (see §8).

### `activate(digest)` — ordered, stop-on-first-failure

| Step | Actor | Action |
|---|---|---|
| A1 | host | fetch + verify **every** hash in `contents` against live bytes; emit signed attestation (hashes, bundle digest, actor, toolchain id). Hashing is host-side: Bend Base has no hash primitive (`docs/drafts/meta/mkdir-gap-and-boundary.md:78-88`; kernel "hashes nothing" at `docs/drafts/meta/mundus-kernel-laws.md:290-297`) |
| A2 | host | gate the kernel: `BEND_NO_TELEMETRY=1 bend <kernel-file> --check-only` must print `All terms check.`, exit 0 (gate form at `docs/drafts/meta/op-dispatch-convention.md:50-55`; file-precedes-flag at `runtime/adaptive/META.md:55-61`) |
| A3 | kernel+host | canary **one node** (this node): run the bundle's frozen-set re-measure (§6) on the candidate; record `remeasure.json`; apply the §6 admit rule before proceeding |
| A4 | host | flip `HEAD := digest` (single pointer write); record `{prev_digest, new_digest, actor, attestation_ref, remeasure_ref}` in the lineage |
| A5 | host | retain history; never GC the last N digests (N = owner decision D5) |

Any failure at A1–A3 aborts: no HEAD flip, candidate quarantined per §6.

### `rollback()` — one step, always available

1. `HEAD := previous digest` (exactly one step back in retained history).
2. Re-verify hashes (A1) + re-check kernel (A2) at the restored digest; record a rollback event citing the restored digest and reason.
3. History is retained (no GC of last N; N = D5). Rollback itself is a recorded transition, not a silent pointer move; forward re-activation follows `activate(digest)` from §2.

Single-writer discipline applies throughout (`runtime/adaptive/META.md:90-96`).

---

## 3. NEW KERNEL LAWS / OPS (small and splittable)

Constraint (non-negotiable): kernels stay **SMALL and splittable** — one op = one file, reuse via `import`, never single-file bloat. Shape at `docs/drafts/meta/ops-as-bend.md:8-17`; one executable Bend file per kernel at `runtime/adaptive/HARNESS.md:64-66`. **Single-file bloat is forbidden: checker hangs on oversized files have been reported — hang reproduction is unverified in this run**, so the rule is preventive: any op file that cannot be checked in isolation is split (entry + imports) before review.

| Op (file proposal) | Typed Input → Output | Laws it must carry (each: named `law` + same-name `def` proof) |
|---|---|---|
| `activate` (`runtime/ops/activate.bend` — proposed, absent) | `ActivateInput{digest: String, expected: List<HashEntry>} -> ActivateOutput{ok: Bool, reason: String}` | `activate_requires_hash_match` (ok ⇒ every entry matched); `activate_requires_check` (ok ⇒ checker gate passed); `activate_canary_first` (HEAD flip ⇒ canary ADMIT recorded); `activate_single_flip` (one transition flips exactly one HEAD) |
| `rollback` (`runtime/ops/rollback.bend` — proposed, absent) | `RollbackInput{head: Digest, prev: Digest} -> RollbackOutput{head: Digest}` | `rollback_one_step` (output == immediate predecessor, never skip); `rollback_always_available` (prev retained ⇒ rollback defined); `rollback_records_reason` (every rollback carries prev+reason) |
| `propose` (`runtime/ops/propose.bend` — proposed, absent) | `ProposeInput{parent: Digest, change: ChangeDesc} -> ProposeOutput{candidate: Digest}` | `propose_never_mutates_head` (propose leaves HEAD unchanged); `propose_parent_pinned` (candidate cites exact parent digest); `propose_machine_readable` (candidate is op/law/program diff, never prose-only — cf. passive-materialization memo `:31-34`) |
| `signer-gate` (`runtime/ops/signer-gate.bend` — proposed, absent) | `GateInput{request: Request, policy: Policy, attestation: Attestation} -> GateOutput{Allow \| Deny \| NeedReview}` | `gate_deny_by_default` (no-match ⇒ Deny); `gate_no_escalation`; `gate_deterministic` (same policy+request ⇒ same decision); `gate_review_is_explicit` (NeedReview never auto-activates). Criteria mirror the network-flow memo `:38-44`; wiring there is proposal-only, **unverified** |

Each op: checked via `bend <op>.bend --check-only` (exit 0) plus a falsification mutation that must fail (convention at `docs/drafts/meta/op-dispatch-convention.md:68-80`).

---

## 4. CLI CONTRACT (shell / host driver)

The shell may **ONLY**: (a) invoke checked kernel transitions with explicit arguments, and (b) perform the irreducible host effects below. Basis: pure-decision-in-kernel / effects-in-driver (`docs/drafts/meta/op-dispatch-convention.md:82-103`; `docs/drafts/meta/mkdir-gap-and-boundary.md:58-77`).

| Allowed host effect | Example command | Why host-side (evidence) |
|---|---|---|
| `mkdir` (provision derived dirs) | `mkdir -p` parent of kernel `path` output | Base has no dir effect (`mkdir-gap-and-boundary.md:18-25,138-147`) |
| `hash` (sha256 verify) | `shasum -a 256` | kernel "hashes nothing" (`mundus-kernel-laws.md:290-297`) |
| `exec` (run checked kernel) | `bend <file> -- <verb> <args>` | `IO.spawn` is a fiber, not a process (same doc `:21,66-69`) |
| `relay` (fetch/append events) | host relay client | kernel cannot speak relay: no TLS in Base (network-policy-flow memo `:21-27`) |
| `keychain` (identity/sign) | host signer | identity is host/owner-signer (`op-dispatch-convention.md:92-98`) |
| `network` (transport) | host transport | sockets exist, TLS does not; transport is host-side (same memo) |

The shell must **NEVER**: branch on state (no `if`/`case` over state contents), mutate outside a kernel transition (no direct writes except the transition's derived path), or inline op logic (no re-implementation of `run`/laws; op logic stays in the op file per `op-dispatch-convention.md:100-104`).

**Auditor conformance rule (grep-able):**
```sh
# 1. No state-branching in the driver (must print nothing):
grep -rnE 'if.*state|case.*state|verb_of|fold_verdicts|plan\(' <driver-shim> ; test $? -eq 1
# 2. No hardcoded verb→directory map (must print nothing; paths come from kernel `path` verb):
grep -rnE 'capture\.state|retrieve\.state|init\.state' <driver-shim> ; test $? -eq 1
# 3. Only checked invocations (every `bend` line carries `--check-only` or `-- <verb>` with explicit args):
grep -rn 'bend ' <driver-shim> | grep -vE '\-\-check-only|\-\- (help|init|capture|plan|work|claim|packet|return|learn|correct|retrieve|status|path|op|activate|rollback)'
# rule 3 must also print nothing. Driver filename itself = owner decision D6 (must not duplicate the in-progress `./mundus` — existence **unverified** here per `mkdir-gap-and-boundary.md:27-30`).
```

---

## 5. TRUST BOUNDARY (stated plainly)

**The kernel decides. The host executes AND attests. A check passing is not proof the host obeyed.**

- Hash verification, fetching, effect execution, directory creation, relay transport, and signing are **host-side** with **auditable attestation** (what bytes, what digest, who, what toolchain, what evidence ref). The kernel never fetches, never hashes, never touches the network.
- The kernel's job is the pure decision plus its checked laws (dispatch totality, derivation determinism, gate predicates in §3).
- Consequences: a green checker means the *decision logic* checked — it says nothing about whether the host verified a hash, ran the right bytes, flipped the right HEAD, or honored a Deny. The host could ignore a Deny (network-policy-flow memo `:60-62` carries this limit forward).
- Every activation therefore pairs one kernel proof (`All terms check.`) with one host attestation (A1/A4 records in §2); a reviewer replays both, never either alone.

---

## 6. LEARN → BUNDLE pipeline (verify-then-frozen-set-delta)

Accepted lessons become **machine-readable op/law/program changes — never prose-only** (stabilization rule, passive-materialization memo `:31-34`).

| Stage | Input | Gate | Output |
|---|---|---|---|
| propose | observed outcomes only (checker/fixture outputs, revisions, costs) | `propose` op (§3): parent pinned, HEAD untouched | candidate bundle digest + `candidate.json` (form at `self-learning-loop.md:23-31` L2) |
| verify | candidate op/law files | `bend <file> --check-only` exit 0 + recorded falsification mutation | `evidence` (checker + negative-case output) |
| delta | `baseline.json` + `remeasure.json` on the **same** `frozen_version` | **LEARN GATE** (`self-learning-loop.md:55-62`): ADMIT iff `S_c ≥ S_b` AND (`S_c > S_b` OR `C_c < C_b`); else QUARANTINE, never merge | `delta.json` with disposition |
| canary | admitted candidate | single-node canary re-measure before activation (§2 A3) | canary ADMIT record |
| activate | canary-ADMIT digest | `activate(digest)` (§2) | HEAD flip + lineage record |

Quarantined candidates sit in `quarantine/<cycle-id>/`, never merged, never cited as learning (quarantine-first at `self-learning-loop.md:62`). Skipping re-measurement voids the cycle as learning (same file `:31,41-48`). Cost unit/weights, frozen-set content, and scorer identity = owner decisions carried from `self-learning-loop.md:114-123` D2–D4 (not re-decided here).

---

## 7. BREAK-GLASS (named human override for incidents)

Because humans own the outcome, incidents have one override path — used sparingly, always recorded:

| Element | Rule |
|---|---|
| **Who** | exactly one named human (owner decision D7) may declare break-glass; no agent self-authorizes it (agents draft, humans accept) |
| **What gets recorded** | `{declarant, timestamp, reason, incident_ref, pre_digest, post_digest, attestation_ref, evidence_refs[]}` appended to the lineage as a `BREAK_GLASS` event before any HEAD move |
| **How the lineage marks it** | the HEAD record is tagged `BREAK_GLASS:<declarant>:<reason-slug>`; the event bypasses canary/gate but never bypasses recording; a post-incident `delta.json` + review is owed within the window set in D7 |
| **What it cannot do** | publish/send externally, mint identity, or GC history (last-N retention in §2 still holds); external sends need their own reviewed publication path |

Break-glass use is itself reviewable evidence at the next human review; repeated use triggers a bundle/policy revision through §6, not a standing bypass.

---

## 8. STAGING, ACCEPTANCE, OWNER DECISIONS

### Staging

| Stage | Scope | Entry criteria for the next stage |
|---|---|---|
| **v1: single-node bundle** (this spec) | one node; `activate`/`rollback` per §2; four ops per §3; CLI per §4; learn→bundle per §6; break-glass per §7 | all A1–A8 below green on the accepted revision + owner decisions D1–D8 closed |
| **v2: fleet / gossip** (explicitly later) | multi-node gossip, fleet canary, shared HEAD protocol | v1 stable for the window set in D8; gossip/auth/freshness design reviewed (current HARNESS defers federation until a real multi-node need at `runtime/adaptive/HARNESS.md:15-17`); v2 spec accepted by a named human before any fleet code |

### Checkable acceptance criteria

| # | Criterion | Check |
|---|---|---|
| A1 | this spec exists at `docs/drafts/meta/self-building-loop.md` with §§1–8 + decisions, draft banner, tables, no invented claims | `test -f` + grep `## 1.`…`## 8.` + `OPEN OWNER DECISIONS` + `unverified` |
| A2 | manifest validates: digest recomputes from canonical form; every member hash verifies; secrets/relay/worktrees absent from `contents` | script recomputes `digest`; `grep -riE 'secret\|token\|keychain' <manifest>` empty; member paths ⊆ D1 list |
| A3 | `activate(digest)` follows A1→A5 in order; bad-hash and bad-check candidates abort with no HEAD flip | drill logs show abort at A1 / A2 with HEAD unchanged; canary record present on success |
| A4 | `rollback()` restores exactly the previous digest; history of last N retained | drill: activate X→Y, rollback ⇒ HEAD==X; `ls` lineage retains N digests |
| A5 | four ops exist as small files (entry + imports), each `bend --check-only` green + one recorded failing mutation | `bend runtime/ops/{activate,rollback,propose,signer-gate}.bend --check-only` exit 0 ×4; four negative-case logs |
| A6 | driver passes the §4 triple-grep conformance with zero hits | run the three greps; all empty |
| A7 | learn→bundle drill: one prose-only proposal rejected; one gated candidate ADMITs with matching `frozen_version` baseline+remeasure; one regressing candidate quarantined | `delta.json` fixtures ×3; quarantined SHA absent from main history |
| A8 | draft-only boundary: no commit/publish/send from this task except this file; human owns outcome stated | `git status` shows only this file; banner present |

### Numbered OPEN OWNER DECISIONS

1. v1 bundle member list (exact kernel/op/script/entry/frozen-task paths) + owner/reviewer of this spec + acceptance revision id.
2. Canonical-manifest byte form (key order, whitespace, encoding) that `digest` hashes.
3. `requires` pinning: exact `opencode`/host toolchain id capture (bend pinned `2.0.21`).
4. `policy` field shape (slug + digest form) and which policy governs v1 activation.
5. History retention N (proposal: 10 — **decision, not a claim**); GC rule for digests older than N; lineage store path.
6. Driver filename/location (must not duplicate the in-progress `./mundus` — coordinate; existence **unverified**) + canary definition for one node (which frozen set, timeout).
7. Break-glass declarant(s) by name, incident-record store, post-incident review window.
8. v2 entry: stability window + who authors the fleet/gossip spec; confirm fleet stays out of v1.
9. Frozen-set content v1, scorer identity, cost unit/weights (carried from `self-learning-loop.md:114-123` D2–D4 — close here or there, not both).
10. Branch/merge naming for bundle candidates (`learn/<cycle-id>` reuse? new `bundle/<digest>`?) and main-merge approver.

Non-claims: no bundle, op file, driver, scorer, frozen set, or runner is claimed implemented beyond the paths cited; `runtime/ops/{activate,rollback,propose,signer-gate}.bend` do not exist yet; tombstone/merge semantics remain proposals; prior scores (136/136, 74/74, 652/652) are retained evidence from `runtime/adaptive/LEARNING.md` via `self-learning-loop.md:15`, not claims of this loop.
