# Codex to OpenCode lifecycle trial

This run connected real harnesses through the shared registry, not two simulated
labels in one process. Codex coordinated the producer; two fresh OpenCode server
sessions used the existing `opencode/deepseek-v4-pro` configuration.

1. Codex deliberately replayed the known first-item failure: `[1,2]` produced 1,
   where the expected maximum was 2. The existing checked chunked kernel returned
   2 and also returned 12 for `[9,1,12,0]`. This was an experimental replay of a
   known failure, not spontaneous discovery or newly synthesized code.
2. Lifecycle closeout captured the observations, retained the counterexample,
   ran fresh core admission, and published selected findings to the signed remote.
3. A separate local registry downloaded the bundle and independently admitted it.
4. The OpenCode memory arm actually invoked `lifecycle before --sync` and retrieved
   the producer's exact bundle. The baseline received the same functional task
   specification without retrieval. Neither received held-out tests or feedback.
5. The coordinator scored both code answers, then recorded the memory arm's
   closeout. This downstream scratch JavaScript answer was not promoted as a
   verified Bend core.

The task was to implement `batchMaximum` over ragged batches without mutating
inputs. Seventy-four cases were frozen before collecting either answer.

| Arm | Correct | Mutations | Model time including tools | Tool calls |
| --- | ---: | ---: | ---: | ---: |
| No memory | 74/74 | 0 | 4.608 s | 0 |
| Retrieved findings | 74/74 | 0 | 13.773 s | 1 |

Normalized code was identical. Retrieval added 9.165 seconds in this single run
without an accuracy gain. This is positive integration evidence and a null
learning-efficacy result, not proof that retrieval generally helps or hurts.
Inputs, output code, sanitized provider metrics, and scoring results are saved
in `cross-harness-*`. Raw sessions, commands with machine paths, and run IDs stay
private. Reproduce scoring with `node runtime/evaluation/cross-harness.mjs`.

Both arms had the same instructed caps: two bash calls, 600 output words,
120 seconds, and no revisions after test feedback. The adapter enforces the
wall deadline; tool/word limits were audited. Total model tokens differed and
are reported, not claimed equal. It was one task with one session per arm,
sequential invocation, no random assignment, and a simple public task family.
Provider latency and cache effects prevent a general performance conclusion.
The JavaScript files are evaluation artifacts; maintained core logic stays in
the respective single Bend files.
