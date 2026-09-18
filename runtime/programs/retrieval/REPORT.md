# retrieval spike — diffusion retrieval over the job graph (Bend, new-syntax target)

Status: spike complete as sources; machine gate RED (no executable toolchain).
Date: 2026-09-18. Scope: NEW dir only `runtime/programs/retrieval/`
(graph.bend, rank.bend, route.bend, LAWS.bend, PROOF.bend, REPORT.md).
Nothing else touched: no edits to `programs/*.nudge.md`,
`runtime/programs/bend-laws/`, `runtime/programs/cli.py`, or the vault.
No credentials, no network calls from Bend (all defs pure; mains return values).

## 1. Toolchain record

- `command -v bend` → empty. `~/.cargo/bin/bend*` → no matches.
  `/opt/homebrew/bin`, `/usr/local/bin`, `node_modules/.bin` → no bend.
  Conclusion: **no `bend` on PATH at build time**, so `bend check` /
  `bend run-rs` / `bend PROOF.bend` could not be executed here.
- Last verified version in-tree is **bend-lang 0.2.38** (per
  `docs/designs/agit-in-bend.md` §8 and `runtime/programs/bend-laws/README.md`).
  That 0.2.38 CLI has no `guide`/`base` subcommands and **rejects new syntax**
  (`import Base`, `type … is Data`, `law`, `->` annotations) — the bend-laws
  README records exactly this gap. So even a present 0.2.38 could not check
  these files; the new toolchain (bend-lang.com / GUIDE.md) is required.
- New-syntax authority used: GUIDE.md (bend-lang main branch, fetched
  2026-09-18 for this spike) + the bend-lang.com law/proof convention
  (`LAWS.bend` human-owned claims, `PROOF.bend` AI-owned
  `def Laws.<name>` defs, `bend PROOF.bend` gate).

## 2. File map

| File | Lines | Contents |
|---|---|---|
| `graph.bend` | ~150 | `NodeKind` (Job/Post/Artifact), `Graph` CSR (`count/offsets/nbrs/kinds`), total list/CSR helpers (`nsub`, `nth`, `take`, `drop`, `zeros`, `add_at`, `pad_to`, `neighbors_of`, `kind_of`, …), `demo_graph`, `main → out_degree(demo,0) = 4` |
| `rank.bend` | ~175 | particle heat diffusion + teleport (`diffuse_phase` fork-join halves, `teleport`, `step`, `diffuse` with Nat fuel), `demo_heat/seed/alpha`, `demo_rank` (fuel 3), `main → heat_sum = 1200` |
| `route.bend` | ~130 | `Best` top-two scan, `fuse` (wl·lex + wd·pct), `route` (threshold + margin, `Answer`/`Abstain`), `exposes_source` no-leak witness, `demo_lex/fused/route`, `main → Answer{0, 49}` |
| `LAWS.bend` | ~55 | 5 laws: `mass_conservation`, `fuel_zero_identity`, `route_deterministic`, `no_leak`, `step_preserves_heat` |
| `PROOF.bend` | ~60 | 3 closed proofs (`{==}` / case analysis), 1 induction skeleton (`mass_conservation`), 1 `?TODO` leaf (`step_preserves_heat`) |
| `REPORT.md` | this | commands, outputs, gate, pain notes |

## 3. Commands & outputs (execution evidence)

### 3a. Bend gate — blocked, no binary

```sh
$ command -v bend
(empty)
$ bend check runtime/programs/retrieval/graph.bend
zsh: command not found: bend
```

When the new toolchain lands, the gate procedure is (dependency order):

```sh
bend check runtime/programs/retrieval/graph.bend
bend check runtime/programs/retrieval/rank.bend
bend check runtime/programs/retrieval/route.bend
bend check runtime/programs/retrieval/LAWS.bend
bend check runtime/programs/retrieval/PROOF.bend
bend PROOF.bend   # must print all laws hold; currently 1 ?TODO open by design
```

Expected value-mains once runnable: graph `main → 4n`, rank `main → 1200n`,
route `main → Answer{0n, 49n}`.

### 3b. Python oracle — exact algorithm mirror (RAN, all green)

The oracle below implements the same constants and integer ops in the same
order (CSR slice → per-node `q = h/d`, `keep = h − d·q` → takes pool →
`share·s + rem` repatriation; fusion `1·lex + 2·pct`; threshold 30, margin 3).
Paste-recap of the consolidated run (verbatim numbers):

```sh
$ python3 -c '<oracle mirroring rank.bend + route.bend; see §3c>'
degrees: [4, 1, 2, 2, 2, 1] | nbr(0)= [1, 2, 3, 4] | nbr(5)= [0]
round 0 (initial): [1200, 0, 0, 0, 0, 0] sum=1200
after 1 round:     [180, 255, 255, 255, 255, 0] sum=1200
after 2 rounds:    [609, 39, 40, 148, 148, 216] sum=1200
after 3 rounds:    [474, 130, 130, 147, 193, 126] sum=1200
demo_rank(3): [474, 130, 130, 147, 193, 126] sum: 1200
pct:   [39, 10, 10, 12, 16, 10]
fused: [87, 22, 27, 32, 38, 21]
route: top=doc0 score=87 second=38 margin=49 threshold=30 min_margin=3
       -> Answer(doc=0, conf=49)
abstain-zero:      [0,0,0,0,0,0]    -> Abstain(0)  (under threshold)
abstain-tie:       [50,50,10,0,0,0] -> Abstain(1)  (margin 0 < 3, first-max wins ties)
abstain-threshold: [20,10,5,0,0,0]  -> Abstain(0)  (max 20 < 30)
edge in=[1200, 0]                 sum_in=1200 -> sum_out=1200 [474, 130, 130, 147, 193, 126]
edge in=[1200, 0, 0, 0, 0, 0, 50, 60] sum_in=1310 -> sum_out=1310 [495, 133, 134, 152, 198, 128, 32, 38]
edge in=[0, 0, 0, 0, 0, 0]        sum_in=0    -> sum_out=0    [0, 0, 0, 0, 0, 0]
edge in=[7, 0, 0, 0, 0, 0]        sum_in=7    -> sum_out=7    [0, 1, 2, 2, 2, 0]
```

Reading: mass conserved every round and for short/long/zero/tiny inputs
(pad-to-count semantics, §4); demo verdict `Answer{0, 49}`; all three
abstain paths fire with the documented codes.

### 3c. Oracle source (runnable as-is; no new files created)

The §3b numbers come from this single `python3 -c` program (CSR, diffuse,
teleport with `s==0 → identity`, fusion, verdict function as specified above).
It is quoted here rather than stored so `retrieval/` keeps exactly the six
spike artifacts:

```python
offsets=[0,4,5,7,9,11,12]; nbrs=[1,2,3,4, 0, 0,3, 4,5, 0,5, 0]; count=6
deg=[offsets[i+1]-offsets[i] for i in range(count)]
def pad(h): return list(h)+[0]*max(0,count-len(h))
def nbr(i): return nbrs[offsets[i]:offsets[i+1]] if i<count else []
def diffuse(h):
    h=pad(h); m=len(h); new=[0]*m
    for i,hi in enumerate(h):
        d=deg[i] if i<count else 0
        if d==0: new[i]+=hi
        else:
            q=hi//d; new[i]+=hi-q*d
            for j in nbr(i): new[j]+=q
    return new
def teleport(h,seed,s,num,den):
    if s==0: return list(h)
    takes=[(hi*num)//den for hi in h]; pool=sum(takes)
    base=[hi-t for hi,t in zip(h,takes)]
    share=pool//s; rem=pool-share*s; out=list(base); first=True
    se=list(seed)+[0]*max(0,len(h)-len(seed))
    for i,f in enumerate(se):
        if f==1:
            out[i]+=share
            if first: out[i]+=rem; first=False
    return out
def step(h,seed,s,n,d): return teleport(diffuse(h),seed,s,n,d)
```

## 4. Design lineage (where each requirement lives)

Demo graph (CSR `offsets=[0,4,5,7,9,11,12]`,
`nbrs=[1,2,3,4, 0, 0,3, 4,5, 0,5, 0]`), causal nodes from `job-contract.md`:

| Node | Kind | Contract source |
|---|---|---|
| 0 | Job | job 5046e555 ("Add Agent activity model", §9 example) |
| 1 | Job | follow-up job (`followUpJobIds`, §8 gate) |
| 2 | Post | timeline `job.proposed` (§5) |
| 3 | Post | timeline `job.review_requested` (§5) |
| 4 | Artifact | `ag-map-01` Candidate, rev abc (§7) |
| 5 | Artifact | `ag-map-01` Accepted by human ≠ producer (§7, resolution gate §8) |

Edges mirror the contract arrows: 0→{1,2,3,4} (owns/parents), 1→0, 2→{0,3}
(backlink, timeline order), 3→{4,5} (attaches), 4→{0,5} (resolves, lineage),
5→0 (accepted→job).

Patterns taken from `agit-in-bend.md` §1–§7: closed ADTs + total functions
(no seventh state, no partial route); Nat-fuel bounded driver + fork-join
(§6, translated: old `bend`/`fork` blocks → fuel-first countdown +
parallel-let halves); shell/Bend split (§7, table below); byte-exact
determinism requirement (§4 laws as pure defs).

`jobs.js` tie-in (read-only): `brief(job, context)` builds the model prompt
from `contextSnapshots` (120 KB cap, sha256 each). Diffusion ranking is the
proposed *selector* for that context list — it decides which snapshots enter
the brief; it never writes the brief. `nudge-simplify.md` §2.8 tie-in:
`host.output_excludes: ["sourceIds"]` is exactly LAWS law 4 (`no_leak`);
the `Route` type has no provenance fields by construction, and the host keeps
the exact-ID guard on its side.

## 5. Gate table

| # | Law | Proof status in PROOF.bend | Oracle evidence |
|---|---|---|---|
| 1 | `mass_conservation` (any fuel, any vector) | induction skeleton; step case rewrites via law 5 + IH | §3b: every round + 4 edge shapes conserve exactly |
| 2 | `fuel_zero_identity` (pointwise) | CLOSED (`{==}` by computation) | `diffuse(0n,…) ≡ h` definitional |
| 3 | `route_deterministic` | CLOSED (reflexivity) | verdict fn deterministic; tie → first-max pinned |
| 4 | `no_leak` | CLOSED (case analysis, both arms `False{}`) | `Answer`/`Abstain` carry index+codes only |
| 5 | `step_preserves_heat` | skeleton + `?TODO` leaf (new-checker Nat reasoning needed) | §3b per-node facts: `d·q + (h−d·q) == h`, pool fully repatriated |

Overall: **RED on this machine (no toolchain); 3/5 laws fully proven in
source, 2/5 proof skeletons with machine-check pending.** The single `?TODO`
is intentional: it keeps `bend PROOF.bend` honestly failing until the new
checker discharges the arithmetic leaf.

## 6. Syntax gaps & unverified assumptions (new toolchain must confirm)

1. No executable `bend` anywhere on PATH (§1) — nothing machine-checked.
2. 0.2.38 (last in-tree version) rejects the whole target surface
   (`import Base`, `is Data`, `law`, `->`, `1n` patterns); documented in
   bend-laws README, not re-probed here.
3. Quantity threading (`+List<Nat>` fields/params, `+x = …` lets, `+`-match
   handing out `+` fields) follows GUIDE text but is untested against real
   Base — especially list literals (`[1200n, …]`) ascribed to `+List<Nat>`.
4. Base names assumed from the `Type.verb` scheme, never imported:
   `Nat.is_eq/is_gt/is_ge`; bare `+ - * /` and `<`-family on Nat without
   `:T`; `Nat`/`Bool`/`List`/`True{}`/`False{}`/`Nil{}`/`Con{}` shapes.
   U32 deliberately avoided end-to-end (all-Nat fixed point) to shrink this.
5. Cross-module surface: `import ./x.bend as Alias`, `Alias.def` calls,
   `Alias.Type` annotations, `Route.Answer{…}` qualified patterns in PROOF,
   `Route.Route` type reference in LAWS law 3/4.
6. Proof-term shapes: `{==}` reflexivity, `%e : P` rewrite with `_` motive
   (copied from the GUIDE `add_zero` pattern), `?TODO` open leaf.
7. Multi-scrutinee `match a b:` with mixed `Con{…} 1n+p` / `Nil{} _` arms;
   nested matches on parameters only (never on computed values — all
   branching goes through Bool-param helpers).

## 7. Pain notes (new-syntax constraints that shaped the code)

- No `if`: every branch is `match` on a `Bool`-typed parameter, so
  comparisons (`is_eq/is_gt/is_ge`, zero-tests) are computed at call sites
  and dispatched in `*_branch` / `*_cell` helpers (7 such helpers).
- `match` never scrutinizes a computed value: `out_begin(g,i)`-style lets
  are inlined into helper arguments instead.
- Termination drives parameter order: the shrinking List/Nat comes first
  (fuel FIRST in `diffuse`), accumulators/indices after ("ones after it are
  free"). `spread`/`give_back`/`zip_add` had to be reordered for this.
- Sharing forces `+`: parallel halves read the same graph/heat, and
  `out_degree`/`neighbors_of` read CSR slices thrice — all affine threading
  attempts failed on paper, hence `+List<Nat>` everywhere.
- Conservation made unconditional by construction (`pad_to` + saturating
  `nsub` + `s==0 → identity` teleport), which is what lets law 1 quantify
  over ALL vectors with no well-formedness premise.
- Integer-only PageRank (particles, floor-div remainders kept in place,
  teleport remainder to first seed) conserves exactly where floats would
  need an epsilon law.

## 8. Shell vs Bend boundary (agit-in-bend §7 applied)

| Concern | Owner | Note |
|---|---|---|
| CSR bytes, sha256, hex-decode, snapshot text, keyword counts | shell/host | Bend receives Nat counts only |
| Commits, notes refs, tags, merges, human roster, reviewer ≠ worker | git via shell | unchanged by this spike |
| Diffusion scores, fusion, threshold/margin verdict, abstain | pure Bend | this spike; deterministic |
| `sourceIds` exclusion | BOTH | Bend: unrepresentable output; host: `output_excludes` guard |
| SQLite projection, Buzz replies, brief assembly | desk / steward | retrieval only selects context |

## 9. Next actions

1. Install the new Bend toolchain side-by-side; run the §3a gate procedure.
2. Audit §6.3–§6.5 names against real `bend base` output; fix and re-run.
3. Close the law-5 `?TODO` under the checker; `bend PROOF.bend` must print
   all-laws-hold before any host wiring.
4. Wire host: CSR export from desk jobs + lexical counts from context
   snapshots → `diffuse`/`route` → brief context selection; keep
   `output_excludes` guard in the wrapper.

## 8. Addendum 2026-09-18: real-gate pass (parent session, bend 2.0.5)

New toolchain (`/Users/a3fckx/.bend/bin/bend`, 2.0.5; legacy removed) run
against this dir. Fixes applied (semantics verified identical to §3 oracle:
heat `1200n`, `Answer{0n, 49n}`, out-degree `4n`):
- `nsub`: match params in declaration order (a before b).
- Proof-def params take no `+` annotations (laws keep `for +h`).
- `Nat` scalars reused in one path are `+` (Data, refcounted).
- `G.zip_add` → `zip_add` (defined in rank.bend).
- `give_cell`/`give_back` mutual recursion fused into single `give_back`
  (Bend bans cycles; guide prescribes mode-selector defs).
- `best_cell`/`best_cell2`/`best_two` cycle replaced by single `best_two`
  using `Bool.pick` value-selection (Base idiom) + one structural recursion.
- Binder order found empirically: outer-pattern vars before params
  (f before rem).
Gate: all defs check; 4/5 laws hold; `step_preserves_heat` keeps its
intentional `?TODO` (`Error: 1 TODO found`) — the per-node arithmetic leaf
is the only open item. Demos execute: rank `1200n`, route `Answer{0n,49n}`.
