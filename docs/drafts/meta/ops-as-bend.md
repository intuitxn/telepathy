# DRAFT — ops as Bend: procedures as executable kernels, not strings of text

Status: draft, agent-authored · Updated: 2026-09-22 · **Not published, not sent,
not committed.** No external effect, no publication authority. Written for review.

Request under execution: *"procedure as bend because it's more computation native
and has better properties than string of text"*, in the context of designing
**ops** as reusable executable operations — one file per work, analogous to Bend
kernels — so that parallel agents can run isolated units over any input system.

Owner/reviewer: Shubham. Coordinator: `@meta` (single writer of one private
snapshot lineage). Worker: a `bend-forge` subagent. This draft is the
coordinator's synthesis; the op file is the worker's returned artifact.

## 1. Definition

An **op** is one self-contained Bend file that is a total, pure function from a
declared typed input to a declared typed output, carrying its own named laws. It
is executed by the Bend compiler/runtime; it is not interpreted as prose.

```text
op file
  import Base
  type Input  is Data: ...        # declared input system
  type Output is Data: ...        # declared output
  def run(input: Input) -> Output # the operation
  law  <name>: {claim : Type}     # checkable property
  def  <name>(...) ...            # proof, same name as the law
  def main() -> IO(Unit)          # one fixture, print only
```

Invocation is uniform: `bend <op>.bend --check-only` gates the laws; the bare
file form runs `main` on a fixture. No DSL, VM, scheduler or model compiler is
introduced.

## 2. Why Bend over a string-of-text procedure

| Property | String-of-text procedure | Bend op |
|---|---|---|
| Semantics | ambiguous prose; each agent re-interprets | typed `Input -> Output`, one meaning |
| Checkability | none; "looks right" | compiler-checked named laws (`All terms check.`) |
| Failure mode | silently plausible | type/law failure at `--check-only`, before execution |
| Composition | copy/paste and edit | `append`/`fold` homomorphism laws; referential transparency |
| Parallelism | shared text, implicit ordering | pure function: chunk the input, fold partials, combine |
| Provenance | who edited which sentence | source digest + law set + checker output |
| Non-vacuity | n/a | a falsified law is rejected (negative fixture) |

The claim is narrow and honest: Bend owns the **pure decision over handed-in
values**. It cannot spawn processes, reach the network (beyond raw loopback),
create directories, or hash. Those effects stay in the host (see
[`one-file-bend-command.md`](one-file-bend-command.md), HARNESS.md §"What the
system should build toward").

## 3. Isolation and parallel execution model

- **One op = one file.** Adding a capability means adding a file, not editing a
  shared procedure. No shared mutable state exists between ops.
- **Isolation.** Each op runs in its own Bend process over its own input. The
  input system is a typed value; the op cannot observe another op's state.
- **Parallelism.** Because `fold` is a monoid homomorphism
  (`fold(xs ++ ys) == apply(fold xs, fold ys)`), a coordinator may split an input
  into chunks, run each chunk as an isolated unit, and combine the partial
  results. This is the concrete sense in which ops are "run in parallel over any
  input system".
- **One coordinator.** A single coordinator owns the private Lorenz snapshot
  lineage (`init -> capture -> work -> worker -> claim -> packet -> return ->
  learn`); workers return artifacts and never race to mutate the lineage.

## 4. First op and verified evidence

Worker artifact: `runtime/ops/fold.bend` — a reusable associative reduction
(`Add`, `Max`) over `+List<Nat>`, with typed input `FoldInput{op, values}`,
`run`, and laws: `fold_identity`, `fold_singleton`, `fold_chunk`, supported by
`add_assoc`, `add_zero_r`, `max_zero_r`, `max_assoc`.

Coordinator-run checks (independent of the worker's own report):

```sh
BEND_NO_TELEMETRY=1 ~/.bend/bin/bend runtime/ops/fold.bend --check-only
# -> All terms check.   (exit 0)

BEND_NO_TELEMETRY=1 ~/.bend/bin/bend runtime/ops/fold.bend
# -> fixture 14
# -> fixture_max 5      (exit 0)
```

Falsification check (proves the laws are actually checked, not decorative): a
copy with `ident(Max{})` mutated `0n -> 1n` fails the checker at
`fold_chunk_max`, exit 1. Source digest and toolchain are recorded in the private
lineage, not here.

## 5. Boundary and non-claims

- The op is a pure kernel. Hashing, byte scans, storage, identity, publication
  and human acceptance stay with the host / a named human.
- A reported worker result and a compiler check are **not** a verified code
  bundle and **not** human acceptance. Only Shubham reviewing this exact revision
  resolves the work.
- No new registry service, signer, dispatcher, scheduler or agent framework is
  introduced. The retired JavaScript lifecycle/registry stack is not recreated.

## Outstanding work

- Human review of this draft and of `runtime/ops/fold.bend`; the acceptance
  criteria in this run were derived by the coordinator from the request and
  repo guidance (HARNESS.md:55, "one executable Bend file per kernel") because
  the request supplied no explicit criteria.
- Only one op exists. The "any input system" ambition needs more ops and a
  documented dispatch convention; neither is implemented here.
- Buzz memory retention requires the owner-controlled signer; a finding draft
  was prepared but not sent.
- Nothing is committed, published, or deployed.
