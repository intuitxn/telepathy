# Buzz memory — history kernel laws (`runtime/worker/history.bend`)

Pure Bend kernel that turns Buzz events into a canonical, per-UTC-day history.
No IO, clock, subprocess, hashing, or network. The shell feeds it finite data;
Bend decides the checkable verdicts. This is the draft design note for the
kernel and its 23 named laws. **Status is `draft`; a named human still has to
review the exact revision. A passing check is not acceptance.**

- Kernel: `runtime/worker/history.bend`
- Toolchain: Bend **2.0.21**, `BEND_NO_TELEMETRY=1`, `<bend> FILE --check-only`
  (not `bend check FILE`). Success prints `All terms check.`
- Gate result: **`All terms check.`** over all 23 laws (see proof report).

---

## 1. Event schema

`BuzzEvent` (all fields small/affine so the value is `Data`):

| field     | type          | meaning                                             |
|-----------|---------------|-----------------------------------------------------|
| `src`     | `Nat`         | source event id (ordering + provenance key)         |
| `minute`  | `Nat`         | unix minute; **caller divides seconds by 60**       |
| `actor`   | `Nat`         | actor id (placeholder for hex/pubkey mapping)       |
| `channel` | `Nat`         | channel id                                          |
| `thread`  | `Nat`         | thread root id                                      |
| `kind`    | `Nat`         | event kind code (0 msg, 1 notice, 2 edit; else unknown) |
| `text`    | `+List<Nat>`  | text bytes                                          |

`src`/`minute` are computed **shell-side** (`unix_seconds / 60`) because Bend
`Nat` is unary and large literals overflow. The kernel never reads a clock.

Derived types:

- `Entry{src, day, actor, channel, thread, kind, text}` — a `BuzzEvent` with its
  UTC day resolved. (Same 7 fields; `minute` replaced by `day`.)
- `DayHistory{day, entries}` — one day and its canonical entries (`is Type`,
  owns its list).
- `Verdict = Admit{} | Dedupe{} | Quarantine{}`.

Accessors are explicit defs (`ev_src`, `ev_minute`, …, `entry_src`, `entry_day`,
…); Bend 2.0.21 has no `x.field` syntax in law statements.

## 2. Day boundary rule

```
day = minute / 1440        # 1440 = minutes per UTC day
day_of(m) = (m / 1440n : Nat)
```

- `minute` is a **UTC** minute index; days are half-open `[0,1440)`, `[1440,2880)`, …
- 1439 → day 0, 1440 → day 1 (laws `day_boundary_1439`, `day_boundary_1440`).
- Sane-minute bound is `max_minute() = 2880n` (2 days), **exclusive**; minutes at
  or above it are "insane" and quarantined (placeholder, see Open Questions).

## 3. Canonical / ordering / dedupe / digest rules

**Canonical form** = `dedupe(sort(entries))`.

- **Ordering key**: `(day, thread, src)`, lexicographic, ascending (`key_cmp`).
  `lexd` compares `day`, then `thread`, then delegates to `lex2` for `src`.
- **Dedupe**: after sorting, drop later entries whose `src` equals the previous
  entry's `src` (`dedupe` + `eq_nat` + `dedupe_step`). A duplicate is a
  **Dedupe verdict**, never a silent merge.
- **Sort**: single self-recursive insertion sort (`sort` → `insert` →
  `insert_at`), so no mutual recursion (Bend forbids it and requires defs before
  use).
- **Digest**: `day_digest(entries) = flat(canonical(entries))`, a structural
  `+List<Nat>` fold of two bytes per numeric field (`enc`) plus the raw `text`
  bytes. It is **not sha256**; the shell still owns real hashing.
  `history_digest` prefixes the day byte.

**Classification** (`classify(e, prev_src)`), checked in this order:

1. unknown `kind` → `Quarantine`
2. `minute` not `< max_minute()` ("insane") → `Quarantine`
3. `src < prev_src` (source-id regression) → `Quarantine`
4. `src == prev_src` (duplicate) → `Dedupe`
5. otherwise → `Admit`

`well_formed(e, prev_src)` is the matching boolean (known kind ∧ sane minute ∧
`prev_src ≤ src`); `gate(events, prev_src)` folds verdicts with Quarantine
dominating, then Dedupe, then Admit.

## 4. The 23 named laws (9 universal + 14 concrete)

### Universally quantified (9)

| # | law | one-line statement |
|---|-----|--------------------|
| 1 | `provenance_round_trip` | Every entry keeps its source event id: `entry_src(entry_of(e)) == ev_src(e)`. |
| 2 | `field_retention` | `entry_of(e)` equals the `Entry` built from all seven event fields. |
| 3 | `entry_day_retained` | The entry's day equals the bucket of the event minute. |
| 4 | `date_bucketing` | Bucketing is a function: `day_of(m) == day_of(m)` (one date per minute). |
| 5 | `text_retained` | Text bytes survive event→entry. |
| 6 | `actor_retained` | Actor survives event→entry. |
| 7 | `classify_deterministic` | The verdict is a pure function of `(event, predecessor)`. |
| 8 | `canonical_deterministic` | Canonical form is a pure function of the entries. |
| 9 | `digest_deterministic` | The day digest is a pure function of the entries. |

### Concrete fixture / counterexample / gate witnesses (14)

| # | law | one-line statement |
|---|-----|--------------------|
| 10 | `fixture_admit_good` | A good event (`kind 0`, sane minute, `src > prev`) → `Admit`. |
| 11 | `fixture_quarantine_unknown_kind` | `kind 9` → `Quarantine`. |
| 12 | `fixture_quarantine_insane_minute` | `minute 5000` (≥ bound) → `Quarantine`. |
| 13 | `fixture_quarantine_source_regression` | `src 2` after `prev 9` → `Quarantine`. |
| 14 | `fixture_dedupe_duplicate` | `src 5` after `prev 5` → `Dedupe` (not merge). |
| 15 | `equivalence_good` | Good event: `is_quarantine(classify) == not_(well_formed)`. |
| 16 | `equivalence_illformed` | Ill-formed event: `is_quarantine(classify) == not_(well_formed)`. |
| 17 | `dedupe_not_quarantine` | A duplicate is not quarantined. |
| 18 | `day_boundary_1439` | `day_of(1439) == 0`. |
| 19 | `day_boundary_1440` | `day_of(1440) == 1`. |
| 20 | `ordering_lexicographic` | A later day sorts greater: `key_cmp(big, small) == GT`. |
| 21 | `ordering_tie_break_src` | Same day/thread → higher `src` sorts greater. |
| 22 | `gate_witness_mixed` | `gate([good, unknown_kind], 0n) == Quarantine`. |
| 23 | `digest_stable_under_reorder` | `day_digest([a,b]) == day_digest([b,a])` via canonicalization. |

## 5. Counterexamples and handling

| counterexample input | verdict | why |
|----------------------|---------|-----|
| unknown `kind` (9) | `Quarantine` | never silently merged |
| insane `minute` (5000) | `Quarantine` | out-of-range, not bucketed |
| source-id regression (`src < prev`) | `Quarantine` | ordering integrity |
| duplicate `src` (`src == prev`) | `Dedupe` | collapse, do not merge |
| good event | `Admit` | admit path |

## 6. PROVEN vs DESIGNED

**PROVEN (machine-checked, `All terms check.`)** — the 23 laws above: provenance
and field retention, day bucketing incl. boundaries, classify/gate counterexample
verdicts, ordering key comparisons, canonical/digest determinism, and
reorder-invariance of the structural digest. Proofs are structural case analyses
(`match` on the quantified parameter) ending in `{==}`.

**DESIGNED (not yet a machine-checked universal)**:

- `sort` correctness as a *universal* property (output is ordered and a
  permutation of the input) is only exercised by concrete witnesses; the
  insertion-sort termination is checked, the permutation/order theorem is not.
- `dedupe` correctness as a universal "no two kept entries share `src`" theorem
  is witnessed only for fixtures.
- The structural digest is collision-resistant only by construction; it is
  **not** a cryptographic hash.
- `max_minute = 2880n` (2 days) is a placeholder sanity bound, not a calibrated
  epoch limit.

## 7. Open questions (carried, unresolved)

1. **Minute vs seconds, epoch** — is `minute` UTC unix minutes, and is the epoch
   fixed? The `max_minute` bound is a placeholder.
2. **Ordering key** — `(day, thread, src)` vs the alternative
   `(date, actor, channel, thread, src)`; which is the canonical replay order?
3. **Dedupe vs quarantine** for duplicates — this draft maps equal `src` to
   `Dedupe`; should a conflicting duplicate (same `src`, different body) instead
   quarantine?
4. **Structural digest vs sha256** — the kernel folds bytes; the shell must
   still compute/verify a real content hash.
5. **Hex `src` mapping** — `src`/`actor`/`channel`/`thread` are small `Nat`
   placeholders; the mapping from hex/pubkey identifiers is shell-side.
6. **Standalone vs `system.bend` integration** — keep `history.bend` standalone,
   or import/inline it into `runtime/worker/system.bend`?

## 8. Non-claims

Bend proves only the laws above over the values handed to it. The shell/human
must still do: reading files and events, `unix_seconds / 60`, real hashing,
byte scans, identity-roster checks, schema validation, and the final acceptance
decision for an exact revision.
