# CLI Thinning Audit — shell may only invoke checked kernel transitions with explicit arguments and perform irreducible host effects

Root: `/Users/a3fckx/Desktop/Attri/telepathy`
Date (UTC): 2026-09-24
Method (read-only): `Read` + `sh -n` syntax check only. No execution beyond `sh -n` / `git status --short`.
`sh -n` result: `mundus`, `runtime/ops/run.sh`, `runtime/worker/run.sh`, `scripts/memory-sync.sh`, `scripts/census.sh`, `scripts/learn-loop.sh`, `scripts/install-bend-ci.sh`, `scripts/install-jj-ci.sh`, `scripts/setup-programs.sh`, `scripts/worktree-guard.sh`, `scripts/refresh-notes.sh`, `scripts/install-meta.sh`, `runtime/worker/engrams/verify-lorenz.sh` — all `syntax OK`.

Rule under audit: "the shell may only invoke checked kernel transitions with explicit arguments and perform irreducible host effects; it must never branch on state, mutate outside a transition, or inline logic."
Scope: `./mundus`, `runtime/ops/run.sh`, `runtime/worker/run.sh`, `scripts/memory-sync.sh`, `scripts/census.sh`, `scripts/durability-guard.sh`, `scripts/learn-loop.sh`, `runtime/meta_shell.py`, `scripts/*.sh` generally, `runtime/worker/engrams/verify-lorenz.sh`.
`scripts/durability-guard.sh` is `sh` wrapper `exec python3 -` heredoc; Python lines cited as `scripts/durability-guard.sh:<line>`.
`runtime/meta_shell.py` is Python host; same rule applied (host may only call `_bend`/`_transition` with explicit args + irreducible effects).

Conformance rule (one line, auditor grep — FAIL if any match branches on / interprets / mutates managed kernel state outside a checked transition):
`rg -n 'grep -q.*(All terms check\.|TODO)|FIXTURE_OUT.*EXPECTED|NORMALIZED.*EXPECTED|case "\$head"|cat "\$root/head"|python3 -c|sort.*(memory|census)\.in|ref_count|is_hex64|owner_pubkey|agent_pubkeys|buzz_slugs|sha_hex.*body|awk .NF|if \[.*(GATE_CODE|FIXTURE_CODE|patch_changed|age)|lorenz_snapshot_saved|re\.findall.*\^id=' -- mundus runtime/ops/run.sh runtime/worker/run.sh scripts/memory-sync.sh scripts/census.sh scripts/durability-guard.sh scripts/learn-loop.sh runtime/meta_shell.py scripts/*.sh`

Notation: MUST-MOVE = branch on managed state / interpret state content / compute kernel decision / mutate managed state outside kernel transition (needs owning kernel op/law). LEGIT-HOST-EFFECT = mkdir, exec/spawn, hash, network/relay, keychain, file copy, printing, exit codes (stays in shell).

---

## 1. `./mundus` — VERDICT: THIN (MUST 0 / LEGIT 8)

MUST-MOVE: none. All `case` branches are on CLI argv (`$verb`, `${2:-}`), not on snapshot/memory/checker content. `mkdir -p "$root/planner"` prepares experimental planner root (host dir effect, not Bend lineage mutation).

LEGIT-HOST-EFFECT:
- `mundus:42` `verb=${1:-help}` — CLI default (arg handling).
- `mundus:44` `case "$verb" in` — static verb dispatch.
- `mundus:45` `exec "$SELF_DIR/runtime/ops/run.sh" "$@"` — exec/spawn.
- `mundus:46` `exec "$SELF_DIR/scripts/durability-guard.sh" "$@"` — exec/spawn.
- `mundus:49` `shift; exec "$SELF_DIR/scripts/memory-sync.sh" "$@"` — exec/spawn.
- `mundus:53` `exec "$SELF_DIR/runtime/worker/run.sh" "$@"` — exec/spawn (worker lineage).
- `mundus:62` `mkdir -p "$root/planner"` — mkdir.
- `mundus:64` `exec "$BEND" "$SELF_DIR/runtime/mundus.bend" -- "$verb" "$root/planner" "$@"` — checked kernel exec + `mundus:66` `echo "mundus: unknown verb` + `exit 64` — printing + exit code.

## 2. `runtime/ops/run.sh` — VERDICT: MIXED (MUST 7 / LEGIT 18)

MUST-MOVE:
- M1 `runtime/ops/run.sh:251` `if [ "$GATE_CODE" -eq 0 ] && printf '%s\n' "$GATE_OUT" | grep -qx 'All terms check\.' && ! printf ... | grep -q TODO` — branches on checker output content to decide fixture run. Own: kernel op `GateDecide` / law `GateAllCheckedNoTodo`.
- M2 `runtime/ops/run.sh:266` `if [ "$GATE_CODE" -eq 0 ] && printf ... | grep -qx 'All terms check\.' && ! ... | grep -q TODO; then` — duplicate gate-verdict computation. Own: `GateDecide`.
- M3 `runtime/ops/run.sh:268` `elif printf '%s' "$GATE_OUT" | grep -q 'TODO'` — interprets checker TODO marker. Own: `GateOpenLaw`.
- M4 `runtime/ops/run.sh:283` `case "$NAME" in` + `runtime/ops/run.sh:285` `if [ "$FIXTURE_OUT" = "$EXPECTED" ]; then` — compares fold output to inlined `fixture 14 / fixture_max 5`. Own: kernel op `FoldFixtureCheck` / law `FoldExpected`.
- M5 `runtime/ops/run.sh:304` `NORMALIZED=$(printf '%s\n' "$FIXTURE_OUT" | awk 'NF {$1=$1; print}')` — inline `awk` normalization of kernel output. Own: `StatusNormalize` law.
- M6 `runtime/ops/run.sh:305` `if [ "$NORMALIZED" = "$EXPECTED" ]; then` — compares status table (8-line `EXPECTED_STATUS`) in shell. Own: kernel op `StatusFixtureCheck` / law `StatusExpected`.
- M7 `runtime/ops/run.sh:338` `for _v in "$GATE_VERDICT" ...; do` + `runtime/ops/run.sh:346` `if [ "$r" -gt 0 ]; then` — tallies GREEN/YELLOW/RED to compute `exit_code`. Own: kernel op `VerdictAggregate` / law `ExitRedNonzero`.

LEGIT-HOST-EFFECT:
- L1 `runtime/ops/run.sh:19` `umask 077` — host mode.
- L2 `runtime/ops/run.sh:37` `bend_binary() {` + `runtime/ops/run.sh:45` `now_utc() {` + `date -u` — exec/time.
- L3 `runtime/ops/run.sh:49` `sha256_file() {` + `shasum -a 256` / `sha256sum` — hash.
- L4 `runtime/ops/run.sh:59` `sanitize() {` + `tr -c` + `sed` — filename-safe host transform.
- L5 `runtime/ops/run.sh:63` `abspath() {` + `( CDPATH= cd ... && pwd -P)` — path effect.
- L6 `runtime/ops/run.sh:107` `command_list()` + `printf '%s -> %s\n'` — printing.
- L7 `runtime/ops/run.sh:113` `write_brief() {` + `> "$run_dir/brief"` — file write (task-data mirror).
- L8 `runtime/ops/run.sh:170` `write_evidence() {` + `> "$run_dir/evidence"` — file write.
- L9 `runtime/ops/run.sh:228` `mkdir -p "$RUNS_DIR"` + `runtime/ops/run.sh:229` `mkdir "$run_dir"` — mkdir.
- L10 `runtime/ops/run.sh:231` `cp "$OP_PATH" "$run_dir/source.bend"` — file copy.
- L11 `runtime/ops/run.sh:239` `head=$(git -C "$ROOT" rev-parse HEAD` — VCS observation (read-only).
- L12 `runtime/ops/run.sh:243` `toolchain=$( cd "$ROOT" && BEND_NO_TELEMETRY=1 "$BEND" version` — exec/spawn.
- L13 `runtime/ops/run.sh:247` `GATE_OUT=$( cd "$ROOT" && BEND_NO_TELEMETRY=1 "$BEND" "$CHECKED_SOURCE" --check-only` — checked-kernel exec.
- L14 `runtime/ops/run.sh:252` `FIXTURE_OUT=$( cd "$ROOT" && BEND_NO_TELEMETRY=1 "$BEND" "$CHECKED_SOURCE"` — checked-kernel exec.
- L15 `runtime/ops/run.sh:313` `DRIVER_DIGEST=$(sha256_file` — hash.
- L16 `runtime/ops/run.sh:319` `PATCH_TEXT=$(git -C "$ROOT" diff HEAD` — VCS observation.
- L17 `runtime/ops/run.sh:353` `printf '%s\n' "$PATCH_TEXT" > "$run_dir/candidate.patch"` — file write.
- L18 `runtime/ops/run.sh:379` `main() {` + `case "$cmd" in` + `while [ $# -gt 0 ]` arg parse + `usage >&2` + `return 2` — CLI parsing / printing / exit codes.

## 3. `runtime/worker/run.sh` — VERDICT: MIXED (MUST 5 / LEGIT 12)

MUST-MOVE:
- M1 `runtime/worker/run.sh:34` `head=$(cat "$root/head")` + `runtime/worker/run.sh:36` `case "$head" in step.?*)` — interprets HEAD pointer content. Own: kernel op `HeadRead` / law `HeadWellFormed`.
- M2 `runtime/worker/run.sh:37` `case "$head" in *[!a-zA-Z0-9._-]*|*..*) fail` — charset/traversal validation in shell. Own: `HeadWellFormed`.
- M3 `runtime/worker/run.sh:44` `status) exec "$BEND" "$SOURCE" -- history "$input"` — maps `status` verb to `history` transition in shell. Own: kernel dispatch law `StatusIsHistory`.
- M4 `runtime/worker/run.sh:74` `grep -qx 'All terms check\.' "$attempt/check.txt" || fail` — gate on checker text. Own: `KernelGate`.
- M5 `runtime/worker/run.sh:83` `task=$1; actor=${2:-codex}; origin=${3:-local:mundus}` — silent defaults for explicit args. Own: kernel op `CaptureValidate` / law `NoShellDefaults` (caller must pass explicit actor/origin).

LEGIT-HOST-EFFECT:
- L1 `runtime/worker/run.sh:7` `umask 077` — host mode.
- L2 `runtime/worker/run.sh:11` `case "$SOURCE" in /*)` — absolute-path guard.
- L3 `runtime/worker/run.sh:19` `case "$root" in /*)` + `root="$PWD/$root"` — path effect.
- L4 `runtime/worker/run.sh:22` `case "$verb" in` arity checks (`init/capture/work/...`) — CLI arg validation.
- L5 `runtime/worker/run.sh:49` `mkdir -p "$root"` + `runtime/worker/run.sh:63` `mkdir -p "$root/snapshots"` — mkdir.
- L6 `runtime/worker/run.sh:53` `mkdir "$root/.writer-lock"` + `trap cleanup EXIT` — lock mkdir + trap.
- L7 `runtime/worker/run.sh:64` `attempt=$(mktemp -d` — temp dir.
- L8 `runtime/worker/run.sh:68` `cp "$SOURCE" "$attempt/source.bend"` — file copy (checked-bytes pin).
- L9 `runtime/worker/run.sh:70` `"$BEND" "$SOURCE" --check-only > "$attempt/check.txt"` — checked-kernel exec.
- L10 `runtime/worker/run.sh:75` `shasum -a 256` / `sha256sum` — hash.
- L11 `runtime/worker/run.sh:88` `if "$BEND" "$SOURCE" -- "$@" > "$attempt/result.txt"` — checked-kernel exec + exit code.
- L12 `runtime/worker/run.sh:91` `mv "$attempt/head.next" "$root/head"` + `cat result` / `exit "$rc"` — atomic publish + printing + exit code.

Note: `runtime/worker/run.sh:89` `[ -f "$output" ] || fail` + `L90-91` HEAD `mv` mutates `root/head` outside Bend; retained here as host atomic-publish effect per file header, but strict reading wants kernel op `HeadAdvance`.

## 4. `scripts/memory-sync.sh` — VERDICT: LOGIC-HEAVY (MUST 12 / LEGIT 10)

MUST-MOVE:
- M1 `scripts/memory-sync.sh:25` `is_hex64() {` + `case "$1" in *[!0-9a-fA-F]*)` — pubkey/slug validation logic. Own: kernel law `PubkeyWellFormed`.
- M2 `scripts/memory-sync.sh:69` `/usr/bin/python3 -c '` + `scripts/memory-sync.sh:73` `if v.startswith("nsec"):` — bech32/secp256k1 private→public derivation in host Python. Own: kernel op `IdentityDerive`.
- M3 `scripts/memory-sync.sh:109` `/usr/bin/python3 -c '` + `scripts/memory-sync.sh:117` `for k in d.keys():` — keychain + `managed-agents.json` + env aggregation/dedup/sort. Own: kernel op `AgentSetResolve`.
- M4 `scripts/memory-sync.sh:146` `/usr/bin/python3 -c '` + `for e in sorted((x.get("slug")` — parses `buzz mem ls --json` to sorted slugs. Own: kernel op `MemoryListProjection`.
- M5 `scripts/memory-sync.sh:163` `if [ -n "$owner_pub" ] && is_hex64` — branches on identity state. Own: `SyncScopeDecide`.
- M6 `scripts/memory-sync.sh:177` `LC_ALL=C sort -u -t'|' -k2,2` — host sort/dedup of entries. Own: `MemoryEntriesOrdered`.
- M7 `scripts/memory-sync.sh:179` `/usr/bin/python3 -c '` + `if slug and slug not in seen: seen[slug] = sc` — first-scope-wins + sorted merge. Own: kernel op `MemoryMerge` / law `OwnerWins`.
- M8 `scripts/memory-sync.sh:195` `case "$enc" in */*|"" ) die` — slug-shape validation. Own: `SlugWellFormed`.
- M9 `scripts/memory-sync.sh:197` `if [ "$scope" = "owner" ]; then` + `scripts/memory-sync.sh:201` `for ap in $agents; do` + `if "$BUZZ" mem get ...; then got=1; break` — owner/agent fetch + agent fallback loop. Own: kernel op `MemoryFetch` / law `ScopeFetchPriority`.
- M10 `scripts/memory-sync.sh:207` `printf '%s|%s\n' "$slug" "$d" >>"$tmpd/index"` + `scripts/memory-sync.sh:208` `cp "$body" "$root/memory/$enc"` + `scripts/memory-sync.sh:211` `LC_ALL=C sort ... >"$root/memory.in"` — assembles + mutates managed `memory/` + `memory.in` outside transition. Own: kernel op `MemoryCommit`.
- M11 `scripts/memory-sync.sh:225` `/usr/bin/python3 -c '` + `print(line.split("|", 1)[0])` — interprets `memory.in` in `do_ls`. Own: kernel op `MemoryProjection` (shell should call `memory` transition).
- M12 `scripts/memory-sync.sh:241` `do_ensure() {` + `scripts/memory-sync.sh:243` `if [ ! -s "$root/memory.in" ]; then` + `scripts/memory-sync.sh:250` `age=$((now - mt))` — freshness (size/mtime/age) decision + `get` direct `cat` (`scripts/memory-sync.sh:238` `cat "$root/memory/$enc"` without kernel). Own: kernel ops `FreshnessCheck` / `MemoryGet`.

LEGIT-HOST-EFFECT:
- L1 `scripts/memory-sync.sh:34` `abspath()` + `printf '%s' "$PWD/$1"` — path effect.
- L2 `scripts/memory-sync.sh:37` `sha_hex() {` + `shasum -a 256` / `sha256sum` — hash.
- L3 `scripts/memory-sync.sh:47` `encode_slug() {` + `sed 's|/|__|g'` — host filename encoding.
- L4 `scripts/memory-sync.sh:54` `security find-generic-password -s buzz-desktop -w` — keychain.
- L5 `scripts/memory-sync.sh:60` `[ -x "$BUZZ" ] || die` — exec guard + `die` printing/exit.
- L6 `scripts/memory-sync.sh:142` `"$BUZZ" mem ls --json --owner` / `--agent` — network/relay exec.
- L7 `scripts/memory-sync.sh:156` `mkdir -p "$root/memory"` + `scripts/memory-sync.sh:158` `tmpd="$(mktemp -d)"` + `trap "rm -rf` — mkdir/temp/trap.
- L8 `scripts/memory-sync.sh:198` `"$BUZZ" mem get "$slug" --owner` / `--agent` — network/relay exec.
- L9 `scripts/memory-sync.sh:213` `printf 'sync: %d entries` — printing.
- L10 `scripts/memory-sync.sh:257` `case "$cmd" in sync) ls) get) ensure)` — CLI dispatch + `exit 64` codes.

## 5. `scripts/census.sh` — VERDICT: LOGIC-HEAVY (MUST 9 / LEGIT 8)

MUST-MOVE:
- M1 `scripts/census.sh:47` `is_test_name() {` + `case "$(basename` in `*test*)` — test-wins classifier. Own: kernel law `KindTestWins`.
- M2 `scripts/census.sh:60` `for f in "$REPO_ROOT"/runtime/*.bend; do` + `scripts/census.sh:63` `if is_test_name` — kernel-kind assignment. Own: `KindClassify`.
- M3 `scripts/census.sh:71` `find "$REPO_ROOT/runtime/worker" -type f -name "*.bend"` + `scripts/census.sh:79` `printf 'kernel|%s\n'` — traversal + kind. Own: `KindClassify`.
- M4 `scripts/census.sh:84` `for f in .../runtime/ops/*.bend` + `add_record "op"` — op-kind. Own: `KindClassify`.
- M5 `scripts/census.sh:95` `find .../runtime/programs ...` + `printf 'program|%s\n'` — program-kind. Own: `KindClassify`.
- M6 `scripts/census.sh:108` `if [ -f "$REPO_ROOT/mundus" ]; then` + `scripts/census.sh:118` `for f in .../scripts/*.sh` — host-kind. Own: `KindClassify`.
- M7 `scripts/census.sh:128` `find "$REPO_ROOT/docs" -type f -name "*.md"` + `scripts/census.sh:140` `for f in "$REPO_ROOT"/*.md` — doc-kind. Own: `KindClassify`.
- M8 `scripts/census.sh:177` `ref_count() {` + `scripts/census.sh:184` `rg -l -F ... -e "$rel" -e "$base"` + `scripts/census.sh:196` `while IFS= read -r hit; do` exclusion chain — reference counting over repo content. Own: kernel op `ReferenceCount`.
- M9 `scripts/census.sh:216` `LC_ALL=C sort -t '|' -k 2,2 -u` + `scripts/census.sh:219` `while IFS='|' read -r kind rel; do` + `scripts/census.sh:231` `LC_ALL=C sort ... > "$OUT_FILE"` — dedup + record build + mutate `<root>/census.in` outside transition. Own: kernel ops `CensusDedup` / `CensusCommit`.

LEGIT-HOST-EFFECT:
- L1 `scripts/census.sh:36` `mkdir -p "$OUT_ROOT"` — mkdir.
- L2 `scripts/census.sh:42` `TMP_KINDS="$(mktemp` + `trap 'rm -f` — temp/trap.
- L3 `scripts/census.sh:60` `for f in ...; [ -f "$f" ]` + `find ... -print` — spawn/enumerate.
- L4 `scripts/census.sh:160` `sha_hex() {` + `sha256sum` / `shasum -a 256` — hash.
- L5 `scripts/census.sh:184` `rg -l -F` vs `scripts/census.sh:188` `grep -rlF` — observation exec (content search as host effect; decision itself MUST-MOVE per M8).
- L6 `scripts/census.sh:210` `wc -l | tr -d ' '` — count host util.
- L7 `scripts/census.sh:214` `SORTED_KINDS="$(mktemp` — temp.
- L8 `scripts/census.sh:25` `exit 64` + `echo "usage:` — printing/exit codes.

## 6. `scripts/durability-guard.sh` — VERDICT: MIXED (MUST 6 / LEGIT 10)

MUST-MOVE (Python heredoc lines):
- M1 `scripts/durability-guard.sh:59` `if mode == 'check':` + `scripts/durability-guard.sh:60` `if summary.strip():` — dirty-vs-empty decision on `jj diff --summary` content. Own: kernel op `DurabilityCheck` / law `EmptyParents`.
- M2 `scripts/durability-guard.sh:67` `if snapshot_root == root or root in snapshot_root.parents:` — location separation check. Own: `SnapshotLocation`.
- M3 `scripts/durability-guard.sh:77` `manifest = {'format': 'jj-recovery/v1', 'workspace': str(root), ...}` + `scripts/durability-guard.sh:80-82` manifest/status/diff writes — assembles recovery record outside Bend. Own: `RecoveryManifest`.
- M4 `scripts/durability-guard.sh:85` `with tarfile.open(snapshot / 'files.tar.gz', 'w:gz'` + `scripts/durability-guard.sh:87` `children[:] = [name for name in children if name not in ('.git', '.jj')]` — scope filter + archive build. Own: `SnapshotScope`.
- M5 `scripts/durability-guard.sh:95` `changed = run('diff', '--from', revision, '--to', '@', '--summary'` + `scripts/durability-guard.sh:96` `if changed.strip():` — atomicity re-check on jj state. Own: `SnapshotAtomic`.
- M6 `scripts/durability-guard.sh:24` `def verify(directory):` + `for member in source.getmembers():` print loop — interprets tar/manifest bytes in host. Own: `SnapshotVerify`.

LEGIT-HOST-EFFECT:
- L1 `scripts/durability-guard.sh:4` `exec "${PYTHON:-python3}" - "$@" <<'PY'` — exec/spawn.
- L2 `scripts/durability-guard.sh:14` `os.umask(0o077)` — host mode.
- L3 `scripts/durability-guard.sh:18` `p = subprocess.run([jj, '--no-pager', *args]` — exec/spawn (jj).
- L4 `scripts/durability-guard.sh:57` `status = run('status', cwd=root)` — VCS capture (effect).
- L5 `scripts/durability-guard.sh:69` `snapshot_root.mkdir(parents=True, exist_ok=True, mode=0o700)` — mkdir.
- L6 `scripts/durability-guard.sh:70` `datetime.datetime.now(...).strftime` + `uuid.uuid4().hex` — time/random host effects.
- L7 `scripts/durability-guard.sh:76` `run('tag', 'set', tag, '-r', revision` — VCS tag effect.
- L8 `scripts/durability-guard.sh:46` `print('usage: durability-guard.sh [check | snapshot | verify` — printing.
- L9 `scripts/durability-guard.sh:64` `print('durability-guard: @ is empty` + `return 0/1/2` — printing/exit codes.
- L10 `scripts/durability-guard.sh:102` `print(snapshot)` — printing.

## 7. `scripts/learn-loop.sh` — VERDICT: MIXED (MUST 4 / LEGIT 5)

MUST-MOVE:
- M1 `scripts/learn-loop.sh:17` `SUMMARY="$(printf ... | grep -E 'passed=[0-9]+ total=[0-9]+ cost=[0-9]+s' | tail -1)"` — parses score output content. Own: kernel op `ScoreParse`.
- M2 `scripts/learn-loop.sh:18` `P="$(printf '%s' "$SUMMARY" | grep -o 'passed=[0-9]*' | cut -d= -f2)"` + `scripts/learn-loop.sh:19-20` `T=...` `C=...` — field extraction via `grep`/`cut`. Own: `ScoreParse`.
- M3 `scripts/learn-loop.sh:22` `LINE="$(printf '{"ts":"%s","mode":"%s","passed":%s,...}' ...)"` — builds JSONL run record in shell. Own: kernel op `RunRecord`.
- M4 `scripts/learn-loop.sh:23` `printf '%s\n' "$LINE" >> /tmp/learn-loop-runs.log` + `scripts/learn-loop.sh:24` `>> "$ROOT/tasks/frozen/runs.log"` — appends managed learning log outside transition. Own: kernel op `LearnAppend`.

LEGIT-HOST-EFFECT:
- L1 `scripts/learn-loop.sh:9` `case "$MODE" in baseline|remeasure)` — CLI dispatch.
- L2 `scripts/learn-loop.sh:14` `SCORE_OUT="$("$ROOT/tasks/frozen/score.sh" 2>&1)"` + `STATUS=$?` — exec/spawn + exit code.
- L3 `scripts/learn-loop.sh:16` `printf '%s\n' "$SCORE_OUT"` — printing.
- L4 `scripts/learn-loop.sh:21` `TS="$(date -u +%FT%TZ)"` — time effect.
- L5 `scripts/learn-loop.sh:26` `exit "$STATUS"` — exit-code propagation.

## 8. `runtime/meta_shell.py` — VERDICT: LOGIC-HEAVY (MUST 18 / LEGIT 15)

MUST-MOVE (representative load-bearing sites; each needs owning kernel op/law):
- M1 `runtime/meta_shell.py:87` `return " ".join(text.split())[:3900]` — truncates Bend fields. Own: `FieldBound`.
- M2 `runtime/meta_shell.py:138` `self.db.execute("UPDATE jobs SET status='interrupted'"` — recovery transition in SQL, not Bend. Own: `JobRecover`.
- M3 `runtime/meta_shell.py:159` `if hashlib.sha256(pinned.read_bytes()).hexdigest() != self.source_hash:` + `runtime/meta_shell.py:163` `if "All terms check." not in checked:` — gate on bytes/checker text. Own: `KernelGate`.
- M4 `runtime/meta_shell.py:211` `if await self._jj(root, "log", "-r", "@", ... "empty") != "true":` — empty-change gate on jj state. Own: `WorkspacePrepare`.
- M5 `runtime/meta_shell.py:214` `if not re.fullmatch(r"[0-9a-f]{40,64}", base):` — revision-shape decision. Own: `RevisionWellFormed`.
- M6 `runtime/meta_shell.py:216` `if await self._jj(... "conflict") != "false":` — conflict gate. Own: `BaselineConflictFree`.
- M7 `runtime/meta_shell.py:242` `if retiring and job.get("result_commit"):` + `clean == "true" and parent == job["result_commit"]` — idempotent-retire branch on jj state. Own: `WorkspaceRetireIdempotent`.
- M8 `runtime/meta_shell.py:260` `ancestry = await self._jj(... base_commit + "::" + revision` + `if job["base_commit"] not in ancestry.splitlines():` — ancestry check. Own: `ResultDescendsBaseline`.
- M9 `runtime/meta_shell.py:264` `conflicts = await self._jj(... "& conflicts()"` + `if conflicts:` — conflict check. Own: `ResultConflictFree`.
- M10 `runtime/meta_shell.py:287` `if params.get("base_commit") != job["base_commit"] or params.get("result_commit")` — exact-review identity check. Own: `IntegrateIdentity`.
- M11 `runtime/meta_shell.py:296` `if current != job["base_commit"] and not resuming:` — main-moved check. Own: `MainUnmoved`.
- M12 `runtime/meta_shell.py:307` `if conflicts or current not in ancestors.splitlines():` — fast-forward check. Own: `FastForward`.
- M13 `runtime/meta_shell.py:377` `if not isinstance(task, str) or not task.strip() or len(task) > 64000` + `runtime/meta_shell.py:379` acceptance check — validation logic. Own: `SubmitWellFormed`.
- M14 `runtime/meta_shell.py:388` `conversation = hashlib.sha256((project + "\0" + conversation).encode()).hexdigest()` — conversation isolation hash decision. Own: `ConversationIsolate` (hash stays as effect, decision moves).
- M15 `runtime/meta_shell.py:393` `old = self.db.execute("SELECT * FROM jobs WHERE request_id=?"` + `if old:` dedup branch — idempotency in SQL. Own: `RequestIdempotent`.
- M16 `runtime/meta_shell.py:451` `if "lorenz_snapshot_saved" not in output or not out.is_file():` + `runtime/meta_shell.py:461` `ids = re.findall(r"^id=(\d+) kind=\d+ ...$", history, re.M)` + `runtime/meta_shell.py:462` `if op != "init" and not ids:` — interprets transition output/history text. Own: `TransitionCommit`.
- M17 `runtime/meta_shell.py:534` `packet = await self._prepare(...)` + `runtime/meta_shell.py:542` `if outcome.get("stop_reason") != "end_turn":` + `runtime/meta_shell.py:544` `if outcome.get("permission_requests"):` + `runtime/meta_shell.py:546` `if not result.strip():` — agent-outcome validation in host. Own: `AgentOutcomeValidate`.
- M18 `runtime/meta_shell.py:976` `self.permission_requests += 1` + `return ... {"outcome": "cancelled"}` — permission denial decision + count. Own: `PermissionDeny`.

LEGIT-HOST-EFFECT (representative):
- L1 `runtime/meta_shell.py:51` `path.mkdir(parents=True, ... mode=0o700)` + `chmod` — mkdir.
- L2 `runtime/meta_shell.py:56` `atomic_write()` + `os.replace` + `fsync` — atomic file write.
- L3 `runtime/meta_shell.py:75` `secrets.token_urlsafe(32)` — random/key.
- L4 `runtime/meta_shell.py:109` `fcntl.flock(... LOCK_EX | LOCK_NB)` — lock exec.
- L5 `runtime/meta_shell.py:118` `sqlite3.connect` + `PRAGMA journal_mode=WAL` — private-state open (effect; content decisions above still MUST-MOVE).
- L6 `runtime/meta_shell.py:181` `_jj()` + `asyncio.create_subprocess_exec` + `CHILD_GROUPS.add` — exec/spawn.
- L7 `runtime/meta_shell.py:421` `_bend()` + `asyncio.create_subprocess_exec(*command` + `KERNEL_TIMEOUT` — checked-kernel exec.
- L8 `runtime/meta_shell.py:422` `env = {k: v ... if not k.startswith("BUZZ_")}` — secret redaction.
- L9 `runtime/meta_shell.py:484` `configuration = {"mcp": {"meta_kernel": ...}}` + `f"http://127.0.0.1:{self.port}/mcp"` — loopback/network config.
- L10 `runtime/meta_shell.py:519` `return await run_agent(... self._execution_project ... events.jsonl` — agent spawn.
- L11 `runtime/meta_shell.py:645` `hmac.compare_digest(supplied, expected)` — auth compare.
- L12 `runtime/meta_shell.py:693` `subprocess.run(["launchctl", "bootstrap"` / `bootout` — service exec.
- L13 `runtime/meta_shell.py:749` `private_dir(args.state)` + plist `atomic_write` — file effects.
- L14 `runtime/meta_shell.py:852` `wait_for()` + `time.sleep(1)` + `print(f"[{job_id[:8]}]` — polling/printing/time.
- L15 `runtime/meta_shell.py:917` `owned_acp()` + `acp.connect_to_agent` + `os.killpg` — ACP spawn/cleanup.

## 9. `scripts/install-bend-ci.sh` — VERDICT: THIN (MUST 0 / LEGIT 8)

LEGIT-HOST-EFFECT:
- `scripts/install-bend-ci.sh:9` `[ "${GITHUB_ACTIONS:-}" = true ] || exit 1` — env guard.
- `scripts/install-bend-ci.sh:10` `[ "$(uname -s)-$(uname -m)" = Linux-x86_64 ]` — platform guard.
- `scripts/install-bend-ci.sh:14` `mktemp -d` + `trap 'rm -rf` — temp/trap.
- `scripts/install-bend-ci.sh:16` `curl --proto '=https' ... -fsSL ...tar.gz` — network.
- `scripts/install-bend-ci.sh:19` `sha256sum -c -` — hash.
- `scripts/install-bend-ci.sh:20` `tar -xzf` — exec.
- `scripts/install-bend-ci.sh:23` `mv "$bend_ci_tmp/bend" "$bend_ci_dest"` — file move.
- `scripts/install-bend-ci.sh:24` `BEND_NO_TELEMETRY=1 .../bend version` + appends to `GITHUB_ENV`/`GITHUB_PATH` — exec + printing/file append.

## 10. `scripts/install-jj-ci.sh` — VERDICT: THIN (MUST 0 / LEGIT 7)

LEGIT-HOST-EFFECT:
- `scripts/install-jj-ci.sh:5` `[ "${GITHUB_ACTIONS:-}" = true ]` — env guard.
- `scripts/install-jj-ci.sh:6` `[ "$(uname -s)-$(uname -m)" = Linux-x86_64 ]` — platform guard.
- `scripts/install-jj-ci.sh:10` `mktemp -d` + `trap` — temp.
- `scripts/install-jj-ci.sh:12` `curl --proto '=https' ...` — network.
- `scripts/install-jj-ci.sh:15` `sha256sum -c -` + `scripts/install-jj-ci.sh:16` `python3 - ... tarfile.open` verified-extract — hash + verified exec.
- `scripts/install-jj-ci.sh:28` `"$jj_ci_dest/jj" --version` — exec.
- `scripts/install-jj-ci.sh:29` `printf ... >> "$GITHUB_PATH"` — printing/append.

## 11. `scripts/setup-programs.sh` — VERDICT: MIXED (MUST 5 / LEGIT 12)

MUST-MOVE:
- M1 `scripts/setup-programs.sh:37` `python3 -c "import json,sys; d=json.load(sys.stdin); print(next((c.get('id') ... if c.get('name')=='$1')"` — interprets relay list JSON. Own: kernel op `ChannelResolve`.
- M2 `scripts/setup-programs.sh:42` `if [ -n "$uuid" ]; then` + `echo "channel $1 exists` vs create path — existence-gated create. Own: `ChannelEnsure`.
- M3 `scripts/setup-programs.sh:55` `if "$buzz_bin" projects list ... python3 -c "... any(p.get('slug')=='$1' ..."` — project-existence interpretation. Own: `ProjectEnsure`.
- M4 `scripts/setup-programs.sh:68` `if [ "$3" = "owner" ]; then` — role-branching membership logic. Own: `MembershipAssign`.
- M5 `scripts/setup-programs.sh:118` `while IFS='|' read -r name title tag path; do` + `case "$name" in \#*)` + `publish_note` skip — list-driven publish decision. Own: `NotesSyncPlan` (relay stays as effect, plan moves).

LEGIT-HOST-EFFECT:
- `scripts/setup-programs.sh:25` `command -v "$buzz_bin"` — exec guard.
- `scripts/setup-programs.sh:28` `[ -z "${BUZZ_PRIVATE_KEY:-}" ]` — secret presence guard (no print).
- `scripts/setup-programs.sh:46` `"$buzz_bin" channels create --name "$1" --type "$2"` — network/relay exec.
- `scripts/setup-programs.sh:59` `"$buzz_bin" projects create "$1" --name "$2" --channel "$3"` — network/relay.
- `scripts/setup-programs.sh:69` `"$buzz_bin" channels add-member --channel "$1" --pubkey "$2"` — network/relay.
- `scripts/setup-programs.sh:79` `"$buzz_bin" canvas set --channel "$1" --content - < "$script_dir/$2"` — network/relay + file read.
- `scripts/setup-programs.sh:85` `"$buzz_bin" notes set --name "$1" ... < "$repo_dir/$4"` — network/relay.
- `scripts/setup-programs.sh:91` `t_channel="$(ensure_channel telepathy stream)"` (+5 channels) — exec capture.
- `scripts/setup-programs.sh:104` `for ch in ...; do` + `for pubkey in "$@"; do` — CLI-driven loops.
- `scripts/setup-programs.sh:112` `set_canvas ...` ×3 — exec.
- `scripts/setup-programs.sh:122` `done < "$script_dir/shared-files.list"` — file read.
- `scripts/setup-programs.sh:128` `echo "Publish the telepathy code ..."` — printing.

## 12. `scripts/worktree-guard.sh` — VERDICT: THIN (MUST 0 / LEGIT 2)

- `scripts/worktree-guard.sh:5` `"$JJ" root >/dev/null` — exec/spawn (ownership probe).
- `scripts/worktree-guard.sh:6` `exec "$JJ" status --no-pager` — exec/spawn (read-only status).

## 13. `scripts/refresh-notes.sh` — VERDICT: THIN (MUST 0 / LEGIT 6)

LEGIT-HOST-EFFECT (relay push only; no managed `*.in` mutation, no digest/JSON logic):
- `scripts/refresh-notes.sh:8` `command -v buzz` — exec guard.
- `scripts/refresh-notes.sh:10` `security find-generic-password -s buzz-desktop -w` + `python3 -c` identity extract — keychain (no secret print).
- `scripts/refresh-notes.sh:14` `export BUZZ_RELAY_URL=...` — env effect.
- `scripts/refresh-notes.sh:15` `while IFS='|' read -r name title tag path` + `case "$name" in \#*)` — list iteration/skip (host file loop, not kernel-state branch).
- `scripts/refresh-notes.sh:19` `buzz notes set --name "$name" ... < "$repo_dir/$path"` — network/relay exec.
- `scripts/refresh-notes.sh:20` `echo "note refreshed: $name"` / `failed` + `exit 0` — printing/exit codes.

## 14. `scripts/install-meta.sh` — VERDICT: THIN (MUST 0 / LEGIT 7)

- `scripts/install-meta.sh:8` `[ "$#" -le 1 ] || exit 64` — arg validation.
- `scripts/install-meta.sh:10` `for required in runtime/AUTONOMY.md ...; do [ -f "$REPO/$required" ]` — presence guards.
- `scripts/install-meta.sh:13` `mkdir -p "$CONFIG/commands" "$CONFIG/agents" "$CONFIG/meta-backups"` — mkdir.
- `scripts/install-meta.sh:14` `backup=$(mktemp -d` — temp.
- `scripts/install-meta.sh:17` `[ ! -d "$target" ] || exit 1` — type guard.
- `scripts/install-meta.sh:19` `cp -P "$target" "$backup/$kind.meta.md"` — file copy.
- `scripts/install-meta.sh:21` `ln -s ...; mv -f ... "$target"` — symlink + atomic move + `printf` printing.

## 15. `runtime/worker/engrams/verify-lorenz.sh` — VERDICT: MIXED (MUST 5 / LEGIT 10)

MUST-MOVE (test-harness acceptance logic that duplicates kernel laws):
- M1 `runtime/worker/engrams/verify-lorenz.sh:25` `grep -q 'All retries are safe' "$engram_scratch/before.txt"` + `L26` second grep — asserts memory content in shell. Own: `MemoryContains`.
- M2 `runtime/worker/engrams/verify-lorenz.sh:30` `if grep -Eq 'All retries are safe|Retry writes automatically' "$engram_scratch/active.txt"; then` — stale-memory decision. Own: `CorrectionInvalidates`.
- M3 `runtime/worker/engrams/verify-lorenz.sh:32` `grep -q 'id=2 kind=2 status=superseded'` + `L33` `needs-review` — history-status assertions. Own: `HistoryStatus`.
- M4 `runtime/worker/engrams/verify-lorenz.sh:37` `if call correct ... 999 0 reviewer invalid rejected > ...; then echo 'invalid correction accepted'` — invalid-transition acceptance check. Own: `CorrectionRejectsUnknown`.
- M5 `runtime/worker/engrams/verify-lorenz.sh:38` `[ ! -e "$engram_scratch/invalid" ]` — no-file-on-reject gate. Own: `FailedTransitionNoWrite`.

LEGIT-HOST-EFFECT:
- L1 `runtime/worker/engrams/verify-lorenz.sh:9` `[ "$(shasum -a 256 "$source_file" | cut ...)" = "$expected" ]` — hash.
- L2 `runtime/worker/engrams/verify-lorenz.sh:10` `[ "$("$bend_bin" version)" = 'bend 2.0.21' ]` — exec version pin.
- L3 `runtime/worker/engrams/verify-lorenz.sh:11` `engram_scratch=$(mktemp -d` + `chmod 700` + `trap 'rm -r` — temp/mkdir/trap.
- L4 `runtime/worker/engrams/verify-lorenz.sh:14` `cp "$source_file" "$engram_scratch/system.bend"` — file copy.
- L5 `runtime/worker/engrams/verify-lorenz.sh:15` `cmp ...` — compare exec.
- L6 `runtime/worker/engrams/verify-lorenz.sh:17` `"$bend_bin" ... --check-only > .../check.txt` — checked-kernel exec.
- L7 `runtime/worker/engrams/verify-lorenz.sh:18` `grep -q '^All terms check\.$'` — checker-text gate (kept here as test-gate effect; strict move per M-gates above).
- L8 `runtime/worker/engrams/verify-lorenz.sh:19` `call() { "$bend_bin" ... -- "$@"; }` + `L20-23` `call init/capture/remember` — checked-kernel execs with explicit args.
- L9 `runtime/worker/engrams/verify-lorenz.sh:35` `cmp "$engram_scratch/before.txt" "$engram_scratch/predecessor.txt"` — compare.
- L10 `runtime/worker/engrams/verify-lorenz.sh:39` `printf '%s\n' '{"source_sha256":...}'` — printing evidence.

---

## Verdict table

| file | verdict | MUST | LEGIT |
|---|---|---|---|
| ./mundus | THIN | 0 | 8 |
| runtime/ops/run.sh | MIXED | 7 | 18 |
| runtime/worker/run.sh | MIXED | 5 | 12 |
| scripts/memory-sync.sh | LOGIC-HEAVY | 12 | 10 |
| scripts/census.sh | LOGIC-HEAVY | 9 | 8 |
| scripts/durability-guard.sh | MIXED | 6 | 10 |
| scripts/learn-loop.sh | MIXED | 4 | 5 |
| runtime/meta_shell.py | LOGIC-HEAVY | 18 | 15 |
| scripts/install-bend-ci.sh | THIN | 0 | 8 |
| scripts/install-jj-ci.sh | THIN | 0 | 7 |
| scripts/setup-programs.sh | MIXED | 5 | 12 |
| scripts/worktree-guard.sh | THIN | 0 | 2 |
| scripts/refresh-notes.sh | THIN | 0 | 6 |
| scripts/install-meta.sh | THIN | 0 | 7 |
| runtime/worker/engrams/verify-lorenz.sh | MIXED | 5 | 10 |
| TOTAL | — | 71 | 138 |

Totals: MUST-MOVE 71, LEGIT-HOST-EFFECT 138.

Evidence: `git status --short` before this file showed pre-existing staged/modified entries (e.g. `M README.md`, `M mundus`, staged `scripts/census.sh`, `scripts/memory-sync.sh`, `scripts/learn-loop.sh`, `runtime/*.bend`, `tasks/frozen/*`, `docs/drafts/meta/*`); this audit adds only `docs/drafts/meta/cli-thinning-audit.md` and modifies no other file. `sh -n` passed on all 13 shell files listed above.
