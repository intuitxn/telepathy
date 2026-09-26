# Science, computation, and agent delegation

This is the operational contract for using the [algorithm machine](dsh-algorithm-machine.md) to pursue new knowledge. The machine may generate hypotheses, algorithms, experiments, and counterexamples. It calls a claim **accepted for a particular task** only when the task's frozen method and independent evaluator support it. Acceptance is scoped evidence, not a declaration of universal truth.

## One machine, several kinds of work

| Computer science principle | Scientific analogue | Executable record | Failure if omitted |
| --- | --- | --- | --- |
| Program and type | A method with admissible inputs and outputs | Source digest, input schema, declared assumptions, checker result | Fluent pseudocode is treated as an implementation |
| State transition | An intervention or measurement changes what is known | Causal parent, prediction, action, observation, provenance | A later summary silently rewrites an earlier result |
| Search under a budget | Choose which hypothesis, experiment, or algorithm to test next | Finite frontier, estimated gain, uncertainty, cost, remaining grant | More branches are equated with more discovery |
| Simulation | Predict the consequences of a model before acting | Model version, inputs, output, error against later observation | A simulated effect is reported as a measured effect |
| Independent evaluation | Reproduce an analysis or test a prediction with protected data | Pinned evaluator, case or protocol digest, verdict and counterexample | The proposer grades its own output |
| Parallel execution | Separate independent questions or attempts | Scoped plan, exact base, one owner, resource reservation | Shared assumptions and verifier capacity hide correlated errors |
| Version control | Preserve competing methods and failed ideas | Exact `jj` revision and immutable result archive | A new method is compared against a changing incumbent |
| Logical clock | Say what could have influenced a result | Task-log parent, branch parent, session sequence | Wall time is mistaken for causal order |

The causal-order distinction follows [Lamport's original account](https://www.microsoft.com/en-us/research/publication/time-clocks-ordering-events-distributed-system/). Computational reproducibility means preserving code, data, and method needed to rerun an analysis; it is a useful minimum when an independent physical replication is not yet possible ([Peng](https://pmc.ncbi.nlm.nih.gov/articles/PMC3383002/)). These analogies define records and checks in this machine; they do not turn software tests into physical evidence.

An LLM is a proposal and translation engine inside this arrangement. It can write a plan, map a paper to a candidate program, choose context, predict a tool result, and explain a discrepancy. A Bend checker, deterministic simulator, external instrument, cited source, independent verifier, and host controller have different jobs. A model's agreement with another model is weak evidence when their training and prompts create correlated errors. The result of a model turn is a **proposal** until a measurement settles it.

The translation path for an algorithm is:

```text
paper or pseudocode
  -> bounded specification {types, assumptions, input domain, output, invariant}
  -> executable candidate in one Bend file
  -> checker and deterministic examples
  -> held-out cases and counterexamples outside the candidate workspace
  -> exact-revision gate and independently measured score
  -> selected digest for future sessions, if it beats the incumbent
```

Ambiguous prose must produce an explicit assumption or an unknown result. A passing finite benchmark establishes behavior on its tested cases, not equivalence to an arbitrary paper or correctness outside its domain. The present `runtime/core/telepathy.bend` implements a bounded transition, frontier, retrieval, and prediction example; it is not a general paper-to-program compiler.

## Claims are typed by evidence

Use distinct records for a hypothesis, a source assertion, a simulated prediction, a direct measurement, a reproducible computation, and a task-accepted claim. A claim must name its domain, method, inputs, uncertainty, source digests, counterevidence, and the exact causal cut at which it was assessed. `unknown` is a real outcome. An inaccessible paper, absent instrument record, failed audit, or insufficient replication cannot become a negative or positive result by inference.

```text
Claim = {
  proposition, scope, status: proposed | tested | refuted | task_accepted | unknown,
  method_ref, source_refs, input_refs, predicted_observation,
  observed_ref?, counterexample_refs, evaluator_ref, causal_parent
}
```

For a new cross-field claim, first test whether the supposed novelty already appears in relevant source corpora at a recorded retrieval date. Then define a discriminating prediction or proof obligation. Run the field's appropriate observation or derivation, retain negative results, and use an independent verifier or replicator. An integration task may compose results only after it checks each dependency and the new inference between them. A task acceptance rule may validate source provenance or a calculation without validating the physical claim itself; the recorded status must reflect that narrower result.

This resembles the generate, experiment, and review loop in [Sakana's AI Scientist paper](https://arxiv.org/abs/2408.06292) and the empirical archive selection in its [Darwin Gödel Machine paper](https://arxiv.org/abs/2505.22954). Those papers motivate candidate generation and comparison; neither supplies this machine with a universal scientific oracle. The host must choose a domain-specific method before a task is funded.

## Governing exploration

Let the frontier contain only distinct, still admissible actions. Each action names the hypothesis it can distinguish, a proposed measurement or edit, the source and task heads it uses, its authority scope, and a maximum cost. At each causal checkpoint, estimate the **marginal verified gain** and the **value of resolving uncertainty**, then spend a bounded grant. The rule is a decision policy, not a claim that estimated probabilities are objectively correct:

```text
choose admissible a maximizing
    expected task gain(a) + beta * expected information gain(a)
    - lambda * total cost(a) - rho * downside(a)
subject to frozen acceptance, scope, budget, and evaluator
```

The information term is useful only when an observation could change the next decision. A paper search that cannot change a hypothesis, or another model sample with the same evidence and failure mode, has little marginal value. Bandit-guided search gives a formal example of balancing estimated value and exploration under sampling budgets ([Kocsis and Szepesvári](https://sites.ualberta.ca/~szepesva/papers/ecml06.pdf)); its guarantees do not transfer directly to open-ended research where rewards, independence, and a generative model may be absent. Track prediction error separately from task quality: a predictable no-op is well calibrated and still unproductive.

At a checkpoint, apply these transitions:

1. **Refine** when a measured counterexample narrows an assumption or exposes a useful new test.
2. **Fork** when two hypotheses need genuinely different evidence or when a controlled comparison can discriminate methods.
3. **Falsify** when the frozen test rejects a stated prediction; retain the counterexample and source revision.
4. **Suspend** when the next measurement is unaffordable, unavailable, or outside scope; retain an unknown rather than inventing a conclusion.
5. **Select** only after the protected evaluator compares a candidate with the incumbent at equal conditions and the declared no-regression rule passes.
6. **Stop** when the acceptance condition is met, the authorized budget is exhausted, or no admissible action has justified marginal value.

An unexpected observation can create a new branch, but it cannot change the frozen goal, evaluator, budget, or permissions. Reframing any of those requires a new authorized task decision. This prevents an agent from improving its apparent score by changing what success means.

## How many agents?

The prompt compiler should first return a **task proposal**, not a worker count:

```text
prompt + source head
  -> goal, acceptance, scopes, assumptions, candidate methods
  -> needed sources, instruments, executors, oracles, and integration work
  -> cost and capacity forecast for a finite task graph
  -> frozen task spec and independently checked plan pages
  -> grants for eligible nodes as evidence and capacity permit
```

The planner can describe up to 10,000 logical nodes in bounded pages. A node is
only a durable task contract until the host reserves a grant and a worker slot.
For a cross-field knowledge task, the forecast must also name how each field's
sources and measurements will be checked and how a synthesis claim will be
tested. If an instrument, source corpus, verifier, or budget is missing, the
program records that need and stops the affected branch as `unknown`; it cannot
manufacture a scientific result by launching more sessions. Only a new frozen
task or an authorized grant can expand the original resources.

There is no fixed optimum. The present funded research program dispatches **one live worker at a time** from potentially many durable logical plans. Its default planner can react to independently settled outcomes and host-checked accepted claim proposals between pages, then stop below the task ceiling. The 10,000-plan stress result used no model workers; it demonstrates controller bookkeeping, not 10,000 useful agents or scientific findings. An agent count is a resource decision made from work independence, verifier throughput, and measured marginal return.

For a proposed live width `n`, cap it by the number of eligible independent plans, workspace and provider limits, funded grants, and the rate at which results can be checked. One integration owner must retain capacity to combine and test exact revisions. The serial fraction and coordination cost limit parallel speedup, as [Amdahl's original analysis](https://www.cs.cmu.edu/~18742/papers/Amdahl1967.pdf) warns. Multiple model calls may share a systematic error, so their outputs do not count as independent replications merely because sessions were separate.

In a measured task family, let `r_w` be worker result arrivals per worker-hour, and let `r_v` and `r_i` be verifier and integration capacities in completions per hour. After a one-worker pilot establishes positive rates, an initial throughput cap is `n <= min(eligible, funded, provider, floor(r_v / r_w), floor(r_i / r_w))`. If a result needs no source merge, that task's integration capacity is not binding. These are measured rates with uncertainty, so the cap must fall when a queue accumulates. Choose the smallest tested `n` whose lower confidence bound on verified gain per total compute meets the task's target; latency, regressions, and unsupported claims are separate constraints. This is a scheduling rule to validate, not a universal law of agent teams.

Start with one worker. For a task family with repeated comparable instances, trial widths `1, 2, 4, ...` under the **same total compute budget**, frozen evaluator, and matched task mix. Increase width only if the next width improves verified outcomes or time to an accepted result enough to pay for planning, coordination, verification, and merge overhead without higher regression or unsupported-claim rates. Preserve paired outcomes and uncertainty intervals; when the evidence is inconclusive, keep the smaller width. Do not launch 10,000 live sessions to test whether a logical graph can hold 10,000 nodes.
At cold start, zero observed completions gives no throughput estimate. A slow
measured verifier can likewise yield a parallel capacity below one. With a
funded slot and clear verifier and integration queues, the governor permits one
serial pilot; unknown work or an unserved queue blocks further dispatch. Only
measured paired outcomes can raise live width beyond one.

Split a plan only if the children have separate deliverables, authority scopes, checks, and enough independent work to amortize a new grant. If two agents would edit the same file or rely on the same unverified premise, first separate their hypotheses or let one agent work. Merge only checked outputs through an integration node that verifies both the dependencies and their combined result. Stop spawning when verifier backlog grows, accepted gain per compute falls, or the frontier becomes duplicate. Reserve verifier and integration budget **before** growing the worker pool.

## Preventing long-session drift

Long context can make relevant evidence harder to use; [Lost in the Middle](https://arxiv.org/abs/2307.03172) reports position-dependent performance on its studied tasks. [Recursive Language Models](https://arxiv.org/abs/2512.24601) treat long input as an external environment to inspect selectively. In this machine, neither a larger prompt nor recursive calls are free: retrieval and subcalls consume grant and must be compared with a lean baseline.

At the start of an episode, give the agent the frozen goal, acceptance rule, current task and source heads, selected evidence and counterexamples, remaining grant, and one bounded next decision. Keep the full transcript in the session log; put only source-linked findings in reusable task state. At each checkpoint, calculate:

| Signal | What to record | Response |
| --- | --- | --- |
| Verified progress | New accepted result, independently falsified branch, or measured uncertainty reduction per total compute | Continue only if it changes the frontier or acceptance state |
| Prediction quality | Predicted files, observations, costs, and checks versus actual receipts | Retrieve missing evidence or narrow the next action |
| Goal fidelity | Whether the output addresses its frozen deliverable and acceptance method | Reject a changed objective; re-anchor at the task head |
| Duplicate work | Same source digest, claim, or counterexample attempted again | Reuse evidence; stop sampling the same branch unchanged |
| Evidence quality | Unsupported claims, source mismatches, verifier disagreement, unknowns mislabeled as facts | Refute, audit, or suspend before admitting the finding |
| Integration pressure | Ready grants, verification queue, merge conflicts, wall time and cost | Reduce live width and clear the bottleneck |

If two bounded episodes consume their grants without a new checked artifact, counterexample, or decision-changing observation, checkpoint and change the **method**: inspect a missing source, design a discriminating test, or start a fresh session from the causal cut. Do not ask the same session to produce a longer narrative about its own progress. This `two episodes` trigger is an initial policy to test, not an established optimum. A failed experiment that eliminates a hypothesis can count as progress; a lengthy persuasive summary cannot. Retain the incumbent agent and compare any prompt, retrieval, or harness edit on fresh tasks before selecting it. Session memory alone does not update model weights.

## Decision procedure and implemented policy seam

This pseudocode describes the proposed adaptive governor around the existing task program. The pure `delegation-governor.mjs` and [paired synthetic benchmark](../../benchmarks/delegation/README.md) implement a bounded width recommendation from claimed independently settled paired receipts, equal frozen budget, measured capacity, and current backlog. The generic task program now applies a host-supplied recommendation only to exact eligible plan refs and rechecks it after a crash. It cannot authenticate evidence produced by its callback. The production research host remains pinned to one live worker until an independent archived settlement and compute meter supplies real matched trials; the keyless simulator does not establish a provider gain. The scoring policy must be calibrated per task family.

```text
run(goal, acceptance, oracle, source_head, total_grant):
    task = freeze(goal, acceptance, oracle, source_head, total_grant)
    frontier = validate_and_admit(plan_pages(task), max_logical_tasks)
    width = 1
    while task.remaining and not task.accepted:
        cut = task.causal_head
        candidates = eligible(frontier, cut, task.remaining)
        if candidates.empty: return checkpoint(task, "no eligible work or unknown")
        selected = rank_by_expected_gain_information_cost_risk(candidates)
        work = reserve_distinct_grants(selected, min(width, verifier_capacity, integration_capacity))
        concurrently for grant in work:
            receipt = execute_pinned_session(grant, scoped_context(cut))
            archive(receipt.prediction, receipt.action, receipt.observation, receipt.cost)
        verdicts = []
        for receipt in completed(work):     # host pins oracle and settles results
            verdict = independently_verify(receipt, oracle, cut)
            verdicts.append(verdict)
            frontier = update_only_from_admitted_evidence(frontier, verdict)
        measure_gain_and_backlog(task, work, verdicts)
        if duplicate_or_drift_or_backlog: width = max(1, floor(width / 2))
        if paired_trial_supports_more_width and integration_reserve: width = min(width * 2, cap)
        if no_justified_next_action: return checkpoint(task, "stopped with open questions")
    return exact_head_and_evidence(task)
```

No worker may choose its own width, evaluator, grant, or task head. A crash after an uncertain model invocation requires an exact archive audit; absence of a local response is not proof that the provider did no work. A rejected result can release its worker slot without becoming accepted knowledge. The current `task-program.mjs`, `task-control.mjs`, and `task-host.mjs` implement durable plans, funding, archiving, audit, independent result settlement, and serial production dispatch for a one-scope research slice. A trusted production evidence adapter, dependency-aware scientific synthesis, field-specific verifiers, and live provider outcomes remain implementation and research targets.

## Benchmark that can decide the next implementation

Pre-register a fixed budget, frozen verifier and source corpus, model route, task mix, and outcome fields. Keep held-out cases and verifier code outside the candidate workspace. Run the same task instances with one worker, then controlled two- and four-worker variants if the one-worker baseline leaves independent eligible work. Report the distribution and paired difference, not just a winning mean.

| Suite | Independent check | Primary measurements |
| --- | --- | --- |
| Algorithm translation | Bend checker, explicit laws, hidden input/output cases, incumbent comparison | Correct cases, regressions, runtime/fuel, prediction error, total model tokens |
| Evidence retrieval | Frozen corpus with dated and contradictory records; adjudicated answer key | Supported claim precision, abstention on unknowns, missed counterevidence, cost |
| Simulated discovery | Hidden simulator parameters; candidate predicts outcomes before choosing bounded experiments | Held-out predictive quality, hypotheses eliminated, experiments and compute used |
| Real field pilot | A field expert fixes the protocol and independent replication route before proposals | Reproduced claims, unresolved claims, false positives, elapsed time and total cost |

The simulator tests adaptive experiment design, not real-world scientific discovery. The real field pilot must keep the instrument or replication result outside the agent's control. Compare a long transcript, a fresh session with selected evidence, and a recursive retrieval policy at equal total compute. Report unsupported-claim rate, duplicate-work rate, verified gain per compute, and time to a checked result. Run an unchanged agent clone beside any modified agent on fresh held-out tasks; promote a self-edit only if its declared task metrics improve without regressions. The initial `1, 2, 4` widths and two-episode drift trigger are hypotheses to validate with these measurements.

The [fixed-oracle Bend exploration benchmark](../../benchmarks/exploration/README.md)
now exercises two evidence ordering policies at equal round and scan caps. It
records a case where bounded verified evidence helps and a stale-evidence
counterexample where it loses. Its public synthetic fixture and simulated host
policy do not replace the held-out model and field comparisons above.
