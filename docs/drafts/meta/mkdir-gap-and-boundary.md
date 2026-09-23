# DRAFT — the mkdir gap and the pure/effectful boundary

Status: draft, agent-authored · Updated: 2026-09-23 · Owner/reviewer: Shubham ·
Coordinator: `@meta`.
**Not published, not sent, not merged. No external effect and no publication
authority. Written for human review; a named human accepts a specific revision.
Nothing here is acceptance.**

Subject: the "mkdir gap" the `mundus` kernel exposes, the pure/effectful
boundary it makes explicit, and how to close it neatly.
Kernel under discussion: `runtime/mundus.bend` (Bend `2.0.21`).
Companion law doc: `docs/drafts/meta/mundus-kernel-laws.md`.

## 0. How this was verified (read-only checks only)

| Check | Command (exact) | Observed |
|---|---|---|
| `init` into a nonexistent root | `BEND_NO_TELEMETRY=1 ~/.bend/bin/bend runtime/mundus.bend -- init <nonexistent-root>` | `cannot write <root>/state.state [No such file or directory]; the state directory must exist (Bend has no mkdir)`; exit 2 |
| Base has no dir/exec surface | `grep -nE "mkdir\|readdir\|rmdir\|exec\|process\|system" ~/.bend/bend2/base.bend` | count **0** |
| No Dir/Path/OS/Proc/System namespace | `grep -oE "^def [A-Za-z_]+" ~/.bend/bend2/base.bend \| sort -u` | modules: `App Array Audio Bool Chan Char Cmp Empty Equal Exists F File IO Image List Listener Map Maybe Nat Or Pair Result Set Socket String TCP UDP U Window Word` — none of Dir/Path/OS/Proc/System |
| `IO.spawn` is a fiber, not a process | `~/.bend/bend2/base.bend:211-213`; `~/.bend/bend2/effs/spawn.js` | `io_spawn` calls `io_push(act, …)` — schedules a fiber; no OS process |
| Base file surface | `~/.bend/bend2/base.bend` | `IO.args` (:190), `File.open` (:257), `File.read` (:262), `File.read_at` (:272), `File.size` (:277), `File.write` (:282), `File.close` (:292), `IO.print/print_err/die` (:174-194), `IO.spawn/fork/join` (:211-254), `TCP.*` (:296+) |
| `File.read_at` is offset-addressed | `~/.bend/bend2/effs/file_read_at.js` | `sys.pread(fd, ptr, len, BigInt(offset))` |
| `File.write` has no position arg | `~/.bend/bend2/effs/file_write.js`; `grep -nE "seek\|tell\|truncate\|rename\|unlink\|stat" base.bend` | `fs.writeSync(fd, b, at, len, null)` → writes at the current offset; **no** seek/tell/truncate/rename/unlink/stat anywhere in base |
| Kernel derives the path purely | `runtime/mundus.bend:359-363`; `-- path <root> capture` | `verb_dir(S,V) = S ++ "/" ++ V`; `slot(S,V) = verb_dir(S,V) ++ ".state"`; prints `<root>/capture.state` |

Unverified / not touched: `./mundus`, the host entry point said to be under
construction by another agent, does **not** exist in this worktree at drafting
time (`ls mundus` → no such file). Its design is treated as **in-progress and
out of scope**; nothing here edits it.

## 1. The gap, stated precisely

The kernel owns **derivation** but not **directory creation**.

- Pure core: `verb_dir(S,V) = S ++ "/" ++ V` and `slot(S,V) = verb_dir(S,V) ++ ".state"`
  are pure, deterministic, and already carry five named laws
  (`verb_dir_determinism`, `verb_dir_witness`, `verb_dir_distinct`, `slot_derived`,
  `verb_dir_distinct_all`; `runtime/mundus.bend:366-401`).
- Effectful shell: the write path is `File.open(slot(root,verb), "w")`
  (`runtime/mundus.bend:1344`). `File.open` is plain `open(2)` with **no parent
  creation** (`~/.bend/bend2/effs/file_open.js`). When the derived parent
  directory is absent the open fails, and `write_opened` reports it explicitly
  (`runtime/mundus.bend:1333-1336`).

So the kernel correctly computes *where* state lives, and correctly refuses to
pretend it wrote state it did not. But **something outside the kernel must
create `<root>` (and each derived `<root>/<verb>` directory)** — and today that
step is ad-hoc: the law doc's demo sequence simply says "scratch root outside
the repo" and the kernel comment says "created by the host driver (`mkdir -p`)"
(`runtime/mundus.bend:24-29`, `docs/drafts/meta/mundus-kernel-laws.md:68-73`,
`:253-263`), with no single owner, no checked contract, and no shim in the tree.

The gap is not a bug in the kernel; it is an **unassigned boundary**. The kernel
already documents the split honestly (it "never claims to create a directory").
What is missing is a named owner for the effect and one place that performs it.

## 2. The boundary rule (first principles)

> **Rule.** The pure core owns *decisions* (what path, which verb, what state).
> The host owns *effects* (anything that touches the OS). Directory creation is
> an effect Base does not expose; therefore the host is its correct owner.

Evidence for the rule:

- Base exposes no effect to create a directory (`base.bend` grep count 0; no
  Dir/Path/OS namespace), so a kernel-side `mkdir` is not expressible — see §5.
- `IO.spawn` is a fiber, not a process (`effs/spawn.js`), so the kernel cannot
  even shell out to a host `mkdir`.
- The rule is already the project's stated convention, not a new invention:
  `runtime/ops/README.md` fixes "The op kernel stays pure. Effects … live here
  in the shell driver," and its effect table assigns subprocess launch, file
  writes, run dirs, `git diff`, and sha256 to the driver.
- `runtime/mundus.bend:19-22` already partitions the file into a **pure core**
  (no IO, no clock, no network, no subprocess, no hashing) and an **effectful
  shell** (the only `File.*`/`IO.*` calls; §8 begins at `:1240`).

What else is host-owned, by the same rule (each verified as absent from Base):

| Effect | Why the host owns it | Evidence |
|---|---|---|
| `mkdir` (directory creation) | no dir effect in Base | `base.bend` grep 0; §0 |
| Subprocess / exec | `IO.spawn` is a fiber, not a process | `effs/spawn.js` |
| `git` (diff, rev-parse) | no VCS effect in Base | `runtime/ops/README.md` effect table |
| `sha256` / hashing | no hash in Base; pure core "hashes nothing" | `docs/drafts/meta/mundus-kernel-laws.md:290-297`; `runtime/ops/README.md` |
| TLS / network policy | sockets exist, TLS does not | `base.bend:296+` (TCP/UDP only) |
| `rename` / `unlink` / `stat` / `truncate` | not in Base | `base.bend` grep for these = 0 |
| Provisioning the state root | follows from `mkdir` being host-owned | this doc, §1 |

The kernel keeps the one thing it is good at — the **derivation law** — and the
host keeps every syscall. That is the boundary; the gap is just the unassigned
`mkdir` on the host side of it.

## 3. Option (a) — host shim

The kernel's `path` verb is the single source of truth for derivation
(`runtime/mundus.bend:1542-1547`: prints `slot(root,verb)`). The shim asks it,
`mkdir -p`s the parent, then dispatches. It never hardcodes a verb→directory map.

```sh
#!/bin/sh
# mundus — host shim. The kernel derives; the host creates; then dispatch.
verb=$1; root=$2
slot=$(BEND_NO_TELEMETRY=1 ~/.bend/bin/bend runtime/mundus.bend -- path "$root" "$verb")
mkdir -p "$(dirname "$slot")"          # dirname(slot) == verb_dir(root,verb)
exec env BEND_NO_TELEMETRY=1 ~/.bend/bin/bend runtime/mundus.bend -- "$@"
```

That is the whole effect: five lines around the existing kernel. `dirname` of the
kernel's own `path` output *is* `verb_dir`, so derivation stays in the kernel and
the shim adds only the missing syscall.

| Pros | Cons |
|---|---|
| Minimal: one small file, no kernel change | One more file to own |
| Keeps the "state is a directory" model intact | Not zero-host: a shell wrapper is still required |
| Honors the boundary (§2): kernel derives, host effects | `dirname` assumes a POSIX path separator; fine on darwin/linux, unverified on other hosts |
| The `path` verb already exists and is law-backed | Only `init` strictly needs it; other verbs read a root that `init` already made |
| Testable: shim output is the kernel's own derivation | A user calling `bend runtime/mundus.bend` directly bypasses the shim (unchanged failure mode, §1) |

## 4. Option (b) — single-file state

Make the root a **FILE**, not a directory. Slots are addressed by offset with
`File.read_at` and recorded by appending with `File.write`. No directory is ever
needed, so no `mkdir` ever runs; the kernel becomes fully self-hosting.

| Pros | Cons |
|---|---|
| Zero-host: no shim, no `mkdir`, one file | **Abandons the "state is a directory" model** (`mundus-kernel-laws.md:56-66`), and its derived `verb_dir`/`slot` laws lose their filesystem meaning |
| Uses only Base primitives: `File.open/read_at/write/size/close` | `File.write` has **no position argument** (`effs/file_write.js`: `writeSync(…, null)`), and Base exposes no seek/tell/truncate. So a slot can be **appended** (`"a"`) or the whole file **rewritten** (`"w"`), but **not updated in place at an offset** — updates become rewrite-or-log |
| Reading by offset is real: `File.read_at` = `pread` | Needs a new on-disk encoding (record framing, tombstoning/compaction) and new laws; the directory model's laws do not transfer |
| Survives on hosts where `mkdir` is unavailable | Concurrency/locking is unaddressed (`File.open` exposes no locks) |
| | Larger change now; the kernel is already written and law-checked for directories |

Status of (b): **feasible with the primitives that exist, but a model change, not
a patch.** It is a real option only if "zero-host" is a hard requirement.

## 5. Option (c) — kernel-side `mkdir` / `exec` — NOT POSSIBLE

| Attempt | Why it fails | Evidence |
|---|---|---|
| Kernel calls `mkdir` | Base has **no** dir effect at all (grep count 0; no Dir/Path/OS namespace) | `base.bend` §0 |
| Kernel shells out (`system`/`exec`) | `IO.spawn` schedules a **fiber**, not an OS process; no exec/system def exists | `base.bend:211-213`; `effs/spawn.js`; grep count 0 |
| Kernel opens the parent and writes | `File.open` is `open(2)` with no parent creation; the parent must already exist | `effs/file_open.js`; §1 |

There is no path in which the kernel creates a directory. (c) is closed; the
choice is between (a) and (b), not including (c).

## 6. Recommendation

**Adopt option (a): the host shim.** Reasoning:

1. It matches the project's own boundary convention (`runtime/ops/README.md`;
   `runtime/mundus.bend:24-29`, `:19-22`) instead of adding a second model.
2. It is the smallest correct change: the kernel is already law-checked and its
   `path` verb already exposes the derivation, so the shim adds only the missing
   syscall and hardcodes nothing.
3. It preserves every existing law; (b) would invalidate the directory-model laws
   and require new ones.
4. It is honest about the split — the kernel already documents that the host
   creates the directory; (a) just gives that host step a name and a home.

**What would change the recommendation:** a hard requirement that the system run
with **no host wrapper at all** (zero-host / single-artifact). If that becomes a
requirement, option (b) is the only route, and the recommendation flips to (b)
with the caveats in §4 — provided an in-place-update story (rewrite vs
append-log) is accepted.

## 7. How to proceed (in order)

1. **Shim first.** Land the §3 shim as the single host entry point for `mundus`;
   it calls `path`, `mkdir -p`s the parent, and dispatches. Do not duplicate the
   verb→directory map.
2. **Prove the gap is closed.** Run `init <nonexistent-root>` through the shim and
   confirm the state slots appear, then `status` reads them. (Kernel file itself
   unchanged.)
3. **Wire `retrieve`/`status` to real state dirs.** Point them at the directory
   the shim provisioned (today's demos use a scratch root / fixtures;
   `mundus-kernel-laws.md:253-263`, `:209-218`), so the directory model is used
   end-to-end.
4. **Decide (b) later, only if required.** Revisit option (b) **only** if
   zero-host is made a hard requirement; otherwise keep the directory model and
   the shim.

## 8. Acceptance criteria (option (a) path) and open owner decisions

Acceptance criteria for the chosen (a) path — all verifiable, none invented:

1. `./mundus init <nonexistent-root>` (via the shim) exits 0 and creates
   `<root>/state.state`, `<root>/init.state`, `<root>/graph.state`.
2. The shim obtains the slot path from `bend runtime/mundus.bend -- path <root>
   <verb>`; it contains **no** hardcoded verb→directory map.
3. `bend runtime/mundus.bend --check-only` still prints `All terms check.`
   (exit 0) with the kernel file unchanged.
4. Calling the kernel directly with a missing root still fails with the explicit
   `… the state directory must exist (Bend has no mkdir)` message (no silent
   empty state).
5. `./mundus status <root>` reads the shim-provisioned directory and prints one
   line per slot.

Open owner decisions (numbered):

1. Owner/reviewer for the shim: confirm Shubham owns, and name the reviewer.
2. Is the shim the **only** supported entry point (kernel direct calls
   discouraged), or is the direct-call failure mode acceptable?
3. Do `retrieve`/`status` read the real state directory, or keep using the
   documented fixtures (`graph_or_fixture`)? (`mundus-kernel-laws.md:209-218`,
   open question 6.)
4. Is **zero-host** a requirement? If yes, the recommendation flips to option
   (b) and the directory model is abandoned — decide before step 3 of §7.
5. If (b) is ever chosen: append-only log or full rewrite, and what replaces the
   `verb_dir`/`slot` laws?
6. Does the shim ship in `runtime/` or as a repo-root `./mundus` (coordinate with
   the in-progress entry point; do not create a second one)?

## 9. Non-claims

- This document is a **draft for human review**; it is not acceptance, a merge, a
  publish, or a send.
- It does not implement the shim, the single-file model, or any kernel change.
- It edits no file other than itself, and touches no work by other agents.
- It invents no metrics and claims no shipped feature; every observed line is a
  read-only check from §0, and the in-progress `./mundus` is marked unverified.
- `./mundus`'s existence, design, and line numbers are **not** asserted here.
