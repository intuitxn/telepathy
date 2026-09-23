# Meta: native programs and the host boundary

The consolidated runtime combines the integration branch's retirement, identity,
context and autonomy changes with Mundus's command surface and scoped retrieval
kernel. `./mundus` now routes worker commands to the real Lorenz protocol.
Experimental numeric planning and local graph retrieval remain separate.

## What is native

| Layer | Responsibility |
|---|---|
| Bend | Worker ownership, task/result links, explicit learning and correction; adaptive kernels; scoped diffusion; numeric planning; verdict/status/context functions; native loopback OpenCode HTTP delivery over TCP. |
| Small host scripts | Processes, private directories, local writer lock, source freezing/digests, atomic head publication, operation dispatch and configuration installation. |
| Buzz / OpenCode / Codex | Agent identity, model access, ACP, tool execution, relay and durable engram storage. |
| Git / independent evaluators | Versioned candidates, review gates, source-bound verification and independent outcome checks. |

A census of the predecessor branches found 62.0% (integration) and 64.7%
(Mundus) Bend by physical source lines, or 58.3% and 60.7% excluding blank and
full-line comments. Scope: tracked first-party runtime/, scripts/, ops/ and the
root mundus executable, excluding tests, evaluation, retired opencode-v2 and
check/evaluate drivers. This includes proofs, examples and historical utilities;
it excludes external hosts, models, compiler and the website. It is source
composition, not execution coverage or a percentage of intelligence.

Bend's official language description provides native compilation, parallel
execution and an affine dependent proof system: https://www.bend-lang.com/.
Our use of it does not show that this harness runs its reasoning on a GPU,
updates model weights, or proves every behavior. Some local laws are concrete
fixture equalities; their names do not make them universal theorems.

If “Neural Computers” means the 2026 paper (https://arxiv.org/abs/2604.06425),
it proposes computation, memory and I/O inside learned runtime state. This
system instead has neural agents operating explicit programs and external
state. Both pursue reusable capability, through different mechanisms.

## Demand-driven programs

The useful target is: invoke a compatible checked capability when one exists;
otherwise ask Meta to propose or repair it, evaluate it independently, and
retain the supported outcome. A successful routine can then run without
repeated model interpretation. Meta still performs problem formulation,
exception handling, program revision and selection of evidence.

That is demand-driven execution, not a promise that idle programs improve
spontaneously. The current operation driver checks a source snapshot and its
registered fixture. It does not autonomously discover missing capabilities,
construct a work graph, or promote arbitrary generated programs. The numeric
planner does not translate natural-language tasks into delegated work.

## Local work loop

Run `./mundus help` for exact arguments. One private root contains:

- `head`: the selected successful step;
- `snapshots/step.*/state`: immutable worker history;
- per-attempt source, checker output, source digest and transition output;
- `.writer-lock`: cooperative local mutation lock, absent when idle.

`capture -> work -> worker -> claim -> packet -> return -> learn` is explicit.
A return preserves attribution but does not establish correctness or become
memory automatically. A fresh process reads learned findings in later packets.
`correct` supersedes a finding and marks its dependents for review. Independent
checks decide whether a selected report supports a retained finding.

A failed transition leaves the head unchanged. Interruption may leave an
unpublished snapshot or writer lock; inspect before recovery. This wrapper is
not an adversarial sandbox, distributed lease, filesystem durability guarantee,
or automatic merger of snapshot branches. Different roots can claim equivalent
work independently. Direct Bend invocations bypass the host lock/publication.

The task root and evidence stay private. `scripts/install-meta.sh` installs
both the command and role with backups for fresh OpenCode contexts; it does not
reload an existing agent or grant credentials.

## Across nodes

Reusable evidence needs the problem contract, source revision, dependencies,
evaluator, measured outcome, counterexamples and supersession status. A receiving
node must retrieve that evidence and check its compatibility with current code.
A correction must be observed by the receiver before claiming stale-memory
handling across nodes.

Local Lorenz snapshots and Buzz engrams are distinct. Existing tests establish
local fresh-process reuse and invalidation; they do not establish distributed
exclusive claims, automatic replication, convergent corrections, or improvement
in model accuracy. The recorded coding pilots showed no accuracy advantage for
the memory arms. New matched, repeated held-out tasks remain necessary.

## Remaining live boundaries

The September 23 probe found Buzz Desktop running with Codex ACP descendants;
no authenticated callable Buzz host was available to this shell. Native memory
reads returned auth_error. This is unavailable access, not an empty memory store.
No keys were extracted or identities switched. The native Buzz -> OpenCode ->
Bend demonstration and fresh-session relay correction remain unverified.

GitHub PR #18 is the existing consolidation review. Its older feature PRs were
already superseded; main requires independent approval and passing checks.
Agent verification cannot impersonate that approving identity. The historical
retrieval proof subtree proves narrowed fragments; general heat/mass
conservation remains outside its checked claims and the production manifest.

## Verification of the consolidated candidate

- Bend 2.0.21: all ten required kernel files check.
- `node scripts/check.mjs --require-bend`: 15 check groups passed, none skipped; includes native protocol, Lorenz evaluator and Mundus fresh-process tests.
- `node --test scripts/ops-driver.test.mjs`: 3 passed, including failed-gate nonexecution and wrong-output rejection.
- `python3 -m unittest test_programs test_v11` in runtime/programs: 74 passed.
- Site `npm run check` under Node 24.18.0: typecheck, 20 tests and build passed. Local Node 26 Web Storage caused an earlier site-only failure; the CI-matched runtime passed without website changes.
- Fresh unrelated OpenCode context: meta command resolves to the meta primary agent and the Mundus instructions. Installer test preserved both prior entries.
- The initial focused wrapper test ran during a wrapper edit and failed; the stable-source rerun passed. Keep executable scripts stable during an invocation.
- CI now pins the official Bend 2.0.21 Linux archive by SHA256 and requires Bend. Linux results are established by the PR checks, not the local macOS run.
