import Base

# A pure, bounded algorithm kernel. The host owns authority, source digests,
# independent task verification, wall time, and durable receipts. In particular,
# the HostSuccess/HostFailure constructors below are INPUT CLAIMS: this file
# cannot authenticate the caller or establish that a verifier actually ran.
#
# CLI:
#   bend runtime/core/telepathy.bend -- batch EVENT_SCAN CANDIDATE_SCAN
#     DOC_SCAN AUTHORIZED_SCOPE K EVENTS CANDIDATES DOCS
#   bend runtime/core/telepathy.bend -- diffuse STEPS BUDGET K
#     NODES EDGES ANCHORS AUTHORIZED_SCOPE_IDS
#
# EVENTS is newline-separated rows of five canonical 0..65535 integers:
#   seq, predicted, observed, calibration_measured (0/1), host_verdict
#   host_verdict: 0=HostFailure, 1=HostSuccess, 2=NoVerdict
# CANDIDATES has rows of four:
#   action, admissible (0/1), fuel, estimate (0 means no predicted benefit)
# DOCS has rows of three:
#   id, scope, value
# Each block may be empty. No trailing newline. At most 128 rows and 4096
# characters per block. The three scan limits and K are each at most 128.
#
# Every inspected event or candidate spends one scan unit. The highest positive
# estimate in the inspected, admissible, funded prefix wins; equal estimates
# prefer lower action ID, then more remaining action fuel. Choosing spends one
# unit of that action's fuel. Estimates are untrusted host inputs, not evidence
# of actual value. A sequence gap is rejected and
# reported, never silently omitted. Retrieval returns scoped records, not
# bare IDs. A query's scope must already be authorized by the host.
# Diffusion blocks contain canonical newline-separated 0..65535 integers:
# NODES, ANCHORS and AUTHORIZED_SCOPE_IDS contain node IDs; EDGES contains
# triples (source ID, destination ID, weight 0..8). Each block is at most 4096
# characters and 128 records. STEPS is at most 16; BUDGET and K at most 128.
# The host authenticates the scope and ID mapping. The kernel computes only a
# pure, bounded context ranking over the induced in-scope graph.

type TpVerdict is Data:
  HostSuccess{}
  HostFailure{}
  NoVerdict{}

type TpEvent is Data:
  TpEvent{seq: Nat, predicted: Nat, observed: Nat, calibration_measured: Bool, verdict: TpVerdict}

type TpQuality is Data:
  TpQuality{success: Nat, failure: Nat, unknown: Nat}

type TpCalibration is Data:
  TpCalibration{matched: Nat, mismatched: Nat, unknown: Nat}

type TpState is Data:
  TpState{cursor: Nat, quality: TpQuality, calibration: TpCalibration, rejected: Nat, accepted: Nat}

type TpRun is Data:
  TpRun{state: TpState, scanned: Nat, exhausted: Bool}

def tp_init() -> TpState:
  TpState{0n, TpQuality{0n, 0n, 0n}, TpCalibration{0n, 0n, 0n}, 0n, 0n}

def tp_quality_step(q: TpQuality, verdict: TpVerdict) -> TpQuality:
  match q verdict:
    case TpQuality{s, f, u} HostSuccess{}:
      TpQuality{(s + 1n : Nat), f, u}
    case TpQuality{s, f, u} HostFailure{}:
      TpQuality{s, (f + 1n : Nat), u}
    case TpQuality{s, f, u} NoVerdict{}:
      TpQuality{s, f, (u + 1n : Nat)}

def tp_calibration_known(same: Bool, c: TpCalibration) -> TpCalibration:
  match same c:
    case True{} TpCalibration{m, x, u}:
      TpCalibration{(m + 1n : Nat), x, u}
    case False{} TpCalibration{m, x, u}:
      TpCalibration{m, (x + 1n : Nat), u}

def tp_calibration_unknown(c: TpCalibration) -> TpCalibration:
  match c:
    case TpCalibration{m, x, u}:
      TpCalibration{m, x, (u + 1n : Nat)}

def tp_calibration_step(c: TpCalibration, predicted: Nat, observed: Nat, measured: Bool) -> TpCalibration:
  match measured:
    case False{}:
      tp_calibration_unknown(c)
    case True{}:
      tp_calibration_known(Nat.is_eq(predicted, observed), c)

def tp_step_branch(ok: Bool, cursor: Nat, q: TpQuality, c: TpCalibration, rejected: Nat, accepted: Nat, predicted: Nat, observed: Nat, measured: Bool, verdict: TpVerdict) -> TpState:
  match ok:
    case False{}:
      TpState{cursor, q, c, (rejected + 1n : Nat), accepted}
    case True{}:
      TpState{(cursor + 1n : Nat), tp_quality_step(q, verdict), tp_calibration_step(c, predicted, observed, measured), rejected, (accepted + 1n : Nat)}

def tp_step(state: TpState, event: TpEvent) -> TpState:
  match state event:
    case TpState{+cursor, q, c, rejected, accepted} TpEvent{seq, predicted, observed, measured, verdict}:
      tp_step_branch(Nat.is_eq(seq, cursor), cursor, q, c, rejected, accepted, predicted, observed, measured, verdict)

def tp_run_go(fuel: Nat, +events: +List<TpEvent>, state: TpState, scanned: Nat) -> TpRun:
  match fuel events:
    case _ Nil{}:
      TpRun{state, scanned, False{}}
    case 0n Con{h, t}:
      TpRun{state, scanned, True{}}
    case 1n+rest Con{h, t}:
      tp_run_go(rest, t, tp_step(state, h), (scanned + 1n : Nat))

def tp_run(fuel: Nat, +events: +List<TpEvent>) -> TpRun:
  tp_run_go(fuel, events, tp_init(), 0n)

type TpCandidate is Data:
  TpCandidate{action: Nat, admissible: Bool, fuel: Nat, estimate: Nat}

type TpChoice is Data:
  TpNoChoice{scanned: Nat, exhausted: Bool}
  TpChosen{action: Nat, remaining_fuel: Nat, estimate: Nat, scanned: Nat, exhausted: Bool}

type TpBest is Data:
  TpNoBest{}
  TpBestCandidate{action: Nat, remaining_fuel: Nat, estimate: Nat}

def tp_better(+action: Nat, remaining: Nat, +estimate: Nat, +old_action: Nat, old_remaining: Nat, +old_estimate: Nat) -> Bool:
  Nat.is_gt(estimate, old_estimate) ||
    (Nat.is_eq(estimate, old_estimate) &&
      (Nat.is_lt(action, old_action) ||
        (Nat.is_eq(action, old_action) && Nat.is_gt(remaining, old_remaining))))

def tp_best_with(+action: Nat, +remaining: Nat, +estimate: Nat, best: TpBest) -> TpBest:
  match best:
    case TpNoBest{}:
      TpBestCandidate{action, remaining, estimate}
    case TpBestCandidate{+old_action, +old_remaining, +old_estimate}:
      Bool.pick(TpBest, tp_better(action, remaining, estimate, old_action, old_remaining, old_estimate),
        TpBestCandidate{action, remaining, estimate},
        TpBestCandidate{old_action, old_remaining, old_estimate})

def tp_consider_branch(positive: Bool, action: Nat, remaining: Nat, estimate: Nat, best: TpBest) -> TpBest:
  match positive:
    case True{}:
      tp_best_with(action, remaining, estimate, best)
    case False{}:
      best

def tp_consider(action: Nat, remaining: Nat, +estimate: Nat, best: TpBest) -> TpBest:
  tp_consider_branch(Nat.is_gt(estimate, 0n), action, remaining, estimate, best)

def tp_choice_from_best(best: TpBest, scanned: Nat, exhausted: Bool) -> TpChoice:
  match best:
    case TpNoBest{}:
      TpNoChoice{scanned, exhausted}
    case TpBestCandidate{action, remaining, estimate}:
      TpChosen{action, remaining, estimate, scanned, exhausted}

# Scan the funded prefix exactly once. A zero estimate abstains even if the
# candidate is admissible; no claim about uninspected candidates is made.
def tp_choose_go(scan: Nat, +items: +List<TpCandidate>, scanned: Nat, best: TpBest) -> TpChoice:
  match scan items:
    case _ Nil{}:
      tp_choice_from_best(best, scanned, False{})
    case 0n Con{h, t}:
      tp_choice_from_best(best, scanned, True{})
    case 1n+rest Con{h, t}:
      match h:
        case TpCandidate{action, True{}, 1n+left, estimate}:
          tp_choose_go(rest, t, (scanned + 1n : Nat),
            tp_consider(action, left, estimate, best))
        case TpCandidate{action, True{}, 0n, estimate}:
          tp_choose_go(rest, t, (scanned + 1n : Nat), best)
        case TpCandidate{action, False{}, fuel, estimate}:
          tp_choose_go(rest, t, (scanned + 1n : Nat), best)

def tp_choose(scan: Nat, +items: +List<TpCandidate>) -> TpChoice:
  tp_choose_go(scan, items, 0n, TpNoBest{})

type TpDoc is Data:
  TpDoc{id: Nat, scope: Nat, value: Nat}

type TpScanDocs is Data:
  TpScanDocs{docs: +List<TpDoc>, scanned: Nat, exhausted: Bool}

type TpRetrieval is Data:
  TpRetrieval{docs: +List<TpDoc>, scanned: Nat, exhausted: Bool}

def tp_scan_cons(in_scope: Bool, doc: TpDoc, +rest: TpScanDocs) -> TpScanDocs:
  match in_scope rest:
    case True{} TpScanDocs{docs, scanned, exhausted}:
      TpScanDocs{doc <> docs, scanned, exhausted}
    case False{} TpScanDocs{docs, scanned, exhausted}:
      TpScanDocs{docs, scanned, exhausted}

def tp_scan_docs_go(fuel: Nat, +docs: +List<TpDoc>, +scope: Nat, scanned: Nat) -> TpScanDocs:
  match fuel docs:
    case _ Nil{}:
      TpScanDocs{[], scanned, False{}}
    case 0n Con{h, t}:
      TpScanDocs{[], scanned, True{}}
    case 1n+rest Con{h, t}:
      match h:
        case TpDoc{id, +doc_scope, value}:
          +tail = tp_scan_docs_go(rest, t, scope, (scanned + 1n : Nat))
          tp_scan_cons(Nat.is_eq(doc_scope, scope), TpDoc{id, doc_scope, value}, tail)

def tp_take_docs(k: Nat, +docs: +List<TpDoc>) -> +List<TpDoc>:
  match k docs:
    case 0n _:
      []
    case _ Nil{}:
      []
    case 1n+rest Con{h, t}:
      h <> tp_take_docs(rest, t)

def tp_retrieval_done(k: Nat, +scan: TpScanDocs) -> TpRetrieval:
  match scan:
    case TpScanDocs{docs, scanned, exhausted}:
      TpRetrieval{tp_take_docs(k, docs), scanned, exhausted}

# The host must supply an authorized scope. The kernel enforces equality only.
# Full records preserve scope even if distinct records reuse the same ID.
def tp_retrieve(fuel: Nat, +docs: +List<TpDoc>, scope: Nat, k: Nat) -> TpRetrieval:
  tp_retrieval_done(k, tp_scan_docs_go(fuel, docs, scope, 0n))

# Canonical numeric parser. Input length and row limits bound parsing before
# any record scan. No parser result is treated as a trusted verifier result.
def tp_nat_parsed(raw: String, parsed: Maybe<&2, Nat>) -> Maybe<&2, Nat>:
  match parsed:
    case None{}:
      None{}
    case Some{+n}:
      Bool.pick(Maybe<&2, Nat>, Nat.is_le(n, 65535n) && String.eq(raw, Nat.show(n)), Some{n}, None{})

def tp_nat_short(short: Bool, +raw: String) -> Maybe<&2, Nat>:
  match short:
    case False{}:
      None{}
    case True{}:
      tp_nat_parsed(raw, Nat.read(raw))

def tp_nat(+raw: String) -> Maybe<&2, Nat>:
  tp_nat_short(Nat.is_le(String.length(raw), 5n), raw)

def tp_bool(value: Maybe<&2, Nat>) -> Maybe<&2, Bool>:
  match value:
    case Some{0n}:
      Some{False{}}
    case Some{1n}:
      Some{True{}}
    case _:
      None{}

def tp_verdict(value: Maybe<&2, Nat>) -> Maybe<&2, TpVerdict>:
  match value:
    case Some{0n}:
      Some{HostFailure{}}
    case Some{1n}:
      Some{HostSuccess{}}
    case Some{2n}:
      Some{NoVerdict{}}
    case _:
      None{}

def tp_event(s: Maybe<&2, Nat>, p: Maybe<&2, Nat>, o: Maybe<&2, Nat>, m: Maybe<&2, Bool>, v: Maybe<&2, TpVerdict>) -> Maybe<&2, TpEvent>:
  match s p o m v:
    case Some{seq} Some{predicted} Some{observed} Some{measured} Some{verdict}:
      Some{TpEvent{seq, predicted, observed, measured, verdict}}
    case _ _ _ _ _:
      None{}

def tp_candidate(a: Maybe<&2, Nat>, b: Maybe<&2, Bool>, f: Maybe<&2, Nat>, e: Maybe<&2, Nat>) -> Maybe<&2, TpCandidate>:
  match a b f e:
    case Some{action} Some{admissible} Some{fuel} Some{estimate}:
      Some{TpCandidate{action, admissible, fuel, estimate}}
    case _ _ _ _:
      None{}

def tp_doc(i: Maybe<&2, Nat>, s: Maybe<&2, Nat>, v: Maybe<&2, Nat>) -> Maybe<&2, TpDoc>:
  match i s v:
    case Some{id} Some{scope} Some{value}:
      Some{TpDoc{id, scope, value}}
    case _ _ _:
      None{}

def tp_event_cons(head: Maybe<&2, TpEvent>, tail: Maybe<&2, +List<TpEvent>>) -> Maybe<&2, +List<TpEvent>>:
  match head tail:
    case Some{h} Some{t}:
      Some{h <> t}
    case _ _:
      None{}

def tp_candidate_cons(head: Maybe<&2, TpCandidate>, tail: Maybe<&2, +List<TpCandidate>>) -> Maybe<&2, +List<TpCandidate>>:
  match head tail:
    case Some{h} Some{t}:
      Some{h <> t}
    case _ _:
      None{}

def tp_doc_cons(head: Maybe<&2, TpDoc>, tail: Maybe<&2, +List<TpDoc>>) -> Maybe<&2, +List<TpDoc>>:
  match head tail:
    case Some{h} Some{t}:
      Some{h <> t}
    case _ _:
      None{}

def tp_parse_events(rows: Nat, +lines: +List<String>) -> Maybe<&2, +List<TpEvent>>:
  match rows lines:
    case _ Nil{}:
      Some{[]}
    case 0n _:
      None{}
    case 1n+rest Con{s, Con{p, Con{o, Con{m, Con{v, tail}}}}}:
      tp_event_cons(tp_event(tp_nat(s), tp_nat(p), tp_nat(o), tp_bool(tp_nat(m)), tp_verdict(tp_nat(v))), tp_parse_events(rest, tail))
    case _ _:
      None{}

def tp_parse_candidates(rows: Nat, +lines: +List<String>) -> Maybe<&2, +List<TpCandidate>>:
  match rows lines:
    case _ Nil{}:
      Some{[]}
    case 0n _:
      None{}
    case 1n+rest Con{a, Con{b, Con{f, Con{e, tail}}}}:
      tp_candidate_cons(tp_candidate(tp_nat(a), tp_bool(tp_nat(b)), tp_nat(f), tp_nat(e)), tp_parse_candidates(rest, tail))
    case _ _:
      None{}

def tp_parse_docs(rows: Nat, +lines: +List<String>) -> Maybe<&2, +List<TpDoc>>:
  match rows lines:
    case _ Nil{}:
      Some{[]}
    case 0n _:
      None{}
    case 1n+rest Con{i, Con{s, Con{v, tail}}}:
      tp_doc_cons(tp_doc(tp_nat(i), tp_nat(s), tp_nat(v)), tp_parse_docs(rest, tail))
    case _ _:
      None{}

def tp_lines_branch(empty: Bool, text: String) -> +List<String>:
  match empty:
    case True{}:
      []
    case False{}:
      String.lines(text)

def tp_lines(+text: String) -> +List<String>:
  tp_lines_branch(String.eq(text, ""), text)

def tp_bool_json(value: Bool) -> String:
  match value:
    case True{}:
      "true"
    case False{}:
      "false"

def tp_quality_json(q: TpQuality) -> String:
  match q:
    case TpQuality{success, failure, unknown}:
      "{\"success\":" ++ Nat.show(success) ++ ",\"failure\":" ++ Nat.show(failure) ++ ",\"unknown\":" ++ Nat.show(unknown) ++ "}"

def tp_calibration_json(c: TpCalibration) -> String:
  match c:
    case TpCalibration{matched, mismatched, unknown}:
      "{\"match\":" ++ Nat.show(matched) ++ ",\"mismatch\":" ++ Nat.show(mismatched) ++ ",\"unknown\":" ++ Nat.show(unknown) ++ "}"

def tp_run_json(run: TpRun) -> String:
  match run:
    case TpRun{TpState{cursor, quality, calibration, rejected, accepted}, scanned, exhausted}:
      "{\"cursor\":" ++ Nat.show(cursor) ++ ",\"quality\":" ++ tp_quality_json(quality) ++ ",\"calibration\":" ++ tp_calibration_json(calibration) ++ ",\"rejected\":" ++ Nat.show(rejected) ++ ",\"accepted\":" ++ Nat.show(accepted) ++ ",\"scanned\":" ++ Nat.show(scanned) ++ ",\"scan_exhausted\":" ++ tp_bool_json(exhausted) ++ "}"

def tp_choice_json(choice: TpChoice) -> String:
  match choice:
    case TpNoChoice{scanned, exhausted}:
      "{\"selected\":false,\"scanned\":" ++ Nat.show(scanned) ++ ",\"scan_exhausted\":" ++ tp_bool_json(exhausted) ++ "}"
    case TpChosen{action, remaining, estimate, scanned, exhausted}:
      "{\"selected\":true,\"action\":" ++ Nat.show(action) ++ ",\"remaining_fuel\":" ++ Nat.show(remaining) ++ ",\"estimate\":" ++ Nat.show(estimate) ++ ",\"scanned\":" ++ Nat.show(scanned) ++ ",\"scan_exhausted\":" ++ tp_bool_json(exhausted) ++ "}"

def tp_doc_json(doc: TpDoc) -> String:
  match doc:
    case TpDoc{id, scope, value}:
      "{\"id\":" ++ Nat.show(id) ++ ",\"scope\":" ++ Nat.show(scope) ++ ",\"value\":" ++ Nat.show(value) ++ "}"

def tp_doc_join_branch(empty: Bool, prefix: String, rest: String) -> String:
  match empty:
    case True{}:
      prefix
    case False{}:
      prefix ++ "," ++ rest

def tp_doc_join(doc: TpDoc, +rest: String) -> String:
  tp_doc_join_branch(String.eq(rest, ""), tp_doc_json(doc), rest)

def tp_docs_inner(+docs: +List<TpDoc>) -> String:
  match docs:
    case Nil{}:
      ""
    case Con{h, t}:
      +rest = tp_docs_inner(t)
      tp_doc_join(h, rest)

def tp_retrieval_json(+retrieval: TpRetrieval) -> String:
  match retrieval:
    case TpRetrieval{docs, scanned, exhausted}:
      "{\"docs\":[" ++ tp_docs_inner(docs) ++ "],\"scanned\":" ++ Nat.show(scanned) ++ ",\"scan_exhausted\":" ++ tp_bool_json(exhausted) ++ "}"

def tp_report(run: TpRun, choice: TpChoice, +retrieval: TpRetrieval) -> String:
  "{\"schema\":\"telepathy.kernel/v4\",\"verdict_source\":\"host_supplied_unauthed\",\"events\":" ++ tp_run_json(run) ++ ",\"choice\":" ++ tp_choice_json(choice) ++ ",\"retrieval\":" ++ tp_retrieval_json(retrieval) ++ "}"

def tp_batch_parsed(events: Maybe<&2, +List<TpEvent>>, candidates: Maybe<&2, +List<TpCandidate>>, docs: Maybe<&2, +List<TpDoc>>, event_scan: Nat, candidate_scan: Nat, doc_scan: Nat, scope: Nat, k: Nat) -> IO(Unit):
  match events candidates docs:
    case Some{es} Some{cs} Some{ds}:
      IO.print(tp_report(tp_run(event_scan, es), tp_choose(candidate_scan, cs), tp_retrieve(doc_scan, ds, scope, k)))
    case _ _ _:
      IO.die(Unit, 2, "invalid batch rows: use canonical 0..65535 integers in complete records")

def tp_batch_payloads(ok: Bool, event_scan: Nat, candidate_scan: Nat, doc_scan: Nat, scope: Nat, k: Nat, events: String, candidates: String, docs: String) -> IO(Unit):
  match ok:
    case False{}:
      IO.die(Unit, 2, "batch block exceeds 4096 characters")
    case True{}:
      tp_batch_parsed(tp_parse_events(128n, tp_lines(events)), tp_parse_candidates(128n, tp_lines(candidates)), tp_parse_docs(128n, tp_lines(docs)), event_scan, candidate_scan, doc_scan, scope, k)

def tp_batch_limits(ok: Bool, event_scan: Nat, candidate_scan: Nat, doc_scan: Nat, scope: Nat, k: Nat, +events: String, +candidates: String, +docs: String) -> IO(Unit):
  match ok:
    case False{}:
      IO.die(Unit, 2, "scan limits and K must be in 0..128")
    case True{}:
      tp_batch_payloads(Nat.is_le(String.length(events), 4096n) && Nat.is_le(String.length(candidates), 4096n) && Nat.is_le(String.length(docs), 4096n), event_scan, candidate_scan, doc_scan, scope, k, events, candidates, docs)

def tp_batch_numbers(e: Maybe<&2, Nat>, c: Maybe<&2, Nat>, d: Maybe<&2, Nat>, s: Maybe<&2, Nat>, k: Maybe<&2, Nat>, events: String, candidates: String, docs: String) -> IO(Unit):
  match e c d s k:
    case Some{+event_scan} Some{+candidate_scan} Some{+doc_scan} Some{scope} Some{+top_k}:
      tp_batch_limits(Nat.is_le(event_scan, 128n) && Nat.is_le(candidate_scan, 128n) && Nat.is_le(doc_scan, 128n) && Nat.is_le(top_k, 128n), event_scan, candidate_scan, doc_scan, scope, top_k, events, candidates, docs)
    case _ _ _ _ _:
      IO.die(Unit, 2, "invalid numeric batch argument")

def tp_batch_command(is_batch: Bool, event_scan: String, candidate_scan: String, doc_scan: String, scope: String, k: String, events: String, candidates: String, docs: String) -> IO(Unit):
  match is_batch:
    case False{}:
      IO.die(Unit, 2, "usage: batch EVENT_SCAN CANDIDATE_SCAN DOC_SCAN AUTHORIZED_SCOPE K EVENTS CANDIDATES DOCS")
    case True{}:
      tp_batch_numbers(tp_nat(event_scan), tp_nat(candidate_scan), tp_nat(doc_scan), tp_nat(scope), tp_nat(k), events, candidates, docs)

# Fixed example is only a smoke fixture. The batch command is the executable
# entry point for varied inputs; benchmark verdicts belong to an external host.
def tp_demo() -> String:
  tp_report(
    tp_run(4n, [TpEvent{0n, 5n, 5n, True{}, HostSuccess{}}, TpEvent{1n, 7n, 3n, True{}, HostFailure{}}, TpEvent{3n, 9n, 9n, False{}, NoVerdict{}}]),
    tp_choose(3n, [TpCandidate{10n, True{}, 2n, 9n}, TpCandidate{11n, False{}, 5n, 99n}]),
    tp_retrieve(3n, [TpDoc{0n, 1n, 5n}, TpDoc{1n, 2n, 9n}, TpDoc{2n, 1n, 7n}], 1n, 2n)
  )

law quality_is_not_calibration:
  {tp_step(tp_init(), TpEvent{0n, 5n, 5n, True{}, HostFailure{}}) == TpState{1n, TpQuality{0n, 1n, 0n}, TpCalibration{1n, 0n, 0n}, 0n, 1n} : TpState}
def quality_is_not_calibration():
  {==}

law success_despite_calibration_mismatch:
  {tp_step(tp_init(), TpEvent{0n, 5n, 3n, True{}, HostSuccess{}}) == TpState{1n, TpQuality{1n, 0n, 0n}, TpCalibration{0n, 1n, 0n}, 0n, 1n} : TpState}
def success_despite_calibration_mismatch():
  {==}

law missing_verdict_is_unknown:
  {tp_step(tp_init(), TpEvent{0n, 5n, 5n, True{}, NoVerdict{}}) == TpState{1n, TpQuality{0n, 0n, 1n}, TpCalibration{1n, 0n, 0n}, 0n, 1n} : TpState}
def missing_verdict_is_unknown():
  {==}

law event_gap_reported:
  {tp_step(tp_init(), TpEvent{1n, 5n, 5n, True{}, HostSuccess{}}) == TpState{0n, TpQuality{0n, 0n, 0n}, TpCalibration{0n, 0n, 0n}, 1n, 0n} : TpState}
def event_gap_reported():
  {==}

law event_scan_exhausted:
  {tp_run(0n, [TpEvent{0n, 1n, 1n, True{}, HostSuccess{}}]) == TpRun{tp_init(), 0n, True{}} : TpRun}
def event_scan_exhausted():
  {==}

law chosen_fuel_decreases:
  {tp_choose(1n, [TpCandidate{7n, True{}, 2n, 9n}]) == TpChosen{7n, 1n, 9n, 1n, False{}} : TpChoice}
def chosen_fuel_decreases():
  {==}

law higher_estimate_wins_within_scan:
  {tp_choose(2n, [TpCandidate{7n, True{}, 2n, 1n}, TpCandidate{8n, True{}, 3n, 9n}]) == TpChosen{8n, 2n, 9n, 2n, False{}} : TpChoice}
def higher_estimate_wins_within_scan():
  {==}

law scan_cap_bounds_choice:
  {tp_choose(1n, [TpCandidate{7n, True{}, 2n, 1n}, TpCandidate{8n, True{}, 3n, 9n}]) == TpChosen{7n, 1n, 1n, 1n, True{}} : TpChoice}
def scan_cap_bounds_choice():
  {==}

law no_positive_estimate_abstains:
  {tp_choose(1n, [TpCandidate{7n, True{}, 2n, 0n}]) == TpNoChoice{1n, False{}} : TpChoice}
def no_positive_estimate_abstains():
  {==}

law candidate_scan_exhausted:
  {tp_choose(1n, [TpCandidate{7n, False{}, 3n, 9n}, TpCandidate{8n, True{}, 1n, 9n}]) == TpNoChoice{1n, True{}} : TpChoice}
def candidate_scan_exhausted():
  {==}

law scoped_record_retained:
  {tp_retrieve(2n, [TpDoc{7n, 2n, 10n}, TpDoc{7n, 1n, 20n}], 1n, 1n) == TpRetrieval{[TpDoc{7n, 1n, 20n}], 2n, False{}} : TpRetrieval}
def scoped_record_retained():
  {==}

law retrieval_scan_exhausted:
  {tp_retrieve(0n, [TpDoc{1n, 1n, 9n}], 1n, 1n) == TpRetrieval{[], 0n, True{}} : TpRetrieval}
def retrieval_scan_exhausted():
  {==}

# Task-scoped context diffusion. Node IDs have one meaning within a graph;
# the CLI rejects duplicates. This is a small pure fold of the former separate
# diffusion draft, not a second runtime or a source of authority.
type TpDEdge is Data:
  TpDEdge{src: Nat, dst: Nat, weight: Nat}

type TpDCell is Data:
  TpDCell{activation: Nat, id: Nat}

def tp_d_member(+x: Nat, +xs: +List<Nat>) -> Bool:
  match xs:
    case Nil{}:
      False{}
    case Con{h, t}:
      Nat.is_eq(x, h) || tp_d_member(x, t)

def tp_d_unique(+xs: +List<Nat>) -> Bool:
  match xs:
    case Nil{}:
      True{}
    case Con{h, t}:
      Bool.not(tp_d_member(h, t)) && tp_d_unique(t)

def tp_d_edges_valid(+edges: +List<TpDEdge>, +nodes: +List<Nat>) -> Bool:
  match edges:
    case Nil{}:
      True{}
    case Con{e, t}:
      match e:
        case TpDEdge{s, d, w}:
          Nat.is_le(w, 8n) && tp_d_member(s, nodes) && tp_d_member(d, nodes) && tp_d_edges_valid(t, nodes)

def tp_d_len(+xs: +List<Nat>) -> Nat:
  match xs:
    case Nil{}:
      0n
    case Con{h, t}:
      (1n + tp_d_len(t) : Nat)

def tp_d_zeros(n: Nat) -> +List<Nat>:
  match n:
    case 0n:
      []
    case 1n+p:
      0n <> tp_d_zeros(p)

def tp_d_index(+x: Nat, +xs: +List<Nat>, +i: Nat) -> Nat:
  match xs:
    case Nil{}:
      i
    case Con{h, t}:
      Bool.pick(Nat, Nat.is_eq(x, h), i, tp_d_index(x, t, (i + 1n : Nat)))

def tp_d_nth(+xs: +List<Nat>, i: Nat) -> Nat:
  match xs:
    case Nil{}:
      0n
    case Con{h, t}:
      match i:
        case 0n:
          h
        case 1n+p:
          tp_d_nth(t, p)

def tp_d_cap(+x: Nat) -> Nat:
  Bool.pick(Nat, Nat.is_le(x, 32n), x, 32n)

def tp_d_bump(+xs: +List<Nat>, i: Nat, amount: Nat) -> +List<Nat>:
  match xs:
    case Nil{}:
      []
    case Con{h, t}:
      match i:
        case 0n:
          tp_d_cap((h + amount : Nat)) <> t
        case 1n+p:
          h <> tp_d_bump(t, p, amount)

def tp_d_seed_go(+anchors: +List<Nat>, +nodes: +List<Nat>, +scope: +List<Nat>, +scores: +List<Nat>) -> +List<Nat>:
  match anchors:
    case Nil{}:
      scores
    case Con{a, t}:
      +next = Bool.pick(+List<Nat>, tp_d_member(a, nodes) && tp_d_member(a, scope),
        tp_d_bump(scores, tp_d_index(a, nodes, 0n), 8n), scores)
      tp_d_seed_go(t, nodes, scope, next)

def tp_d_seed(+nodes: +List<Nat>, +anchors: +List<Nat>, +scope: +List<Nat>) -> +List<Nat>:
  tp_d_seed_go(anchors, nodes, scope, tp_d_zeros(tp_d_len(nodes)))

# Integer fixed point: floor(floor(activation * weight / 8) * 4 / 8).
def tp_d_hop(activation: Nat, weight: Nat) -> Nat:
  (((((activation * weight : Nat) / 8n : Nat) * 4n : Nat) / 8n : Nat))

def tp_d_edge_into(+edge: TpDEdge, +nodes: +List<Nat>, +scope: +List<Nat>, +old: +List<Nat>, +next: +List<Nat>) -> +List<Nat>:
  match edge:
    case TpDEdge{s, d, w}:
      Bool.pick(+List<Nat>, tp_d_member(s, scope) && tp_d_member(d, scope),
        tp_d_bump(next, tp_d_index(d, nodes, 0n), tp_d_hop(tp_d_nth(old, tp_d_index(s, nodes, 0n)), w)),
        next)

def tp_d_fold_edges(+edges: +List<TpDEdge>, +nodes: +List<Nat>, +scope: +List<Nat>, +old: +List<Nat>, +next: +List<Nat>) -> +List<Nat>:
  match edges:
    case Nil{}:
      next
    case Con{e, t}:
      tp_d_fold_edges(t, nodes, scope, old, tp_d_edge_into(e, nodes, scope, old, next))

def tp_d_before(+a: Nat, +id: Nat, +b: Nat, other: Nat) -> Bool:
  Nat.is_gt(a, b) || (Nat.is_eq(a, b) && Nat.is_lt(id, other))

def tp_d_insert(+cell: TpDCell, +sorted: +List<TpDCell>) -> +List<TpDCell>:
  match cell sorted:
    case TpDCell{a, id} Nil{}:
      [TpDCell{a, id}]
    case TpDCell{a, id} Con{h, t}:
      match h:
        case TpDCell{b, other}:
          Bool.pick(+List<TpDCell>, tp_d_before(a, id, b, other),
            TpDCell{a, id} <> (TpDCell{b, other} <> t),
            TpDCell{b, other} <> tp_d_insert(TpDCell{a, id}, t))

def tp_d_cells(+nodes: +List<Nat>, +scores: +List<Nat>, +scope: +List<Nat>) -> +List<TpDCell>:
  match nodes scores:
    case Nil{} _:
      []
    case Con{id, nt} Nil{}:
      []
    case Con{id, nt} Con{score, st}:
      +tail = tp_d_cells(nt, st, scope)
      Bool.pick(+List<TpDCell>, Nat.is_gt(score, 0n) && tp_d_member(id, scope),
        TpDCell{score, id} <> tail, tail)

def tp_d_sort(+cells: +List<TpDCell>, +sorted: +List<TpDCell>) -> +List<TpDCell>:
  match cells:
    case Nil{}:
      sorted
    case Con{h, t}:
      tp_d_sort(t, tp_d_insert(h, sorted))

def tp_d_take(k: Nat, +cells: +List<TpDCell>) -> +List<TpDCell>:
  match k cells:
    case 0n _:
      []
    case _ Nil{}:
      []
    case 1n+p Con{h, t}:
      h <> tp_d_take(p, t)

def tp_d_set_cells(+cells: +List<TpDCell>, +nodes: +List<Nat>, +scores: +List<Nat>) -> +List<Nat>:
  match cells:
    case Nil{}:
      scores
    case Con{h, t}:
      match h:
        case TpDCell{a, id}:
          tp_d_set_cells(t, nodes, tp_d_bump(scores, tp_d_index(id, nodes, 0n), a))

def tp_d_round(+nodes: +List<Nat>, +edges: +List<TpDEdge>, +scope: +List<Nat>, +old: +List<Nat>, budget: Nat) -> +List<Nat>:
  +next = tp_d_fold_edges(edges, nodes, scope, old, tp_d_zeros(tp_d_len(nodes)))
  tp_d_set_cells(tp_d_take(budget, tp_d_sort(tp_d_cells(nodes, next, scope), [])), nodes, tp_d_zeros(tp_d_len(nodes)))

def tp_d_drive(steps: Nat, +nodes: +List<Nat>, +edges: +List<TpDEdge>, +scope: +List<Nat>, +scores: +List<Nat>, +budget: Nat) -> +List<Nat>:
  match steps:
    case 0n:
      scores
    case 1n+p:
      tp_d_drive(p, nodes, edges, scope, tp_d_round(nodes, edges, scope, scores, budget), budget)

def tp_d_context(+nodes: +List<Nat>, +edges: +List<TpDEdge>, +anchors: +List<Nat>, +scope: +List<Nat>, steps: Nat, +budget: Nat, k: Nat) -> +List<TpDCell>:
  +seed = tp_d_seed(nodes, anchors, scope)
  +final = tp_d_drive(steps, nodes, edges, scope, seed, budget)
  tp_d_take(k, tp_d_take(budget, tp_d_sort(tp_d_cells(nodes, final, scope), [])))

def tp_d_nat_cons(head: Maybe<&2, Nat>, tail: Maybe<&2, +List<Nat>>) -> Maybe<&2, +List<Nat>>:
  match head tail:
    case Some{h} Some{t}:
      Some{h <> t}
    case _ _:
      None{}

def tp_d_edge_cons(head: Maybe<&2, TpDEdge>, tail: Maybe<&2, +List<TpDEdge>>) -> Maybe<&2, +List<TpDEdge>>:
  match head tail:
    case Some{h} Some{t}:
      Some{h <> t}
    case _ _:
      None{}

def tp_d_edge(s: Maybe<&2, Nat>, d: Maybe<&2, Nat>, w: Maybe<&2, Nat>) -> Maybe<&2, TpDEdge>:
  match s d w:
    case Some{src} Some{dst} Some{weight}:
      Some{TpDEdge{src, dst, weight}}
    case _ _ _:
      None{}

def tp_d_parse_nats(rows: Nat, +lines: +List<String>) -> Maybe<&2, +List<Nat>>:
  match rows lines:
    case _ Nil{}:
      Some{[]}
    case 0n _:
      None{}
    case 1n+p Con{h, t}:
      tp_d_nat_cons(tp_nat(h), tp_d_parse_nats(p, t))

def tp_d_parse_edges(rows: Nat, +lines: +List<String>) -> Maybe<&2, +List<TpDEdge>>:
  match rows lines:
    case _ Nil{}:
      Some{[]}
    case 0n _:
      None{}
    case 1n+p Con{s, Con{d, Con{w, t}}}:
      tp_d_edge_cons(tp_d_edge(tp_nat(s), tp_nat(d), tp_nat(w)), tp_d_parse_edges(p, t))
    case _ _:
      None{}

def tp_d_cell_json(cell: TpDCell) -> String:
  match cell:
    case TpDCell{a, id}:
      "{\"id\":" ++ Nat.show(id) ++ ",\"activation\":" ++ Nat.show(a) ++ "}"

def tp_d_cell_join(cell: TpDCell, rest: String) -> String:
  match rest:
    case SNil{}:
      tp_d_cell_json(cell)
    case _:
      tp_d_cell_json(cell) ++ "," ++ rest

def tp_d_cells_json(+cells: +List<TpDCell>) -> String:
  match cells:
    case Nil{}:
      ""
    case Con{h, t}:
      tp_d_cell_join(h, tp_d_cells_json(t))

def tp_d_result(+cells: +List<TpDCell>, steps: Nat, budget: Nat) -> String:
  "{\"schema\":\"telepathy.diffusion/v1\",\"scope_source\":\"host_supplied_unauthed\",\"steps\":" ++ Nat.show(steps) ++ ",\"budget\":" ++ Nat.show(budget) ++ ",\"context\":[" ++ tp_d_cells_json(cells) ++ "]}"

def tp_d_valid_branch(ok: Bool, +nodes: +List<Nat>, +edges: +List<TpDEdge>, +anchors: +List<Nat>, +scope: +List<Nat>, +steps: Nat, +budget: Nat, k: Nat) -> IO(Unit):
  match ok:
    case True{}:
      IO.print(tp_d_result(tp_d_context(nodes, edges, anchors, scope, steps, budget, k), steps, budget))
    case False{}:
      IO.die(Unit, 2, "invalid diffusion graph: duplicate node id, unknown endpoint, or weight above 8")

def tp_d_parsed(n: Maybe<&2, +List<Nat>>, e: Maybe<&2, +List<TpDEdge>>, a: Maybe<&2, +List<Nat>>, s: Maybe<&2, +List<Nat>>, steps: Nat, budget: Nat, k: Nat) -> IO(Unit):
  match n e a s:
    case Some{+nodes} Some{+edges} Some{anchors} Some{scope}:
      tp_d_valid_branch(tp_d_unique(nodes) && tp_d_edges_valid(edges, nodes), nodes, edges, anchors, scope, steps, budget, k)
    case _ _ _ _:
      IO.die(Unit, 2, "invalid diffusion rows: use canonical 0..65535 integers in complete records")

def tp_d_blocks(ok: Bool, steps: Nat, budget: Nat, k: Nat, nodes: String, edges: String, anchors: String, scope: String) -> IO(Unit):
  match ok:
    case False{}:
      IO.die(Unit, 2, "diffusion block exceeds 4096 characters")
    case True{}:
      tp_d_parsed(tp_d_parse_nats(128n, tp_lines(nodes)), tp_d_parse_edges(128n, tp_lines(edges)), tp_d_parse_nats(128n, tp_lines(anchors)), tp_d_parse_nats(128n, tp_lines(scope)), steps, budget, k)

def tp_d_limits(ok: Bool, steps: Nat, budget: Nat, k: Nat, +nodes: String, +edges: String, +anchors: String, +scope: String) -> IO(Unit):
  match ok:
    case False{}:
      IO.die(Unit, 2, "diffusion steps must be 0..16 and budget/K 0..128")
    case True{}:
      tp_d_blocks(Nat.is_le(String.length(nodes), 4096n) && Nat.is_le(String.length(edges), 4096n) && Nat.is_le(String.length(anchors), 4096n) && Nat.is_le(String.length(scope), 4096n), steps, budget, k, nodes, edges, anchors, scope)

def tp_d_numbers(steps: Maybe<&2, Nat>, budget: Maybe<&2, Nat>, k: Maybe<&2, Nat>, nodes: String, edges: String, anchors: String, scope: String) -> IO(Unit):
  match steps budget k:
    case Some{+rounds} Some{+width} Some{+count}:
      tp_d_limits(Nat.is_le(rounds, 16n) && Nat.is_le(width, 128n) && Nat.is_le(count, 128n), rounds, width, count, nodes, edges, anchors, scope)
    case _ _ _:
      IO.die(Unit, 2, "invalid numeric diffusion argument")

def tp_d_command(ok: Bool, steps: String, budget: String, k: String, nodes: String, edges: String, anchors: String, scope: String) -> IO(Unit):
  match ok:
    case True{}:
      tp_d_numbers(tp_nat(steps), tp_nat(budget), tp_nat(k), nodes, edges, anchors, scope)
    case False{}:
      IO.die(Unit, 2, "usage: diffuse STEPS BUDGET K NODES EDGES ANCHORS AUTHORIZED_SCOPE_IDS")

law diffusion_blocks_out_of_scope_hub:
  {tp_d_context([0n, 1n, 2n, 3n], [TpDEdge{0n, 1n, 8n}, TpDEdge{1n, 3n, 8n}, TpDEdge{0n, 2n, 8n}, TpDEdge{2n, 1n, 8n}], [0n], [0n, 1n, 3n], 2n, 2n, 2n) == tp_d_context([0n, 1n, 3n], [TpDEdge{0n, 1n, 8n}, TpDEdge{1n, 3n, 8n}], [0n], [0n, 1n, 3n], 2n, 2n, 2n) : +List<TpDCell>}
def diffusion_blocks_out_of_scope_hub():
  {==}

law diffusion_scoped_chain_score:
  {tp_d_context([0n, 1n, 3n], [TpDEdge{0n, 1n, 8n}, TpDEdge{1n, 3n, 8n}], [0n], [0n, 1n, 3n], 2n, 2n, 2n) == [TpDCell{2n, 3n}] : +List<TpDCell>}
def diffusion_scoped_chain_score():
  {==}

law diffusion_tie_breaks_by_id:
  {tp_d_context([3n, 2n, 1n], [TpDEdge{1n, 3n, 8n}, TpDEdge{1n, 2n, 8n}], [1n], [1n, 2n, 3n], 1n, 2n, 2n) == [TpDCell{4n, 2n}, TpDCell{4n, 3n}] : +List<TpDCell>}
def diffusion_tie_breaks_by_id():
  {==}

def tp_main(args: List<String>) -> IO(Unit):
  match args:
    case Nil{}:
      IO.print(tp_demo())
    case Con{command, Con{event_scan, Con{candidate_scan, Con{doc_scan, Con{scope, Con{k, Con{events, Con{candidates, Con{docs, Nil{}}}}}}}}}}:
      tp_batch_command(String.eq(command, "batch"), event_scan, candidate_scan, doc_scan, scope, k, events, candidates, docs)
    case Con{command, Con{steps, Con{budget, Con{k, Con{nodes, Con{edges, Con{anchors, Con{scope, Nil{}}}}}}}}}:
      tp_d_command(String.eq(command, "diffuse"), steps, budget, k, nodes, edges, anchors, scope)
    case _:
      IO.die(Unit, 2, "usage: batch EVENT_SCAN CANDIDATE_SCAN DOC_SCAN AUTHORIZED_SCOPE K EVENTS CANDIDATES DOCS | diffuse STEPS BUDGET K NODES EDGES ANCHORS AUTHORIZED_SCOPE_IDS")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    tp_main(args)
