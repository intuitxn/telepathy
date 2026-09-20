# Cross-harness batch maximum findings

The first-item shortcut failed on [1,2]: observed 1, expected 2. Switching to the checked chunked maximum kernel returned 2; another flat input [9,1,12,0] returned 12. This failure was deliberately replayed from a known counterexample, not discovered autonomously.

For related batch reductions, every value must contribute. The core proves chunk composition: maximum of the maxima of chunks equals the maximum of their flattened values. Identity for an empty chunk is zero over natural numbers. Do not assume the first element represents its batch. Preserve input data. These findings support reasoning; the downstream implementation still needs independent tests.
