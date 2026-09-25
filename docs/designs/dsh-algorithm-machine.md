# Telepathy algorithm machine

Status: local migration under test, 2026-09-25. The live DeepSeek API path
has not yet been exercised with a credential.

## What runs

```text
request + grant + current evidence
           │
           ▼
DeepSeek Harness session (deepseek-official / deepseek-flash)
  context, model turns, tools, session log, cancellation
           │ proposal + prediction
           ▼
Telepathy DSH plugins (runtime/dsh/)
  task grants/admission/checkpoints + exact source archive
  → Bend check/build/run → independent score → future-session selection
           │ checked inputs and receipts
           ▼
Bend candidate (one .bend file) + host-pinned evaluator/cases
  pure transition, simulation, retrieval, frontier, algorithm laws
```

DSH is the sole agent driver. Its sessions and tool records supply the
durable decision history. The plugin owns the boundary where proposals become
executions and scores become a selected version. Bend owns pure computation.
A one-file Bend candidate can contain its types, algorithm, laws, and batch
`main`; it cannot also be the model host, independent evaluator, credential
store, or permission boundary. Papers and pseudocode enter as candidate
specifications. The model translates them to typed source; the compiler and
independent tests check what holds.

There is no separate Mundus daemon or second model scheduler in the target.
The useful Mundus idea is a scoped state projection of admitted events. A
small task control service within DSH must own cross-session grants, causal
heads, and acceptance; independent DSH session logs do not create that shared
task state automatically. Its reducer may use pure Bend logic. The old
`mundus`, Meta shell, mailbox plugin, and OpenCode host code are historical
sources during migration. Agent handoffs can use DSH session references, but
a task claim enters shared state only through scoped admission. The site,
forum, reusable algorithms, and local workspace service remain separate.

## One event clock and one closed loop

The target admitted event has a scope, causal parents, logical sequence, actor and
authority, exact source/configuration/evaluator digests, prediction,
observation, measured status, and cost. Logical time is the partial order of
events and branch parents. Wall time, tokens, CPU, simulation fuel, and money
are separate measured costs. An unmeasured result stays unknown.

```text
S(t) = Fold(pinned reducer, admitted events at causal cut t)
S = {goal, observed work, accepted knowledge, beliefs, frontier,
     grants, budgets, versions, causal heads}

context → predict effect/cost → admissibility → act on exact base
        → observe → independent score → discrepancy
        → update belief/frontier → select or revise
```

The goal and acceptance rule are frozen for a comparison. Beliefs and the
finite potentia frontier can change. A frontier item names a distinct
admissible action or algorithm branch, its expected value, uncertainty, risk,
fuel, and causal origin. Compute advances a branch; counterexamples remove
or revise it. Selection weighs expected verified gain, information gained,
measured cost, and risk under the grant. Prediction accuracy is separate from
task success: a predictable no-op has good calibration and zero task gain.
The current Bend core scans a bounded prefix and selects the admissible,
funded candidate with the highest positive supplied estimate. Ties resolve
deterministically. Those estimates are not measured values; calibration,
information gain, and closed feedback into the frontier remain to be verified.

For an edit, a prediction names the base digest, expected changed behavior,
expected checks, and possible failure. The host records what happened on that
base. The evaluator supplies task quality `Q` from fixed cases or other
independent checks. Calibration compares prediction with observation. The
agent's assertion never supplies the verdict.

The target retrieval path enforces a host grant before ranking current
evidence and counterexamples within a context budget. Diffusion, if
introduced, must beat a simpler
scope-safe baseline at matched compute and cannot expand authority. The
present Bend core filters records by a caller-supplied scope; it does not
authenticate that scope or implement diffusion. Its `calibration_measured`
and `HostSuccess`/`HostFailure` fields are also caller supplied. A host must
bind scope and verdict to grants and independent receipts before this can
become accepted task state.

## The small task control service

The neural design pass identifies the missing cross-session control seam.
The service is a compact task projection and policy attached to DSH, while
DSH continues to drive model turns. Its host API is:

```text
open(frozen_spec) -> task_ref
plan(task_ref, typed_logical_task) -> plan_ref
view(task_ref, agent, causal_cut, token_budget) -> scoped context_refs
grant(task_ref, deliverable, base_refs, budget, location) -> grant_ref
admit(task_ref, typed_event, grant_ref) -> new causal head or rejection
settle(task_ref, candidate_refs) -> accepted head | rejected
checkpoint(task_ref) -> continue | inspect | delegate | integrate | stop
```

`open` freezes the host-authorized goal and verifier. `grant` reserves finite
worker, evaluation, and integration budget for one owner and exact `jj` base.
`view` filters by scope and causal cut before spending tokens. `admit` checks
schema, authority, parents, and event digest before recording a handoff.
`settle` compares the current head with the candidate base and calls the
host-pinned independent verifier after reserving evaluation budget. The
verifier reconciles branches and checks the combined exact revision.
`checkpoint` records a reasoned next work kind without starting a model
turn. `startChild` separately checks an isolated `jj` workspace and binds the
new DSH child to its live parent. Host audit callbacks resolve interrupted
starts or evaluations. The service is mounted as a host service; the optional
`task_plan` model tool still needs a host-owned session binding.

### Revision transformations and gates

`jj` snapshots edits into a working-copy revision as commands run, and its
[current Git compatibility guide](https://docs.jj-vcs.dev/latest/git-compatibility/)
lists hooks as unsupported. The control boundary is **adoption** of
an exact revision as a task or algorithm head. Pure source transformations may
run through an explicit [`jj fix`
tool](https://docs.jj-vcs.dev/latest/config/#code-formatting-and-other-file-content-transformations);
they produce a new revision that needs its own checks. The integration owner
then runs
`node scripts/jj-gate.mjs FULL_JJ_COMMIT_ID`, which uses
`jj --ignore-working-copy run --ignore-changes --clean --root -r FULL_JJ_COMMIT_ID -- node scripts/check.mjs --require-dsh`.
It records a receipt only when all checks pass with zero skips. `settle`
requires this exact-revision result before its compare-and-swap head update.
The receipt binds the DSH source commit, built entrypoints, Bend binary, Node
version, jj executable and store, protected checker inputs, and check output.
`jj telepathy-gate FULL_JJ_COMMIT_ID` is installed from the previous checked
release, and `jj telepathy-install FULL_JJ_COMMIT_ID` adopts a checked release.
The first local release requires an explicit reviewed bootstrap. `jj fix` is
the intended deterministic source-transformation seam; this revision does
not install a formatter or pretend that jj has a pre-commit hook.
CI repeats the DSH and Bend checks on the published Git head. This gate checks
the revision's declared build and tests; a candidate that edits its own tests
could weaken them. Algorithm quality additionally requires the host-pinned
evaluator and cases outside the candidate, while a harness self-edit requires
review of the changed verifier itself and fresh-task clone evaluation. A
changed tree invalidates the prior receipt; neither a model statement nor a
local working-copy snapshot advances the accepted head.

The production DSH patch loads plugins and skills from a host-owned checked
release outside the model workspace. Workspace HMR is disabled: it could
otherwise import agent-edited plugin code with host privileges. After a gate
and independent review accept a new revision, the host installs a new immutable
release and starts new sessions on it. Development HMR may watch a separate
trusted checkout, but it does not promote source or alter an existing session's
algorithm pin.
The model-facing boundary disables shell, network-capable tools, PTC, default
child tools, and automatic LLM title generation. Guarded file tools require a
verified root or child workspace and reject private state and source-control
paths. The required agent loop depends on startup readiness, which requires
the file boundary, both task/grant refs, and the task-run meter; an unfunded
production launch stops before a provider turn. A trusted host must bind a
child to its grant while DSH creates it.
This boundary runs in the host process, so untrusted plugin code still needs a
separate operating-system account or sandbox.

### From one prompt to many bounded tasks

The first model pass turns the authorized prompt into a proposed task graph:
each node names an output, parent evidence, a concrete acceptance method,
authority scope, compute estimate, and dependencies. The controller validates
the proposal against the original goal and available budget, admits nodes as
**logical tasks**, and grants only a bounded active set to DSH sessions. An
admitted task does not consume a live model session while it waits. This is
how 10,000 potential agents fit on one machine: a durable graph and small
active worker pool, with integration and evaluation capacity reserved before
the pool grows. `task-program.mjs` persists planner invocation intents,
pages, and dispatch intents, and pauses for an exact host audit after either
an uncertain planner call or worker invocation. The funded research host now
interleaves pages with worker verdicts: a nonfinal page forms a durable barrier,
and only independently settled outcomes can enter the next planning turn.
Each page is checked as a whole before any plan is
admitted; an audited invalid raw reply needs a bounded, explicit replan, while an
unexpected partial admission is quarantined for host repair. Planner and
worker callbacks remain host-owned injection points; a worker return cannot
itself accept the task. The target is
useful verified work per total compute, not a large session count.

```text
prompt → task contracts → scoped graph/frontier → bounded grants
       → predictions → branch work → independent checks
       → causal admission → exact-revision integration → new frontier
```

The executable host program has a finite contract, rather than a request to
open 10,000 sessions:

```text
freeze(goal, acceptance, scope, oracle digests, compute limits, max_tasks)
fund one planner grant and reserve one worker slot
while planned < max_tasks and work remains justified:
    reserve a bounded DeepSeek turn at the current causal cut
    archive its exact input and response; validate a page of at most 64 tasks
    admit the page once, then dispatch its tasks with one live worker
    archive predictions and evidence; independently settle each result
    if a verdict is uncertain: stop for exact audit
    give bounded, attributed verdicts and scoped context to the next page
close the planner grant; checkpoint accepted results and open questions
```

`createFundedTaskProgram` implements the first one-scope version of the
planner and worker boundary. Its default feedback mode treats `targetTasks` as
an upper bound, uses one funded planner session across pages, and dispatches
one worker at a time. It reserves two active-grant slots for a multi-task run:
the planner and one worker. A page below the bound remains open until its
worker verdicts are settled; after feedback, the planner can stop with an
empty final page. Legacy all-pages-first planning remains opt-in with
`feedbackPlanning: false`. A model's early stop closes planning only; it does
not prove the frozen goal has been accepted by an independent verifier.
Host-supplied callbacks provision worker grants, run workers, recover dispatches,
and independently settle results. The runnable research host requires a bounded
`telepathy.research-proposal/v1` JSON artifact. It archives the raw response
before parsing inside the host verifier. A malformed proposal is an
independently rejected result, not a reason to repeat the provider call.
Model-supplied source digests stay inside the proposal until the pinned oracle
resolves their bytes and relevance.
For the next funded planner page, the host searches accepted settlements back
to the exact causal cut until it finds up to eight distinct claim-content
digests within 24 KiB. It checks each settlement at the page's causal cut,
the exact archived dispatch and artifact digests, and the proposal schema
before exposing its proposition, reported method, and uncertainty. The newest
verified instance represents repeated content; all receipts remain archived
and omitted settlements are counted. Rejected,
malformed, or unknown worker output cannot become planner knowledge. The
selected context and its digest are archived with the planner attempt; a
cold replay checks the same selection without another model turn.
`createResearchTaskProgramHost` supplies these callbacks for independent
research and analysis tasks. It creates exact-base linked `jj` workspaces,
meters one DSH worker session per dispatch, archives evidence, and calls the
host-pinned result verifier. One evaluation per worker ensures a rejection
releases the slot for the next task.
The host foregrounds the frozen goal, acceptance, causal cut, and required
contribution before each turn. It archives and rejects repeated normalized
deliverable/acceptance pairs at the planner's causal cut. The scoped context
view labels proposed versus verified evidence and preserves independently
verified findings when newer proposals fill its bounded window. These guards
catch exact structural drift, not semantic paraphrases or unsupported claims.
The host must provision a frozen token/fuel/evaluation budget large enough for
the proposed count. Opt-in controller stress runs admitted 10,000 logical
plans in about 187–201 seconds on this machine; a measured 200.7-second run
spent 198.6 seconds on durable event writes, 1.2 seconds on cold replay, and
25 ms on a bounded head view. It used one grant and zero model workers. The
current research host dispatches one worker at a time. It retires a clean
linked `jj` workspace only after the raw response is archived and an independent
result verdict is settled. Dirty, ignored-private, and uncertain workspaces
remain for audit; a retained-workspace cap stops new grants rather than deleting
their contents. A root-scoped lock makes capacity checks and checkout creation
atomic across programs, and the root pins one capacity. Restart retires a
clean final settled checkout and reconciles its jj registration when removal
finished just before a crash. A partially removed checkout remains for audit.
Twelve keyless serial workers peaked at one linked checkout and
finished with zero, retaining all twelve dispatch receipts. A full 10,000-worker
run still needs a wall, storage, provider, and verifier forecast. The controller stress did not
make 10,000 provider calls or verify 10,000 scientific findings. Planner and
worker turns with uncertain outcomes halt for exact archive audit instead of being
silently repeated. The funded planner slice admits independent research and
analysis plans with no dependencies. The host controller also admits a
`synthesis` task whose cited result events were independently accepted from
at least two frozen scopes at one causal cut. The integration owner receives
their attributed manifest, and a separately pinned oracle scores the proposed
result. A funded cross-field planner and domain-specific evaluators remain to
be built.

For knowledge work, the output of a task is a claim with its source and
measurement record, including counterevidence and unresolved assumptions.
The controller can score whether the **agreed check** was met; it cannot infer
universal truth from model agreement or from the number of agents. Funding
refutation, replication, or cross-field integration is a new task decision at
the current causal cut, charged to the remaining budget.

For research, a task may produce a hypothesis, source map, derivation,
experiment, or attempted refutation. Its evaluator records provenance,
independent replication when possible, contradictions, and unresolved claims.
Open questions can improve the frontier without being labeled established
knowledge. Work crossing fields can be recombined only at an integration node
that checks the dependencies and the resulting claim. The model can propose
new questions or a better decomposition, but those proposals receive fresh
grants rather than expanding the original authority or compute on their own.
Each task contract fixes its own scoring method before work starts. Software
tasks can score held-out correctness, regressions, prediction calibration, and
total measured compute. Research tasks retain separate fields for source
provenance, falsifiable predictions, replication, counterexamples, and open
uncertainty; they do not acquire a single universal truth score. A claim with
no independent check stays proposed or unknown. The funded research planner
receives bounded settled verdicts and scoped evidence at the next causal cut;
it can propose another research or analysis task within the remaining budget.
The funded research slice still disallows dependencies and synthesis tasks,
even though the controller can admit and settle a host-authored synthesis task.
The controller can independently settle a proposed research or
analysis result against its frozen plan, grant, causal cut, and pinned oracle,
then unlock a dependent plan. An exhausted rejected result releases its worker
slot so independent work can continue. One result never closes the overall
goal. The funded planner and serial research worker now form a keyless-tested
composition. A funded, archived synthesis turn over host-selected accepted
results is now keyless-tested. Live DeepSeek runs, field-specific verifiers, a
funded planner that chooses cross-field sources, and measured replication are
still needed before it can produce independently accepted new knowledge at scale.

The [science and delegation contract](science-computation-and-delegation.md)
defines the proposed measurement for exploration, agent width, and long-run
drift. A pure [delegation governor](../../benchmarks/delegation/README.md)
now selects width from paired settled verdicts, total compute, and measured
capacity. The generic task program can request wider dispatch from a host-owned
evidence callback that binds eligible plans, current capacity, and paired
verdict receipts. The runnable research host remains serial until production
can authenticate those receipts from live archives. The
[fixed-oracle exploration benchmark](../../benchmarks/exploration/README.md)
executes the Bend retrieval, frontier, and event kernel under two evidence
ordering policies. It includes a drift case and a counterexample where the
older verified estimate is wrong; it is a simulation, not a live agent result.
The [discovery pilot](../../benchmarks/discovery/README.md) commits each
prediction before a hidden synthetic oracle reveals the next observation, then
scores the final law on held-out cases per total compute. Its abstentions and
false law claims are reported separately from probe fit.

## Evolution, recursion, and versioning

An agent may propose edits to an algorithm, retrieval policy, prompt, or
plugin in an isolated `jj` workspace. Each child gets finite depth, width,
fuel, and an integration reserve. A candidate and benchmark bind to exact
digests and toolchain version. `algorithm_run` freezes source and records
predictions and observations; host-only `scoreCandidate` uses host-pinned cases
after an evaluation reservation. Host-only `selectCandidate` requires strict
case gain without regressions and changes the pointer for future sessions.
The production patch keeps model-facing scoring and selection disabled until
their origin grant and independent approval are bound. Existing sessions keep
their pin. A DSH host
release update and Bend candidate selection are different operations.
When the fixed case set is saturated, strict case gain has no next winner.
Further evolution needs a new host-pinned case generation or a separately
pinned cost/simplicity objective with repeated measurements and a no-regression
rule. Source shortening or a single noisy timing sample is not enough evidence
to promote a self-edit.

Recursive self-improvement needs more than public fixture gains. Fork an
unchanged agent clone and a proposed descendant at equal total compute.
Evaluate both on fresh tasks with a frozen oracle; measure verified gain,
regressions, calibration, compute, and branch overhead. Retain a finding or
variant only after that comparison. Session learning does not update model
weights. The [fresh clone comparison seam](fresh-clone-comparison.md) now
records a paired, host-only decision from pinned receipts and an independent
evaluator. A production driver must still prove fresh tasks, clone lineage,
prediction timing, and metered usage before it can supply promotion evidence.
[Recursive Language Models](https://arxiv.org/abs/2512.24601)
motivate keeping long context in an external environment and recursively
examining selected pieces; DSH must still meter those subcalls.
[Sakana's Darwin Gödel Machine](https://sakana.ai/dgm/) motivates
archive-based self-modification with empirical tests; [AB-MCTS](https://sakana.ai/ab-mcts/)
motivates bounded branch search. The third-party
[J-Space DSH plugin](https://github.com/kolawong/dsh-plugin-j-space) adds
instructions and an optional ledger to a session; it does not add a host
verifier or change model weights. Telepathy does not load it. Adopt such a
protocol only if paired runs on frozen Telepathy tasks show more verified gain
per total compute than the current session policy. Separately, this machine
can measure how discrete action choices change predicted state and verified
progress; that measurement is not an implementation of the plugin.

`jj` is the causal graph for editable source. One writer owns each workspace.
Jujutsu snapshots edits without a native pre-commit hook. The machine's check
is the adoption transition: apply any deterministic `jj fix` transformation,
resolve its new full revision ID, run the previous checked release's exact
`jj telepathy-gate`, obtain an independent verdict, then use task-control's
expected-head compare-and-swap. A later bookmark or GitHub push has its own
publication rules. A `jj fix` rewrite invalidates a prior receipt.
The ordered machine gates are therefore: content transformation, source/type
check, bounded execution, independent evaluation, exact-revision receipt, and
causal head adoption. A gate may propose a transformed revision, but only the
head adoption stage changes what future agents inherit. A failed or unknown
stage leaves the candidate branch available for inspection without advancing
the accepted head.
The integration owner combines exact revisions, resolves conflicts, and
reruns the verifier on the combined commit. DSH events, `jj` revisions, and
Telepathy handoffs record different causal facts. A handoff becomes accepted
knowledge only after scoped admission and checking. Federation and Mesh are
optional transport for later cross-node work; remote facts never select the
local algorithm without an origin grant and verifier.

## Language and tooling seam

Bend 2 is the first executable language. Its checker makes pure transitions
inspectable; a native build runs many simulations without a model call per
step. A batch `main` must accept bounded dynamic inputs, consume explicit
fuel while doing work, and emit stable machine-readable output. Named laws
prove only their written statements. The evaluator and cases live outside
the candidate.

The [algorithm specification path](algorithm-language-path.md) freezes an
attributed paper or pseudocode excerpt, explicit assumptions, typed CLI
probes, and counterexample requests before binding a one-file Bend candidate
to `algorithm_run`. Checker and prediction receipts are executable evidence;
semantic correctness remains unscored until the independent oracle.
The bounded `algorithm-language.mjs` compiler now turns a small natural-number
recurrence syntax into one deterministic Bend file, with immediate simulation
and editor-shaped diagnostics. It is a fast executable pseudocode subset, not
an automatic translation of an arbitrary paper or an independent evaluator.

An LSP would expose Bend diagnostics, symbol navigation, completion for the
small algorithm contract, and source-to-receipt links. It is a developer aid,
not a new runtime. The first milestone is fast checker diagnostics on one
candidate file and a counterexample at the current cursor. A custom DSL can
wait until repeated programs reveal a smaller stable syntax than Bend itself.

## Measured migration gates

The implementation contains `runtime/core/telepathy.bend`, a three-tool funded DSH
plugin and patch under `runtime/dsh/`, the task controller and task program,
the provider-usage ledger, guarded file tools, and the independent benchmark under
`benchmarks/core/`. The keyless suite exercises DSH sessions for run, score,
select, execute, old/new session pins, prompt-to-task dispatch, scoped file
access, and provider usage accounting. `make integration-check` requires a
pinned DSH checkout and Bend, then checks both executable case sets. Native
candidate runs have an isolated read view under macOS Seatbelt or Linux
Bubblewrap, and the gate exercises private-file canaries; the compiler and
checker still require an isolated account for untrusted inputs. A root task
run enables the usage ledger by supplying its exact task and grant refs.
Provider usage is recorded after a model call, so one call can overrun and
block later turns. The meter serializes calls for a grant within a DSH process
and buffers output until the provider usage is charged. A host audit may
resolve an interrupted call only with an exact request receipt and a
conservative charge; an unaudited call stays blocked. The event chain refuses
new publication at its replay limit, so a restart cannot be stranded by a
previously admitted event. These checks prove a deterministic vertical slice, not
autonomous self-improvement or scientific discovery.

Before retiring the old local host operationally, require:

1. A dynamic Bend batch candidate and strict work budget, checked on the
   integrated exact revision, with replayable score artifacts.
2. A durable task controller with two isolated child grants, scoped handoff
   admission, restart replay, and a conflict settled only after checking the
   combined exact revision. The selected algorithm must be executable by its
   pinned digest; score artifacts must be protected from model tool writes.
3. A live DSH session with private `DEEPSEEK_API_KEY`, exact
   `deepseek-official/deepseek-flash` route, scoped skill discovery, and a
   prediction → run → score → selection → fresh-session read.
4. A fresh-task unchanged-clone comparison for a self-editing agent at equal
   total compute, with held-out results and regressions recorded.
5. An inventory of resident jobs and private state, then a deliberate host
   switch. Removing source must not erase active service state.

The exact integrated source must pass `node scripts/check.mjs --require-dsh`.
Remote publication follows the repository's exact-revision review rule.

Operational cutover must first finish a live DSH run, inventory and drain old
tasks, stop the old service, and snapshot its private database and installed
entry points coherently. Retain that snapshot for rollback; source retirement
alone is not an operational switch.

## References

The pinned [DeepSeek Harness architecture](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md),
[extension cookbook](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/extension-cookbook.md),
and [Cordis primer](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-primer.md)
describe the host seams. [DeepSeek's model update](https://api-docs.deepseek.com/updates/)
names `deepseek-flash` as the V4.1 Flash API ID. Repository commands and pins
are in [runtime/dsh/README.md](../../runtime/dsh/README.md) and
[benchmarks/core/README.md](../../benchmarks/core/README.md).
