# One writer per mutable unit

Give each independent worker its own jj workspace and disjoint file scope. One coordinator owns integration and each Bend snapshot lineage. jj history protects versions, but it does not enforce ownership, sandbox files, make Bend writes atomic, or give global claims across nodes.

Before editing, identify the task, base revision, workspace, owned paths, and checkable outcome. Inspect `jj status`; unknown changes belong to their owner until resolved. Preserve a candidate's exact commit and test evidence. After combining work, rerun checks on the integrated revision. Keep remote publication as a separate explicit bookmark and GitHub operation.
