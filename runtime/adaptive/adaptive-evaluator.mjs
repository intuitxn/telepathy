// Trusted fixed evaluator for adaptive-max-v1; public fixtures, not a hidden benchmark.
import { isDeepStrictEqual } from 'node:util';
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const cases = [];
function enumerate(prefix) {
  cases.push(prefix);
  if (prefix.length < 3) for (const value of [0, 1, 2]) enumerate([...prefix, value]);
}
enumerate([]);
cases.push([17, 4, 23, 23, 8], [1, 2], [2, 1], [23, 0], [0, 23], [7, 7, 7, 7], [5, 4, 3, 2, 1], [1, 2, 3, 4, 5], [0, 0, 0, 0], [23]);
const answers = cases.map(values => Math.max(0, ...values));
const probeEvidence = { scope: '50 public fixed examples; finite empirical checks, not a universal proof or hidden benchmark', cases, expected: answers, observed: answers };
const expected = {
  schema: 'intuitxn-adaptive-blocks/v1',
  adaptation: {
    experiment: 'fixed-fixture-bounded-policy-learning', forecast: { numerator: 5, denominator: 6 },
    surprise: true, no_shift_surprise: false, causal_confirmed: true,
    development: { baseline_correct: 4, exact_correct: 8, count: 8 },
    interventions: { paired_count: 4, reorder_shortcut_regressions: 4, sham_shortcut_regressions: 0, reorder_exact_regressions: 0 },
    final_admission: { adaptive: 1, disabled_learning: 0, no_surprise: 0 },
    adaptive: { policy: 1, heldout_correct: 8, heldout_count: 8, element_visits: 24, transfer_correct: 4, transfer_count: 4 },
    disabled_learning: { policy: 0, heldout_correct: 4, heldout_count: 8, element_visits: 8, transfer_correct: 3, transfer_count: 4 },
    no_surprise_control: { policy: 0, heldout_correct: 4, heldout_count: 8, element_visits: 8, transfer_correct: 3, transfer_count: 4 },
  },
  algebra: { original: 23, chunked: 23, transported: 23, empty_identity: 0, speedup_claimed: false },
  evidence: { ids_are_labels_not_hashes: true, history_size: 2, retained_failures: 1, counterexample_id: 12,
    counterexample_input: [1, 2], counterexample_observed: 1, counterexample_expected: 2,
    reused_source_id: 2, new_task_result: 23, changed_dependency_reuse: 0, algorithm_change_kind: 0, reformulation_kind: 1 },
  scope: 'finite authored kernels and fixtures; local reuse, no network synchronization or neural training',
};

function report(text) {
  assert(isDeepStrictEqual(JSON.parse(text), expected), 'fixed evaluator report mismatch');
}
function replayOutput(text) {
  const lines = text.trim().split('\n');
  assert(lines.length === 3 && lines[0] === 'evidence_reused: stored text matches current computed evidence', 'invalid replay output');
  assert(isDeepStrictEqual(JSON.parse(lines[1]), { restored_source_id: 2, restored_task_result: 23 }), 'replay dispatch mismatch');
  report(lines[2]);
}

export { cases, answers, probeEvidence, report, replayOutput };
