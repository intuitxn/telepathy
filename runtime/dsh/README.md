# Telepathy algorithm capability for DeepSeek Harness

The runtime is pinned to [`deepseek-ai/deepseek-harness` commit `477b4f420553e8a52c2fbccc464d7561b239c443`](https://github.com/deepseek-ai/deepseek-harness/tree/477b4f420553e8a52c2fbccc464d7561b239c443). `core.mjs` defines six tools for the keyless smoke profile; production exposes four: `algorithm_compile`, `algorithm_active`, `algorithm_run`, and `algorithm_execute`. Scoring and selection are host-only. The model proposes source and predictions. The host archives exact Bend bytes, checks/builds, runs bounded exploratory cases, and records a receipt. A separate, host-pinned evaluator reruns the archived source against frozen cases. Every selection needs a complete passing score. Later selections also require a strict gain with no lost passing cases on the same evaluator, case set, toolchain, and repeat count.

## Run one executable pseudocode file

`algorithm-language.mjs` is an operator CLI for a small deterministic recurrence language. A file has one `algorithm` declaration, up to eight natural-number `state` fields, one `step` expression for each field, and one `return` field. Expressions use state names, `tick`, literals, `add`, saturating `sub`, and `if_lt`. Each step reads the prior state. The CLI accepts 0..128 canonical steps and at most 16 KiB of UTF-8 source.

```text
algorithm counter
model deepseek-flash
state total = 0
step total = add(total, 1)
return total
```

`model NAME` is optional and must appear between `algorithm` and the first
`state`. It is a request to the trusted host, not part of the numerical
transition. The same source simulates with or without the declaration.
`model auto` asks the host to choose an available route by measured passing
cases per compute unit. The
`selectModelRoute` function takes a host-owned index whose measurements bind
to one evaluation generation and retain receipt digests. The host must verify
that index and its receipts before use, and derive availability from credential,
provider capacity, and grant budget. An unmeasured route can be requested
by name for an initial pilot but cannot win `auto`. Credentials stay in the
private host environment and are never a DSL or index field. The current
production DSH toolchain and task grants still pin
`deepseek-official/deepseek-flash`; this
syntax and selector do not authorize another live provider.

```sh
node runtime/dsh/algorithm-language.mjs check counter.algo
node runtime/dsh/algorithm-language.mjs simulate counter.algo 3
node runtime/dsh/algorithm-language.mjs compile counter.algo > counter.bend
node runtime/dsh/algorithm-language.mjs run counter.algo 3
# After the host pins an evaluator and case set, use the run output's receipt values:
node runtime/dsh/algorithm-language.mjs score RECEIPT_ID RECEIPT_SHA256
```

`run` compiles exactly one Bend source, predicts stdout with the in-process simulator, checks/builds/runs the generated source with the existing bounded native runner, and prints JSON containing both outputs, prediction agreement, status, digests, and the retained receipt path. Set `BEND` or `BEND_BIN` if Bend is not on `PATH`; the private archive defaults to `~/.local/state/telepathy-dsh/algorithms` and can be set with `TELEPATHY_DSH_ARCHIVE` outside the current workspace, the source file's containing jj workspace or directory, the configured DSH workspace, and temporary directories. The operator CLI does not establish claim correctness: an independent task oracle must score the archived candidate separately. Arbitrary papers and unrestricted pseudocode are outside this bounded language.

`score` consumes only the run receipt ID and digest. The host process must set `TELEPATHY_DSH_EVALUATOR`, `TELEPATHY_DSH_EVALUATOR_SHA256`, `TELEPATHY_DSH_CASE_SET`, and `TELEPATHY_DSH_CASE_SET_SHA256` to approved bytes outside the candidate workspace. It replays the archived Bend source against every frozen case, archives the score, and exits nonzero on a failed case. `benchmarks/algorithm-language/cases.json` is a public six-case service-queue fixture for local reproduction; it is not a hidden task oracle or evidence of general correctness. Scoring does not select a global active candidate.

In a funded DSH algorithm session, `algorithm_compile` accepts the same bounded text and up to 16 distinct step counts. It returns deterministic Bend source, both source digests, diagnostics, and in-process simulation outputs after one source parse. The agent can write those exact Bend bytes with its scoped file tool, then call `algorithm_run` with the returned Bend digest and an explicit prediction. Compilation and batched simulation consume one grant fuel unit. They do not run native Bend or score correctness.

For editor feedback on `.algo` files, run `node runtime/dsh/algorithm-lsp.mjs` as a stdio language server. It uses the same bounded compiler diagnostics and supports full-document changes, completion, keyword hover, and state definitions. It does not execute or score candidate code.

`node benchmarks/algorithm-language/run.mjs 10000 128` measures compile throughput, simulation with a fresh parse, and repeated simulation of a prepared program on the current machine. It verifies identical outputs and reports elapsed time without a machine-specific pass threshold.

The production route in `cordis.patch.yml` is `deepseek-official/deepseek-flash` (DeepSeek V4.1 Flash). Provide `DEEPSEEK_API_KEY` only in the private host process environment after the model tool boundary has been checked. Do not put a reusable key in a model-readable DSH credential file. No key belongs in this repository. OpenCode Go / Muse Spark is an isolated coding contributor, not the DSH model route. A live DeepSeek API turn has not been run or verified here because no DeepSeek API credential was available. The keyless DSH tests below do not establish live API behavior.

## Build the pinned upstream DSH checkout

From a private, non-temporary directory, clone and pin the **upstream DSH checkout**. Keep the DSH build outside model-writable and temporary roots. These Git commands apply only to that separate upstream clone; Telepathy uses jj. The native addon is needed for durable DSH session locking on macOS:

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git /path/to/deepseek-harness
git -C /path/to/deepseek-harness checkout 477b4f420553e8a52c2fbccc464d7561b239c443
npx -y pnpm@11.7.0 --dir /path/to/deepseek-harness install --frozen-lockfile
npx -y pnpm@11.7.0 --dir /path/to/deepseek-harness run build:lib:host
npx -y pnpm@11.7.0 --dir /path/to/deepseek-harness run build:native-system
```

## Check and install a trusted production release

From the Telepathy repository root, provide the built entrypoints from that pinned upstream checkout and a Bend binary. Give the installer a full, immutable jj commit ID, not a working-copy alias:

```sh
export TELEPATHY_DSH_CLI_BIN=/path/to/deepseek-harness/apps/cli/lib/bin.js
export TELEPATHY_DSH_LLM_MODULE=/path/to/deepseek-harness/packages/llm/llm/lib/index.js
export BEND="$HOME/.bend/bin/bend"
node scripts/install-dsh-release.mjs FULL_JJ_COMMIT_ID --bootstrap
```

The first installation uses `--bootstrap` only after source review; it is rejected once a trusted gate alias exists. Later revisions use `jj telepathy-install FULL_JJ_COMMIT_ID`, which runs the **previous checked release's** installer and gate. The gate uses `jj --ignore-working-copy run --ignore-changes --clean --root -r FULL_JJ_COMMIT_ID -- node scripts/check.mjs --require-dsh`; it requires a passing check with zero skips and binds the pinned DSH build, Bend binary, jj store, and checker inputs in its receipt. The installer copies the checked patch, plugins, gate, installer, checker, protected test fixtures, and `bend-kernels` skill into a release directory named by that commit. Its default parent is `~/.local/share/telepathy-dsh/releases`; `TELEPATHY_DSH_RELEASES` can select another host-owned parent outside the model-writable workspace and temporary roots. It installs `jj telepathy-gate` and `jj telepathy-install` aliases pinned to that release. A later candidate that changes the gate, checker, or protected test inputs needs separate control-plane review. Installing prepares files for a later host launch; it does not switch or restart a running DSH process.

Set `TELEPATHY_DSH_TRUSTED_ROOT` to that installed `trusted_root` and load the patch **from the release**. The patch resolves plugins relative to itself and requires absolute, nonoverlapping workspace, DSH home, and trusted release roots. It disables model shell, web, search, workflow, default child tools, PTC, and automatic title model calls; the remaining file tools are guarded by `tool-boundary.mjs`. The required DSH agent loop waits for `startup-ready.mjs`, which requires the boundary, both task/grant refs, and an active usage meter before any production provider turn. A failed optional security plugin or an unfunded launch therefore stops agent startup. HMR is disabled, so edits in the model workspace cannot hot reload host plugin code. Keep the release and upstream DSH build outside model-writable locations.

Set a private `DSH_HOME` outside the source tree and outside `/tmp`, `/var/tmp`, and the user's temporary directory. The algorithm plugin refuses to start with its archive inside the workspace or those sandbox-writable roots. The headless test sets `TELEPATHY_DSH_TEST_ALLOW_UNSAFE_ARCHIVE=1` only for isolated temporary fixtures. The release installer does not package the evaluator or case set: place their approved bytes in a separate host-owned location and pin their SHA-256 digests. A changed file requires an explicit new evaluation generation:

```sh
export DSH_HOME=/path/to/private/telepathy-dsh-state
export TELEPATHY_DSH_WORKSPACE="$PWD"
export TELEPATHY_DSH_TRUSTED_ROOT="$HOME/.local/share/telepathy-dsh/releases/FULL_JJ_COMMIT_ID"
export TELEPATHY_DSH_EVALUATOR=/path/to/host-owned/evaluation/run.mjs
export TELEPATHY_DSH_CASE_SET=/path/to/host-owned/evaluation/kernel-cases.json
export TELEPATHY_DSH_EVALUATOR_SHA256="$(shasum -a 256 "$TELEPATHY_DSH_EVALUATOR" | cut -d ' ' -f 1)"
export TELEPATHY_DSH_CASE_SET_SHA256="$(shasum -a 256 "$TELEPATHY_DSH_CASE_SET" | cut -d ' ' -f 1)"
export BEND_BIN="$BEND"
export TELEPATHY_TASK_REF=HOST_OPENED_TASK_SHA256
export TELEPATHY_ROOT_GRANT_REF=HOST_FUNDED_INTEGRATION_GRANT_SHA256
node "$TELEPATHY_DSH_CLI_BIN" --profile headless --patch "$TELEPATHY_DSH_TRUSTED_ROOT/runtime/dsh/cordis.patch.yml" --json 'Evaluate the Bend candidate against the pinned case set.'
```

The two task refs above must come from a host-opened task and funded integration-owner grant. They are placeholders, not values to invent. The production algorithm tools reserve grant fuel before each call: 60 for `algorithm_run`, 60 for `algorithm_execute`, and 1 each for `algorithm_compile` and `algorithm_active`. For subprocess tools, one fuel unit reserves one second of the maximum subprocess wall deadline; compile and active calls cost one control unit each. The full charge remains spent if the call fails or the host crashes. This is a conservative wall-time allowance, not measured CPU use or an operating-system process-tree quota. The same DSH call ID cannot reuse a reservation. Only active algorithm, implementation, evaluation, and integration grants may call these tools. The model-facing `algorithm_score` and `algorithm_select` tools are disabled in this patch. Scoring must use a host-owned evaluator after task-control reserves an evaluation, and selection needs an authorized integration grant, score origin, and independent approval. A host-only promotion adapter is included below; its fresh-task evaluator, evidence publisher, and driver still require a trusted host. The separate `headless-smoke.patch.yml` runs keyless mock checks without enabling an unfunded production route.

`kernel-cases.json` scores the actual `runtime/core/telepathy.bend` kernel. `benchmarks/core/reference.bend` and `cases.json` are the executable adapter/reference fixture used by the keyless integration test. Switching case sets creates a separate scoring generation; compare candidate and incumbent only after both have been scored against the same pinned case-set and evaluator digests.

The current selector compares exact case correctness. Once an active candidate passes every case, another candidate on that same fixed set cannot show a strict correctness gain. Continuing promotion requires a new host-pinned evaluation generation or a separately defined, independently measured cost objective.

The same release patch can boot `--profile sdk` for direct session clients. `--json` is a bounded live projection; the durable session log is under `DSH_HOME/sessions`, and full receipts and scores are under `DSH_HOME/algorithms`. The selected pointer affects the first `algorithm_active` or `algorithm_execute` call in a new session. A session that has read it keeps the archived pin even if a later session selects a descendant.

## Task control and its current boundary

The production patch mounts `task-control.mjs` as the `telepathyTaskControl` host service. It stores a frozen task specification and a replayable, content-addressed event chain in private `TELEPATHY_TASK_STATE` (by default `~/.local/state/telepathy-dsh/tasks`), outside the workspace and temporary roots. Its host methods plan typed logical tasks, reserve finite scoped branch grants, admit causal events, show bounded context, and checkpoint. Source settlement requires an injected independent verifier: the combined exact jj revision must pass the gate above, and a separately pinned evaluator must accept it before the task head advances. A research or analysis `result` remains a proposal until `settleResult` reserves evaluation budget and a separate host verifier accepts the exact plan, grant, artifact, causal cut, and pinned oracle. That acceptance unlocks dependent plans without advancing the jj head or closing the overall task. An exhausted rejected result is marked failed and releases its worker slot; audited abandonment of the last evaluation does the same. The service has a child-session adapter for a trusted host that supplies isolated jj workspaces and scope setup; it binds a child to the file-tool boundary during DSH setup. DSH drives the model turns.

`createJjCombinedVerifier` now gives its host-owned `evaluateIndependent` callback a `goal_binding` for the frozen goal and acceptance text, task ref, exact combined commit and gate receipt, integration candidates, causal cut, accepted source-result digest/count, evaluator and case-set pins, and toolchain. Whole-task acceptance requires a content-addressed `telepathy.goal-evaluation/v1` receipt that echoes this binding, names a fresh-clone comparison receipt, passes every measured case and hard constraint, and reports zero counterexamples and unsupported claims. The adapter reads that comparison from a private `freshComparisonRoot`, checks its bytes and exact combined commit against the pinned evaluator and case set, and requires its candidate cases to pass. An arbitrary receipt digest cannot close the goal. The goal evidence digest is recorded separately as `goal_receipt_sha256`; the existing settlement `receipt_sha256` remains the independent evaluation artifact used by algorithm promotion. Any other pending evaluation or a task-log change during evaluation rejects acceptance. A passing source or synthesis settlement by itself still has `task_accepted: false`. The callback remains responsible for domain-specific goal scoring; this source revision does not install that evaluator or run a live provider trial.

`task-program.mjs` drives bounded planner pages, durable plan and grant requests, and a small worker pool. It records each planner attempt before invocation; after an uncertain call, an exact host audit must recover its page, prove absence, or identify an invalid raw response by digest before another planner call. It validates an entire page before admitting the first task. A confirmed invalid page needs an explicit digest-bound replan, limited to three attempts per cursor; an unexpected partial controller rejection is quarantined for host repair. Its planner, planner audit, grant factory, worker, and dispatch audit are host callbacks; the release patch does not supply them. In feedback mode a nonfinal page becomes a durable barrier: the next planner turn waits for independently settled results from that page and receives only bounded attributed verdicts. Legacy preplanning remains available with `feedbackPlanning: false`; the generic program does not call `settleResult` itself. The controller also needs host-owned knowledge, research-result, and combined-revision verifiers plus child scope setup. The scorer and selector are host-only exports; the promotion adapter below exists in source, while production still needs a host-pinned fresh-task evaluator, evidence publisher, and driver. The public DSH SDK starts root sessions, while true parent-linked children use the in-process host adapter. `createTaskPlanTool` is an optional helper requiring a host-owned session binding; the patch does not mount a model-visible `task_plan` tool.

`createFundedTaskProgram` in `task-host.mjs` is the first model-backed planner composition. The trusted host creates one deterministic analysis plan and root grant before calling `createTaskProgram`; the grant funds one stable DeepSeek SDK session across pages. It archives each exact input and prompt before dispatch, and the response, events, and binding receipt before returning a page. A cold run uses only the immutable receipt to recover a completed or invalid page; a missing receipt leaves the call unknown. The host-generated final patch disables the planner model tools; a keyless pinned SDK test checks the actual request catalog is empty. This slice accepts one scope, research/analysis tasks without dependencies, the exact host-set worker budget per task, and an explicit `targetTasks` ceiling. Full dispatch needs `spec.limits.max_tasks` and `max_branches` of at least `targetTasks + 1`, aggregate worker token/fuel/evaluation allocations, and additional tokens for variable plan-record byte charges. Default feedback planning keeps the planner grant active alongside one worker, so a multi-task run needs `max_active_grants >= 2`; a nonfinal page waits for verified or rejected worker verdicts before another planner turn. The planner may finish early with an empty final page when no justified work remains. Grant, worker, and dispatch-audit callbacks still come from a trusted host; worker callbacks must call independent `settleResult`, since their return values do not accept tasks. No live DeepSeek model planning turn has been run without a private API credential and an adopted checked release.

The production patch requires `TELEPATHY_TASK_REF` and `TELEPATHY_ROOT_GRANT_REF` and mounts `usage-meter.mjs` after task control. On the root session's first model request it binds the explicit host-funded root grant; child sessions use their already recorded grant. A private SQLite ledger sums provider-reported token usage per grant. Calls sharing a grant are serialized within one DSH process, and a second process cannot spend the grant while one call is pending. Provider chunks are buffered until usage is durably charged, with a 4 MiB buffer cap. Interrupted calls block future turns until a trusted `auditUncertainUsage` callback proves no dispatch or supplies a conservative upper bound and records its receipt. Model usage is counted separately from task-control's payload-byte allowance. One provider call can overrun because usage arrives after generation; the overrun is recorded and further calls stop. A launch with no task refs or only one ref is blocked before provider dispatch.

Logical tasks are durable records, not live agents. The opt-in `TELEPATHY_STRESS_10K=1` controller test constructs a 10,000-node logical task DAG with a limit of one active grant and spawns no worker sessions. `TELEPATHY_PROGRAM_STRESS_10K=1` exercises the prompt-to-task driver with the same bounded grant policy and an injected worker callback. These measure bookkeeping and bounded dispatch, not 10,000 concurrent DSH agents or verified new knowledge. The one-scope research host below now provides a metered worker and result-settlement path for research and analysis plans without dependencies. Completing a general graph still needs live model validation and field-specific independent verifiers.

`algorithm_run` accepts a relative one-file `.bend` source, its exact lowercase SHA-256, predicted check/build success, and up to 16 bounded exploratory cases. Only `Base` imports are accepted. It does not prove task correctness. Its build cache and receipt include the Clang identity; scorer replay rejects a different compiler. Each cached binary and manifest publish as one directory, so a crash cannot expose a new partial entry; old binary-only entries are quarantined and rebuilt. The host-only `scoreCandidate` function accepts only a receipt ID and digest; the evaluator, cases, and their expected hashes come from host settings. The host-only `selectCandidate` function accepts a candidate score digest, an incumbent score digest or `null` for first selection, and the expected active pointer digest. Its compare-and-swap update uses a crash-released SQLite OS lock. An existing active pointer must equal the scored incumbent. `algorithm_execute` takes only bounded arguments and runs the current session's selected archived binary after verifying its source, receipt, binary, and toolchain digests.

## Host-owned algorithm promotion

The previous checked release protects the privileged DSH host runtime,
production patch, gate, installer, and fixed checks as trust inputs. A change
to any of these requires separate control-plane review before adoption.

`algorithm-promotion.mjs` is a host-only adapter, not a DSH model tool. The trusted host supplies the exact earlier candidate admission and settlement requests. `prepare` requires both events already to exist in `task-control` and requires their idempotent calls to return `existing: true`; it never creates a candidate or spends an evaluation. The settlement must have accepted the current exact jj head. The adapter compares that head's `.bend` bytes with the archived source and binds the executed `algorithm_run` receipt, score, DSH session, funded integration grant, exact gate receipt from the private hashed task event, and a private fresh-task clone evidence receipt. The settlement's `receipt_sha256` must equal the evidence file's content digest. A separate host-pinned, self-contained `freshVerifierPath` module checks the actual gate and clone receipts and returns the exact evidence and binding digests. The fresh task set, score evaluator, and score cases are separately host-pinned. No model-supplied report can replace these checks. The host supplies `taskStoreRoot` alongside the controller so the adapter can verify the settled event's gate lineage.

`fresh-clone-comparison.mjs` is the host-only paired evidence seam for that verifier. It reads private prediction and run receipts from unchanged and proposed agent clones, replays the same pinned evaluator on a frozen task set, checks equal measured total compute, and records case regressions, counterexamples, unsupported claims, and calibration. Its durable verdict does not switch the active agent. The caller still must prove task freshness, exact clone lineage, prediction-before-dispatch, and trustworthy host metering; the synthetic test does not establish those production facts.

`apply` checks the accepted task head again under the same lock as source
settlement's final compare-and-swap, then selects the score pointer and writes
its marker before releasing that lock. A prior completed pointer update can
still be recovered as a historical selection after the task head advances.

`prepare` publishes an immutable intent before `apply` calls the host-only score selector's active-pointer CAS. If the process stops after that CAS, `apply` accepts only the exact candidate/source/run/score pins and expected parent pointer, then writes an immutable selected marker. Replaying a completed marker reports the historical selection even after a later accepted task head or active candidate. A pending intent whose candidate was displaced before its selected marker was written fails closed: the host must keep promotion selection single-flight and reconcile each pending intent before starting another. This is a source-level transaction seam: a production fresh-task evaluator and its receipt format must still be supplied by the trusted host, and the pinned verifier must independently inspect equal-budget baseline and candidate clone runs. The keyless test exercises the contract with a temporary jj repository and a synthetic pinned verifier; it does not claim live recursive improvement. Updating this adapter or its test changes the release trust inputs and needs review before the checked release can adopt it.

## Single-task research host

`task-host.mjs` provides a runnable one-scope composition. An authorized prompt becomes one deterministic research plan, receives one grant, and runs through the pinned DSH SDK in a separate exact-base jj workspace. The production patch meters its DeepSeek turn; the checked `research-only.patch.yml` then disables the algorithm core so this research grant cannot invoke Bend algorithm tools. The host archives the response and DSH event evidence in private immutable files, admits a typed result, and calls `settleResult` with a separately pinned verifier. An accepted result unlocks dependent work; it does not declare the overall goal complete. Model text alone never becomes accepted knowledge.

The verifier must be a host-owned, self-contained ES module outside the worker workspace and temporary roots, export `verifyResult(input)`, and have bytes matching `spec.pinned_versions.evaluator_sha256`. The case-set file must likewise match `spec.pinned_versions.case_set_sha256`. The verifier receives the exact result binding plus `artifactRoot` and the checked `caseSetBytes`, then returns the controller's bound verdict. The host retains those checked bytes, so later file changes cannot change that running oracle or case set.

Invoke the installed module from a trusted host script. `workerWorkspace` must be an isolated jj workspace whose `@-` equals `spec.initial_head`. All state paths, `dshHome`, the checked release, and the verifier must be private host paths outside the worker workspace and temporary directories. Supply an actual frozen `spec` and evaluator; the path names below are illustrative.

```js
import { createSingleTaskHost, dshToolchainFingerprint } from '/path/to/checked/release/runtime/dsh/task-host.mjs';

// Freeze these three SHA-256 values in the host configuration, and set
// spec.pinned_versions.toolchain = dshToolchainFingerprint(cliSha256, sdkSha256, llmSha256).

const host = await createSingleTaskHost({
  spec, prompt, programId: 'research-001',
  workerBudget: { tokens: 4000, fuel: 5, children: 0, integrations: 0, evaluations: 1 },
  workerWorkspace: '/path/to/isolated/jj-worker',
  verifierFile: '/path/to/private/verified-result-oracle.mjs',
  caseSetFile: '/path/to/private/research-cases.json',
  stateRoot: '/path/to/private/programs',
  taskStateRoot: '/path/to/private/tasks',
  archiveRoot: '/path/to/private/results',
  dsh: {
    dshBin: '/path/to/pinned/deepseek-harness/apps/cli/lib/bin.js',
    sdkModule: '/path/to/pinned/deepseek-harness/packages/sdk/client/lib/index.js',
    llmModule: '/path/to/pinned/deepseek-harness/packages/llm/llm/lib/index.js',
    cliSha256, sdkSha256, llmSha256,
    trustedRoot: '/path/to/checked/release',
    dshHome: '/path/to/private/dsh-home',
    env: { PATH: process.env.PATH, HOME: process.env.HOME,
      DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY },
  },
});
const progress = await host.run();
```

The host preflights the exact jj base, key, private paths, checked release manifest, pinned DSH checkout and CLI/SDK/LLM entrypoint digests before a provider turn. It passes only `PATH`, `HOME`, and `DEEPSEEK_API_KEY` from the private caller environment; task references and DSH paths are constructed by the host. The host-owned upstream installation must also keep its transitive built imports immutable; the entrypoint hashes do not attest that entire build tree. A crash after DSH starts but before its response is archived leaves the dispatch `unknown`; the driver will not repeat that external turn. A trusted operator must recover and check the durable DSH session output before admitting a result or proving absence. This single-task research slice has a deterministic one-task planner; `createFundedTaskProgram` above supplies the funded model planner for a separate composition. Neither slice creates true DSH children, settles source candidates, or switches the resident host. The keyless `task-host.test.mjs` checks result settlement, restart idempotency, uncertain dispatch, and path isolation; `task-program.headless.test.mjs` checks pinned SDK worker and planner catalogs with a mock provider.

## Funded research task program

`resident-ingress.mjs` is a thin host-owned entry point for this research
program. It provides durable `submit`, `status`, `list`, `runNext`, and explicit
`resume` calls, plus a local CLI. It does not start a second model scheduler,
resume Meta ACP sessions, read the old `intuitxn-meta` database, or turn a
reported job into accepted knowledge. A submission must name a reviewed
profile that freezes the exact jj base, integration owner, oracle and case-set
digests, DSH toolchain, finite compute, workspaces, and verifier paths. The
request supplies only its kind, goal, acceptance, profile ID, and idempotent
request ID. A single-scope profile admits `research` or `analysis`; a
`mode: "two_scope"` profile admits `cross_field`. Coding and other kinds receive
`unsupported` without a provider call. The profile has no
credential field. `DEEPSEEK_API_KEY` enters only from the private host process.

The private CLI config is one JSON object with `stateRoot` and `profiles`.
Each profile has the fields validated in `profileValue` in
`resident-ingress.mjs`; keep the config outside model workspaces and mode 0600.
The `two_scope` profile replaces `scope`, `target_tasks`, and
`planner_workspace` with two distinct `scopes`, two `planner_workspaces`, and a
third `synthesis_workspace`. It also pins `synthesis_oracle_sha256`,
`synthesis_oracle_trusted_root`, `synthesis_oracle_file`, `synthesis_budget`,
`synthesis_deliverable`, `synthesis_acceptance`, and
`synthesis_model_token_limit`. All three workspaces must share one jj store
and have `@-` at the frozen `initial_head`. The host checks the oracle bytes,
the full five-plan compute forecast, and the release before a provider turn.
For example, a request using that reviewed profile is:

```json
{"request_id":"joint-001","profile_id":"reviewed-joint-v1","kind":"cross_field","task":"Find a testable relation between two frozen fields","acceptance":"Independently checked sources in both fields and a synthesis with a falsifiable prediction"}
```
From the checked release, use:

```sh
node runtime/dsh/resident-ingress.mjs --config /private/ingress.json submit < /private/request.json
node runtime/dsh/resident-ingress.mjs --config /private/ingress.json status REQUEST_ID
node runtime/dsh/resident-ingress.mjs --config /private/ingress.json list
node runtime/dsh/resident-ingress.mjs --config /private/ingress.json run-next
```

`run-next` journals an invocation before constructing the DSH host. An
interrupted or ambiguous planner/worker turn remains `unknown` and is skipped
on later runs. Only a trusted host can call `reconcile` with an exact archived
attempt/profile receipt proving completion or absence; there is deliberately
no model-facing or CLI reconcile command. An absence receipt permits a new
attempt, while an unknown receipt never does. A paused non-ambiguous program
requires an explicit `resume` call. An existing request is held if its profile
digest changes. Different request IDs for identical work are durable aliases
of one program, so every submitted ID resolves in `status`. `reported` means
the program reached its terminal checkpoint, including an accepted or rejected
two-source synthesis; it does not mean the frozen goal was independently
accepted. An unfinished two-scope phase is `paused` and needs explicit
`resume`. This ingress funds at most one research or analysis result in each
scope and one synthesis. No service or LaunchAgent is installed by this module.

`scoped-context.mjs` is an opt-in host diagnostic for retrieval. Given a
trusted controller view at an exact causal cut, a host-owned source resolver,
host-authored relationship edges, and a pinned native Bend binary, it compares
the existing flat selection with bounded graph diffusion under the same K and
output-byte cap. Every returned ref retains its event digest, source digest,
scope, and evidence status. It rejects changed source bytes, unknown graph
events, duplicate or out-of-scope kernel IDs, and an unpinned binary. Its timing
and graph-size diagnostics remain host-only because they can reveal the
presence of out-of-scope records. The fixed keyless case is evidence of one
ranking difference, not a reason to switch live planner context. It is not a
model tool or a source of authority.

`createResearchTaskProgramHost` composes the funded DeepSeek planner with the same archived, independently settled research worker. Give it the frozen `spec`, `prompt`, `programId`, `targetTasks` ceiling, `plannerBudget`, and `workerBudget` plus the private paths and checked `dsh` settings above. This one-attempt slice requires exactly one evaluation per worker. Use `plannerWorkspace` with `@-` at `spec.initial_head` instead of `workerWorkspace`, and provide a private, canonical `workerWorkspaceRoot` outside the planner workspace, state, archive, verifier, case set, and DSH roots. The host creates one deterministic linked jj workspace per granted plan at the exact base. It runs one worker at a time and accepts `research` and `analysis` results only after the pinned host verifier accepts their artifact, evidence, plan kind, and oracle. Default feedback planning can stop below the ceiling after observing those settled outcomes. The worker must return a `telepathy.research-proposal/v1` JSON object. Raw bytes are archived before a malformed claim is rejected through independent settlement; no provider turn is repeated. The parser validates structure and causal parent only. Its source hashes remain proposals until the host-pinned oracle checks the underlying sources.

```js
import { createResearchTaskProgramHost, researchProgramForecast } from '/path/to/checked/release/runtime/dsh/task-host.mjs';

const forecast = researchProgramForecast({ spec, targetTasks, plannerBudget, workerBudget });
if (Object.values(forecast.shortfall).some(Boolean)) throw new Error('Increase frozen compute limits');
const host = await createResearchTaskProgramHost({
  spec, prompt, programId, targetTasks, plannerBudget, workerBudget,
  plannerWorkspace, workerWorkspaceRoot, verifierFile, caseSetFile,
  stateRoot, taskStateRoot, archiveRoot, dsh,
});
const progress = await host.run();
```

Before a later funded planner page, the host searches accepted research settlements to the page's causal cut until it finds up to eight distinct claim-content digests within 24 KiB. It checks each independent settlement and exact archived dispatch and artifact, keeps the newest verified instance of repeated content, then exposes the reported proposition, method, and uncertainty. A fixed recent-settlement cutoff would lose older distinct evidence after enough repeated confirmations. The omitted count includes duplicate confirmations and older settlements; their receipts remain archived. Rejected, malformed, and uncertain output stays out of the next planner context. The selected bytes and digest are archived with the planner attempt and checked on cold audit. A root-scoped, crash-released lock makes retained-workspace capacity checks and checkout creation atomic across programs; the first use pins the capacity for that root. Recovery also retires a clean final settled checkout and forgets its exact jj registration if removal completed before a crash. A partially removed checkout remains for audit.

The forecast reports the minimum task, branch, token, fuel, and evaluation allocations plus any shortfall; serialized plan bytes may consume more tokens. It does not grant compute. `run()` can be called again with the same frozen settings: archived worker turns settle idempotently, while a turn without an immutable receipt remains `unknown` until a trusted audit resolves it. A program checkpoint created by the earlier preplanning default must resume with `feedbackPlanning: false`; a new feedback program uses its own checkpoint signature. Early planner `done` closes planning, not the frozen task's independent acceptance. The host retires only clean, independently settled linked workspaces. Dirty, ignored-private, and uncertain workspaces remain for audit; `maxRetainedWorkerWorkspaces` defaults to eight and halts a new grant when full. Twelve keyless serial workers peaked at one checkout and ended at zero, with all receipts archived. This does not measure a 10,000-provider-call run. Production turns require a private DeepSeek credential and the checked DSH release. The keyless tests cover both plan kinds, malformed and archived-response recovery, and an unarchived unknown turn; they do not establish live model quality or new knowledge.

The controller can admit a host-authored `synthesis` task only when its 2..16 cited result events were independently accepted at one causal cut and come from at least two frozen scopes. The root integration owner alone can take its grant. `createSynthesisHost` now prepares that grant, checks the attributed sources in one private archive, journals one funded DSH dispatch, and settles its archived proposal through the separately pinned synthesis oracle. `createCheckedSynthesisRunner` preflights the checked release and uses the metered SDK session; a missing dispatch receipt remains unknown until a trusted audit. The oracle must check cited artifacts and evidence, including the new inference. The funded research planner does not yet select cross-field sources, and no live DeepSeek synthesis turn has run.

`createTwoScopeResearchSynthesisHost` composes this path for exactly two frozen scopes in one task. It funds one model-planned research or analysis task per scope, serially, using distinct planner workspaces and one shared private task store, worker root, and artifact archive. After one independent acceptance in each scope, the host selects those exact result events and funds one synthesis through `createSynthesisHost`. The workspaces must share a jj store and have `@-` at `spec.initial_head`; the synthesis oracle must be a host-owned file with bytes matching the frozen digest. Call `twoScopeResearchSynthesisForecast` before funding. Pass the checked `createCheckedSynthesisRunner({ dsh, taskStateRoot })` as `synthesisRunner`, along with `plannerWorkspaces`, `synthesisWorkspace`, `synthesisOracleTrustedRoot`, `synthesisOracleFile`, `synthesisBudget`, `synthesisDeliverable`, and `synthesisAcceptance`. The composition contract is archived before a model turn, and a fresh provider turn checks compute remaining after other programs' spending. The forecast is not an escrow for future synthesis; concurrent spending can stop a later phase. Large source excerpts shrink to the funded prompt bound; the pinned oracle still receives full source artifacts. A rejected or uncertain source cannot trigger synthesis. Keyless tests cover accepted, rejected, uncertain, replay, shared-compute, and preflight paths. The current program attempts at most one result per scope and one synthesis; it cannot replan a rejected synthesis or close the overall task (`task_accepted` stays false). No live cross-field claim has been verified.

`createArchivedDelegationEvidence` can supply the generic task program with paired width evidence from a frozen manifest, exact accepted settlement receipts, protected compute meter confirmations, fresh capacity observations, and host-certified independent plan refs. Zero observed completions permit one funded pilot when queues are clear; unknown work or backlog blocks it. Its keyless tests show a cold restart holds width one without real matched trials. The runnable research host remains serial until a production host supplies authentic trial, meter, capacity, and independence callbacks.

## Keyless integration proof

The test adapter in `mock-llm.mjs` is loaded only by `headless-smoke.patch.yml`. It makes no model request. After building the pinned upstream checkout, run:

```sh
TELEPATHY_DSH_CLI_BIN=/path/to/deepseek-harness/apps/cli/lib/bin.js \
TELEPATHY_DSH_LLM_MODULE=/path/to/deepseek-harness/packages/llm/llm/lib/index.js \
make integration-check
```

The headless test generates a deliberately wrong one-file baseline from the reference source, then runs both through real DSH sessions. It scores both against the same 11 held-out cases, calls `algorithm_select` through DSH to promote the 11/11 candidate over the 0/11 incumbent, and executes the pinned binary in a new session. It checks that the older session retains its original pin.

## Boundaries

The plugin limits source size, case count, child output, and wall time, and passes a small environment to Bend and the evaluator. On macOS, native candidate runs use Seatbelt with reads limited to the exact binary, its path ancestors, and system runtime files; writes and network are denied. On Linux, Bubblewrap starts from an empty temporary root and mounts only the binary, runtime libraries, and virtual devices; install a working `bwrap` before running live candidates. Other hosts fail closed. Core and evaluator canary tests check that a candidate cannot read a private file, and the exact jj gate rejects test-only sandbox overrides. Compiler/checker invocations still process candidate source under the host account, so use an isolated account for sources you do not trust. The model-facing file tools are confined to a verified workspace and reject control files, symlinks out of scope, and private roots. This guard is a DSH plugin running under the host account; isolate the host account if arbitrary untrusted plugins or source are in scope. Keep evaluator and case-set digests host-owned. `algorithm_select` measures empirical improvement on the fixed cases only; it does not certify the algorithm or the agent beyond those cases.
