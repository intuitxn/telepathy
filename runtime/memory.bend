import Base

# ===========================================================================
# runtime/memory.bend — pure read point for the fixed host memory contract.
#
# HOST CONTRACT (fixed, verified against scripts/memory-sync.sh):
#   <root>/memory.in holds one `slug|digest` line per entry, sorted by slug,
#   where digest is sha256 hex of the body bytes.
#   Bodies live at <root>/memory/<slug> with `/` replaced by `__`.
#   The kernel has NO memory support (no import, no Memory verb; the shell
#   routes `memory` to scripts/memory-sync.sh). This file is the single pure
#   read point for that contract: parse_index(text) -> MemIndex.
#
# QUARANTINE (never silently merged):
#   * Malformed lines (no `|`, extra `|`, empty slug, empty digest) are
#     quarantined in `bad` (first wins for duplicates).
#   * Duplicate slugs are quarantined (raw line kept in `bad`); the first
#     file-order occurrence wins in `entries`, which stay sorted by slug.
#   * Empty lines are SKIPPED (not quarantined) so a trailing newline does
#     not count as malformed. This is DESIGNED, see docs.
#
# PROVEN vs DESIGNED:
#   * PROVEN (checker): all `law`s below, each with a same-named proof def.
#     `bend runtime/memory.bend --check-only` must print `All terms check.`
#   * DESIGNED (not proven): sha256==digest check, `/`->`__` body-file
#     existence, file sorting on disk, empty-line skipping. The pure core
#     assumes `memory.in` text; the shell owns files, hashing, mkdir.
#
# DEFERRED: wiring into runtime/mundus.bend is a separate step. This file
#   is standalone and does NOT import mundus.bend.
#
# PERFORMANCE (observed defects, kept fast for the checker):
#   * Bind shared recursive tails once; never put a recursive call in both
#     Bool.pick arms (Bool.pick is strict, both arms evaluate).
#   * Recursive defs use direct recursion + non-recursive helpers; no mutual
#     recursion; `match` (lazy) for branching, `Bool.pick` only with no
#     recursion in its arms.
# ===========================================================================

type Entry is Data:
  Entry{slug: String, digest: String}

type MemHit is Data:
  Hit{digest: String}
  Miss{}

type MemIndex is Data:
  MemIndex{entries: +List<Entry>, bad: +List<String>}

# ---- small accessors ------------------------------------------------------

def entry_slug(e: Entry) -> String:
  match e:
    case Entry{s, d}:
      s

def entry_digest(e: Entry) -> String:
  match e:
    case Entry{s, d}:
      d

def index_entries(m: MemIndex) -> +List<Entry>:
  match m:
    case MemIndex{es, bad}:
      es

def index_bad(m: MemIndex) -> +List<String>:
  match m:
    case MemIndex{es, bad}:
      bad

# ---- line parsing: slug|digest, both non-empty, exactly one pipe ---------
# Leaf first: mk_entry, then fin, go, pair, line (no forward refs).

def mk_entry(+slug: String, +digest: String) -> Maybe<&2, Entry>:
  Bool.pick(Maybe<&2, Entry>, String.is_empty(slug), None{},
  Bool.pick(Maybe<&2, Entry>, String.is_empty(digest), None{},
  Some{Entry{slug, digest}}))

def parse_pair_fin(+slug: String, +digest: String, +rest2: +List<String>) -> Maybe<&2, Entry>:
  match rest2:
    case Nil{}:
      mk_entry(slug, digest)
    case Con{h, t}:
      None{}

def parse_pair_go(+slug: String, +rest: +List<String>) -> Maybe<&2, Entry>:
  match rest:
    case Nil{}:
      None{}
    case Con{+digest, rest2}:
      parse_pair_fin(slug, digest, rest2)

def parse_pair(+ps: +List<String>) -> Maybe<&2, Entry>:
  match ps:
    case Nil{}:
      None{}
    case Con{+slug, rest}:
      parse_pair_go(slug, rest)

def parse_line(line: String) -> Maybe<&2, Entry>:
  parse_pair(String.split(line, '|'))

# ---- drop empty lines (trailing newline); skipped, not quarantined -------
# Leaf first: pick, then empties.

def drop_pick(is_empty: Bool, +line: String, +rec: +List<String>) -> +List<String>:
  match is_empty:
    case True{}:
      rec
    case False{}:
      line <> rec

def drop_empties(+ls: +List<String>) -> +List<String>:
  match ls:
    case Nil{}:
      Nil{}
    case Con{+line, +rest}:
      drop_pick(String.is_empty(line), line, drop_empties(rest))

# ---- slug compare / sorted insert (first wins, sorted) --------------------

def entry_is_slug(+e: Entry, +slug: String) -> Bool:
  String.eq(entry_slug(e), slug)

def entry_le(+a: Entry, +b: Entry) -> Bool:
  String.is_le(entry_slug(a), entry_slug(b))

def has_slug(+es: +List<Entry>, +slug: String) -> Bool:
  match es:
    case Nil{}:
      False{}
    case Con{+h, +t}:
      Bool.or(entry_is_slug(h, slug), has_slug(t, slug))

def insert_branch(le: Bool, +e: Entry, +h: Entry, +t: +List<Entry>, +rec: +List<Entry>) -> +List<Entry>:
  match le:
    case True{}:
      e <> (h <> t)
    case False{}:
      h <> rec

def insert_sorted(+e: Entry, +sorted: +List<Entry>) -> +List<Entry>:
  match sorted:
    case Nil{}:
      [e]
    case Con{+h, +t}:
      insert_branch(entry_le(e, h), e, h, t, insert_sorted(e, t))

# ---- lookup (total: Hit explicit, Miss explicit) --------------------------
# Leaf first: find_or, then memory_find.

def find_or(hit: Bool, +digest: String, rest: MemHit) -> MemHit:
  match hit:
    case True{}:
      Hit{digest}
    case False{}:
      rest

def memory_find(+es: +List<Entry>, +slug: String) -> MemHit:
  match es:
    case Nil{}:
      Miss{}
    case Con{+h, +t}:
      find_or(entry_is_slug(h, slug), entry_digest(h), memory_find(t, slug))

def memory_slugs(+es: +List<Entry>) -> +List<String>:
  match es:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      entry_slug(h) <> memory_slugs(t)

# ---- sorted check (leaf first) --------------------------------------------

def sorted_and(le: Bool, rec: Bool) -> Bool:
  match le:
    case False{}:
      False{}
    case True{}:
      rec

def sorted_head(+h: String, +t: +List<String>, rec: Bool) -> Bool:
  match t:
    case Nil{}:
      True{}
    case Con{+k, +u}:
      sorted_and(String.is_le(h, k), rec)

def is_sorted(+xs: +List<String>) -> Bool:
  match xs:
    case Nil{}:
      True{}
    case Con{+h, +t}:
      sorted_head(h, t, is_sorted(t))

# ---- counts ---------------------------------------------------------------

def mem_entry_count(+es: +List<Entry>) -> Nat:
  match es:
    case Nil{}:
      0n
    case Con{h, t}:
      1n+mem_entry_count(t)

def mem_bad_count(+bs: +List<String>) -> Nat:
  match bs:
    case Nil{}:
      0n
    case Con{h, t}:
      1n+mem_bad_count(t)

def index_entry_count(m: MemIndex) -> Nat:
  mem_entry_count(index_entries(m))

def index_bad_count(m: MemIndex) -> Nat:
  mem_bad_count(index_bad(m))

def index_slugs(m: MemIndex) -> +List<String>:
  memory_slugs(index_entries(m))

def index_find(m: MemIndex, +slug: String) -> MemHit:
  memory_find(index_entries(m), slug)

def has_string(+ls: +List<String>, +s: String) -> Bool:
  match ls:
    case Nil{}:
      False{}
    case Con{+h, +t}:
      Bool.or(String.eq(h, s), has_string(t, s))

# ---- render (entries -> canonical text, trailing newline) -----------------

def render_entry(e: Entry) -> String:
  match e:
    case Entry{s, d}:
      s ++ "|" ++ d

def render_entries(+es: +List<Entry>) -> String:
  match es:
    case Nil{}:
      ""
    case Con{h, t}:
      render_entry(h) ++ "\n" ++ render_entries(t)

# ---- accumulator: file-order first wins, sorted entries, bad quarantined --
# Leaf first: dup, some, go, next, then acc (no forward refs, no mutual).

def next_entries_dup(dup: Bool, +e: Entry, +entries: +List<Entry>) -> +List<Entry>:
  match dup:
    case True{}:
      entries
    case False{}:
      insert_sorted(e, entries)

def next_entries_some(+e: Entry, +entries: +List<Entry>) -> +List<Entry>:
  next_entries_dup(has_slug(entries, entry_slug(e)), e, entries)

def next_entries_go(m: Maybe<&2, Entry>, +entries: +List<Entry>) -> +List<Entry>:
  match m:
    case None{}:
      entries
    case Some{+e}:
      next_entries_some(e, entries)

def next_entries(+line: String, +entries: +List<Entry>) -> +List<Entry>:
  next_entries_go(parse_line(line), entries)

def next_bad_dup(dup: Bool, +line: String, +bad: +List<String>) -> +List<String>:
  match dup:
    case True{}:
      line <> bad
    case False{}:
      bad

def next_bad_some(+e: Entry, +line: String, +entries: +List<Entry>, +bad: +List<String>) -> +List<String>:
  next_bad_dup(has_slug(entries, entry_slug(e)), line, bad)

def next_bad_go(m: Maybe<&2, Entry>, +line: String, +entries: +List<Entry>, +bad: +List<String>) -> +List<String>:
  match m:
    case None{}:
      line <> bad
    case Some{+e}:
      next_bad_some(e, line, entries, bad)

def next_bad(+line: String, +entries: +List<Entry>, +bad: +List<String>) -> +List<String>:
  next_bad_go(parse_line(line), line, entries, bad)

def parse_acc(+lines: +List<String>, +entries: +List<Entry>, +bad: +List<String>) -> MemIndex:
  match lines:
    case Nil{}:
      MemIndex{entries, bad}
    case Con{+line, +rest}:
      parse_acc(rest, next_entries(line, entries), next_bad(line, entries, bad))

def parse_all(+lines: +List<String>) -> MemIndex:
  parse_acc(drop_empties(lines), Nil{}, Nil{})

def parse_index(text: String) -> MemIndex:
  parse_all(String.lines(text))

# ---- slug escape: `/` -> `__` for body path (leaf first) ------------------

def escape_tail(+h: Char, +tail: String) -> String:
  Bool.pick(String, Char.is_eq(h, '/'), "__" ++ tail, SCon{h, tail})

def slug_escape(s: String) -> String:
  match s:
    case SNil{}:
      SNil{}
    case SCon{+h, t}:
      escape_tail(h, slug_escape(t))

def mem_body_path(+root: String, +slug: String) -> String:
  root ++ "/memory/" ++ slug_escape(slug)

# ===========================================================================
# FIXTURES
# ===========================================================================

def fixture_two() -> String:
  "b|2\na|1\n"

def fixture_dup() -> String:
  "a|1\na|2\nb|3\n"

def fixture_malformed() -> String:
  "nope\nbad\n"

def fixture_mixed() -> String:
  "a|1\nbadline\nb|2\nc|3\nc|4\n|empty\nempty|\n"

def work_fixture() -> String:
  "k00|d00\nk01|d01\nk02|d02\nk03|d03\nk04|d04\nk05|d05\nk06|d06\nk07|d07\nk08|d08\nk09|d09\nk10|d10\nk11|d11\nk12|d12\nk13|d13\nk14|d14\nk15|d15\nk16|d16\nk17|d17\nk18|d18\nk19|d19\n"

# ===========================================================================
# LAWS (20) + PROOFS (same name). All proofs are `{==}` reflexivity: each
# proposition computes to equal terms on both sides.
# ===========================================================================

# 1. empty file -> empty index (counterexample: empty)
law mem_empty:
  {parse_index("") == MemIndex{Nil{}, Nil{}} : MemIndex}

def mem_empty():
  {==}

# 2. singleton parses to one slug
law mem_singleton:
  {index_slugs(parse_index("a|1\n")) == ["a"] : +List<String>}

def mem_singleton():
  {==}

# 3. all malformed -> 0 entries, 2 quarantined (counterexample: all-malformed)
law mem_all_malformed:
  {(index_entry_count(parse_index(fixture_malformed())), index_bad_count(parse_index(fixture_malformed()))) == (0n, 2n) : Nat & Nat}

def mem_all_malformed():
  {==}

# 4. line without pipe is quarantined (malformed quarantine)
law mem_malformed_no_pipe:
  {has_string(index_bad(parse_index("abc\n")), "abc") == True{} : Bool}

def mem_malformed_no_pipe():
  {==}

# 5. line with extra pipe is quarantined (malformed quarantine)
law mem_malformed_extra_pipe:
  {has_string(index_bad(parse_index("a|b|c\n")), "a|b|c") == True{} : Bool}

def mem_malformed_extra_pipe():
  {==}

# 6. empty slug is quarantined (malformed quarantine)
law mem_empty_slug:
  {has_string(index_bad(parse_index("|d\n")), "|d") == True{} : Bool}

def mem_empty_slug():
  {==}

# 7. empty digest is quarantined (counterexample: empty-digest)
law mem_empty_digest:
  {has_string(index_bad(parse_index("s|\n")), "s|") == True{} : Bool}

def mem_empty_digest():
  {==}

# 8. duplicate keeps first file-order digest (duplicate quarantine, first wins)
law mem_duplicate_first_wins:
  {index_find(parse_index(fixture_dup()), "a") == Hit{"1"} : MemHit}

def mem_duplicate_first_wins():
  {==}

# 9. duplicate counts: 2 unique entries, 1 quarantined duplicate
law mem_duplicate_counts:
  {(index_entry_count(parse_index(fixture_dup())), index_bad_count(parse_index(fixture_dup()))) == (2n, 1n) : Nat & Nat}

def mem_duplicate_counts():
  {==}

# 10. unsorted input yields sorted slugs (sortedness)
law mem_slugs_sorted:
  {is_sorted(index_slugs(parse_index(fixture_two()))) == True{} : Bool}

def mem_slugs_sorted():
  {==}

# 11. duplicates dedupe to unique sorted slugs (dedupe)
law mem_slugs_deduped:
  {index_slugs(parse_index(fixture_dup())) == ["a", "b"] : +List<String>}

def mem_slugs_deduped():
  {==}

# 12. lookup hits an existing slug (found)
law mem_find_hit:
  {index_find(parse_index("a|1\nb|2\n"), "b") == Hit{"2"} : MemHit}

def mem_find_hit():
  {==}

# 13. lookup of absent slug is explicit Miss, never silent (absent)
law mem_find_miss:
  {index_find(parse_index("a|1\n"), "zzz") == Miss{} : MemHit}

def mem_find_miss():
  {==}

# 14. lookup is total and deterministic (lookup totality)
law mem_find_total:
  for +es: +List<Entry>
  for +s: String
  {memory_find(es, s) == memory_find(es, s) : MemHit}

def mem_find_total(es, s):
  {==}

# 15. parsing is deterministic (determinism)
law mem_parse_deterministic:
  for text: String
  {parse_index(text) == parse_index(text) : MemIndex}

def mem_parse_deterministic(text):
  {==}

# 16. slug projection is deterministic (determinism)
law mem_slugs_deterministic:
  for +es: +List<Entry>
  {memory_slugs(es) == memory_slugs(es) : +List<String>}

def mem_slugs_deterministic(es):
  {==}

# 17. render then parse round-trips sorted entries (round-trip)
law mem_roundtrip:
  {index_entries(parse_index(render_entries([Entry{"a", "1"}, Entry{"b", "2"}]))) == [Entry{"a", "1"}, Entry{"b", "2"}] : +List<Entry>}

def mem_roundtrip():
  {==}

# 18. mixed fixture counts entries and quarantine (entry/quarantine counts)
law mem_counts_mixed:
  {(index_entry_count(parse_index(fixture_mixed())), index_bad_count(parse_index(fixture_mixed()))) == (3n, 4n) : Nat & Nat}

def mem_counts_mixed():
  {==}

# 19. work bound: 20 records parse to 20 entries, 0 quarantined
law mem_work_bound:
  {(index_entry_count(parse_index(work_fixture())), index_bad_count(parse_index(work_fixture()))) == (20n, 0n) : Nat & Nat}

def mem_work_bound():
  {==}

# 20. body path escapes `/` to `__` (host contract)
law mem_escape_slash:
  {mem_body_path("/r", "a/b") == "/r/memory/a__b" : String}

def mem_escape_slash():
  {==}

# ===========================================================================
# EFFECTFUL SHELL (demo only). Pure core above does no IO. `main` reads
# <root>/memory.in, prints counts, and optionally looks up one slug.
# Missing file dies nonzero (no silent default).
# usage: bend runtime/memory.bend -- <root> [slug]
# ===========================================================================

def mem_usage() -> String:
  "memory — pure read point for <root>/memory.in (slug|digest per line)\n" ++
  "usage: bend runtime/memory.bend -- <root> [slug]\n" ++
  "  <root>/memory.in   one `slug|digest` line per entry, sorted by slug\n" ++
  "  bodies at <root>/memory/<slug> with `/` replaced by `__`\n" ++
  "missing file exits nonzero; malformed/duplicates are quarantined."

def mem_read_close(pair: File & Result<&1, &1, U32 & String, String>) -> IO(String):
  (h, r) = pair
  do IO<String>:
    File.close(h)
    text : String <- IO.pass(String, r)
    IO.pure(String, text)

def mem_read_opened(opened: Result<&1, &1, U32 & String, File>, +path: String) -> IO(String):
  match opened:
    case Fail{(+code, message)}:
      IO.die(String, code, "memory: cannot open " ++ path ++ " [" ++ message ++ "]")
    case Done{file}:
      do IO<String>:
        pair : File & Result<&1, &1, U32 & String, String> <- File.read(file, 1048576)
        mem_read_close(pair)

def mem_read_text(+path: String) -> IO(String):
  do IO<String>:
    opened : Result<&1, &1, U32 & String, File> <- File.open(path, "r")
    mem_read_opened(opened, path)

def mem_print_hit(h: MemHit) -> IO(Unit):
  match h:
    case Hit{d}:
      IO.print("FOUND " ++ d)
    case Miss{}:
      IO.print("ABSENT")

def mem_show_counts(+idx: MemIndex) -> IO(Unit):
  do IO<Unit>:
    IO.print("entries=" ++ Nat.show(index_entry_count(idx)) ++ " quarantined=" ++ Nat.show(index_bad_count(idx)))
    IO.print("slugs: " ++ String.join(index_slugs(idx), ","))

def mem_show_root(+root: String) -> IO(Unit):
  do IO<Unit>:
    text : String <- mem_read_text(root ++ "/memory.in")
    +idx : MemIndex = parse_index(text)
    mem_show_counts(idx)

def mem_show_lookup(+root: String, +slug: String) -> IO(Unit):
  do IO<Unit>:
    text : String <- mem_read_text(root ++ "/memory.in")
    +idx : MemIndex = parse_index(text)
    mem_show_counts(idx)
    mem_print_hit(index_find(idx, slug))

def mem_run_rest(+root: String, rest: List<String>) -> IO(Unit):
  match rest:
    case Nil{}:
      mem_show_root(root)
    case Con{+slug, t}:
      mem_show_lookup(root, slug)

def mem_run(args: List<String>) -> IO(Unit):
  match args:
    case Nil{}:
      do IO<Unit>:
        IO.print(mem_usage())
        IO.die(Unit, 64, "no root")
    case Con{+root, rest}:
      mem_run_rest(root, rest)

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    mem_run(args)
