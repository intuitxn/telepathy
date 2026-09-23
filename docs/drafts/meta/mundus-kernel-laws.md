# DRAFT — mundus kernel: one command surface over state directories

Status: draft, agent-authored · Updated: 2026-09-22 · Bend `2.0.21`.
**Not published, not sent, not merged. No external effect.** Written for human
review; a named human accepts a specific revision. Nothing here is acceptance.

Kernel: `runtime/mundus.bend` (single file, executable).
Checker: `BEND_NO_TELEMETRY=1 ~/.bend/bin/bend runtime/mundus.bend --check-only`
→ `All terms check.` (exit 0). `bend check FILE` is not a supported command;
the file precedes `--check-only`.

Scope note: `retrieve` is a **small faithful port** of the pure core of
`runtime/worker/diffusion.bend` (activation over a graph, exactly `steps`
rounds, an edge conducts only when both endpoints are in scope, ranking by
activation desc / id asc, scope filter before top-K). It is not a re-export of
that kernel and does not claim its 45-law surface.

---

## 1. Command surface

`main` reads `IO.args()`, takes the first element as the VERB, and dispatches.
An absent or unknown verb prints the verb list and exits with code **64**
(`IO.die`). Nothing falls through silently.

| Verb | Args | State transition | Derived directory |
|---|---|---|---|
| `help` | — | none (pure) | — |
| `init` | `<root>` | writes `state`, `init`, `graph` slots | `<root>/init` |
| `capture` | `<root> <task>` | reads `state`; writes `capture` + `state` | `<root>/capture` |
| `plan` | `<root> <budget> <depth>` | reads `state`; writes `plan` + `state`; prints the `Plan` | `<root>/plan` |
| `work` | `<root>` | writes `work` + `state` | `<root>/work` |
| `claim` | `<root>` | writes `claim` + `state` | `<root>/claim` |
| `packet` | `<root>` | writes `packet` + `state` | `<root>/packet` |
| `return` | `<root>` | writes `return` + `state` | `<root>/return` |
| `learn` | `<root>` | writes `learn` + `state` | `<root>/learn` |
| `correct` | `<root>` | writes `correct` + `state` | `<root>/correct` |
| `retrieve` | `<root>` | reads `graph`; writes `retrieve` | `<root>/retrieve` |
| `status` | `<root>` | reads every known slot; writes `status` | `<root>/status` |
| `op` | `<name>` | none (pure); prints the op descriptor | — |
| `path` | `<root> <verb>` | none (pure); prints the derived path | `<root>/<verb>` |

Every write path is **derived**, never hardcoded in the shell:

```
verb_dir(state, verb) = state ++ "/" ++ verb          # the transition directory
slot(state, verb)     = verb_dir(state, verb) ++ ".state"   # the file written
```

So `capture <root>` writes `slot(root, "capture") = <root>/capture.state`. The
shell never contains a literal verb->directory map; it always calls
`verb_dir`/`slot`. `path <root> <verb>` exposes the derivation directly.

---

## 2. State-directory model

- A **state is a directory** `S` containing one `*.state` file per slot.
- `state.state` is the current manifest: a `State{verb, step, label}` record
  rendered as comma-separated unary `Nat`s (e.g. `2,1,9`).
- A verb reads the slot(s) it needs and writes `slot(S, V)` plus the updated
  `state.state`. `init` is the genesis write.
- `graph.state` is the retrieval graph: line 1 = node ids, remaining lines =
  `src,dst,weight` edges.
- The transition is **pure in derivation**: `verb_dir`/`slot` are pure and
  deterministic; the effectful shell only reads/writes the derived path.

**Directory creation is a shell effect.** Base exposes no `mkdir` (verified:
`~/.bend/bend2/base.bend` has `File.open/read/write/size/close` and no
directory effect; `file_open.c` is `open(2)` with no parent creation). The host
driver must create `<root>` (and any derived directory it uses) before the
kernel writes. The kernel never claims to create a directory; a missing
directory surfaces as an explicit error, not a silent empty state.

---

## 3. Pure core vs effectful shell

| Layer | Contents | Constraint |
|---|---|---|
| **Pure core** (§1–§7 of the file) | verb vocabulary + `verb_of`; `verb_dir`/`slot`; `State` encode/decode; `worse`/`fold_verdicts`; `Task`/`Plan`/`plan`; small diffusion core; status projection | no IO, no clock, no network, no subprocess, no hashing |
| **Effectful shell** (§8) | `main`, `run`/`run_act` dispatch, `File.*`/`IO.*`, slot read/write, graph text parsing, pretty-printers | the only effects; calls the pure core, never embeds its logic |

`Nat.read` (text -> `Nat`) is used **only** in the shell: Base's `Nat.read`
does not normalize inside the checker, so it is deliberately kept out of every
law. This is why the on-disk text form is a shell concern and the universal
state law is stated over the list encoding.

---

## 4. Laws (47 named; each proven by a def of the same name)

### 4.1 Dispatch (6)

| Law | One-line statement |
|---|---|
| `dispatch_total` | every listed verb round-trips through its own name: `verb_of(verb_name(v)) == Some{v}` |
| `dispatch_action_total` | every verb maps to a defined action (`APure`/`AShell`) |
| `dispatch_unknown_is_none` | an unknown verb string maps to `None` (error path) |
| `dispatch_empty_name_is_none` | the empty verb name maps to `None` |
| `counter_empty_args_have_no_verb` | `has_verb(Nil) == False` (absent verb handled) |
| `counter_nonempty_args_have_verb` | `has_verb(["help"]) == True` |

### 4.2 Derivation (5)

| Law | One-line statement |
|---|---|
| `verb_dir_determinism` | `verb_dir(s,v)` is a pure function: same inputs, identical string |
| `verb_dir_witness` | `verb_dir("/r","capture") == "/r/capture"` |
| `verb_dir_distinct` | different verbs derive different directories (`init` vs `capture`) |
| `slot_derived` | `slot(s,v) == verb_dir(s,v) ++ ".state"` (write path is derived) |
| `verb_dir_distinct_all` | `verb_dir("/r","help") == "/r/help"` (derivation witness) |

### 4.3 State round-trip (3)

| Law | One-line statement |
|---|---|
| `state_roundtrip` | for every `State`, `decode(encode(s)) == Some{s}` |
| `state_decode_witness` | `decode([1,2,3]) == Some{State{1,2,3}}` |
| `state_decode_rejects_short` | a truncated record is `None`, never a default |

### 4.4 Verdict fold (9)

| Law | One-line statement |
|---|---|
| `verdict_fold_identity` | `fold(Nil) == Green` |
| `verdict_fold_singleton` | `fold([v]) == v` for every verdict |
| `verdict_fold_red_dominates` | `fold(Red <> vs) == Red` for every tail |
| `verdict_worse_comm` | `worse` is commutative |
| `verdict_worse_assoc` | `worse` is associative |
| `verdict_fold_order_witness` | two permutations of `{Red,Green,Yellow}` fold equal |
| `verdict_fold_yellow_witness` | `fold([Green,Yellow,Green]) == Yellow` |
| `verdict_fold_no_red_green_witness` | `fold([Green,Green]) == Green` |
| `verdict_fold_empty_is_green_not_red` | the empty fold is `Green`, not `Red` |

### 4.5 Plan (13)

| Law | One-line statement |
|---|---|
| `plan_determinism` | same `Task` -> identical `Plan` |
| `plan_leaf_below_threshold` | `budget < leaf_budget` -> leaf, no split |
| `plan_depth_limit_leaf` | `depth >= max_depth` -> leaf even with budget |
| `plan_split_when_budgeted` | `budget >= leaf_budget` and `depth < max_depth` -> split |
| `plan_fanout_proportional` | a split has exactly `fanout` children; a leaf 0 |
| `plan_termination` | on the split arm every child depth is strictly greater |
| `plan_budget_conservation` | `sum(child budgets) <= parent budget` |
| `plan_subtask_independence` | the two children's scopes are distinct |
| `plan_roles_assigned` | children carry distinct roles `[Scout, Worker]` |
| `plan_leaf_no_children` | a leaf has no children |
| `counter_budget_zero_is_leaf` | budget `0` is a leaf (explicit) |
| `counter_depth_at_max_is_leaf` | depth at max is a leaf (explicit) |
| `counter_budget_at_threshold_splits` | budget at the threshold splits (boundary) |

### 4.6 Retrieval (5)

| Law | One-line statement |
|---|---|
| `retrieve_determinism` | same graph/task/budget -> identical ranked ids |
| `retrieve_empty_anchors_quarantine` | empty anchors return nothing |
| `retrieve_scope_all_in` | every returned id is in scope |
| `retrieve_returns_anchor_witness` | zero steps returns the in-scope seed |
| `retrieve_out_of_scope_excluded` | an out-of-scope node is never returned |

### 4.7 Status projection (4)

| Law | One-line statement |
|---|---|
| `status_one_line_per_slot` | one output line per slot read, for every list |
| `status_projection_total_fixture` | the fixture projects to exactly 3 rows |
| `status_render_witness` | a present slot renders `slot\tpresent` |
| `counter_status_absent_explicit` | an absent slot renders `slot\tabsent` |

### 4.8 Op dispatch (2)

| Law | One-line statement |
|---|---|
| `op_known_fixture` | `op_of("fold")` is `Some` |
| `op_unknown_none` | `op_of("not-an-op")` is `None` (error path) |

---

## 5. Counterexamples and handling (explicit, never silent)

| Case | Handling | Evidence |
|---|---|---|
| absent verb (no args) | print verb list, exit 64 | `-- no verb` demo |
| unknown verb | print verb list, `IO.die(64, ...)` | `-- frobnicate` demo (exit 64) |
| unknown op | print verb list, `IO.die(64, ...)` | `-- op nope` demo (exit 64) |
| budget 0 / below threshold | leaf plan, no split | `counter_budget_zero_is_leaf` |
| depth at max | leaf plan, no split | `counter_depth_at_max_is_leaf` |
| truncated state record | `decode` returns `None` | `state_decode_rejects_short` |
| missing state slot | read returns `None`; genesis `State{0,0,0}` | `state_or_genesis` |
| missing graph slot | fixture graph used (documented) | `graph_or_fixture` |
| missing state directory | `File.open` fails; explicit `IO.die` naming the directory | `write_opened` |
| empty scope | nothing returned | `retrieve_empty_anchors_quarantine` |

---

## 6. PROVEN vs DESIGNED

**PROVEN (checker, `All terms check.`)**
- The 47 named laws above, each with a proof def of the same name.
- Dispatch totality for all 14 verb constructors; derivation determinism;
  state list round-trip; verdict fold identity/dominance/commutativity/
  associativity/order witness; plan determinism/termination/budget
  conservation/fan-out/independence/roles; retrieval determinism/scope gating;
  status one-line-per-slot; op dispatch.

**DESIGNED (specified, not proven here)**
- The exact on-disk text format (`Nat.show`/`Nat.read` round-trip) — parsed in
  the shell; Base's `Nat.read` is not checker-normalizing, so only the list
  encoding carries a universal law.
- The directory-creation step — a shell/driver effect (Base has no `mkdir`).
- Slot ordering in `status` (fixed list, not a directory listing — Base has no
  `readdir`).
- Graph text parsing (`src,dst,weight`), validated by the run demos, not laws.
- Any real job/agent wiring: this kernel is a command surface over a state
  directory; it does not spawn agents, merge, or accept anything.

---

## 7. Verification evidence

Checker (repo file, exact command):

```sh
BEND_NO_TELEMETRY=1 ~/.bend/bin/bend runtime/mundus.bend --check-only
# All terms check.   exit 0     (bend 2.0.21)
```

Falsification 1 — mutate `worse(Red, b) -> Yellow{}` in a scratch copy:

```sh
BEND_NO_TELEMETRY=1 ~/.bend/bin/bend <copy> --check-only
# Error:
# - expected : Yellow{}
# - observed : Red{}
# Location: verdict_fold_singleton
# exit 1
```

Falsification 2 — mutate the claim `verdict_fold_identity` `Green{} -> Red{}`:

```sh
BEND_NO_TELEMETRY=1 ~/.bend/bin/bend <copy> --check-only
# Error:
# - expected : Green{}
# - observed : Red{}
# Location: verdict_fold_identity
# exit 1
```

Run demos (scratch root outside the repo; exit codes in comments):

```sh
bend runtime/mundus.bend -- help                 # prints the verb list; exit 0
bend runtime/mundus.bend -- init <scratch>       # writes state/init/graph slots; exit 0
bend runtime/mundus.bend -- capture <scratch> "demo task"   # writes capture.state; exit 0
bend runtime/mundus.bend -- plan <scratch> 8 0   # prints the Plan; exit 0
bend runtime/mundus.bend -- frobnicate           # error path; exit 64
bend runtime/mundus.bend -- path <scratch> capture          # <scratch>/capture.state
bend runtime/mundus.bend -- retrieve <scratch>   # [4,3] from graph.state
bend runtime/mundus.bend -- status <scratch>     # one line per slot
```

---

## 8. Open questions

1. Should a state transition **create** its derived directory (requires a shell
   driver / `mkdir`), or is the current "driver provisions, kernel writes"
   split the intended contract?
2. `status` cannot list a directory (Base has no `readdir`); is a fixed slot
   list acceptable, or should the driver pass the slot list as an argument?
3. Is the on-disk text format (`Nat.show`/`Nat.read`) authoritative, or should
   the list encoding be the wire format?
4. Budget split: the current split delegates the full remaining budget to one
   funded worker and zero to the scout (conservation is provable by
   construction). Is an equal/N-way numeric split wanted, and at what proof
   cost?
5. Should `plan` recurse one level (current) or the host loop it; and what is
   the default `fanout`/`leaf_budget`/`max_depth`?
6. Should `retrieve` be the authoritative retrieval surface, or continue to
   point at `runtime/worker/diffusion.bend`?
7. Which verbs (if any) should become real ops with their own files under the
   op-dispatch convention, and who owns the op registry listing?

---

## 9. Non-claims

- A passing checker is **not** acceptance, truth, a merge, or a verified worker
  answer. Only a named human reviewing the exact revision resolves work.
- No network, credentials, transcripts, or private source ids are touched; the
  kernel hashes nothing and compares bytes/bits only.
- The kernel does not create directories, spawn agents, publish, send, merge,
  tag, or resolve anything.
- `retrieve` is a small faithful pure core, not the full
  `runtime/worker/diffusion.bend` surface.
- This document and the kernel are drafts for human review.
