# Fresh task clone comparison seam

The trusted host runs an unchanged agent or harness revision and a proposed
descendant on the same held-out tasks. It gives each clone the same model,
toolchain, task set, evaluator generation, and **exact measured total compute**.
Model turns, tools, verification, branching, and coordination all consume that
total. The host archives each clone's prediction receipt before dispatch and
then its run receipt under a private content-addressed path. These directories
must be outside model-writable workspaces. A model output is an answer, never
a score or a compute meter.

The host-only module at runtime/dsh/fresh-clone-comparison.mjs loads the two
archived receipts by SHA-256, checks their bindings, and invokes the same
separately pinned evaluator on both. The evaluator sees the private task set
and each answer. Every task must have an evaluator outcome. The module
measures paired quality, Brier calibration, unsupported claims,
counterexamples, regressions, and the breakdown of the fixed compute total.
A descendant is supported only with strict aggregate quality gain, no paired
task regression, no candidate counterexample or unsupported claim, and no
worse calibration. Both arms must have usage parts summing to the same frozen
total.

The resulting immutable receipt is at
privateRoot/fresh-comparisons/COMPARISON_SHA.json. It records the per-task
evaluator outcomes and a verdict. A second immutable index at
privateRoot/fresh-comparisons/by-fresh/FRESH_SHA.json resolves the receipt
from the exact fresh block expected by algorithm-promotion.mjs: task set SHA,
baseline and candidate commits and run receipt SHAs, and compute budget SHA.
A host-pinned verifyFreshEvidence module can check that index, replay the
evaluator and meter, and require a supported verdict before accepting
promotion evidence. The promotion adapter separately binds the candidate to
the accepted jj head and exact gate receipt. This comparison module never
changes the active pointer.

This is a source-level seam. A production driver still has to create truly
isolated clones from exact revisions, withhold the oracle's answers, prove the
task set is fresh to both arms, archive predictions before dispatch, and meter
all compute from host observations. Its pinned verifier must check those facts
and the receipt before allowing promotion. The keyless test uses a fixed
synthetic oracle, including a branched variant that loses after overhead and
a counterexample; it is not evidence of live recursive improvement.
