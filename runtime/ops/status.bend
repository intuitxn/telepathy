import Base

# ---- status.bend: a pure, kernel-backed canonical status projection ---------
# Design basis: docs/drafts/meta/bend-state-view.md (`status IN`) and
# docs/drafts/meta/one-file-bend-command.md (minimal canonical set). The draft
# `status IN` reads one immutable Lorenz snapshot; this kernel carries the pure
# projection half only: normalized session records -> canonical status view.
#
# Scope and discipline (see docs/drafts/meta/status-kernel-notes.md):
#   * PURE. The input is the in-file fixture only. No file reads, no network,
#     no process spawn, no writes. The only effect is IO.print in main.
#   * This is NOT a live store reader and NOT wired into runtime/worker.
#   * The five-entity set (agent, job, memory, evidence, session) and its state
#     vocabulary remain an unreviewed proposal; nothing here renames a store.
#   * Session identity is external to Bend, so its row is `external-unbound`.
#   * A passing `--check-only` proves the terms and named laws check; it is not
#     truth, human acceptance, or a verified worker answer.

# ---- typed input -> output contract ----------------------------------------

# The five canonical entities from the draft's minimal set.
type Entity is Data:
  Agent{}
  Job{}
  Memory{}
  Evidence{}
  Session{}

# Normalized session record: one already-normalized entity observation. The
# `event` field is the monotonic local ordinal (Bend `id = 1 + size`); reference
# is the conversation/work id it points at (or 0). Strings are supplied labels,
# never authenticated identities.
type Record is Data:
  Record{entity: Entity, key: String, state: String, event: Nat, reference: Nat, source: String}

# Canonical status row: the fixed projection shape of the draft's output table.
type Row is Data:
  Row{entity: String, key: String, state: String, event: Nat, reference: Nat, source: String, durability: String}

# ---- projection -------------------------------------------------------------

# to_row: total per-record projection. Entity is closed, so every record maps to
# exactly one row; durability is fixed per entity.
def to_row(r: Record) -> Row:
  match r:
    case Record{e, k, s, n, ref, src}:
      match e:
        case Agent{}:
          Row{"agent", k, s, n, ref, src, "snapshot-single-writer"}
        case Job{}:
          Row{"job", k, s, n, ref, src, "snapshot-single-writer"}
        case Memory{}:
          Row{"memory", k, s, n, ref, src, "snapshot-single-writer"}
        case Evidence{}:
          Row{"evidence", k, s, n, ref, src, "snapshot-single-writer"}
        case Session{}:
          Row{"session", k, s, n, ref, src, "external-unbound"}

def map_rows(+rs: +List<Record>) -> +List<Row>:
  match rs:
    case Nil{}:
      Nil{}
    case Con{r, t}:
      to_row(r) <> map_rows(t)

def row_before(a: Row, b: Row) -> Bool:
  match a:
    case Row{ea, ka, sa, na, ra, xa, da}:
      match b:
        case Row{eb, kb, sb, nb, rb, xb, db}:
          Nat.is_lt(na, nb)

def insert_row(+r: Row, +rows: +List<Row>) -> +List<Row>:
  match rows:
    case Nil{}:
      [r]
    case Con{h, t}:
      Bool.pick(+List<Row>, row_before(r, h), r <> (h <> t), h <> insert_row(r, t))

def sort_rows(+rows: +List<Row>) -> +List<Row>:
  match rows:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      insert_row(h, sort_rows(t))

# project: canonical order is ascending event id, so the view is order-independent
# of the input list (the fixture has distinct event ids). Sorting makes the row
# order part of the projection, not of the input.
def project(+rs: +List<Record>) -> +List<Row>:
  sort_rows(map_rows(rs))

def record_count(+rs: +List<Record>) -> Nat:
  match rs:
    case Nil{}:
      0n
    case Con{r, t}:
      1n+record_count(t)

def row_count(+rows: +List<Row>) -> Nat:
  match rows:
    case Nil{}:
      0n
    case Con{h, t}:
      1n+row_count(t)

# ---- well-formedness --------------------------------------------------------

def text_nonblank(text: String) -> Bool:
  match text:
    case SNil{}:
      False{}
    case SCon{+h, t}:
      (Bool.not(Char.is_eq(h, ' ')) && Bool.not(Char.is_eq(h, '\t'))) || text_nonblank(t)

# Session is external-unbound (event 0); every other entity needs a positive id.
def event_rule(e: Entity, n: Nat) -> Bool:
  match e:
    case Session{}:
      Nat.is_eq(n, 0n)
    case Agent{}:
      Nat.is_gt(n, 0n)
    case Job{}:
      Nat.is_gt(n, 0n)
    case Memory{}:
      Nat.is_gt(n, 0n)
    case Evidence{}:
      Nat.is_gt(n, 0n)

def record_well_formed(r: Record) -> Bool:
  match r:
    case Record{e, k, s, n, ref, src}:
      text_nonblank(k) && text_nonblank(s) && text_nonblank(src) && event_rule(e, n)

def all_records_well_formed(+rs: +List<Record>) -> Bool:
  match rs:
    case Nil{}:
      True{}
    case Con{r, t}:
      record_well_formed(r) && all_records_well_formed(t)

def duration_ok(is_external: Bool, n: Nat) -> Bool:
  match is_external:
    case True{}:
      Nat.is_eq(n, 0n)
    case False{}:
      Nat.is_gt(n, 0n)

def row_well_formed(r: Row) -> Bool:
  match r:
    case Row{e, k, s, n, ref, src, d}:
      text_nonblank(e) && text_nonblank(k) && text_nonblank(s) && text_nonblank(src) && duration_ok(String.eq(d, "external-unbound"), n)

def view_well_formed(+rows: +List<Row>) -> Bool:
  match rows:
    case Nil{}:
      True{}
    case Con{h, t}:
      row_well_formed(h) && view_well_formed(t)

# ---- fixed-width rendering (byte-stable) -----------------------------------

def pad_amount(s: String, w: Nat) -> Nat:
  match s:
    case SNil{}:
      w
    case SCon{h, t}:
      match w:
        case 0n:
          0n
        case 1n+p:
          pad_amount(t, p)

def spaces(n: Nat) -> String:
  match n:
    case 0n:
      ""
    case 1n+p:
      " " ++ spaces(p)

def pad(+s: String, w: Nat) -> String:
  s ++ spaces(pad_amount(s, w))

def render_row(r: Row) -> String:
  match r:
    case Row{e, k, s, n, ref, src, d}:
      pad(e, 9n) ++ pad(k, 9n) ++ pad(s, 17n) ++ pad(Nat.show(n), 10n) ++ pad(Nat.show(ref), 10n) ++ pad(src, 21n) ++ d ++ "\n"

def render_rows(+rows: +List<Row>) -> String:
  match rows:
    case Nil{}:
      ""
    case Con{h, t}:
      render_row(h) ++ render_rows(t)

def header_line() -> String:
  pad("entity", 9n) ++ pad("key", 9n) ++ pad("state", 17n) ++ pad("event_id", 10n) ++ pad("reference", 10n) ++ pad("source", 21n) ++ "durability"

# ---- in-file fixtures -------------------------------------------------------

def valid_fixture() -> +List<Record>:
  [Record{Agent{}, "worker-a", "worker", 6n, 0n, "local-worker"},
   Record{Evidence{}, "1", "conversation", 1n, 0n, "operator"},
   Record{Job{}, "5", "claimed", 7n, 5n, "conversation:example"},
   Record{Memory{}, "8", "active", 8n, 1n, "operator"},
   Record{Session{}, "-", "external-unbound", 0n, 0n, "-"}]

# The negative case a named law must reject: blank key, blank source, and a
# non-session entity with a zero event id.
def malformed_record() -> Record:
  Record{Job{}, "", "queued", 0n, 0n, ""}

def full_fixture() -> +List<Record>:
  malformed_record() <> valid_fixture()

# ---- named laws (checked by `bend ... --check-only`) ------------------------

# Totality / one row per record, for ANY record list.
law status_one_row_per_record:
  for +rs: +List<Record>
  {row_count(map_rows(rs)) == record_count(rs) : Nat}

def status_one_row_per_record(rs):
  match rs:
    case Nil{}:
      {==}
    case Con{r, t}:
      Equal.cong(Nat, Nat, x => 1n+x, row_count(map_rows(t)), record_count(t), status_one_row_per_record(t))

# The projection stays total even when the list contains a malformed record.
law status_projection_total:
  {row_count(project(full_fixture())) == record_count(full_fixture()) : Nat}

def status_projection_total():
  {==}

# Every projected row of the well-formed fixture is well-formed.
law status_rows_well_formed:
  {view_well_formed(project(valid_fixture())) == True{} : Bool}

def status_rows_well_formed():
  {==}

def reverse_go(+rs: +List<Record>, +acc: +List<Record>) -> +List<Record>:
  match rs:
    case Nil{}:
      acc
    case Con{r, t}:
      reverse_go(t, r <> acc)

def reverse_records(+rs: +List<Record>) -> +List<Record>:
  reverse_go(rs, Nil{})

# Order independence: canonical order makes the view invariant under reversing
# the input (distinct event ids in the fixture give a total order).
law status_order_independent:
  {project(valid_fixture()) == project(reverse_records(valid_fixture())) : +List<Row>}

def status_order_independent():
  {==}

# Negative case: the malformed record is rejected.
law status_malformed_rejected:
  {record_well_formed(malformed_record()) == False{} : Bool}

def status_malformed_rejected():
  {==}

# The well-formed fixture passes the same predicate.
law status_valid_records_well_formed:
  {all_records_well_formed(valid_fixture()) == True{} : Bool}

def status_valid_records_well_formed():
  {==}

# ---- one fixture run --------------------------------------------------------

def main() -> IO(Unit):
  do IO<Unit>:
    IO.print(header_line())
    IO.print(render_rows(project(full_fixture())))
    IO.print("malformed_record_well_formed: " ++ Bool.show(record_well_formed(malformed_record())))
    IO.print("malformed_record_rejected: " ++ Bool.show(Bool.not(record_well_formed(malformed_record()))))
    IO.print("valid_fixture_well_formed: " ++ Bool.show(all_records_well_formed(valid_fixture())))
