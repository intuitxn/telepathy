import Base

# Single-file Lorenz explicit memory core; see README.md for verification scope.

def store_text_equal_go(a: String, b: String, same: Bool) -> Bool:
  match a b:
    case SNil{} SNil{}:
      same
    case SCon{h, t} SCon{k, u}:
      store_text_equal_go(t, u, same && Char.is_eq(h, k))
    case _ _:
      False{}

def store_text_equal(a: String, b: String) -> Bool:
  store_text_equal_go(a, b, True{})

# Native Base File IO only. One writer; storage is untrusted and mutable.
# No native subprocess, Git, SHA, directory creation, locks or atomic rename
# are available in this Bend Base. Caller creates a private directory.
# Existing records are compared as decoded text and never overwritten by us.
# Missing/read-error distinction prevents overwriting unreadable evidence.

def store_read_failed(code: U32, message: String, missing: Bool) -> IO(Maybe<&2, String>):
  match missing:
    case True{}:
      IO.pure(Maybe<&2, String>, None{})
    case False{}:
      IO.die(Maybe<&2, String>, code, message)


def store_read_limit(+text: String, ended: Bool) -> IO(Maybe<&2, String>):
  match ended:
    case True{}:
      IO.pure(Maybe<&2, String>, Some{text})
    case False{}:
      IO.die(Maybe<&2, String>, 1, "evidence_too_large_or_partial_read")

def store_read_tail(text: String, pair: File & Result<&1, &1, U32 & String, String>) -> IO(Maybe<&2, String>):
  (handle, result) = pair
  do IO<Maybe<&2, String>>:
    File.close(handle)
    tail : String <- IO.pass(String, result)
    store_read_limit(text, String.is_empty(tail))

def store_read_close(pair: File & Result<&1, &1, U32 & String, String>) -> IO(Maybe<&2, String>):
  (handle, result) = pair
  do IO<Maybe<&2, String>>:
    next : File & Result<&1, &1, U32 & String, String> <- File.read(handle, 1)
    text : String <- IO.pass(String, result)
    store_read_tail(text, next)

def store_read_open(result: Result<&1, &1, U32 & String, File>) -> IO(Maybe<&2, String>):
  match result:
    case Fail{(+code, message)}:
      store_read_failed(code, message, U32.is_eq(code, 2))
    case Done{file}:
      do IO<Maybe<&2, String>>:
        pair : File & Result<&1, &1, U32 & String, String> <- File.read(file, 1048576)
        store_read_close(pair)


def store_read(path: String) -> IO(Maybe<&2, String>):
  do IO<Maybe<&2, String>>:
    opened : Result<&1, &1, U32 & String, File> <- File.open(path, "r")
    store_read_open(opened)


def store_write_close(pair: File & Result<&1, &1, U32 & String, Unit>) -> IO(Unit):
  (handle, result) = pair
  do IO<Unit>:
    File.close(handle)
    IO.pass(Unit, result)

def store_write(path: String, text: String) -> IO(Unit):
  do IO<Unit>:
    file : File <- IO.try(File, File.open(path, "w"))
    pair : File & Result<&1, &1, U32 & String, Unit> <- File.write(file, text)
    store_write_close(pair)


def store_source_present(source: Maybe<&2, String>) -> IO(String):
  match source:
    case None{}:
      IO.die(String, 1, "source_missing")
    case Some{text}:
      IO.pure(String, text)

# --- Lorenz local conversation continuity ---
# Problem: retain explicitly selected conversation data, promote explicit memory
# and work, and invalidate knowledge whose stated premise was corrected.
# IDs are local ordinal labels; actors/origins are supplied, not authenticated.
# One dependency per memory in this first increment; no automatic inference,
# execution, capture, synchronization, or model training. State is an immutable
# snapshot chosen by the caller, not a shared database or a consensus protocol.
type LorenzEvent is Data:
  LorenzEvent{kind: Nat, id: Nat, conversation: Nat, dependency: Nat, supersedes: Nat, actor: String, origin: String, text: String, detail: String, owner: String}

def lorenz_size(xs: +List<LorenzEvent>) -> Nat:
  match xs:
    case Nil{}:
      0n
    case Con{h, t}:
      1n+lorenz_size(t)

def lorenz_append(xs: +List<LorenzEvent>, e: LorenzEvent) -> +List<LorenzEvent>:
  match xs:
    case Nil{}:
      [e]
    case Con{h, t}:
      h <> lorenz_append(t, e)

law lorenz_append_preserves_history_length:
  for +xs: +List<LorenzEvent>
  for +e: LorenzEvent
  {lorenz_size(lorenz_append(xs, e)) == 1n+lorenz_size(xs) : Nat}

def lorenz_append_preserves_history_length(xs, e):
  match xs:
    case Nil{}:
      {==}
    case Con{h, t}:
      Equal.cong(Nat, Nat, x => 1n+x, lorenz_size(lorenz_append(t, e)), 1n+lorenz_size(t), lorenz_append_preserves_history_length(t, e))

def lorenz_blank() -> LorenzEvent:
  LorenzEvent{0n, 0n, 0n, 0n, 0n, "-", "-", "-", "-", "-"}

def lorenz_find(xs: +List<LorenzEvent>, +wanted: Nat) -> LorenzEvent:
  match xs:
    case Nil{}:
      lorenz_blank()
    case Con{+h, t}:
      match h:
        case LorenzEvent{k, id, c, d, s, a, o, x, r, w}:
          Bool.pick(LorenzEvent, Nat.is_eq(id, wanted), h, lorenz_find(t, wanted))

def lorenz_replaced(xs: +List<LorenzEvent>, +id: Nat) -> Bool:
  match xs:
    case Nil{}:
      False{}
    case Con{LorenzEvent{k, n, c, d, s, a, o, x, r, w}, t}:
      (Nat.is_eq(k, 3n) && Nat.is_eq(s, id)) || lorenz_replaced(t, id)

def lorenz_memory_kind(+kind: Nat) -> Bool:
  Nat.is_eq(kind, 2n) || Nat.is_eq(kind, 3n)

# Fuel bounds recursion even for untrusted IDs. Validated snapshots permit only
# earlier dependencies, so history size is sufficient to traverse every chain.
def lorenz_active_go(fuel: Nat, +xs: +List<LorenzEvent>, +id: Nat, +event: LorenzEvent) -> Bool:
  match fuel id event:
    case _ 0n _:
      True{}
    case 0n _ _:
      False{}
    case 1n+f _ LorenzEvent{k, n, c, +d, s, a, o, x, r, w}:
      lorenz_memory_kind(k) && Bool.not(lorenz_replaced(xs, id)) && lorenz_active_go(f, xs, d, lorenz_find(xs, d))

def lorenz_active(+xs: +List<LorenzEvent>, +id: Nat, fuel: Nat) -> Bool:
  lorenz_active_go(fuel, xs, id, lorenz_find(xs, id))

def lorenz_depends_go(fuel: Nat, +xs: +List<LorenzEvent>, +id: Nat, +target: Nat, +event: LorenzEvent) -> Bool:
  match fuel id event:
    case _ 0n _:
      False{}
    case 0n _ _:
      True{}
    case 1n+f _ LorenzEvent{k, n, c, +d, s, a, o, x, r, w}:
      Nat.is_eq(id, target) || lorenz_depends_go(f, xs, d, target, lorenz_find(xs, d))

def lorenz_depends(+xs: +List<LorenzEvent>, +id: Nat, +target: Nat, fuel: Nat) -> Bool:
  lorenz_depends_go(fuel, xs, id, target, lorenz_find(xs, id))

def lorenz_has_work(xs: +List<LorenzEvent>, +conversation: Nat) -> Bool:
  match xs:
    case Nil{}:
      False{}
    case Con{LorenzEvent{k, n, c, d, s, a, o, x, r, w}, t}:
      (Nat.is_eq(k, 4n) && Nat.is_eq(c, conversation)) || lorenz_has_work(t, conversation)

def lorenz_line_chars(text: String) -> Bool:
  match text:
    case SNil{}:
      True{}
    case SCon{+h, t}:
      Bool.not(Char.is_eq(h, '\n')) && Bool.not(Char.is_eq(h, '\r')) && lorenz_line_chars(t)

def lorenz_nonblank(text: String) -> Bool:
  match text:
    case SNil{}:
      False{}
    case SCon{+h, t}:
      (Bool.not(Char.is_eq(h, ' ')) && Bool.not(Char.is_eq(h, '\t'))) || lorenz_nonblank(t)

def lorenz_line(+text: String) -> Bool:
  lorenz_nonblank(text) && Nat.is_le(String.length(text), 4096n) && lorenz_line_chars(text)

def lorenz_valid_fields(+xs: +List<LorenzEvent>, event: LorenzEvent, conversation: LorenzEvent, original: LorenzEvent) -> Bool:
  match event conversation original:
    case LorenzEvent{+k, +n, +c, +d, +s, a, +o, +x, +r, +w} LorenzEvent{+ck, ci, cc, cd, cs, ca, +co, ct, cr, cw} LorenzEvent{sk, si, sc, sd, ss, sa, so, st, sr, sw}:
      (Nat.is_eq(k, 1n) && Nat.is_eq(c, 0n) && Nat.is_eq(d, 0n) && Nat.is_eq(s, 0n) && String.eq(r, "-") && String.eq(w, "-")) || (Nat.is_eq(k, 2n) && Nat.is_eq(ck, 1n) && store_text_equal(o, co) && Nat.is_eq(s, 0n) && lorenz_active(xs, d, 1n+lorenz_size(xs)) && String.eq(r, "-") && String.eq(w, "-")) || (Nat.is_eq(k, 3n) && lorenz_memory_kind(sk) && Nat.is_eq(c, sc) && store_text_equal(o, so) && Bool.not(lorenz_replaced(xs, s)) && lorenz_active(xs, d, 1n+lorenz_size(xs)) && Bool.not(lorenz_depends(xs, d, s, 1n+lorenz_size(xs))) && String.eq(w, "-")) || (Nat.is_eq(k, 4n) && Nat.is_eq(ck, 1n) && store_text_equal(o, co) && store_text_equal(x, ct) && Nat.is_eq(d, 0n) && Nat.is_eq(s, 0n) && Bool.not(lorenz_has_work(xs, c)))


def lorenz_valid_kind(+xs: +List<LorenzEvent>, +event: LorenzEvent) -> Bool:
  match event:
    case LorenzEvent{k, n, c, d, s, a, o, x, r, w}:
      lorenz_valid_fields(xs, event, lorenz_find(xs, c), lorenz_find(xs, s))

def lorenz_valid(+xs: +List<LorenzEvent>, +event: LorenzEvent) -> Bool:
  match event:
    case LorenzEvent{k, n, c, d, s, a, o, x, r, w}:
      Nat.is_lt(lorenz_size(xs), 256n) && Nat.is_eq(n, 1n+lorenz_size(xs)) && lorenz_line(a) && lorenz_line(o) && lorenz_line(x) && lorenz_line(r) && lorenz_line(w) && lorenz_valid_kind(xs, event)

# Retention is an explicit transition guard, separate from conversation data.
def lorenz_capture_allowed(retain: Bool, valid: Bool) -> Bool:
  retain && valid

law lorenz_no_implicit_retention:
  for valid: Bool
  {lorenz_capture_allowed(False{}, valid) == False{} : Bool}

def lorenz_no_implicit_retention(valid):
  {==}

def lorenz_emit(e: LorenzEvent) -> String:
  match e:
    case LorenzEvent{k, n, c, d, s, a, o, x, r, w}:
      Nat.show(k) ++ "\n" ++ Nat.show(n) ++ "\n" ++ Nat.show(c) ++ "\n" ++ Nat.show(d) ++ "\n" ++ Nat.show(s) ++ "\n" ++ a ++ "\n" ++ o ++ "\n" ++ x ++ "\n" ++ r ++ "\n" ++ w ++ "\n"

def lorenz_emit_all(xs: +List<LorenzEvent>) -> String:
  match xs:
    case Nil{}:
      "END"
    case Con{h, t}:
      lorenz_emit(h) ++ lorenz_emit_all(t)

def lorenz_snapshot(xs: +List<LorenzEvent>) -> String:
  "lorenz-local/v1\n" ++ lorenz_emit_all(xs)

# Refuse unbounded unary Nat inputs before parsing; canonical decimal only.
def lorenz_nat_parsed(+text: String, parsed: Maybe<&2, Nat>) -> Maybe<&2, Nat>:
  match parsed:
    case None{}:
      None{}
    case Some{+n}:
      Bool.pick(Maybe<&2, Nat>, String.eq(Nat.show(n), text) && Nat.is_le(n, 256n), Some{n}, None{})

def lorenz_nat_short(short: Bool, +text: String) -> Maybe<&2, Nat>:
  match short:
    case False{}:
      None{}
    case True{}:
      lorenz_nat_parsed(text, Nat.read(text))

def lorenz_nat(+text: String) -> Maybe<&2, Nat>:
  lorenz_nat_short(Nat.is_le(String.length(text), 3n), text)

def lorenz_parse_step(valid: Bool, history: +List<LorenzEvent>, event: LorenzEvent, next: +List<LorenzEvent> -> Maybe<&2, +List<LorenzEvent>>) -> Maybe<&2, +List<LorenzEvent>>:
  match valid:
    case False{}:
      None{}
    case True{}:
      next(lorenz_append(history, event))

def lorenz_parse_numbers(+history: +List<LorenzEvent>, next: +List<LorenzEvent> -> Maybe<&2, +List<LorenzEvent>>, k: Maybe<&2, Nat>, n: Maybe<&2, Nat>, c: Maybe<&2, Nat>, d: Maybe<&2, Nat>, s: Maybe<&2, Nat>, a: String, o: String, x: String, r: String, w: String) -> Maybe<&2, +List<LorenzEvent>>:
  match k n c d s:
    case Some{kn} Some{nn} Some{cn} Some{dn} Some{sn}:
      +event = {LorenzEvent{kn, nn, cn, dn, sn, a, o, x, r, w} : LorenzEvent}
      lorenz_parse_step(lorenz_valid(history, event), history, event, next)
    case _ _ _ _ _:
      None{}

def lorenz_parse_lines(lines: +List<String>, +history: +List<LorenzEvent>) -> Maybe<&2, +List<LorenzEvent>>:
  match lines:
    case Con{end, Nil{}}:
      Bool.pick(Maybe<&2, +List<LorenzEvent>>, String.eq(end, "END"), Some{history}, None{})
    case Con{k, Con{n, Con{c, Con{d, Con{s, Con{a, Con{o, Con{x, Con{r, Con{w, rest}}}}}}}}}}:
      lorenz_parse_numbers(history, h => lorenz_parse_lines(rest, h), lorenz_nat(k), lorenz_nat(n), lorenz_nat(c), lorenz_nat(d), lorenz_nat(s), a, o, x, r, w)
    case _:
      None{}

def lorenz_parse_header(valid: Bool, lines: +List<String>) -> Maybe<&2, +List<LorenzEvent>>:
  match valid:
    case True{}:
      lorenz_parse_lines(lines, [])
    case False{}:
      None{}

def lorenz_parse_split(lines: +List<String>) -> Maybe<&2, +List<LorenzEvent>>:
  match lines:
    case Con{header, rest}:
      lorenz_parse_header(String.eq(header, "lorenz-local/v1"), rest)
    case _:
      None{}

def lorenz_parse(text: String) -> Maybe<&2, +List<LorenzEvent>>:
  lorenz_parse_split(String.lines(text))

def lorenz_loaded(parsed: Maybe<&2, +List<LorenzEvent>>) -> IO(+List<LorenzEvent>):
  match parsed:
    case None{}:
      IO.die(+List<LorenzEvent>, 1, "lorenz_invalid_snapshot")
    case Some{history}:
      IO.pure(+List<LorenzEvent>, history)

def lorenz_load(path: String) -> IO(+List<LorenzEvent>):
  do IO<+List<LorenzEvent>>:
    found : Maybe<&2, String> <- store_read(path)
    text : String <- store_source_present(found)
    lorenz_loaded(lorenz_parse(text))

def lorenz_save_existing(previous: Maybe<&2, String>, path: String, text: String) -> IO(Unit):
  match previous:
    case Some{old}:
      IO.die(Unit, 1, "lorenz_output_exists: choose a new snapshot path")
    case None{}:
      do IO<Unit>:
        store_write(path, text)
        IO.print("lorenz_snapshot_saved: local single writer; supplied provenance; no execution")

def lorenz_save_size(valid: Bool, +path: String, text: String) -> IO(Unit):
  match valid:
    case False{}:
      IO.die(Unit, 1, "lorenz_snapshot_too_large")
    case True{}:
      do IO<Unit>:
        previous : Maybe<&2, String> <- store_read(path)
        lorenz_save_existing(previous, path, text)

def lorenz_save(path: String, history: +List<LorenzEvent>) -> IO(Unit):
  +text = lorenz_snapshot(history)
  lorenz_save_size(Nat.is_le(String.length(text), 100000n), path, text)

def lorenz_commit_valid(valid: Bool, history: +List<LorenzEvent>, event: LorenzEvent, path: String) -> IO(Unit):
  match valid:
    case False{}:
      IO.die(Unit, 1, "lorenz_invalid_transition: check fields, references, retention and active dependencies")
    case True{}:
      lorenz_save(path, lorenz_append(history, event))

def lorenz_commit(+history: +List<LorenzEvent>, +event: LorenzEvent, path: String) -> IO(Unit):
  lorenz_commit_valid(lorenz_valid(history, event), history, event, path)

def lorenz_status(+history: +List<LorenzEvent>, e: LorenzEvent) -> String:
  match e:
    case LorenzEvent{+k, +n, c, d, s, a, o, x, r, w}:
      Bool.pick(String, lorenz_memory_kind(k), Bool.pick(String, lorenz_replaced(history, n), "superseded", Bool.pick(String, lorenz_active(history, n, 1n+lorenz_size(history)), "active", "needs-review")), Bool.pick(String, Nat.is_eq(k, 4n), "queued", "conversation"))

def lorenz_describe(+history: +List<LorenzEvent>, +e: LorenzEvent) -> String:
  match e:
    case LorenzEvent{k, n, c, d, s, a, o, x, r, w}:
      "id=" ++ Nat.show(n) ++ " kind=" ++ Nat.show(k) ++ " status=" ++ lorenz_status(history, e) ++ " conversation=" ++ Nat.show(c) ++ " dependency=" ++ Nat.show(d) ++ " supersedes=" ++ Nat.show(s) ++ "\nactor: " ++ a ++ "\norigin: " ++ o ++ "\ntext: " ++ x ++ "\ndetail: " ++ r ++ "\nowner: " ++ w ++ "\n"

def lorenz_display(+history: +List<LorenzEvent>, rows: +List<LorenzEvent>, +only_memory: Bool) -> String:
  match rows:
    case Nil{}:
      ""
    case Con{+e, rest}:
      match e:
        case LorenzEvent{k, n, c, d, s, a, o, x, r, w}:
          Bool.pick(String, Bool.not(only_memory) || (lorenz_memory_kind(k) && lorenz_active(history, n, 1n+lorenz_size(history))), lorenz_describe(history, e), "") ++ lorenz_display(history, rest, only_memory)

def lorenz_query(path: String, only_memory: Bool) -> IO(Unit):
  do IO<Unit>:
    +history : +List<LorenzEvent> <- lorenz_load(path)
    IO.print(lorenz_display(history, history, only_memory))

def lorenz_capture_event(+history: +List<LorenzEvent>, output: String, retain: String, +event: LorenzEvent) -> IO(Unit):
  lorenz_commit_valid(lorenz_capture_allowed(String.eq(retain, "retain"), lorenz_valid(history, event)), history, event, output)

def lorenz_capture_history(+history: +List<LorenzEvent>, output: String, retain: String, actor: String, origin: String, text: String) -> IO(Unit):
  lorenz_capture_event(history, output, retain, LorenzEvent{1n, 1n+lorenz_size(history), 0n, 0n, 0n, actor, origin, text, "-", "-"})

def lorenz_capture(input: String, output: String, retain: String, actor: String, origin: String, text: String) -> IO(Unit):
  do IO<Unit>:
    history : +List<LorenzEvent> <- lorenz_load(input)
    lorenz_capture_history(history, output, retain, actor, origin, text)


def lorenz_remember_found(+history: +List<LorenzEvent>, output: String, c: Nat, d: Nat, actor: String, text: String, found: LorenzEvent) -> IO(Unit):
  match found:
    case LorenzEvent{k, n, cc, cd, cs, ca, origin, ct, cr, cw}:
      lorenz_commit(history, LorenzEvent{2n, 1n+lorenz_size(history), c, d, 0n, actor, origin, text, "-", "-"}, output)

def lorenz_remember_parsed(+history: +List<LorenzEvent>, output: String, cid: Maybe<&2, Nat>, dep: Maybe<&2, Nat>, actor: String, text: String) -> IO(Unit):
  match cid dep:
    case Some{+c} Some{d}:
      lorenz_remember_found(history, output, c, d, actor, text, lorenz_find(history, c))
    case _ _:
      IO.die(Unit, 1, "lorenz_invalid_id")

def lorenz_remember(input: String, output: String, cid: String, dep: String, actor: String, text: String) -> IO(Unit):
  do IO<Unit>:
    history : +List<LorenzEvent> <- lorenz_load(input)
    lorenz_remember_parsed(history, output, lorenz_nat(cid), lorenz_nat(dep), actor, text)

def lorenz_correct_found(+history: +List<LorenzEvent>, output: String, m: Nat, d: Nat, actor: String, reason: String, text: String, found: LorenzEvent) -> IO(Unit):
  match found:
    case LorenzEvent{k, n, c, cd, cs, ca, origin, ct, cr, cw}:
      lorenz_commit(history, LorenzEvent{3n, 1n+lorenz_size(history), c, d, m, actor, origin, text, reason, "-"}, output)

def lorenz_correct_parsed(+history: +List<LorenzEvent>, output: String, mid: Maybe<&2, Nat>, dep: Maybe<&2, Nat>, actor: String, reason: String, text: String) -> IO(Unit):
  match mid dep:
    case Some{+m} Some{d}:
      lorenz_correct_found(history, output, m, d, actor, reason, text, lorenz_find(history, m))
    case _ _:
      IO.die(Unit, 1, "lorenz_invalid_id")

def lorenz_correct(input: String, output: String, mid: String, dep: String, actor: String, reason: String, text: String) -> IO(Unit):
  do IO<Unit>:
    history : +List<LorenzEvent> <- lorenz_load(input)
    lorenz_correct_parsed(history, output, lorenz_nat(mid), lorenz_nat(dep), actor, reason, text)

def lorenz_work_reuse(valid: Bool, history: +List<LorenzEvent>, output: String) -> IO(Unit):
  match valid:
    case True{}:
      lorenz_save(output, history)
    case False{}:
      IO.die(Unit, 1, "lorenz_invalid_work_fields")

def lorenz_work_reuse_event(history: +List<LorenzEvent>, event: LorenzEvent, output: String) -> IO(Unit):
  match event:
    case LorenzEvent{k, n, c, d, s, actor, origin, text, acceptance, owner}:
      lorenz_work_reuse(lorenz_line(actor) && lorenz_line(owner) && lorenz_line(acceptance), history, output)

def lorenz_work_existing(exists: Bool, +history: +List<LorenzEvent>, event: LorenzEvent, output: String) -> IO(Unit):
  match exists:
    case True{}:
      lorenz_work_reuse_event(history, event, output)
    case False{}:
      lorenz_commit(history, event, output)

def lorenz_work_found(+history: +List<LorenzEvent>, output: String, +c: Nat, actor: String, owner: String, acceptance: String, found: LorenzEvent) -> IO(Unit):
  match found:
    case LorenzEvent{k, n, cc, cd, cs, ca, origin, text, cr, cw}:
      lorenz_work_existing(lorenz_has_work(history, c), history, LorenzEvent{4n, 1n+lorenz_size(history), c, 0n, 0n, actor, origin, text, acceptance, owner}, output)

def lorenz_work_parsed(+history: +List<LorenzEvent>, output: String, cid: Maybe<&2, Nat>, actor: String, owner: String, acceptance: String) -> IO(Unit):
  match cid:
    case Some{+c}:
      lorenz_work_found(history, output, c, actor, owner, acceptance, lorenz_find(history, c))
    case None{}:
      IO.die(Unit, 1, "lorenz_invalid_id")

def lorenz_work(input: String, output: String, cid: String, actor: String, owner: String, acceptance: String) -> IO(Unit):
  do IO<Unit>:
    history : +List<LorenzEvent> <- lorenz_load(input)
    lorenz_work_parsed(history, output, lorenz_nat(cid), actor, owner, acceptance)

def lorenz_io_choose(valid: Bool, yes: IO(Unit), no: IO(Unit)) -> IO(Unit):
  match valid:
    case True{}:
      yes
    case False{}:
      no

def lorenz_explain_found(+history: +List<LorenzEvent>, +e: LorenzEvent) -> IO(Unit):
  match e:
    case LorenzEvent{k, i, c, d, s, a, o, x, r, w}:
      lorenz_io_choose(Nat.is_eq(k, 0n), IO.die(Unit, 1, "lorenz_id_not_found"), IO.print(lorenz_describe(history, e)))

def lorenz_explain_parsed(+history: +List<LorenzEvent>, id: Maybe<&2, Nat>) -> IO(Unit):
  match id:
    case Some{n}:
      lorenz_explain_found(history, lorenz_find(history, n))
    case None{}:
      IO.die(Unit, 1, "lorenz_invalid_id")

def lorenz_explain(input: String, id: String) -> IO(Unit):
  do IO<Unit>:
    history : +List<LorenzEvent> <- lorenz_load(input)
    lorenz_explain_parsed(history, lorenz_nat(id))

# A balanced fork/join probe exercises the installed native scheduler. This
# counts leaves, not useful application speedup. GPU ! requests Metal dispatch;
# native runtime may fall back to CPU. JS execution does not measure multicore.
def lorenz_compute_leaves(+depth: Nat) -> U32:
  match depth:
    case 0n:
      1
    case 1n+p:
      a b = lorenz_compute_leaves(p) lorenz_compute_leaves(p)
      (a + b : U32)

def lorenz_compute_run(gpu: Bool, depth: Nat) -> IO(Unit):
  match gpu:
    case False{}:
      IO.print("requested=cpu leaves=" ++ U32.show(lorenz_compute_leaves(depth)))
    case True{}:
      IO.print("requested=gpu leaves=" ++ U32.show(lorenz_compute_leaves!(depth)))

def lorenz_compute_limit(valid: Bool, gpu: Bool, depth: Nat) -> IO(Unit):
  match valid:
    case False{}:
      IO.die(Unit, 1, "compute requires mode cpu|gpu and depth 0..20")
    case True{}:
      lorenz_compute_run(gpu, depth)

def lorenz_compute_parsed(+mode: String, parsed: Maybe<&2, Nat>) -> IO(Unit):
  match parsed:
    case None{}:
      IO.die(Unit, 1, "invalid compute depth")
    case Some{+depth}:
      lorenz_compute_limit((String.eq(mode, "cpu") || String.eq(mode, "gpu")) && Nat.is_le(depth, 20n), String.eq(mode, "gpu"), depth)

law lorenz_parallel_leaf_count:
  {lorenz_compute_leaves(4n) == 16 : U32}

def lorenz_parallel_leaf_count():
  {==}

def lorenz_help() -> String:
  "lorenz init OUT\nlorenz capture IN OUT retain ACTOR ORIGIN TEXT\nlorenz remember IN OUT CONVERSATION_ID DEPENDENCY_ID ACTOR TEXT\nlorenz correct IN OUT MEMORY_ID DEPENDENCY_ID ACTOR REASON TEXT\nlorenz work IN OUT CONVERSATION_ID ACTOR OWNER ACCEPTANCE\nlorenz history IN\nlorenz memory IN\nlorenz explain IN ID\nlorenz compute cpu|gpu DEPTH\nIDs are snapshot-local decimals; dependency 0 means none. Single nonempty lines, max 4096 characters. One dependency per memory. OUT must not exist; check-then-write is not atomic. Private directory and single writer required. Work is queued data only."

def lorenz_dispatch_pair(init: Bool, history: Bool, memory: Bool, path: String) -> IO(Unit):
  match init history memory:
    case True{} _ _:
      lorenz_save(path, [])
    case _ True{} _:
      lorenz_query(path, False{})
    case _ _ True{}:
      lorenz_query(path, True{})
    case _ _ _:
      IO.die(Unit, 1, lorenz_help())

def lorenz_dispatch_six(capture: Bool, remember: Bool, work: Bool, input: String, output: String, p1: String, p2: String, p3: String, p4: String) -> IO(Unit):
  match capture remember work:
    case True{} _ _:
      lorenz_capture(input, output, p1, p2, p3, p4)
    case _ True{} _:
      lorenz_remember(input, output, p1, p2, p3, p4)
    case _ _ True{}:
      lorenz_work(input, output, p1, p2, p3, p4)
    case _ _ _:
      IO.die(Unit, 1, lorenz_help())

def lorenz_dispatch(args: List<String>) -> IO(Unit):
  match args:
    case Con{command, Nil{}}:
      lorenz_io_choose(String.eq(command, "help"), IO.print(lorenz_help()), IO.die(Unit, 1, lorenz_help()))
    case Con{+command, Con{path, Nil{}}}:
      lorenz_dispatch_pair(String.eq(command, "init"), String.eq(command, "history"), String.eq(command, "memory"), path)
    case Con{+command, Con{+path, Con{+id, Nil{}}}}:
      lorenz_io_choose(String.eq(command, "explain"), lorenz_explain(path, id), lorenz_io_choose(String.eq(command, "compute"), lorenz_compute_parsed(path, lorenz_nat(id)), IO.die(Unit, 1, lorenz_help())))
    case Con{+command, Con{input, Con{output, Con{p1, Con{p2, Con{p3, Con{p4, Nil{}}}}}}}}:
      lorenz_dispatch_six(String.eq(command, "capture"), String.eq(command, "remember"), String.eq(command, "work"), input, output, p1, p2, p3, p4)
    case Con{command, Con{input, Con{output, Con{p1, Con{p2, Con{p3, Con{p4, Con{p5, Nil{}}}}}}}}}:
      lorenz_io_choose(String.eq(command, "correct"), lorenz_correct(input, output, p1, p2, p3, p4, p5), IO.die(Unit, 1, lorenz_help()))
    case _:
      IO.die(Unit, 1, lorenz_help())

def lorenz_fixture() -> +List<LorenzEvent>:
  [LorenzEvent{1n, 1n, 0n, 0n, 0n, "operator", "conversation:example", "question", "-", "-"}, LorenzEvent{2n, 2n, 1n, 0n, 0n, "agent", "conversation:example", "premise", "-", "-"}, LorenzEvent{2n, 3n, 1n, 2n, 0n, "agent", "conversation:example", "direct", "-", "-"}, LorenzEvent{2n, 4n, 1n, 3n, 0n, "agent", "conversation:example", "transitive", "-", "-"}]

def lorenz_fixture_corrected() -> +List<LorenzEvent>:
  lorenz_append(lorenz_fixture(), LorenzEvent{3n, 5n, 1n, 0n, 2n, "operator", "conversation:example", "corrected premise", "observed failure", "-"})

law lorenz_correction_invalidates_transitive_dependency:
  {lorenz_active(lorenz_fixture_corrected(), 4n, 6n) == False{} : Bool}

def lorenz_correction_invalidates_transitive_dependency():
  {==}

law lorenz_correction_preserves_original:
  {lorenz_find(lorenz_fixture_corrected(), 2n) == lorenz_find(lorenz_fixture(), 2n) : LorenzEvent}

def lorenz_correction_preserves_original():
  {==}

law lorenz_corrected_premise_active:
  {lorenz_active(lorenz_fixture_corrected(), 5n, 6n) == True{} : Bool}

def lorenz_corrected_premise_active():
  {==}

law lorenz_capture_does_not_create_work:
  {lorenz_has_work(lorenz_fixture(), 1n) == False{} : Bool}

def lorenz_capture_does_not_create_work():
  {==}

law lorenz_repair_revalidates_dependent:
  {lorenz_active(lorenz_append(lorenz_fixture_corrected(), LorenzEvent{3n, 6n, 1n, 5n, 3n, "operator", "conversation:example", "reviewed dependent", "rechecked premise", "-"}), 6n, 7n) == True{} : Bool}

def lorenz_repair_revalidates_dependent():
  {==}

law lorenz_self_dependency_rejected:
  {lorenz_valid(lorenz_fixture(), LorenzEvent{3n, 5n, 1n, 2n, 2n, "operator", "conversation:example", "bad", "self", "-"}) == False{} : Bool}

def lorenz_self_dependency_rejected():
  {==}

law lorenz_descendant_dependency_rejected:
  {lorenz_valid(lorenz_fixture(), LorenzEvent{3n, 5n, 1n, 4n, 2n, "operator", "conversation:example", "bad", "descendant", "-"}) == False{} : Bool}

def lorenz_descendant_dependency_rejected():
  {==}


law lorenz_missing_conversation_rejected:
  {lorenz_valid([], LorenzEvent{2n, 1n, 1n, 0n, 0n, "agent", "source", "claim", "-", "-"}) == False{} : Bool}

def lorenz_missing_conversation_rejected():
  {==}

law lorenz_missing_dependency_rejected:
  {lorenz_valid(lorenz_fixture(), LorenzEvent{2n, 5n, 1n, 99n, 0n, "agent", "conversation:example", "claim", "-", "-"}) == False{} : Bool}

def lorenz_missing_dependency_rejected():
  {==}

law lorenz_superseded_correction_rejected:
  {lorenz_valid(lorenz_fixture_corrected(), LorenzEvent{3n, 6n, 1n, 0n, 2n, "operator", "conversation:example", "ambiguous", "already corrected", "-"}) == False{} : Bool}

def lorenz_superseded_correction_rejected():
  {==}

law lorenz_repair_transition_valid:
  {lorenz_valid(lorenz_fixture_corrected(), LorenzEvent{3n, 6n, 1n, 5n, 3n, "operator", "conversation:example", "reviewed dependent", "rechecked premise", "-"}) == True{} : Bool}

def lorenz_repair_transition_valid():
  {==}

law lorenz_empty_snapshot_roundtrip:
  {lorenz_parse(lorenz_snapshot([])) == Some{[]} : Maybe<&2, +List<LorenzEvent>>}

def lorenz_empty_snapshot_roundtrip():
  {==}

law lorenz_empty_actor_rejected:
  {lorenz_line("") == False{} : Bool}

def lorenz_empty_actor_rejected():
  {==}

law lorenz_multiline_field_rejected:
  {lorenz_line("first\nsecond") == False{} : Bool}

def lorenz_multiline_field_rejected():
  {==}

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    lorenz_dispatch(args)
