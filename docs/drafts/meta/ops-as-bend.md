# Ops as Bend

An op is one Bend file: a total, pure function from a declared typed input to a declared typed output, with named compiler-checked laws.

```text
runtime/ops/<name>.bend
  import Base
  import ./lib/<piece>.bend as Piece    # shared types/laws, when a second op needs them
  type Input  is Data: ...              # declared input system
  type Output is Data: ...              # declared output
  def run(input: Input) -> Output: ...  # the operation
  law  <name>: {claim : Type}           # checkable property
  def  <name>(...) ...                  # proof, same name as the law
  def main() -> IO(Unit): ...           # one fixture, print only
```

Why Bend over a string-of-text procedure: it is typed, so one meaning; its laws are compiler-checked before execution; and a monoid-homomorphism law (`fold(xs ++ ys) == apply(fold xs, fold ys)`) is a proof the work can be split and combined in parallel. Bend owns the pure decision only — effects stay in the shell.

Worked example: `runtime/ops/fold.bend`.
