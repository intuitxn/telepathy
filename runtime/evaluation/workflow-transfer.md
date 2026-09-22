# Dependency-worker learning pilot

This is one harder, project-shaped coding task: reduce work/claim/return/correct/
revoke events into deterministic worker state and ready work. The specification
requires transitive invalidation, worker exclusivity, permanent revocation,
missing/cyclic dependencies, immutable inputs, and exact ordering.

The protocol and external evaluator were frozen before either provider call:

- Protocol SHA-256: `9a0204406305bb6f6a1c59a66b7cf1c4993a0f1ae5885d0185784a3e097d9e1b`.
- Evaluator SHA-256: `cd40f70ebdd2c19cf0eb2d87e7ecb9f739122e78e47618bfad2387b5422e3c51`.
- 652 deterministic cases, including intermediate event prefixes, are saved in
  workflow-transfer-protocol.json.gz (losslessly compressed; hash above is of decompressed bytes). Agents received the full task specification,
  not the oracle or cases. The coordinator authored both specification and oracle.
- Each arm gets a fresh OpenCode session in a separate empty directory, using
  the same running loopback server's default model, a 120-second deadline,
  zero requested tools, no revisions, and an 1800-word output ceiling.
- The memory arm additionally receives the retained Lorenz README finding about
  transitive invalidation and explicit repair. Both arms receive identical task
  rules, including correction semantics. No task fact is exclusive to memory.

Raw session receipts, prompts and messages remain in private .local output.
Committed answers contain generated function code only, with Markdown wrappers
removed if present; no implementation repairs are allowed. The evaluator runs
code in fresh VM contexts with 200ms per-case deadlines and no injected filesystem
or process interface. Node VM is execution isolation for these reviewed synthetic
answers, not a security sandbox for arbitrary hostile programs.

Run `node runtime/evaluation/workflow-transfer.mjs` to re-score the follow-up answers; add `initial` to re-score the preserved initial answers. Run `node --test runtime/evaluation/workflow-transfer.test.mjs` for
oracle consistency and deliberately broken invalidation/mutation controls.

This controlled memory-in-prompt test is separate from the existing signed
cross-harness publication/retrieval demonstration. It does not claim autonomous
retrieval, statistical significance, neural training, or general improvement.
Two arms launched concurrently share server resources; time differences are
observations, not a causal memory-cost estimate.

## Initial observed result

| Arm | Passed | Elapsed | Tool calls | Budget compliant |
| --- | ---: | ---: | ---: | --- |
| Without retained finding | 652/652 | 80.915 s | 0 | Yes |
| With retained finding | 652/652 | 85.183 s | 1 | No |

Both used `opencode/deepseek-v4-pro` and returned different correct code. The memory
arm invoked bash once to list its otherwise empty workspace despite the no-tools
instruction. It did not inspect test fixtures, but this is a real budget violation,
so the run is not a compliant controlled comparison. There is no observed accuracy
gain and no basis to claim learning benefit. Prompt-only tool limits were not
reliable enforcement: the adapter used for that initial pair enabled bash.
The adapter was then corrected to provide enforced `--tools none`; the follow-up below uses it.

The scorer/oracle/cases stayed unchanged. After the violation, report plumbing was
changed to retain `budget_compliant: false` rather than throw before saving the
results. The report records both the original frozen evaluator hash and the final
reporting script hash. Neither initial answer was repaired or replaced; the
follow-up used new sessions and is reported separately.

## Follow-up after enforcing the tool policy

This separate pair used fresh sessions, the same frozen specification, cases,
model and 120-second budget, with all discovered tools disabled through the
adapter. The initial violation and both initial answers remain preserved in
`workflow-transfer-initial-*`; this follow-up corrects experiment configuration
and does not replace or hide an unfavorable result.

| Arm | Passed | Elapsed | Tool calls | Budget compliant |
| --- | ---: | ---: | ---: | --- |
| Without retained finding | 652/652 | 60.711 s | 0 | Yes |
| With retained finding | 652/652 | 70.785 s | 0 | Yes |

Again both code artifacts passed every case, so there is **no measured accuracy
benefit**. The operational improvement was concrete: an observed tool-policy
violation led to an enforced adapter setting, tests, and a compliant follow-up.
It does not establish autonomous self-improvement or more capable model weights.

To limit evidence bloat, the original 1,418,362-byte frozen JSON is retained as a
gzip file; decompression reproduces the exact original protocol hash. The
evaluator records its original frozen hash and final reporting-script hash.
Raw provider receipts and session identifiers stay local and uncommitted.
