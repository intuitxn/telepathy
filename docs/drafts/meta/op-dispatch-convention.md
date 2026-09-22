# Ops as Bend — one file per work

An op is **one Bend file**. Reuse comes from `import`, not from a framework.

## The file

```text
runtime/ops/<name>.bend
  import Base
  import ./lib/<piece>.bend as Piece   # shared types/laws, imported like retrieval does
  type Input  is Data: ...             # declared input system
  type Output is Data: ...             # declared output
  def run(input: Input) -> Output: ... # the operation
  law  <name>: {claim : Type}          # checkable property
  def  <name>(...) ...                 # proof, same name as the law
  def main() -> IO(Unit): ...          # one fixture, print only
```

Reuse is `import ./lib/x.bend as X` (`runtime/programs/retrieval/PROOF.bend:2-5`). Adding a shared type or law = adding an imported file, not editing a registry.

## Run

```sh
bend runtime/ops/<name>.bend --check-only   # gate the laws
bend runtime/ops/<name>.bend                # run the fixture
```

That is the whole dispatch. No registry dict, no driver contract, no daemon.

## Discover

Glob `runtime/ops/*.bend` — the same way skills are found by `**/SKILL.md`. A capability is a file; nothing to register.

## Effects

Bend is pure: it cannot spawn, reach the network, hash or hold identity. The shell does those, exactly as `ops/loops/*.sh` already do. If you want isolation, one worktree per op is a shell one-liner (`git worktree add`), not a contract.

## Boundary

An op never accepts, merges, pushes, publishes or resolves. A green checker is not acceptance and not a verified bundle.

---

Verified: `runtime/ops/fold.bend` → `bend ... --check-only` gives `All terms check.`; bare run gives `fixture 14` / `fixture_max 5`; a mutated `ident(Max{})` fails at `fold_chunk_max`.
