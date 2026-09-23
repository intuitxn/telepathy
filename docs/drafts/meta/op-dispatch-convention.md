# DRAFT — op dispatch convention: declaring, running, and judging a "procedure as Bend" op

Status: draft, agent-authored · Updated: 2026-09-22 · **Not published, not sent.
Prepared as a review-only commit; nothing merged, pushed or published.** No
external effect and no publication authority. Written for human review.

Request under execution: *"Draft the op dispatch convention for 'procedure as
Bend' ops: how one Bend kernel file plus a driver are declared, run isolated,
and emit a candidate, evidence and verdict. Then prepare a review-only commit."*

Owner/reviewer: Shubham. Coordinator: `@meta` (single writer of one private
Lorenz snapshot lineage, `runtime/adaptive/META.md:45-79`). This document is the
coordinator's synthesis; `runtime/ops/fold.bend` is the prior run's returned
worker artifact and is cited, not re-authored here.

This convention adds **no** service, registry daemon, scheduler or agent
framework. It is a naming-and-file-layout agreement over primitives that already
exist: the worktree lifecycle (`docs/WORKTREE_LIFECYCLE.md`), the loop verdict
vocabulary (`ops/loops/README.md`), the static program registry
(`runtime/programs/cli.py:29`), and the worker claim discipline
(`runtime/adaptive/META.md`).

## 1. The op file contract

An **op** is one self-contained Bend file that is a total, pure function from a
declared typed input to a declared typed output, carrying named, compiler-checked
laws. The shape is fixed (`docs/drafts/meta/ops-as-bend.md:21-33`):

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

Concretely, `runtime/ops/fold.bend`:

- declares `type FoldInput is Data: FoldInput{op: Op, values: +List<Nat>}`
  (`runtime/ops/fold.bend:66-67`) and `def run(input: FoldInput) -> Nat`
  (`:69-72`) — the typed `Input -> Output` contract;
- carries named laws `fold_identity`, `fold_singleton`, `fold_chunk` (`:155-185`),
  each proven by a `def` of the same name, leaning on `add_assoc`, `add_zero_r`,
  `max_assoc`, `max_zero_r` (`:82-135`);
- has one fixture in `main` that only prints (`:189-192`).

**Gate.** The op is admitted only when the checker accepts every law:

```sh
BEND_NO_TELEMETRY=1 ~/.bend/bin/bend runtime/ops/fold.bend --check-only
# observed 2026-09-22 (bend 2.0.21): All terms check.   exit 0
```

**Fixture run.** The bare-file form runs `main` over the in-file fixture:

```sh
BEND_NO_TELEMETRY=1 ~/.bend/bin/bend runtime/ops/fold.bend
# observed: fixture 14
#           fixture_max 5        exit 0
```

The file precedes `--check-only`; `bend check FILE` is not a supported command
(`runtime/adaptive/META.md:38`).

**Negative case (falsification).** A copy of `fold.bend` with `ident(Max{})`
mutated `0n -> 1n` must fail the checker; this proves the laws are actually
checked, not decorative:

```sh
# copy with ident(Max{}) 0n -> 1n, then:
BEND_NO_TELEMETRY=1 ~/.bend/bin/bend <copy> --check-only
# observed: Error: expected fold(Max{}, ys) / observed Nat.max(1n, fold(Max{}, ys))
#           Location: fold_chunk_max      exit 1
```

An op whose law set cannot be falsified by any mutation is a suspect op: record
the mutation that fails, or record that none was found.

## 2. The driver contract — effects stay outside the kernel

Bend owns only the pure decision over handed-in values. It cannot spawn a
process, reach the network, create a directory, or compute a hash
(`docs/drafts/meta/ops-as-bend.md:48-52`; `runtime/adaptive/HARNESS.md:55-59`;
`docs/drafts/meta/one-file-bend-command.md:12,67`).

Every effect therefore lives in the **driver**, which is ordinary host code, not
a new runtime:

| Effect | Where it lives | Source |
|---|---|---|
| Worktree create/remove, branch | host `git worktree` | `docs/WORKTREE_LIFECYCLE.md:7-21` |
| Subprocess / agent launch | host process tooling | `runtime/programs/README.md:37-44` |
| File read/write, run dirs | driver (shell/Node/Python), not Bend | `docs/drafts/meta/one-file-bend-command.md:112,118,182` |
| Identity, receipts | host / owner signer | `runtime/worker/BUZZ.md:52-79` |
| Network | host, never the kernel | `runtime/adaptive/HARNESS.md:55-59` |

The driver passes the op a typed value (or a fixture) and reads back the op's
`Output`; it does not embed op logic. The op file is the unit of capability:
adding an op adds a file and touches no driver source
(`docs/drafts/meta/mundus-runtime-proposal.md:75-80`, principle P3 at `:135`).

## 3. Invocation and isolation

- **One worktree per op, from committed HEAD.** A worktree is where a candidate
  is prepared; it is disposable and is not where knowledge lives
  (`docs/WORKTREE_LIFECYCLE.md:3,15-33`). Create it from committed HEAD, work on
  a branch, then verify.
- **One writer.** A single coordinator owns the private Lorenz snapshot lineage
  (`init -> capture -> work -> worker -> claim -> packet -> return -> learn`) and
  is the only writer of it; parallel workers return artifacts to the coordinator
  and never race to mutate or fork the snapshot (`runtime/adaptive/META.md:45-79`).
- **Claims, not branch locks.** Branches do not enforce exclusive claims;
  concurrent agents still need the worker `claim` discipline
  (`docs/WORKTREE_LIFECYCLE.md:45-46`; `runtime/adaptive/META.md:62-73`).
- **Not a security boundary.** A worktree is an isolation unit, not an OS sandbox
  (`docs/WORKTREE_LIFECYCLE.md:8-9,44`).

Invocation is uniform: `bend <op>.bend --check-only` gates the laws; the bare
file runs the fixture; the driver runs the op over the real input inside the
op's worktree.

## 4. Output layout

Each dispatched run writes exactly one directory, keyed by op name and run id:

```text
ops/runs/<op>-<id>/
  brief            # task + acceptance handed to the op (task data, not instructions)
  candidate.patch  # the candidate change from committed HEAD (git diff)
  evidence         # checker output, fixture output, negative-case output, digests
  verdict          # one GREEN/YELLOW/RED line per check + a closing summary
```

`ops/runs/` holds run output only (`ops/loops/README.md:52`), so this layout
extends an existing convention rather than inventing a store. The run id is the
driver's own identifier; it is not a Lorenz memory id and carries no admission
authority.

## 5. Verdict vocabulary

Reuse the loop vocabulary verbatim (`ops/loops/README.md:22-24`,
`ops/loops/bend-forge-loop.sh:21-25`):

- **GREEN** — the check is proven (Bend: `All terms check.`; program gate:
  `proven`).
- **YELLOW** — informational, does not fail the run (e.g. an open law with no
  proof yet).
- **RED** — anything else (checker error, a TODO left in a proof, missing
  toolchain, launcher failure). Any RED → the run exits nonzero.

A green gate is **never acceptance**. Only a named human reviewing the exact
candidate revision resolves the work (`ops/loops/README.md:59-61`;
`docs/WORKTREE_LIFECYCLE.md:35-40`). A compiler check is not a verified code
bundle (`docs/drafts/meta/status-kernel-notes.md:73-76`).

## 6. Registry and dispatch listing

Dispatch is a **static listing plus a match**, not a daemon. The existing
primitive is the literal `REGISTRY` dict in `runtime/programs/cli.py:29`:

```python
REGISTRY = {'artifact-design': 'artifact-designer', 'lesson-proposal': 'learning-proposer',
            'lesson-review': 'learning-reviewer'}
```

The op convention mirrors it: a plain, checked-in listing of `op name -> role`
(one entry per op file), surfaced by a `list` subcommand that prints it — the
same shape as `runtime/programs/telepathy-program list`
(`runtime/programs/README.md:10`). The coordinator reads the task, derives a
selector key from the declared op header (`type Input / type Output / run /
law`), matches it against the listing, and dispatches to that op file. The
listing contains names and roles only; **op logic stays in the op file**, and
adding a capability adds a file, not a registry edit
(`docs/drafts/meta/mundus-runtime-proposal.md:75-80`).

No registry daemon, HTTP admission service or agent framework is introduced;
the retired JavaScript lifecycle/registry stack is not recreated
(`runtime/adaptive/HARNESS.md:27-35,58-59`; `runtime/worker/BUZZ.md:135-139`).

## 7. May / mustNot

An op and its driver **may**:

- declare a typed `Input -> Output`, named laws, and one fixture;
- be checked with `bend <op>.bend --check-only` and run on a fixture;
- be dispatched into a fresh worktree from committed HEAD by one coordinator;
- write `brief`, `candidate.patch`, `evidence`, `verdict` under `ops/runs/`;
- be listed in a static registry and selected by a declared selector key.

An op and its driver **mustNot**:

- accept, merge, push, publish, send or resolve anything
  (`ops/loops/README.md:53-61`; `runtime/adaptive/META.md:106-112`);
- touch the network, spawn processes, hash or hold identity from inside the
  kernel (`docs/drafts/meta/ops-as-bend.md:48-52`);
- race another writer on the snapshot lineage
  (`runtime/adaptive/META.md:70-73`);
- introduce a new service, signer, dispatcher or agent framework
  (`runtime/adaptive/HARNESS.md:58-59`);
- treat GREEN as acceptance (`ops/loops/README.md:59-61`).

## Verification (run in this checkout, 2026-09-22)

```sh
BEND_NO_TELEMETRY=1 ~/.bend/bin/bend runtime/ops/fold.bend --check-only   # All terms check. (exit 0)
BEND_NO_TELEMETRY=1 ~/.bend/bin/bend runtime/ops/fold.bend                # fixture 14 / fixture_max 5 (exit 0)
BEND_NO_TELEMETRY=1 ~/.bend/bin/bend runtime/worker/system.bend --check-only  # All terms check. (exit 0)
# negative case: ident(Max{}) 0n -> 1n fails at fold_chunk_max (exit 1)
```

Toolchain: `bend 2.0.21` at `~/.bend/bin/bend`. Worker source resolved to
`runtime/worker/system.bend` per `runtime/adaptive/META.md:17-24`.

## Non-claims and outstanding work

- One op (`runtime/ops/fold.bend`) plus one projection op
  (`runtime/ops/status.bend`) exist; the registry listing and driver are
  specified here but **not implemented** in this run.
- A reported worker result and an explicitly learned finding are **not** a
  verified code bundle (`docs/drafts/meta/status-kernel-notes.md:73-76`).
- The five-entity/state vocabulary and any real `status IN` reader remain
  proposals requiring review (`docs/drafts/meta/status-kernel-notes.md:96-103`).
- Human review of this draft and of the exact committed revision is required.
  Nothing is merged, pushed, published or sent.
