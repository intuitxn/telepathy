# Agent programs: a small pseudocode language

The source is meant to read like a procedure. The compiler in `runtime/agent_programs/language.py` checks names, types, step order, references, declared effects, and Choice/Noul/Score decision shapes, then emits a deterministic JSON plan. Ordinary programs are submitted to the resident `meta_shell.py` as **one task** through an ACP worker and the Bend kernel. There is no second daemon or scheduler. The constrained [RRSI policy program](../../runtime/agent_programs/rrsi.meta) is the first exception: its steps are interpreted by `runtime/rrsi_loop.py`, and the generic one-task bridge refuses it so its guards cannot be reduced to prompt text.

```text
program review_and_plan version 0.1.0
about "Inspect a request and choose a route."
input request: string
effect read_workspace: read "Read project files."
choice route from input.request:
  ask "What should happen next?"
  options implement, clarify, report_blocked
step inspect:
  use input.request
  allow read_workspace
  ask "Inspect the request and cite relevant files."
  output summary: string
  decide route
```

The full example is [review_and_plan.meta](../../examples/agent-programs/review_and_plan.meta). A source has one `program`, one `about`, typed `input` declarations, named `effect` declarations, optional typed decisions, and ordered `step` blocks. Top-level statements start in column 1; block statements use two spaces. Prompts and descriptions are JSON double-quoted strings. `use` names typed references such as `input.request`, `step.inspect.summary`, or a prior `decision.route`. `after` can name prior steps. Unknown statements and references fail compilation.

```sh
python3 runtime/agent_programs/cli.py check examples/agent-programs/review_and_plan.meta
python3 runtime/agent_programs/cli.py plan examples/agent-programs/review_and_plan.meta
python3 runtime/agent_programs/cli.py submit examples/agent-programs/review_and_plan.meta \
  --input-file ./request.json --allow-effect read_workspace --project "$PWD"
```

`request.json` binds every declared input with a value of the declared type. The bridge refuses undeclared values and any effect named by a step unless the caller also passes `--allow-effect NAME`. It currently refuses `publish` and nested `submit`. These checks prevent accidental broadening in the plan; they are **not OS sandboxing or external authorization**. The ACP worker still follows its host permission model and the operator's actual authority. The bridge submits a single plan to the node; step ordering and output values are still executed and reported by an LLM, not enforced by a separate interpreter. A `reported` node task is not independent acceptance.

Choice is a finite option set. Noul is a yes/no probability with a threshold in `[0,1]`. Score is a bounded numeric scale with an optional threshold. They are typed **decision contracts**, not truth guarantees or effect grants. [TypeSafe AI's primary announcement](https://typesafe.ai/blog/introducing-system-one-models-and-jev) and [API schema](https://api.typesafe.ai/docs) describe Jev/System One decision requests. [CLM's own repository](https://github.com/Contrastive-LM/CLM) describes a contrastive state/action model with a compatible Choice/Noul/Score interface. This repository does not call either provider today. Jev requires hosted access; the CLM reference server currently calls for Linux and an NVIDIA GPU. A future provider adapter can return a typed value and model/version/provenance metadata, which the host must validate against this plan before using as advisory data.

Real-world adaptive input needs a separate, explicit observation boundary. A future `Observation<T>` should include value, source, collection time, schema revision, and source digest; an agent should see that provenance alongside the data. A future decision record should include the model and provider revision, declared question, typed output, uncertainty, and independent outcome checks. The current `json` input type can carry such records, but the compiler does not yet validate their provenance or ingest streams. CLM's state/action scores may help inspect *which candidate action the model preferred*; neither this DSL nor a typed score reveals a generative model's internal neurons or proves a causal explanation of its behavior. That question needs separate instrumentation and controlled experiments.
