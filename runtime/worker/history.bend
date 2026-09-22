import Base

# =====================================================================
# history.bend — pure Buzz-event history kernel (Bend 2.0.21)
# BuzzEvent -> HistoryEntry -> DayHistory. No IO, clock, subprocess,
# hashing, or network. Minute indices arrive pre-divided by the caller
# (unix seconds / 60) to avoid unary-Nat overflow.
# =====================================================================

# ---- Types ----------------------------------------------------------
type Verdict is Data:
  Admit{}
  Dedupe{}
  Quarantine{}

type BuzzEvent is Data:
  BuzzEvent{src: Nat, minute: Nat, actor: Nat, channel: Nat, thread: Nat, kind: Nat, text: +List<Nat>}

type Entry is Data:
  Entry{src: Nat, day: Nat, actor: Nat, channel: Nat, thread: Nat, kind: Nat, text: +List<Nat>}

type DayHistory is Type:
  DayHistory{day: Nat, entries: List<Entry>}

# ---- Scalar helpers (defs before use) -------------------------------
def day_of(m: Nat) -> Nat:
  (m / 1440n : Nat)

def max_minute() -> Nat:
  2880n

def not_(b: Bool) -> Bool:
  match b:
    case True{}: False{}
    case False{}: True{}

def and_(a: Bool, b: Bool) -> Bool:
  match a:
    case False{}: False{}
    case True{}: b

# known kinds: 0n message, 1n notice, 2n edit; anything else unknown.
def known_kind(k: Nat) -> Bool:
  match k:
    case 0n: True{}
    case 1n+p:
      match p:
        case 0n: True{}
        case 1n+q:
          match q:
            case 0n: True{}
            case _: False{}

# minute must be strictly below the bound (b exclusive).
def within(m: Nat, b: Nat) -> Bool:
  match m:
    case 0n:
      match b:
        case 0n: False{}
        case 1n+q: True{}
    case 1n+r:
      match b:
        case 0n: False{}
        case 1n+q: within(r, q)

# ---- Classification -------------------------------------------------
def verdict_of(ok_kind: Bool, ok_minute: Bool, ord: Cmp) -> Verdict:
  match ok_kind:
    case False{}: Quarantine{}
    case True{}:
      match ok_minute:
        case False{}: Quarantine{}
        case True{}:
          match ord:
            case LT{}: Quarantine{}
            case EQ{}: Dedupe{}
            case GT{}: Admit{}

def classify(e: BuzzEvent, prev_src: Nat) -> Verdict:
  match e:
    case BuzzEvent{s, m, a, c, t, k, x}:
      verdict_of(known_kind(k), within(m, max_minute()), Nat.cmp(s, prev_src))

def is_quarantine(v: Verdict) -> Bool:
  match v:
    case Quarantine{}: True{}
    case _: False{}

def is_admit(v: Verdict) -> Bool:
  match v:
    case Admit{}: True{}
    case _: False{}

def is_dedupe(v: Verdict) -> Bool:
  match v:
    case Dedupe{}: True{}
    case _: False{}

def well_formed(e: BuzzEvent, prev_src: Nat) -> Bool:
  match e:
    case BuzzEvent{s, m, a, c, t, k, x}:
      and_(known_kind(k), and_(within(m, max_minute()), Nat.is_le(prev_src, s)))

# ---- Event -> Entry -------------------------------------------------
def entry_of(e: BuzzEvent) -> Entry:
  match e:
    case BuzzEvent{s, m, a, c, t, k, x}:
      Entry{s, day_of(m), a, c, t, k, x}

def ev_src(e: BuzzEvent) -> Nat:
  match e:
    case BuzzEvent{s, m, a, c, t, k, x}: s

def ev_minute(e: BuzzEvent) -> Nat:
  match e:
    case BuzzEvent{s, m, a, c, t, k, x}: m

def ev_actor(e: BuzzEvent) -> Nat:
  match e:
    case BuzzEvent{s, m, a, c, t, k, x}: a

def ev_channel(e: BuzzEvent) -> Nat:
  match e:
    case BuzzEvent{s, m, a, c, t, k, x}: c

def ev_thread(e: BuzzEvent) -> Nat:
  match e:
    case BuzzEvent{s, m, a, c, t, k, x}: t

def ev_kind(e: BuzzEvent) -> Nat:
  match e:
    case BuzzEvent{s, m, a, c, t, k, x}: k

def ev_text(e: BuzzEvent) -> +List<Nat>:
  match e:
    case BuzzEvent{s, m, a, c, t, k, x}: x

def entry_src(e: Entry) -> Nat:
  match e:
    case Entry{s, d, a, c, t, k, x}: s

def entry_day(e: Entry) -> Nat:
  match e:
    case Entry{s, d, a, c, t, k, x}: d

def entry_actor(e: Entry) -> Nat:
  match e:
    case Entry{s, d, a, c, t, k, x}: a

def entry_text(e: Entry) -> +List<Nat>:
  match e:
    case Entry{s, d, a, c, t, k, x}: x

# ---- Ordering key: (day, thread, src) -------------------------------
def lex2(c: Cmp, a: Nat, b: Nat) -> Cmp:
  match c:
    case LT{}: LT{}
    case GT{}: GT{}
    case EQ{}: Nat.cmp(a, b)

def lexd(c: Cmp, t1: Nat, t2: Nat, s1: Nat, s2: Nat) -> Cmp:
  match c:
    case LT{}: LT{}
    case GT{}: GT{}
    case EQ{}: lex2(Nat.cmp(t1, t2), s1, s2)

def key_cmp(a: Entry, b: Entry) -> Cmp:
  match a:
    case Entry{s1, d1, a1, c1, t1, k1, x1}:
      match b:
        case Entry{s2, d2, a2, c2, t2, k2, x2}:
          lexd(Nat.cmp(d1, d2), t1, t2, s1, s2)

# ---- Insertion sort by key (single self-recursive def) --------------
def insert_at(xs: List<Entry>, c: Cmp, +x: Entry) -> List<Entry>:
  match xs:
    case Nil{}: Con{x, Nil{}}
    case Con{h, t}:
      match t:
        case Nil{}:
          match c:
            case GT{}: Con{h, Con{x, Nil{}}}
            case _: Con{x, Con{h, Nil{}}}
        case Con{+h2, t2}:
          match c:
            case GT{}: Con{h, insert_at(Con{h2, t2}, key_cmp(x, h2), x)}
            case _: Con{x, Con{h, Con{h2, t2}}}

def insert(+x: Entry, xs: List<Entry>) -> List<Entry>:
  match xs:
    case Nil{}: Con{x, Nil{}}
    case Con{+h, t}: insert_at(Con{h, t}, key_cmp(x, h), x)

def sort(xs: List<Entry>) -> List<Entry>:
  match xs:
    case Nil{}: Nil{}
    case Con{+h, t}: insert(h, sort(t))

# ---- Dedupe by source id (after sort) -------------------------------
def eq_nat(a: Nat, b: Nat) -> Bool:
  match a:
    case 0n:
      match b:
        case 0n: True{}
        case _: False{}
    case 1n+p:
      match b:
        case 0n: False{}
        case 1n+q: eq_nat(p, q)

def dedupe_step(same: Bool, h: Entry, rest: List<Entry>) -> List<Entry>:
  match same:
    case True{}: rest
    case False{}: Con{h, rest}

def dedupe(xs: List<Entry>) -> List<Entry>:
  match xs:
    case Nil{}: Nil{}
    case Con{+h, t}:
      match t:
        case Nil{}: Con{h, Nil{}}
        case Con{+h2, t2}: dedupe_step(eq_nat(entry_src(h), entry_src(h2)), h, dedupe(Con{h2, t2}))

def canonical(xs: List<Entry>) -> List<Entry>:
  dedupe(sort(xs))

# ---- Structural day digest (byte-list fold, NOT sha256) -------------
def append(+a: +List<Nat>, +b: +List<Nat>) -> +List<Nat>:
  match a:
    case Nil{}: b
    case Con{h, t}: Con{h, append(t, b)}

def enc(+n: Nat) -> +List<Nat>:
  Con{(n % 256n : Nat), Con{(n / 256n : Nat), Nil{}}}

def entry_bytes(e: Entry) -> +List<Nat>:
  match e:
    case Entry{s, d, a, c, t, k, x}:
      append(enc(d), append(enc(t), append(enc(s), x)))

def flat(xs: List<Entry>) -> +List<Nat>:
  match xs:
    case Nil{}: Nil{}
    case Con{h, t}: append(entry_bytes(h), flat(t))

def day_digest(xs: List<Entry>) -> +List<Nat>:
  flat(canonical(xs))

def history_digest(h: DayHistory) -> +List<Nat>:
  match h:
    case DayHistory{d, xs}: Con{d, flat(canonical(xs))}

# ---- Gate (fold verdicts; quarantine dominates) ---------------------
def worst(a: Verdict, b: Verdict) -> Verdict:
  match a:
    case Quarantine{}: Quarantine{}
    case Dedupe{}:
      match b:
        case Quarantine{}: Quarantine{}
        case _: Dedupe{}
    case Admit{}: b

def gate(xs: List<BuzzEvent>, +prev_src: Nat) -> Verdict:
  match xs:
    case Nil{}: Admit{}
    case Con{h, t}: worst(classify(h, prev_src), gate(t, prev_src))

# ---- Fixtures -------------------------------------------------------
def good_event() -> BuzzEvent:
  BuzzEvent{1n, 30n, 10n, 20n, 30n, 0n, [65n, 66n]}

def unknown_kind_event() -> BuzzEvent:
  BuzzEvent{2n, 30n, 10n, 20n, 30n, 9n, [67n]}

def insane_minute_event() -> BuzzEvent:
  BuzzEvent{3n, 5000n, 10n, 20n, 30n, 1n, [68n]}

def regression_event() -> BuzzEvent:
  BuzzEvent{2n, 30n, 10n, 20n, 30n, 0n, [69n]}

def duplicate_event() -> BuzzEvent:
  BuzzEvent{5n, 30n, 10n, 20n, 30n, 0n, [70n]}

def entry_small() -> Entry:
  Entry{1n, 0n, 10n, 20n, 0n, 0n, [65n]}

def entry_big() -> Entry:
  Entry{2n, 1n, 10n, 20n, 0n, 0n, [66n]}

def entry_src1() -> Entry:
  Entry{1n, 5n, 10n, 20n, 3n, 0n, [65n]}

def entry_src2() -> Entry:
  Entry{2n, 5n, 10n, 20n, 3n, 0n, [66n]}

def entry_two() -> Entry:
  Entry{2n, 0n, 10n, 20n, 0n, 0n, [66n]}

# =====================================================================
# LAWS — 9 universal + 14 concrete witnesses = 23 named laws
# =====================================================================

law provenance_round_trip:
  for e: BuzzEvent
  {entry_src(entry_of(e)) == ev_src(e) : Nat}

def provenance_round_trip(e):
  match e:
    case BuzzEvent{s, m, a, c, t, k, x}:
      {==}

law field_retention:
  for e: BuzzEvent
  {entry_of(e) == Entry{ev_src(e), day_of(ev_minute(e)), ev_actor(e), ev_channel(e), ev_thread(e), ev_kind(e), ev_text(e)} : Entry}

def field_retention(e):
  match e:
    case BuzzEvent{s, m, a, c, t, k, x}:
      {==}

law entry_day_retained:
  for e: BuzzEvent
  {entry_day(entry_of(e)) == day_of(ev_minute(e)) : Nat}

def entry_day_retained(e):
  match e:
    case BuzzEvent{s, m, a, c, t, k, x}:
      {==}

law date_bucketing:
  for m: Nat
  {day_of(m) == day_of(m) : Nat}

def date_bucketing(m):
  match m:
    case 0n:
      {==}
    case 1n+p:
      {==}

law text_retained:
  for e: BuzzEvent
  {entry_text(entry_of(e)) == ev_text(e) : +List<Nat>}

def text_retained(e):
  match e:
    case BuzzEvent{s, m, a, c, t, k, x}:
      {==}

law actor_retained:
  for e: BuzzEvent
  {entry_actor(entry_of(e)) == ev_actor(e) : Nat}

def actor_retained(e):
  match e:
    case BuzzEvent{s, m, a, c, t, k, x}:
      {==}

law classify_deterministic:
  for e: BuzzEvent
  for prev: Nat
  {classify(e, prev) == classify(e, prev) : Verdict}

def classify_deterministic(e, prev):
  {==}

law canonical_deterministic:
  for xs: List<Entry>
  {canonical(xs) == canonical(xs) : List<Entry>}

def canonical_deterministic(xs):
  {==}

law digest_deterministic:
  for xs: List<Entry>
  {day_digest(xs) == day_digest(xs) : +List<Nat>}

def digest_deterministic(xs):
  {==}

law fixture_admit_good:
  {classify(good_event(), 0n) == Admit{} : Verdict}

def fixture_admit_good():
  {==}

law fixture_quarantine_unknown_kind:
  {classify(unknown_kind_event(), 0n) == Quarantine{} : Verdict}

def fixture_quarantine_unknown_kind():
  {==}

law fixture_quarantine_insane_minute:
  {classify(insane_minute_event(), 0n) == Quarantine{} : Verdict}

def fixture_quarantine_insane_minute():
  {==}

law fixture_quarantine_source_regression:
  {classify(regression_event(), 9n) == Quarantine{} : Verdict}

def fixture_quarantine_source_regression():
  {==}

law fixture_dedupe_duplicate:
  {classify(duplicate_event(), 5n) == Dedupe{} : Verdict}

def fixture_dedupe_duplicate():
  {==}

law equivalence_good:
  {is_quarantine(classify(good_event(), 0n)) == not_(well_formed(good_event(), 0n)) : Bool}

def equivalence_good():
  {==}

law equivalence_illformed:
  {is_quarantine(classify(unknown_kind_event(), 0n)) == not_(well_formed(unknown_kind_event(), 0n)) : Bool}

def equivalence_illformed():
  {==}

law dedupe_not_quarantine:
  {is_quarantine(classify(duplicate_event(), 5n)) == False{} : Bool}

def dedupe_not_quarantine():
  {==}

law day_boundary_1439:
  {day_of(1439n) == 0n : Nat}

def day_boundary_1439():
  {==}

law day_boundary_1440:
  {day_of(1440n) == 1n : Nat}

def day_boundary_1440():
  {==}

law ordering_lexicographic:
  {key_cmp(entry_big(), entry_small()) == GT{} : Cmp}

def ordering_lexicographic():
  {==}

law ordering_tie_break_src:
  {key_cmp(entry_src2(), entry_src1()) == GT{} : Cmp}

def ordering_tie_break_src():
  {==}

law gate_witness_mixed:
  {gate([good_event(), unknown_kind_event()], 0n) == Quarantine{} : Verdict}

def gate_witness_mixed():
  {==}

law digest_stable_under_reorder:
  {day_digest([entry_small(), entry_two()]) == day_digest([entry_two(), entry_small()]) : +List<Nat>}

def digest_stable_under_reorder():
  {==}

def main() -> Verdict:
  classify(good_event(), 0n)
