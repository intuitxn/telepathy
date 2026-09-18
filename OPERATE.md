# Telepathy — operate (one page)

Root for every command below: `/Users/a3fckx/Desktop/Attri/telepathy`.
```sh
cd /Users/a3fckx/Desktop/Attri/telepathy
```

> Pointers, not repeats. Rationale lives in linked docs.
> System: `docs/designs/SYSTEM.md` · Harness: `HARNESS.md` · Programs: `runtime/programs/README.md` · State store: `docs/designs/agentic-git.md` · People flow: `forum/START_HERE.md` (+ `forum/WRITING.md` before artifacts).

## 1. Prove — the Bend gate

Toolchain: `bend 2.0.5` only at `/Users/a3fckx/.bend/bin/bend`. Always absolute path, always `BEND_NO_TELEMETRY=1`. Never bare `bend`. There is **no `bend check`** on 2.0.5.

```sh
export BEND_NO_TELEMETRY=1
BEND=/Users/a3fckx/.bend/bin/bend

$BEND --version
# expect: bend 2.0.5

# THE GATE — must print `All terms check.`, exit 0:
$BEND /Users/a3fckx/Desktop/Attri/telepathy/runtime/programs/bend-laws/PROOF.bend

# Negative control — must FAIL with `5 TODOs found` (laws without proofs):
$BEND /Users/a3fckx/Desktop/Attri/telepathy/runtime/programs/bend-laws/LAWS.bend
```

Per-program law verdict (over that program's inline `bend-law`/`bend-proof` fences):

```sh
/Users/a3fckx/Desktop/Attri/telepathy/runtime/programs/telepathy-program bend-gate <name>
# verdict: proven | open | failed | needs-toolchain
```

Detail: `runtime/programs/bend-laws/TOOLCHAIN.md`, `runtime/programs/bend-laws/README.md`.

## 2. Transact — one program run

Binary: `/Users/a3fckx/Desktop/Attri/telepathy/runtime/programs/telepathy-program`. Model default `opencode-go/deepseek-v4-flash` (`--model` / `TELEPATHY_PROGRAM_MODEL` overrides). Auth stays in your existing profile; nothing credential-like goes into bundles/receipts.

```sh
TP=/Users/a3fckx/Desktop/Attri/telepathy/runtime/programs/telepathy-program

$TP list
$TP compile <name>                                   # immutable bundle + digest, no model call
$TP inspect <name>                                   # {source,digest,frozenDigest} of active source
$TP bend-gate <name>                                 # §1 verdict for this program
printf '%s' '{"title":"…","body":"…","sourceIds":[]}' | $TP run <name> --input - > result.json
$TP gen-runner <name>                                # digest-pinned runner in runtime/programs/runners/ (gitignored); refuses on drift
```

Lesson sub-flow (proposal only — activation still needs a human reviewer + exact digests):

```sh
$TP validate-candidate <name> --input - < candidate.json  # {source,parentDigest} → {valid,digests}
$TP promote-candidate <name> --input - < review.json      # exact-digest, locked, atomic pointer move
```

Contract tests: `python3 -m unittest discover -s runtime/programs -p 'test_*.py'` from the repo root (stdlib-only; runs without the nudge checkout). Live-model runs: `runtime/programs/LIVE_RUN.md`. Full rules: `runtime/programs/README.md`.

## 3. Remember — agit walk + human accept

`agit` records every transition as a git object (commit/note/tag); it never invents digests — it copies them from `result.json` (receipt) + `proof.json`. SQLite (`.local/`) is a rebuildable cache; on disagreement **git wins**. Design: `docs/designs/agentic-git.md` (note: its §3 sketch shows `bend check` — superseded; gate is bare `bend PROOF.bend` per §1).

```sh
AGIT="python3 /Users/a3fckx/Desktop/Attri/telepathy/scripts/agit.py"

$AGIT propose --job <id> --program <name> --request request.json
$AGIT ready   --job <id>                        # refs/notes/agit-state
# … run the program (§2), prove with Bend (§1) …
$AGIT run     --job <id>                        # Active commit (bundle digest + receipt id)
$AGIT prove   --job <id> --proof proof.json     # Waiting note (refs/notes/agit-proof)
$AGIT review  --job <id>                        # Review commit (candidate digest)

# ONLY a named human, on the exact reviewed revision:
$AGIT accept  --job <id> --reviewer "Name"      # gate re-check → merge --no-ff → tag agit/<id>/resolved
$AGIT cancel  --job <id> --by "Name" --reason "…"

$AGIT log   <id>    # transition history from git alone
$AGIT state <id>    # current stage + digests + what blocks next
```

Gate inside `accept`: proof `pass` + candidate==reviewed==merged bytes + reviewer human ≠ worker + bundle digest == active compile digest + no open law. Any failure: no merge, no tag, named rule.

## 4. Crew — who does what

- **bend-forge** (`.opencode/agents/bend-forge.md`): does Bend defs/laws/`PROOF.bend` + gates with negative controls, one job per file. Never self-accepts, merges, tags, touches network/credentials, or sends externally.
- **relay-keeper** (`.opencode/agents/relay-keeper.md`): does service/tunnel/port-4110/node-route health (`scripts/workspace-service.py status`, `npm run doctor`) + user-domain service restart on approved proposal. Never publishes, accepts, resolves, touches credentials/invites, rewires the network, or sends externally.

Job lifecycle both assume: `Proposed -> Ready -> Active -> Waiting -> Review -> Resolved | Cancelled` (`HARNESS.md` §2). Agents draft; humans accept.

## 5. Share / publish — thread → accept → artifact → link

Per `forum/START_HERE.md`: request lives in a thread (`Result` + `Owner` + `Ready when` + `Context` + links); an operator turns an accepted request into a job; candidate comes back for review; human accepts the **exact** revision; reply **in the original thread** with accepted result + link + still-open items. Code → its repo, linked from thread. Writing → artifact, linked from thread.

```sh
npm run desk -- help          # jobs, artifacts, Buzz drafts
npm run check                 # runtime + plugin
npm --prefix site run check   # website (separate)
```

Before writing: read `forum/WRITING.md`. Never put credentials, transcripts, or internal job metadata in an artifact; published `/p/` link quoted in the thread is the stable pointer, never a SQLite row id alone. Boundary: `AGENTS.md`.

## 6. Troubleshoot — 5 reds

| Red | Means | Fix |
|---|---|---|
| `bend: too many arguments` on `bend check …` | 2.0.5 has no `check` subcommand | use bare form §1 |
| `LAWS.bend → 5 TODOs found` | laws asserted, not yet proved — expected | gate `PROOF.bend`, not `LAWS.bend` |
| `bend-gate → failed` / `open` | a law is red / unproven for this program | new candidate + fresh proof; never edit the old proof note |
| `run → failure` envelope, exit ≠ 0 | contract/type violation, 90 s timeout, or source-ID guard (output echoed a supplied `sourceIds` entry) | fix input/output, keep provenance IDs out of title/body, human re-reviews |
| `agit accept` refuses / `gen-runner` refuses on drift | stale digest (bundle/candidate/parent moved), self-accept, open law, leak scan, or SQLite≠git | `agit state <id>` shows the blocker; reconcile to git, revalidate exact digests, human re-accepts |
