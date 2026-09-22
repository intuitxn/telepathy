# Shared task lifecycle and OpenCode delegation

Any harness with a process tool can call these Node standard-library adapters.
They reuse the existing registry and signed Git transport; there is no second
memory database. The installed Bend skill describes the same protocol.

## Before and after work

```sh
REGISTRY="$HOME/.local/share/intuitxn/learning-registry"
node runtime/adaptive/lifecycle.mjs before "$REGISTRY" --core adaptive-max --query 'chunk composition maximum' --sync
```

Retain the returned run UUID and bounded retrieved bundle IDs. `--sync` is
optional and requires configured publisher trust. It stages remote data but
does not execute it. Only previously admitted local entries are retrieved;
reviewed remote cores need registry import with `--execute` first.

After independent task evaluation, save a selected outcome JSON:

```json
{
  "task": "What was attempted",
  "approach": "What actually ran",
  "prediction": "What was expected",
  "result": {"status": "success", "observation": "What happened"},
  "tests": [{"name": "independent check", "passed": true, "evidence": "result and source reference"}],
  "counterexamples": []
}
```

Use `failure` or `partial` when applicable. Optional `costs` and `provenance`
fields retain resource observations and harness attribution. Raw transcripts
are not part of this schema. Record the outcome without promoting code:

```sh
node runtime/adaptive/lifecycle.mjs after "$REGISTRY" RUN_ID --outcome outcome.json
```

For an authorized core change with selected shareable findings:

```sh
node runtime/adaptive/lifecycle.mjs after "$REGISTRY" RUN_ID --outcome outcome.json --source runtime/adaptive/system.bend --findings findings.md --publish
```

Promotion requires reported success and at least one reported test, all passing,
then actual independent registry verification. Reported task results alone do
not prove code correctness. Failed/partial outcomes or failing/missing tests
are retained with `not-promoted`; they cannot admit or publish a candidate.
Counterexamples from earlier attempts can remain alongside successful correction
tests. No source argument means no verified-code claim. Publication additionally
requires explicit `--publish` and a configured authorized destination.

Run files live privately under `REGISTRY/runs/UUID`. Separate runs isolate writers;
closeout locks each run and rejects repeated attempts. Crashed locks need operator
inspection. Snapshots and receipts are retained, not silently retried after
possible external effects. A coordinator may record closeout after scoring a
worker, but must retain that attribution rather than claiming the worker did it.

## Real OpenCode worker

With the existing local server running:

```sh
node runtime/adaptive/delegate-opencode.mjs --server http://127.0.0.1:4096 --directory "$PWD" --prompt task.txt --output .local/new-delegation
```

The output directory must be new, and its parent must exist. Each call creates
a fresh server session using the server's configured default agent/model. Only
the bash tool is enabled; the prompt must bound its purpose. The adapter records
actual model/provider, time, tokens, cost, and tool calls. Its maximum task
deadline is 120 seconds, after which it requests abort. It does not guarantee
that a remote provider immediately stops billing after an abort request.
Tool-count/output-word limits in experiment prompts are audited afterward, not
enforced as model token caps by this adapter.

Raw messages, prompt, answer, session ID, and metrics stay in private output
files with restricted permissions. Do not commit that directory or publish
those raw session artifacts. The adapter accepts only IP-literal loopback
server URLs and does not read or change provider credentials or configuration.

## Integration with /meta agents

The `/meta` owner should call `before` before assigning relevant work, pass the
returned selected findings and run reference to the worker, evaluate its actual
result, and call `after` with selected observations. An OpenCode worker can call
`before` itself, as the demonstrated memory arm did. Exactly one coordinator
owns closeout, preventing duplicate promotion.

At the integration test, the live server did not expose `/meta`; it did expose
ordinary agent delegation. No replacement `/meta` command or server restart was
performed. These hooks are the integration seam for that separately managed
entry point. Merely installing a slash command does not enforce this lifecycle.

## Verification

```sh
node --test runtime/adaptive/lifecycle.test.mjs runtime/adaptive/test-delegate-opencode.mjs
node runtime/evaluation/cross-harness.mjs
```

The [real cross-harness trial](../evaluation/cross-harness.md) includes an actual
Codex-produced failure/correction record, publication, independent import, fresh
OpenCode retrieval, frozen-case scoring, and recorded closeout. It demonstrates
the connection while reporting no correctness gain in that task.
