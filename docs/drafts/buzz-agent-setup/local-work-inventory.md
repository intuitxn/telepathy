# Local work inventory (draft)

Status: engineering inventory, 22 September 2026. Intended for maintainers reviewing
which local changes to integrate; not a company announcement or proof of deployment.

The original checkout is `/Users/a3fckx/Desktop/Attri/telepathy`. It contains other
agents' uncommitted work. The release checkout is
`/Users/a3fckx/Desktop/Attri/telepathy-shared-learning`. The inspection below read
the original checkout without changing it. Dirty files were not copied wholesale.

## Selected fix

Only the existing program gate's exit-status correction and its regression test
were ported into the release checkout:

- `runtime/programs/cli.py`: a checker must exit zero **and** print its success
  marker before the gate reports `proven`.
- `runtime/programs/test_programs.py`: a fake checker that prints the marker and
  exits 1 must report failure.

Verification in the release checkout:

```sh
cd /Users/a3fckx/Desktop/Attri/telepathy-shared-learning/runtime/programs
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest test_programs test_v11
```

Result: 74 tests passed, no skips. This corrects existing Python glue; it introduces
no new runtime or language layer. Marker parsing remains dependent on checker
wording. It does not establish that every authored law expresses the intended task.

## Deferred original-checkout work

| Work | Observed result and reason to defer |
| --- | --- |
| Retrieval Bend operator annotations | Relevant migration to Bend 2.0.21, but accompanied by incomplete stronger proof work. Integrate separately only after the intended law set is agreed and checked. |
| `retrieval/LAWS.bend` and `PROOF.bend` | Strengthens `step_preserves_heat` from an empty-list example to arbitrary lists. The corresponding proof remains open; exact failure below. Do not silently weaken the law to obtain green output. |
| `retrieval/parallel/diffuse_par.bend` | Experimental tree-based diffusion; currently fails affine checking. No validated parallel/GPU performance claim. |
| `retrieval/bench.bend` and `BENCH.md` | Separate benchmark work. Recorded list-based scaling is expensive; large benchmark runs were not repeated in this audit. |
| Desk `retrieval.js`, `selector.js`, and brief changes | Original targeted suite passed 11 tests, including actual Bend demo parity. Deferred because this adds a JavaScript algorithm mirror to a system being simplified around native OpenCode and Bend. |
| Agent updates and project report | Review selectively against current native setup. Historical local observations must not replace current verification. |

The original Desk `jobs.js` still imports `forkEnv`, `FORK_BIN`, and
`DEFAULT_FORK_MODEL`; copying it would restore the removed custom-fork dependency.
Its selector tests establish demo parity, not general equivalence between JavaScript
numbers and Bend natural-number arithmetic. Configuration bounds and broader parity
would need checking before any independent adoption.

## Exact proof blockers

These commands ran against the **original**, dirty checkout with the installed
Bend binary. Both exited 1. Output below is a focused excerpt; large expected-type
expressions are omitted, not replaced with claims of success.

```sh
cd /Users/a3fckx/Desktop/Attri/telepathy
BEND_NO_TELEMETRY=1 /Users/a3fckx/.bend/bin/bend runtime/programs/retrieval/PROOF.bend --check-only
```

```text
- observed : ?step_goal
Location: LAWS.step_preserves_heat
426 | def Laws.step_preserves_heat(h):
427>|   ?step_goal
```

```sh
BEND_NO_TELEMETRY=1 /Users/a3fckx/.bend/bin/bend runtime/programs/retrieval/parallel/diffuse_par.bend --check-only
```

```text
- expected : base
- observed : base (consumed more than once)
Location: gleaf_b
183>| def gleaf_b(z: Bool, n: Nat, base: Nat) -> GTree:
```

## Documentation drift to preserve and reconcile

In the original checkout, `bend-laws/TOOLCHAIN.md` calls retrieval migration green,
but the current open proof contradicts that assertion. Retrieval `REPORT.md` and
proof headers retain historical 2.0.5 verification claims. `GENERATOR_AUDIT.md`
contains a dated snapshot of annotation and version-probe failures subsequently
edited by other work. Those observations need dates and exact revision scope.

`docs/META_AGENT_UPDATES.md` contains a different snapshot of adaptive and registry
behavior; do not transplant it as the current release architecture. The active
release boundary is documented in [coordination-index.md](coordination-index.md)
and `runtime/adaptive/HARNESS.md`; historical custom shared-registry behavior is
archived separately. No local memory records were deleted, merged into Buzz, or
published by this audit.
