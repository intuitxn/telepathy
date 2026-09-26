import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runExploration } from './run.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

test('fixed oracle exposes drift and a counterexample through actual Bend calls', () => {
  const report = runExploration();
  assert.equal(report.ok, true);
  assert.equal(report.source_sha256,
    sha(readFileSync(resolve(here, '../../runtime/core/telepathy.bend'))));
  assert.equal(report.fixture_sha256, sha(readFileSync(join(here, 'scenarios.json'))));
  assert.match(report.bend_version, /^bend /);
  assert.equal(report.scenarios.length, 2);

  const drift = report.scenarios.find(row => row.id === 'distractor-drift');
  assert.deepEqual(drift.budget, { rounds: 12, document_scan_per_round: 4,
    candidate_scan_per_round: 4, oracle_calls_per_round: 1 });
  const bounded = drift.results.find(row => row.strategy === 'bounded-evidence');
  const recent = drift.results.find(row => row.strategy === 'recency');
  assert.deepEqual(bounded.trace.filter(row => row.action !== null).map(row => row.action), [3, 4, 2, 1]);
  assert.equal(bounded.trace.length, 12);
  assert.equal(bounded.verified_gain, 17);
  assert.equal(bounded.duplicate_proposals, 0);
  assert.equal(bounded.unsupported_claims, 1);
  assert.equal(bounded.trace[0].predicted, 9);
  assert.equal(bounded.trace[0].observed, 0); // A verified estimate can be wrong.
  assert.equal(recent.trace.length, 12);
  assert.ok(recent.trace.every(row => row.action === 3));
  assert.equal(recent.verified_gain, 0);
  assert.equal(recent.duplicate_proposals, 11);
  assert.equal(recent.unsupported_claims, 12);
  assert.ok(bounded.verified_gain_per_compute > recent.verified_gain_per_compute);

  for (const scenario of report.scenarios) {
    for (const row of scenario.results) {
      assert.equal(row.trace.reduce((sum, turn) => sum + turn.gain, 0), row.verified_gain);
      assert.equal(row.trace.filter(turn => turn.duplicate).length, row.duplicate_proposals);
      assert.equal(row.usage.document_scans,
        scenario.budget.rounds * scenario.budget.document_scan_per_round);
      assert.equal(row.usage.candidate_scans,
        scenario.budget.rounds * scenario.budget.candidate_scan_per_round);
      assert.equal(row.usage.native_calls, 2 * scenario.budget.rounds + 1);
      assert.equal(row.kernel_quality.success + row.kernel_quality.failure, row.usage.oracle_calls);
      assert.equal(row.kernel_quality.unknown, 0);
      assert.equal(row.simulated_compute_units,
        row.usage.host_items_considered + row.usage.document_scans +
        row.usage.candidate_scans + row.usage.event_scans + row.usage.oracle_calls);
    }
  }

  const counterexample = report.scenarios.find(row => row.id === 'stale-verified-counterexample');
  const stale = counterexample.results.find(row => row.strategy === 'bounded-evidence');
  const fresh = counterexample.results.find(row => row.strategy === 'recency');
  assert.equal(stale.trace[0].action, 1);
  assert.equal(stale.verified_gain, 0);
  assert.equal(fresh.trace[0].action, 2);
  assert.equal(fresh.verified_gain, 5);
  assert.ok(fresh.verified_gain_per_compute > stale.verified_gain_per_compute);
});
