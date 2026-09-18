# bend-laws toolchain — new Bend only (legacy removed 2026-09-18 per owner)

Date: 2026-09-18. Host: macOS arm64 (uname per launcher telemetry fields).
Install method (as requested): `curl -fsSL https://bend-lang.com/install.sh | sh`.
Telemetry: all verification runs below used `BEND_NO_TELEMETRY=1`.

## Result: side-by-side, old install unbroken

| Slot | `… --version` | Path | Notes |
|---|---|---|---|
| Legacy (pre-existing) | `bend-lang 0.2.38` | `/Users/a3fckx/.cargo/bin/bend` | Untouched by installer. sha256 `2792465a32cd3b541a1b970f7845d463b4eb342c5bdafe961d2ab9069c64e710`. |
| Legacy fallback (created 2026-09-18) | `bend-lang 0.2.38` | `/Users/a3fckx/.cargo/bin/bend-0.2.38` | `cp -n` copy of the above; same sha256. Use if PATH shadowing ever confuses `bend`. |
| Proof-carrying (latest per `rep`) | `bend 2.0.5` | `/Users/a3fckx/.bend/bin/bend` (launcher shell script, 3543 bytes) | Installed by bend-lang.com script. No overwrite: the script installs to `${BEND_HOME:-$HOME/.bend}/bin/bend`, never to `~/.cargo/bin`. |

New-toolchain store details (2026-09-18):

- `const VERSION = "2.0.5";` in `/Users/a3fckx/.bend/current/bend2/main.ts`
- `readlink ~/.bend/current` → `app/2.0.5/s0EZ7D`
- `~/.bend/app/` contains `2.0.5/`
- `cat ~/.bend/rep` → `{"ver":"2.0.5","url":"https://bend-lang.com/dl/2.0.5.tar.gz","sha256":"4db70e77ce1b1027f1d0e15dee025921fa794a9b415add4350ec7c64acf2775b","notice":""}`
- Re-running the install script on 2026-09-18 printed `Bend 2.0.5`, exit 0, and confirmed `Another bend is at /Users/a3fckx/.cargo/bin/bend.`
- Requires `bun` (found `/Users/a3fckx/.bun/bin/bun`, `1.3.11`); launcher shells out to it.

PATH note: the installer appended `export PATH="/Users/a3fckx/.bend/bin:$PATH"` to `~/.zshrc`.
In the verifying shell (pre-reload) `which -a bend` → only `/Users/a3fckx/.cargo/bin/bend`,
so bare `bend` still meant 0.2.38 there. After opening a new shell, `~/.bend/bin` sorts
first and bare `bend` will mean 2.0.5. Scripts must therefore use absolute paths:
`/Users/a3fckx/.cargo/bin/bend` (legacy) vs `/Users/a3fckx/.bend/bin/bend` (proof-carrying).
`bend-0.2.38` is the stable legacy alias.

## Gate inputs

- `runtime/programs/bend-laws/LAWS.bend` — human-owned laws (`agent_is_effect_free`, `human_accept_resolves`, `accept_is_idempotent`).
- `runtime/programs/bend-laws/PROOF.bend` — AI-owned `{==}` proofs under `Laws.*`.

## Legacy gate output (expected FAIL — documents why 0.2.38 cannot gate these files)

```
$ ~/.cargo/bin/bend --version
bend-lang 0.2.38

$ ~/.cargo/bin/bend check runtime/programs/bend-laws/LAWS.bend
Errors:
In runtime/programs/bend-laws/LAWS.bend :
- expected: Type variable or '='
- detected:
   9 | type Actor is Data:
EXIT:1

$ ~/.cargo/bin/bend check runtime/programs/bend-laws/PROOF.bend
Errors:
In runtime/programs/bend-laws/PROOF.bend :
- expected: Variable name
- detected:
   8 |   {==}
EXIT:1

$ bend runtime/programs/bend-laws/PROOF.bend   # bare path is not a subcommand in 0.2.38
error: unrecognized subcommand 'runtime/programs/bend-laws/PROOF.bend'
Usage: bend [OPTIONS] <COMMAND>
EXIT:2
```

0.2.38 subcommands (`bend --help`): `check, run-rs, run-c, run-cu, gen-hvm, gen-c, gen-cu, desugar`.
It rejects `import Base` / `type … is Data` / `law` / `{==}` — the new-Bend syntax.

## New gate output (GATE PASSES)

New usage (`~/.bend/bin/bend --help`):

```
Bend 2.0.5: check, run, build and publish Bend programs.
usage:
  bend <file.bend>            check the file, then run main
  bend <file.bend> -o <out>   build a binary; <out>.c emits C, <out>.js JS
  bend <file.bend> --checkup  check and run each import alone
  bend <file.bend> --publish  publish the file and its imports to the hub
  bend <page.html> -o <dir>   bundle a page that imports .bend files
  bend base [--types|<name>]  print Base, its types, or a name and its subnames
  bend guide                  print the Bend guide
  bend --version              print the version
```

There is **no `bend check` subcommand** in 2.0.5. The requested `bend check`
verification was run literally and recorded:

```
$ BEND_NO_TELEMETRY=1 ~/.bend/bin/bend check runtime/programs/bend-laws/LAWS.bend
bend: too many arguments (see bend --help)
EXIT:1

$ BEND_NO_TELEMETRY=1 ~/.bend/bin/bend check runtime/programs/bend-laws/PROOF.bend
bend: too many arguments (see bend --help)
EXIT:1
```

The equivalent check-and-run is the bare file form:

```
$ BEND_NO_TELEMETRY=1 ~/.bend/bin/bend --version
bend 2.0.5

$ BEND_NO_TELEMETRY=1 ~/.bend/bin/bend guide > /tmp/guide.txt
EXIT:0   # 605 lines; opens "# Bend / Bend is a new programming language that combines Lean-like formal proofs …"

$ BEND_NO_TELEMETRY=1 ~/.bend/bin/bend base | head
# Types / # ===== / # Data / …  (Unit, Bool, Maybe, List, U32, String, … plus `law Word`, `law File`, …)
EXIT:0

$ BEND_NO_TELEMETRY=1 ~/.bend/bin/bend base --types | head
type Empty is Data: / type Unit is Data: / …  (same type index)
EXIT:0

$ BEND_NO_TELEMETRY=1 ~/.bend/bin/bend base Maybe | head
type Maybe<a, -A: Kind(a)> is Kind(a):
  None{}
  Some{value: A}
… (plus Maybe.pure/bind/default)
EXIT:0

$ BEND_NO_TELEMETRY=1 ~/.bend/bin/bend runtime/programs/bend-laws/LAWS.bend
Error: 5 TODOs found.
The code is incomplete, and not a valid proof yet.
EXIT:1
# Expected: LAWS.bend alone states unproven laws, so it must fail without PROOF.bend.

$ BEND_NO_TELEMETRY=1 ~/.bend/bin/bend runtime/programs/bend-laws/PROOF.bend
All terms check.
EXIT:0
# ← THE GATE. All five laws hold.
```

Per-import checkup (informational; `--checkup` checks each import standalone,
so the LAWS import alone still reports its TODOs):

```
$ BEND_NO_TELEMETRY=1 ~/.bend/bin/bend runtime/programs/bend-laws/PROOF.bend --checkup
--- ./LAWS.bend ---
Error: 5 TODOs found.
The code is incomplete, and not a valid proof yet.
exit 1
EXIT:1
```

This does not contradict the gate: the bare `bend PROOF.bend` run above
checks the whole program (laws + proofs together) and prints `All terms check.`

## Canonical commands

```sh
export BEND_NO_TELEMETRY=1
NEW=/Users/a3fckx/.bend/bin/bend

$NEW guide                 # 605-line language guide, exit 0
$NEW base                   # dump Base prelude, exit 0
$NEW runtime/programs/bend-laws/PROOF.bend   # gate: expect "All terms check.", exit 0
```

Legacy `0.2.38` (`~/.cargo/bin/bend`, `bend-0.2.38` alias) removed 2026-09-18 — no fallback. Use `$NEW` (absolute path) in all scripts and gates.
