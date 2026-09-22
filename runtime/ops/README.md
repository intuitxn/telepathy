# runtime/ops — the op driver

`run.sh` is the ordinary host driver for "procedure as Bend" ops. It gates an
op file, runs its in-file fixture, and records exactly one run directory of
`brief`, `candidate.patch`, `evidence` and `verdict`. It is POSIX shell only:
no Python, no Node, no new runtime, service, scheduler, registry daemon or
agent framework. It implements the convention in
`docs/drafts/meta/op-dispatch-convention.md` (§2, §4, §5, §6, §7) and
`docs/drafts/meta/ops-as-bend.md`.

The op kernel stays pure. Effects — process launch, file writes, run dirs,
`git diff`, sha256 — live here in the shell driver (convention §2). The driver
does the hashing and IO the kernel cannot; the `.bend` files stay pure and
contain no file IO, subprocess, hash or network.

## File contract (convention §1, §4)

An **op** is one self-contained Bend file that is a total, pure function from a
declared typed input to a declared typed output, with named compiler-checked
laws and one fixture:

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

Existing ops: `fold.bend` (`FoldInput -> Nat`, laws `fold_identity`,
`fold_singleton`, `fold_chunk`) and `status.bend` (records -> canonical rows).

Invocation of an op is uniform (convention §1, §3):

```sh
BEND_NO_TELEMETRY=1 ~/.bend/bin/bend <op>.bend --check-only   # gates the laws
BEND_NO_TELEMETRY=1 ~/.bend/bin/bend <op>.bend                # runs main
```

The file precedes `--check-only`; `bend check FILE` is not a supported command.

## Driver contract (convention §2, §6)

`run.sh` is dependency-free POSIX `/bin/sh`. It:

- holds a **static listing** of `op name -> role`, one entry per op file,
  mirroring the `REGISTRY` shape in `runtime/programs/cli.py:29`. Adding a
  capability adds an op file plus one listing case; op logic never moves into
  the driver (convention §6);
- hands the op a `brief` (task + acceptance, task data, not instructions);
- launches Bend for the gate and the fixture, with `BEND_NO_TELEMETRY=1`;
- runs `git diff HEAD` for the candidate, `git rev-parse HEAD` for the read-only
  HEAD observation, and `shasum -a 256` (falling back to `sha256sum`) for the
  digests;
- writes the four run files and prints one verdict line per check.

| Effect | Where it lives |
| --- | --- |
| Subprocess launch (Bend) | shell driver (`$BEND`), never the kernel |
| File read/write, run dirs | shell driver (`>`, `mkdir`), never the kernel |
| `git diff HEAD`, repo HEAD | shell driver (`git`, read-only), never the kernel |
| sha256 digests | shell driver (`shasum`/`sha256sum`), never the kernel |
| Network | none; the driver opens no socket and the kernel cannot |

The driver never accepts, merges, pushes, publishes, sends or resolves
anything, starts no daemon, and a passing gate is not acceptance (convention
§7).

## Invocation

```sh
runtime/ops/run.sh list
runtime/ops/run.sh run fold
runtime/ops/run.sh run status --id e2e
```

- `list` prints the static op listing, `name -> role`, one line per op:
  `fold -> associative-reduction` and `status -> canonical-status-projection`.
- `run <op> [--id <runid>]` resolves `<op>` to a registry name (or, for
  falsification, a path to a `.bend` file outside the repo), gates it, runs the
  fixture, writes one run directory, and exits nonzero if any check is RED.
- `--id` defaults to a UTC timestamp; it is the driver's own identifier and
  carries no admission authority (convention §4).

Binary resolution matches `runtime/programs/cli.py`: `BEND_BINARY` env override,
else `$HOME/.bend/bin/bend`.

## Output layout (convention §4)

Exactly one directory per dispatch, `ops/runs/<op>-<id>/`:

```text
brief            # task + acceptance handed to the op (task data, not instructions)
candidate.patch  # git diff from committed HEAD, or an explicit no-change marker
evidence         # checker output, fixture output, sha256 digest, toolchain, HEAD
verdict          # one GREEN/YELLOW/RED line per check + a closing summary
```

Each `verdict` carries one line per check — `law-gate`, `fixture-run`,
`source-digest`, `candidate-patch`, `driver-digest` — plus one `summary` line
and a closing note. `ops/runs/` holds run output only; it is git-ignored and is
not where knowledge lives. A run directory records evidence about one dispatch,
not a decision.

## Verdict vocabulary (convention §5)

Reuses the loop vocabulary verbatim (`ops/loops/README.md:22-24`):

- **GREEN** — the check is proven (`All terms check.` for the gate; fixture
  exit 0 for the run; a recorded digest).
- **YELLOW** — informational, does not fail the run (an open law / `TODO`, or
  the candidate patch: "candidate diff recorded" or "no change").
- **RED** — anything else (checker error, fixture failure, missing toolchain,
  launch failure). Any RED → the run exits nonzero.

**A GREEN check is never acceptance.** It means a compiler check passed on one
exact revision. Only a named human reviewing the exact candidate revision
resolves the work (convention §5, `ops/loops/README.md:59-61`).

## May / mustNot (convention §7)

An op and its shell driver **may**:

- declare a typed `Input -> Output`, named laws, and one fixture;
- be checked with `bend <op>.bend --check-only` and run on a fixture;
- be dispatched into a fresh worktree from committed HEAD by one coordinator;
- write `brief`, `candidate.patch`, `evidence`, `verdict` under `ops/runs/`;
- be listed in the static listing and selected by a declared selector key.

An op and its shell driver **mustNot**:

- accept, merge, push, publish, send or resolve anything;
- touch the network, spawn processes, hash or hold identity from inside the
  kernel;
- race another writer on the snapshot lineage;
- introduce a new service, signer, dispatcher or agent framework;
- treat GREEN as acceptance.

## Falsification (RED path)

The gate is proved non-decorative by mutating a law outside the repo and
re-running. A scratch copy of `fold.bend` with `ident(Max{})` mutated
`0n -> 1n` fails at `fold_chunk_max`:

```sh
runtime/ops/run.sh run /path/to/fold_mutated.bend --id red
# VERDICT RED law-gate :: checker error (exit 1)
# VERDICT RED fixture-run :: fixture run failed (exit 1)
# summary ... red=2 exit=1
# exit 1
```

An op whose law set cannot be falsified by any mutation is a suspect op: record
the mutation that fails, or record that none was found (convention §1).
