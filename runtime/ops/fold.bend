import Base

# ---- fold.bend: a reusable associative reduction over Nat lists -----------
#
# Typed contract
#   type Op is Data: Add{} | Max{}   -- names an associative binary operation
#   apply(op, a, b) -> Nat           -- the operation
#   ident(op) -> Nat                 -- its two-sided identity
#   fold(op, xs) -> Nat              -- reduce a +List<Nat> to one summary
#   FoldInput{op, values}            -- typed input; run(input) -> Nat is the
#                                       input -> output contract exercised in main
#
# Named laws the compiler checks (each proven by the def of the same name):
#   fold_identity   fold over the empty list is the identity element
#   fold_singleton  fold over a one-element list is that element
#   fold_chunk      fold over a concatenation is the operation applied to the
#                   two component folds (associativity makes this well-defined)
# Supporting algebra the fold laws lean on, also named and proven:
#   add_assoc, add_zero_r, max_assoc, max_zero_r
#
# Everything here is total and pure. The only IO is main's print; there is no
# network, no subprocess, no credential, and no file write. Bend owns only this
# pure decision over handed-in values; hashing, storage and identity stay in
# the shell (agit-in-bend §7). Adding a new operation means extending `Op` and
# proving its associativity and identity law, not weakening these laws.

# --- operation vocabulary --------------------------------------------------

type Op is Data:
  Add{}
  Max{}

def apply(op: Op, a: Nat, b: Nat) -> Nat:
  match op:
    case Add{}:
      Nat.add(a, b)
    case Max{}:
      Nat.max(a, b)

def ident(op: Op) -> Nat:
  match op:
    case Add{}:
      0n
    case Max{}:
      0n

# --- the reusable reduction ------------------------------------------------

def fold(+op: Op, +xs: +List<Nat>) -> Nat:
  match xs:
    case Nil{}:
      ident(op)
    case Con{h, t}:
      apply(op, h, fold(op, t))

# list concatenation: the monoid the fold is a homomorphism *from*
def append(+xs: +List<Nat>, +ys: +List<Nat>) -> +List<Nat>:
  match xs:
    case Nil{}:
      ys
    case Con{h, t}:
      h <> append(t, ys)

# --- typed input -> output contract and one fixed fixture ------------------

type FoldInput is Data:
  FoldInput{op: Op, values: +List<Nat>}

def run(input: FoldInput) -> Nat:
  match input:
    case FoldInput{op, values}:
      fold(op, values)

def demo() -> FoldInput:
  FoldInput{Add{}, [3n, 1n, 4n, 1n, 5n]}

def demo_max() -> FoldInput:
  FoldInput{Max{}, [3n, 1n, 4n, 1n, 5n]}

# --- supporting algebra (named laws, each proven) --------------------------

law add_assoc:
  for +a: Nat
  for +b: Nat
  for +c: Nat
  {Nat.add(Nat.add(a, b), c) == Nat.add(a, Nat.add(b, c)) : Nat}

def add_assoc(a, b, c):
  match a:
    case 0n:
      {==}
    case 1n+p:
      %add_assoc(p, b, c) : {1n+Nat.add(Nat.add(p, b), c) == 1n+_ : Nat}
      {==}

law add_zero_r:
  for +a: Nat
  {Nat.add(a, 0n) == a : Nat}

def add_zero_r(a):
  match a:
    case 0n:
      {==}
    case 1n+p:
      %add_zero_r(p) : {1n+Nat.add(p, 0n) == 1n+_ : Nat}
      {==}

law max_zero_r:
  for +a: Nat
  {Nat.max(a, 0n) == a : Nat}

def max_zero_r(a):
  match a:
    case 0n:
      {==}
    case 1n+p:
      {==}

law max_assoc:
  for +a: Nat
  for +b: Nat
  for +c: Nat
  {Nat.max(Nat.max(a, b), c) == Nat.max(a, Nat.max(b, c)) : Nat}

def max_assoc(a, b, c):
  match a b c:
    case 0n _ _:
      {==}
    case 1n+ap 0n _:
      {==}
    case 1n+ap 1n+bp 0n:
      max_zero_r(1n+Nat.max(ap, bp))
    case 1n+ap 1n+bp 1n+cp:
      %max_assoc(ap, bp, cp) : {1n+Nat.max(Nat.max(ap, bp), cp) == 1n+_ : Nat}
      {==}

# --- monoid-homomorphism laws, one induction per registered operation ------

def fold_chunk_add(+xs: +List<Nat>, +ys: +List<Nat>) -> {fold(Add{}, append(xs, ys)) == apply(Add{}, fold(Add{}, xs), fold(Add{}, ys)) : Nat}:
  match xs:
    case Nil{}:
      {==}
    case Con{h, t}:
      %Equal.sym(Nat, fold(Add{}, append(t, ys)), Nat.add(fold(Add{}, t), fold(Add{}, ys)), fold_chunk_add(t, ys)) : {Nat.add(h, _) == Nat.add(Nat.add(h, fold(Add{}, t)), fold(Add{}, ys)) : Nat}
      Equal.sym(Nat, Nat.add(Nat.add(h, fold(Add{}, t)), fold(Add{}, ys)), Nat.add(h, Nat.add(fold(Add{}, t), fold(Add{}, ys))), add_assoc(h, fold(Add{}, t), fold(Add{}, ys)))

def fold_chunk_max(+xs: +List<Nat>, +ys: +List<Nat>) -> {fold(Max{}, append(xs, ys)) == apply(Max{}, fold(Max{}, xs), fold(Max{}, ys)) : Nat}:
  match xs:
    case Nil{}:
      {==}
    case Con{h, t}:
      %Equal.sym(Nat, fold(Max{}, append(t, ys)), Nat.max(fold(Max{}, t), fold(Max{}, ys)), fold_chunk_max(t, ys)) : {Nat.max(h, _) == Nat.max(Nat.max(h, fold(Max{}, t)), fold(Max{}, ys)) : Nat}
      Equal.sym(Nat, Nat.max(Nat.max(h, fold(Max{}, t)), fold(Max{}, ys)), Nat.max(h, Nat.max(fold(Max{}, t), fold(Max{}, ys))), max_assoc(h, fold(Max{}, t), fold(Max{}, ys)))

law fold_identity:
  for +op: Op
  {fold(op, Nil{}) == ident(op) : Nat}

def fold_identity(op):
  {==}

law fold_singleton:
  for +op: Op
  for +x: Nat
  {fold(op, [x]) == x : Nat}

def fold_singleton(op, x):
  match op:
    case Add{}:
      add_zero_r(x)
    case Max{}:
      max_zero_r(x)

law fold_chunk:
  for +op: Op
  for +xs: +List<Nat>
  for +ys: +List<Nat>
  {fold(op, append(xs, ys)) == apply(op, fold(op, xs), fold(op, ys)) : Nat}

def fold_chunk(op, xs, ys):
  match op:
    case Add{}:
      fold_chunk_add(xs, ys)
    case Max{}:
      fold_chunk_max(xs, ys)

# --- fixture driver --------------------------------------------------------

def main() -> IO(Unit):
  do IO<Unit>:
    IO.print("fixture " ++ Nat.show(run(demo())))
    IO.print("fixture_max " ++ Nat.show(run(demo_max())))
