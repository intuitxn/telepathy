# Delegation width, measured at a frozen grant

`node benchmarks/delegation/run.mjs` prints a deterministic comparison of
widths 1, 2, and 4. `node --test benchmarks/delegation/run.test.mjs` checks the
decision rules. No model API, live worker, or new scheduler is invoked.

Each paired episode has the same 48-unit budget, candidate catalog, task-set
digest, and evaluator digest at each width. A proposal costs four worker units,
two verifier units, and one integration unit. Coordination costs three units per
additional worker. The proposer sees only the catalog and its width. A separate
simulated verifier closure holds one-time payoffs and produces verdict receipts.
All spent work, verification, integration, and coordination enter the gain per
compute denominator. Unspent grant is reported through the 48-unit cap.

The `complementary` family rewards searching two independent domains: the
measured four-pair aggregate is 60/168 at width 1, 132/180 at width 2, and
54/176 at width 4. Width 2 wins every pair; width 4 searches two zero-payoff
domains and records eight unsupported claims. The `serial-favor` family rewards
the first domain: width 1 yields 204/168, while width 2 yields 120/180. The
same code therefore stays at width 1. A present verifier backlog of three
reduces the current capacity cap from four to one, even with favorable historic
width-2 trials.

`recommendWidth` accepts **host-supplied, independently settled** receipts.
Each receipt must bind the same task set, evaluator, and frozen budget as its
paired episode. It considers the next width only if all observed pairs improve
verified gain per total compute, aggregate yield improves, unsupported claims
do not rise, and the candidate has no recorded regressions. This worst-pair
guard is intentionally conservative; four synthetic pairs do not establish a
statistical confidence bound. It also caps width by eligible independent work,
funded grants, provider and workspace slots, measured worker/verifier/integration
rates, and current backlogs within a stated time horizon. A current unknown
verdict stops new grants until its archive is audited. A paired trial with any
unsettled verdict is inadmissible. Zero capacity returns zero rather than
launching a nominal worker.

Integration seam: a future host owner may turn archived independent task
verdicts into paired episode receipts, compute throughput from observed durations,
and call `recommendWidth` at a causal checkpoint **before reserving worker
grants**. The active `task-host.mjs` still dispatches one live worker at a time.
No untrusted worker should set `verdict_source`, accepted gain, throughput, or
the evaluator digest. The synthetic proposer has hard-coded domain allocation,
so the numbers demonstrate the policy's response to diversity, overhead, and a
verification bottleneck; they do not show that width 2 improves real knowledge
work, nor that a model will reproduce these gains. Run controlled fresh-task
trials with a protected field-specific verifier before changing live width.
