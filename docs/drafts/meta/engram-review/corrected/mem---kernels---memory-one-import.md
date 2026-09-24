# DRAFT - NOT SENT — proposed replacement body for `mem/kernels/memory-one-import`

Source evidence (read-only, 2026-09-24, canonical checkout `/Users/a3fckx/Desktop/Attri/telepathy`):
- `runtime/memory.bend`: ABSENT (`ls: No such file or directory`)
- `scripts/memory-sync.sh`: PRESENT
- `runtime/mundus.bend` live sha256 `c111398f3d1f7acf64a8dd00f933338420ce1ccc2a0e87a7ad97150981e14d8c`;
  grep for `Memory`, `memory.bend`, `Mem.` → 0 hits
- Relay base-hash (`buzz mem hash --agent df4f2c69…1cb49d4`): `8c6b2c1d0cbf10c154a58a9233ff22488907fd9f5a6e2235e42d0facb8aeb602`
- Original scope: worktree `telepathy-mundus` @ `7e5d0b8` (historical; retained below as history)

---

# Memory: the ONE import + the mid-edit repair — 2026-09-22 (corrected 2026-09-24)

Original worktree `telepathy-mundus` @ 7e5d0b8. What follows is retained history
with live-path corrections appended. Do not treat corrected paths as verified
until a Bend check re-passes on the current checkout.

## CORRECTION (2026-09-24, live checkout)
- `runtime/memory.bend` does NOT exist in the live checkout (ABSENT).
  The "ONLY place memory is read from" claim no longer holds as a live path.
- `runtime/mundus.bend` (live sha `c111398f…`) contains NO `Memory{}` type, NO
  `import ./memory.bend`, and NO `Mem.` calls (grep 0 hits). The repair narrative
  below describes the historical worktree, not the live file.
- `scripts/memory-sync.sh` still EXISTS (PRESENT); the `memory <root>` /
  `status` / `ensure` behavior below is unverified against the live kernel.
- Owner decision needed: either restore `runtime/memory.bend` + `Memory{}` wiring
  and re-check, or retire this entry's "ONE import" claim.

## The one source import (HISTORICAL — worktree telepathy-mundus @ 7e5d0b8)
- `runtime/memory.bend` was the ONLY place memory was read from. `runtime/mundus.bend`
  did `import ./memory.bend as Mem` and called `Mem.parse_index`,
  `Mem.memory_slugs`, `Mem.memory_count`, `Mem.memory_quarantine_count`. No memory
  parsing was duplicated in the kernel.
- Contract: `<root>/memory.in` = `slug|digest` lines; bodies at
  `<root>/memory/<slug>` (`/` -> `__`).
- `memory <root>` printed entries/quarantine/sorted slugs; a missing index printed a
  NEED line naming `./mundus memory sync <root>` and exited 66. `status` projected
  the `memory` slot (present `entries=N` / absent).
- Host materialization: `scripts/memory-sync.sh` (sync/ls/get) + `ensure`
  (self-setup: materialize if missing or empty, else report `fresh (N entries)`).
  Materialized 17 real entries from the agent:Honey scope; owner scope was empty
  (agent-scoped writes). No key material is ever printed.

## The repair (report honesty) (HISTORICAL)
A prior agent died mid-edit and left `runtime/mundus.bend` BROKEN: it had added
`import ./memory.bend as Mem`, `Memory{}` to the Verb type, and the `verb_name`
case, but not the other matches. The checker failed with
`expected: cases for Memory / Location: action_of`. Repaired by adding `Memory{}`
to verb_of / action_of / dispatch_total / dispatch_action_total / act / verb_list
/ usage, then finishing the verb. 130 -> 142 laws, 0 removed.

## Performance note (measured, not a regression) (HISTORICAL)
`bend FILE -- <verb>` re-checks/loads on every call, so under host contention the
interpreted path is slow. The COMPILED path is fast:
`bend runtime/mundus.bend -o <bin>` then `<bin> -- memory <root>` returns
instantly (memory + status verified). Neatening opportunity: compile once and
have `./mundus` use the binary.

## Routing collision (open, carried forward)
`./mundus memory <root>` routes to the host materializer (`scripts/memory-sync.sh`),
shadowing the kernel's `memory` read verb, which is reachable as
`bend runtime/mundus.bend -- memory <root>`. Disambiguation is an owner decision.
Unresolved as of 2026-09-24; depends on the restoration decision above.
