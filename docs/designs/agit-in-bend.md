> Design proposal — not shipped. Prepared as a bounded design pass on 2026-09-18.
> Owner review required before any implementation starts.
> This file is the only artifact of this pass. It changes no runtime code.
> Companion to `agentic-git.md` (§4 laws, §5 gate) and `nudge-simplify.md`
> (§2: data algorithms belong in Bend). All Bend code below passed
> `bend check` and `bend run-rs` on bend-lang 0.2.38 (see §8).

# agit logic in Bend: lifecycle + proof laws as pure functions

**Status:** design proposal · **Base:** `docs/designs/agentic-git.md`,
`docs/designs/nudge-simplify.md`, `HARNESS.md`, `docs/PROJECTS.md`

## 0. Frame

`agentic-git.md` assigns three roles: Nudge stays thin (one model call per
transaction), Bend proves correctness (`PROOF.bend` over candidate bytes and
digests), git stores the reviewable record. This doc makes the Bend half
concrete: the exact types, the total transition function, the five laws as
checkable Bend defs, and the boundary between what Bend decides and what the
shell/git layer still owns.

Environment note: `bend guide` and `bend base` do not exist in bend-lang
0.2.38 (`bend --help` lists `check`, `run-rs`/`run-c`/`run-cu`, `gen-hvm`,
`gen-c`, `gen-cu`, `desugar`). The language was instead mastered empirically
against the real CLI: every construct below was accepted by `bend check` and
the kernel in §1–§6 executes under `bend run-rs`. Bend-specific constraints
found that way are recorded in §9 so future authors don't rediscover them.

## 1. JobState type

The six-stage lifecycle (`HARNESS.md` §2, `docs/PROJECTS.md`) as a closed ADT.
There is no seventh state; `match` arms on `JobState` are exhaustive by
construction.

```bend
type JobState = Proposed | Ready | Active | Waiting | Review | Resolved | Cancelled
type LawResult = Pass | Fail | NotEvaluated
type Verdict = Allow | (Deny code) | (NeedInput code)
```

`Resolved` and `Cancelled` are the only terminal states. `Deny(code)` names
the failed law (1–5, §4 order); `NeedInput` means some law is unevaluated, so
the gate waits rather than guessing.

Evidence enters as one value. Digests are byte lists (shell hex-decodes
`sha256:…` before calling Bend — §3 explains why); flags are 1/0 bits from
shell-side byte scans and schema checks (§7):

```bend
type Evidence = (Ev bundle active_bundle review_candidate merge_candidate
  reviewer_is_human reviewer_is_distinct shape_ok hygiene_ok lineage_ok)
```

## 2. Transition function

Total over (state, verdict, stage bit, cancel bit). Non-terminal stages advance
on their stage bit; only `Review + Allow` resolves; cancel from any
non-terminal state lands in `Cancelled`; terminal states absorb.

```bend
def transition(state, verdict, stage_ok, cancel):
  if cancel == 1:
    match state:
      case JobState/Resolved:
        return JobState/Resolved
      case JobState/Cancelled:
        return JobState/Cancelled
      case _:
        return JobState/Cancelled
  else:
    match state:
      case JobState/Proposed:
        if stage_ok == 1:
          return JobState/Ready
        else:
          return JobState/Proposed
      case JobState/Ready:
        if stage_ok == 1:
          return JobState/Active
        else:
          return JobState/Ready
      case JobState/Active:
        if stage_ok == 1:
          return JobState/Waiting
        else:
          return JobState/Active
      case JobState/Waiting:
        if stage_ok == 1:
          return JobState/Review
        else:
          return JobState/Waiting
      case JobState/Review:
        match verdict:
          case Verdict/Allow:
            return JobState/Resolved
          case _:
            return JobState/Review
      case JobState/Resolved:
        return JobState/Resolved
      case JobState/Cancelled:
        return JobState/Cancelled
```

No clause merges, tags, accepts, or touches the network — Bend cannot; it has
no IO. Advancement past `Review` additionally requires the shell to re-check
the gate inline before merging (`agentic-git.md` §3, `agit accept` steps 1–4):
Bend's `Allow` is necessary, never sufficient.

## 3. Digest equality checks

Strings in Bend 0.2.38 are opaque to boolean comparison (`"abc" == "abc"`
does not reduce to 1/0), so digests cross the boundary as `List` of byte
numbers and Bend compares them structurally — byte-exact and
length-sensitive:

```bend
def digest_eq(a, b):
  match a:
    case List/Nil:
      match b:
        case List/Nil:
          return 1
        case List/Cons:
          return 0
    case List/Cons:
      match b:
        case List/Nil:
          return 0
        case List/Cons:
          if a.head == b.head:
            return digest_eq(a.tail, b.tail)
          else:
            return 0

def is_missing(d):
  match d:
    case List/Nil:
      return 1
    case List/Cons:
      return 0

def bit_to_law(bit, missing):
  if missing == 1:
    return LawResult/NotEvaluated
  else:
    if bit == 1:
      return LawResult/Pass
    else:
      return LawResult/Fail
```

A missing digest is `NotEvaluated`, never `Pass`: an absent proof note blocks
the gate (`agentic-git.md` §5 rule 3) instead of defaulting open.

## 4. The five laws as Bend laws

One def per law in `agentic-git.md` §4, in the same order. Each is a pure
function of evidence bytes/bits only — no model calls, no credentials, no
network.

```bend
def law_exact_revision(ev):
  match ev:
    case Evidence/Ev:
      missing = is_missing(ev.review_candidate) | is_missing(ev.merge_candidate)
      return bit_to_law(digest_eq(ev.review_candidate, ev.merge_candidate), missing)
    case _:
      return LawResult/NotEvaluated

def law_source_separation(ev):
  match ev:
    case Evidence/Ev:
      return bit_to_law(ev.hygiene_ok, 0)
    case _:
      return LawResult/NotEvaluated

def law_human_authorship(ev):
  match ev:
    case Evidence/Ev:
      return bit_to_law(ev.reviewer_is_human & ev.reviewer_is_distinct, 0)
    case _:
      return LawResult/NotEvaluated

def law_acceptance_shape(ev):
  match ev:
    case Evidence/Ev:
      return bit_to_law(ev.shape_ok, 0)
    case _:
      return LawResult/NotEvaluated

def law_lineage(ev):
  match ev:
    case Evidence/Ev:
      missing = is_missing(ev.bundle) | is_missing(ev.active_bundle)
      chained = digest_eq(ev.bundle, ev.active_bundle) & ev.lineage_ok
      return bit_to_law(chained, missing)
    case _:
      return LawResult/NotEvaluated
```

| # | Law | Bend def | Shell's job (feeds the bits) |
|---|---|---|---|
| 1 | `exact-revision` | `digest_eq(review_candidate, merge_candidate)` | canonicalize candidate bytes, sha256, hex-decode to byte lists |
| 2 | `source-separation` | gate on `hygiene_ok` | byte-scan candidate for supplied IDs, receipt ids, transcript text, credential patterns (extends `cli.py` host guard) |
| 3 | `human-authorship` | `reviewer_is_human & reviewer_is_distinct` | resolve commit author/committer + `Reviewer:` trailer against human roster; compare with worker identity |
| 4 | `acceptance-shape` | gate on `shape_ok` | validate candidate against the Nudge output schema (title/body present, typed contract) |
| 5 | `lineage` | `digest_eq(bundle, active_bundle) & lineage_ok` | fetch active compile digest; lesson sub-flow additionally checks the frozen-source + parent-digest pair |

## 5. Gate verdict

First `Fail` wins and names its law; otherwise any non-`Pass` holds the gate
open with `NeedInput`; all five `Pass` yields `Allow`. Clearing a law means a
new candidate + fresh proof — the gate never rewrites history.

```bend
type LawSet = (Laws exact separation authorship shape lineage)

def is_pass(r):
  match r:
    case LawResult/Pass:
      return 1
    case _:
      return 0

def is_fail(r):
  match r:
    case LawResult/Fail:
      return 1
    case _:
      return 0

def prove_all(ev):
  r1 = law_exact_revision(ev)
  r2 = law_source_separation(ev)
  r3 = law_human_authorship(ev)
  r4 = law_acceptance_shape(ev)
  r5 = law_lineage(ev)
  return LawSet/Laws(r1, r2, r3, r4, r5)

def gate(laws):
  match laws:
    case LawSet/Laws:
      if is_fail(laws.exact) == 1:
        return Verdict/Deny(1)
      else:
        if is_fail(laws.separation) == 1:
          return Verdict/Deny(2)
        else:
          if is_fail(laws.authorship) == 1:
            return Verdict/Deny(3)
          else:
            if is_fail(laws.shape) == 1:
              return Verdict/Deny(4)
            else:
              if is_fail(laws.lineage) == 1:
                return Verdict/Deny(5)
              else:
                pending = 5 - is_pass(laws.exact) - is_pass(laws.separation) - is_pass(laws.authorship) - is_pass(laws.shape) - is_pass(laws.lineage)
                if pending == 0:
                  return Verdict/Allow
                else:
                  return Verdict/NeedInput(0)
    case _:
      return Verdict/NeedInput(0)
```

The five `rN = law_…(ev)` bindings are independent — the HVM normalizes them
concurrently (implicit data parallelism; no threads are managed). Explicit
`fork` is reserved for the bounded re-proof driver in §6.

## 6. Bounded re-proof driver (fork-join)

Re-proof rounds are bounded: the `bend` loop carries only the round counter
via `fork`, then decides once. An agent looping forever on a failing proof is
a liveness bug; the bound makes it a finite, reviewable event.

```bend
def drive(state, ev, rounds):
  laws = prove_all(ev)
  v = gate(laws)
  bend n = rounds:
    when n > 0:
      return fork(n - 1)
    else:
      return transition(state, v, 1, 0)
```

## 7. What stays in shell git vs pure Bend

| Concern | Owner | Why |
|---|---|---|
| Canonical bytes, sha256, hex-decode, byte scans, schema validation | shell (`agit` wrapper) | Bend has no hashing, no regex, no IO; it decides over values handed in |
| Commits, notes refs (`agit-state`/`agit-proof`/`agit-review`), tags, merges | git via shell | durable reviewable record; Bend is stateless |
| Human identity roster, reviewer ≠ worker check inputs | shell/host | strings cannot prove identity (`cli.py` comment); the host authenticates out-of-band |
| Lifecycle decision, law evaluation, gate verdict | pure Bend (`PROOF.bend`) | total, deterministic, machine-checkable via `bend check`; same inputs → same verdict, always |
| SQLite projection, Buzz replies, changelog | desk / steward (existing) | execution cache and human surface; git wins on disagreement |

The proof gate is a pure function of (candidate bytes, bundle digest, proof
source). `agit prove` serializes evidence → runs `bend check` + evaluates →
writes the `refs/notes/agit-proof` envelope. `agit accept` re-evaluates inline
before merging. Model text claiming approval never enters evidence.

## 8. Verification log (2026-09-18, bend-lang 0.2.38)

- `bend check <kernel>` — passes (all defs above, plus a `main` exercising
  `Review+Allow→Resolved`, `Review+Deny→Review`, `cancel→Cancelled`,
  `drive(Proposed,…,3)→Ready`).
- `bend run-rs <kernel>` — `Result: JobState/Ready`; assertion chain in `main`
  holds (any wrong transition would have returned `Proposed`).
- Negative run (merge-candidate bytes tampered): gate returns `Deny(1)` —
  the exact-revision law fires with the expected code.
- `digest_eq` unit run: equal → 1, one-byte difference → 0, length mismatch → 0.

## 9. Bend constraints discovered (for future authors)

Verified against 0.2.38; re-check before relying on newer versions:

1. One clause per `def` — no multi-clause pattern matching; branch with
   `match`/`case`/`case _` inside a single body.
2. ADT field constructors need parens in the type decl
   (`type V = Allow | (Deny code)`), construct as `V/Deny(3)`, access as
   `v.code` from inside the matching `case`.
3. No `and`/`or`/`not` keywords; use `&` / `|` on 1/0 flags (runtime-verified).
4. No tuple indexing (`t.0` is unbound); carry multi-value results in a named
   ADT (`LawSet`) instead.
5. List patterns bind no variables (`case List/Cons(h, t):` is a parse
   error); match `case List/Cons:` and read `xs.head` / `xs.tail`.
6. `fork` is a keyword only in the `when` arm of a `bend` block, used as
   `return fork(next)`; the `bend` block must be the function's final
   statement (nothing may follow it).
7. `open` is a reserved word; don't use it as a variable name.
8. Strings are opaque to `==` as a boolean — pass digests as byte-number
   lists and compare with `digest_eq`.

## 10. Open questions for the owner

1. Should `PROOF.bend` per job be generated from a template (fixed law set,
   per-job digests filled by `agit prove`) or hand-authored per job with a
   fixed five-law prelude?
2. Where does the canonical-byte definition live so shell hashing and Bend
   byte lists can't drift (shared spec with test vectors, or shell-owned)?
3. Re-proof round bound: fixed constant, per-job policy, or human-set per
   transition?
