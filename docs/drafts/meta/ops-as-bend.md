# Ops as Bend

An op is one Bend file. Reuse comes from `import`, not a framework.

## The file

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

## Run

```sh
bend runtime/ops/<name>.bend --check-only   # gate the laws
bend runtime/ops/<name>.bend                # run the fixture
```

Discover by globbing `runtime/ops/*.bend` — the way skills are found by `**/SKILL.md`. No registry, driver or daemon.

## Why Bend

Typed, so one meaning; laws are compiler-checked before execution; and a monoid-homomorphism law (`fold(xs ++ ys) == apply(fold xs, fold ys)`) proves the work can be split and combined in parallel. Bend owns the pure decision; effects (worktree, subprocess, network, identity) stay in the shell.

## Boundary

An op never accepts, merges, pushes, publishes or resolves. A green checker is not acceptance and not a verified bundle.

Worked example: `runtime/ops/fold.bend` — `--check-only` → `All terms check.`; bare run → `fixture 14` / `fixture_max 5`.
