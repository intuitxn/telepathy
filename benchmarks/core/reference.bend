import Base

# A small executable contract fixture for the independent benchmark runner.
# This is not the production kernel or an evaluator. Its laws cover only the
# statements below; the runner compares process output with external cases.

type State is Data:
  State{clock: Nat, value: Nat}

type Doc is Data:
  Doc{id: Nat, lexical: Nat, heat: Nat, allowed: Bool}

type Ranking is Data:
  Ranking{id: Nat, top: Nat, second: Nat}

def advance(s: State, delta: Nat) -> State:
  match s:
    case State{clock, value}:
      State{Nat.add(clock, 1n), Nat.add(value, delta)}

def replay(fuel: Nat, +s: State, +events: +List<Nat>) -> State:
  match fuel:
    case 0n:
      s
    case 1n+left:
      match events:
        case Nil{}:
          s
        case Con{delta, rest}:
          replay(left, advance(s, delta), rest)

def repeat_steps(fuel: Nat, +s: State) -> State:
  match fuel:
    case 0n:
      s
    case 1n+left:
      repeat_steps(left, advance(s, 3n))

def state_line(s: State) -> String:
  match s:
    case State{clock, value}:
      "clock=" ++ Nat.show(clock) ++ ";value=" ++ Nat.show(value)

def forecast(value: Nat, action: Nat) -> Nat:
  Nat.add(value, action)

def observed(prediction: Nat, disturbance: Nat) -> Nat:
  Nat.sub(prediction, disturbance)

def prediction_line(value: Nat, action: Nat, disturbance: Nat) -> String:
  +p = forecast(value, action)
  +o = observed(p, disturbance)
  "predicted=" ++ Nat.show(p) ++ ";observed=" ++ Nat.show(o) ++ ";error=" ++ Nat.show(Nat.sub(p, o))

def consider_branch(allowed: Bool, +id: Nat, +lexical: Nat, +heat: Nat, +best: Nat, +top: Nat, +second: Nat, +use_heat: Bool) -> Ranking:
  match allowed:
    case False{}:
      Ranking{best, top, second}
    case True{}:
      +score = Bool.pick(Nat, use_heat, Nat.add(lexical, heat), lexical)
      Bool.pick(Ranking, Nat.is_gt(score, top),
        Ranking{id, score, top},
        Bool.pick(Ranking, Nat.is_gt(score, second),
          Ranking{best, top, score}, Ranking{best, top, second}))

def consider(d: Doc, r: Ranking, use_heat: Bool) -> Ranking:
  match d r:
    case Doc{id, lexical, heat, allowed} Ranking{best, top, second}:
      consider_branch(allowed, id, lexical, heat, best, top, second, use_heat)

def rank(+docs: +List<Doc>, +use_heat: Bool, +r: Ranking) -> Ranking:
  match docs:
    case Nil{}:
      r
    case Con{d, rest}:
      rank(rest, use_heat, consider(d, r, use_heat))

def docs(hot_outside: Bool) -> +List<Doc>:
  [Doc{0n, 5n, 2n, True{}},
   Doc{1n, 1n, Bool.pick(Nat, hot_outside, 100n, 9n), False{}},
   Doc{2n, 3n, 5n, True{}}]

def tied_docs() -> +List<Doc>:
  [Doc{0n, 5n, 3n, True{}}, Doc{2n, 3n, 5n, True{}}]

def verdict(r: Ranking, threshold: Nat, min_margin: Nat) -> String:
  match r:
    case Ranking{id, +top, second}:
      +margin = Nat.sub(top, second)
      Bool.pick(String, Nat.is_lt(top, threshold),
        "abstain=threshold;score=" ++ Nat.show(top),
        Bool.pick(String, Nat.is_lt(margin, min_margin),
          "abstain=margin;score=" ++ Nat.show(top),
          "answer=" ++ Nat.show(id) ++ ";score=" ++ Nat.show(top) ++ ";margin=" ++ Nat.show(margin)))

def retrieval(hot_outside: Bool, use_heat: Bool, threshold: Nat) -> String:
  verdict(rank(docs(hot_outside), use_heat, Ranking{999n, 0n, 0n}), threshold, 1n)

def tie_retrieval() -> String:
  verdict(rank(tied_docs(), True{}, Ranking{999n, 0n, 0n}), 7n, 1n)

law zero_fuel_keeps_state:
  for +s: State
  for +events: +List<Nat>
  {replay(0n, s, events) == s : State}

def zero_fuel_keeps_state(s, events):
  {==}

law outside_score_cannot_change_route:
  {retrieval(False{}, True{}, 7n) == retrieval(True{}, True{}, 7n) : String}

def outside_score_cannot_change_route():
  {==}

law repeated_steps_advance_clock:
  {repeat_steps(3n, State{0n, 0n}) == State{3n, 9n} : State}

def repeated_steps_advance_clock():
  {==}

def predict_parsed(a: Maybe<&2, Nat>, b: Maybe<&2, Nat>, c: Maybe<&2, Nat>) -> IO(Unit):
  match a b c:
    case Some{x} Some{y} Some{z}:
      IO.print(prediction_line(x, y, z))
    case _ _ _:
      IO.die(Unit, 2, "invalid predict numbers")

def predict_cmd(rest: List<String>) -> IO(Unit):
  match rest:
    case Con{a, Con{b, Con{c, Nil{}}}}:
      predict_parsed(Nat.read(a), Nat.read(b), Nat.read(c))
    case _:
      IO.die(Unit, 2, "predict VALUE ACTION DISTURBANCE")

def replay_parsed(fuel: Maybe<&2, Nat>, a: Maybe<&2, Nat>, b: Maybe<&2, Nat>, c: Maybe<&2, Nat>) -> IO(Unit):
  match fuel a b c:
    case Some{f} Some{x} Some{y} Some{z}:
      IO.print(state_line(replay(f, State{0n, 0n}, [x, y, z])))
    case _ _ _ _:
      IO.die(Unit, 2, "invalid replay numbers")

def replay_cmd(rest: List<String>) -> IO(Unit):
  match rest:
    case Con{fuel, Con{a, Con{b, Con{c, Nil{}}}}}:
      replay_parsed(Nat.read(fuel), Nat.read(a), Nat.read(b), Nat.read(c))
    case _:
      IO.die(Unit, 2, "replay FUEL EVENT1 EVENT2 EVENT3")

def retrieve_cmd(rest: List<String>) -> IO(Unit):
  match rest:
    case Con{+mode, Nil{}}:
      IO.print(Bool.pick(String, String.eq(mode, "baseline"), retrieval(False{}, False{}, 4n),
        Bool.pick(String, String.eq(mode, "scoped"), retrieval(False{}, True{}, 7n),
          Bool.pick(String, String.eq(mode, "outside-hot"), retrieval(True{}, True{}, 7n),
            Bool.pick(String, String.eq(mode, "abstain-threshold"), retrieval(False{}, True{}, 9n),
              Bool.pick(String, String.eq(mode, "abstain-margin"), tie_retrieval(), "unknown mode"))))))
    case _:
      IO.die(Unit, 2, "retrieve MODE")

def batch_parsed(count: Maybe<&2, Nat>) -> IO(Unit):
  match count:
    case Some{n}:
      IO.print(state_line(repeat_steps(n, State{0n, 0n})))
    case None{}:
      IO.die(Unit, 2, "invalid batch count")

def batch_cmd(rest: List<String>) -> IO(Unit):
  match rest:
    case Con{count, Nil{}}:
      batch_parsed(Nat.read(count))
    case _:
      IO.die(Unit, 2, "batch COUNT")

def dispatch_fail(is_fail: Bool, rest: List<String>) -> IO(Unit):
  match is_fail:
    case True{}:
      do IO<Unit>:
        IO.print("PASS")
        IO.die(Unit, 7, "intentional failure")
    case False{}:
      IO.die(Unit, 2, "unknown command")

def dispatch_batch(is_batch: Bool, +command: String, rest: List<String>) -> IO(Unit):
  match is_batch:
    case True{}:
      batch_cmd(rest)
    case False{}:
      dispatch_fail(String.eq(command, "fail"), rest)

def dispatch_retrieve(is_retrieve: Bool, +command: String, rest: List<String>) -> IO(Unit):
  match is_retrieve:
    case True{}:
      retrieve_cmd(rest)
    case False{}:
      dispatch_batch(String.eq(command, "batch"), command, rest)

def dispatch_replay(is_replay: Bool, +command: String, rest: List<String>) -> IO(Unit):
  match is_replay:
    case True{}:
      replay_cmd(rest)
    case False{}:
      dispatch_retrieve(String.eq(command, "retrieve"), command, rest)

def dispatch_predict(is_predict: Bool, +command: String, rest: List<String>) -> IO(Unit):
  match is_predict:
    case True{}:
      predict_cmd(rest)
    case False{}:
      dispatch_replay(String.eq(command, "replay"), command, rest)

def dispatch_args(args: List<String>) -> IO(Unit):
  match args:
    case Con{+command, rest}:
      dispatch_predict(String.eq(command, "predict"), command, rest)
    case Nil{}:
      IO.die(Unit, 2, "expected command")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    dispatch_args(args)
