import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDiscovery } from './run.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const seedHex = '0123456789abcdef'.repeat(4);
const seed = Buffer.from(seedHex, 'hex');
const sha = value => createHash('sha256').update(value).digest('hex');
const anomalyBytes = createHmac('sha256', seed).update('out-of-bank-cases').digest();
const anomalyIndices = [2 * (anomalyBytes[0] % 4), 2 * (anomalyBytes[1] % 4) + 1];
const heldout = Array.from({ length: 25 }, (_, id) => ({ id, x: Math.floor(id / 5), z: id % 5 }))
  .filter(point => point.x === 4 || point.z === 4);
const lawFromId = id => ({ id, a: Math.floor(id / 25), b: Math.floor(id / 5) % 5, c: id % 5 });

function independentTruth(index, point) {
  const bytes = createHmac('sha256', seed).update(`case:${index}`).digest();
  const law = { a: bytes[0] % 5, b: bytes[1] % 5, c: bytes[2] % 5 };
  const additive = index % 2 === 0;
  const base = additive ? law.a * point.x + law.b * point.z + law.c
    : law.a * point.x * point.z + law.b * point.x + law.c;
  const extra = anomalyIndices.includes(index) ? (additive ? point.x * point.z : point.z) : 0;
  return (base + extra) % 5;
}
function candidateResponse(family, model, point) {
  return (family === 'additive' ? model.a * point.x + model.b * point.z + model.c
    : model.a * point.x * point.z + model.b * point.x + model.c) % 5;
}

test('Bend-driven experiment loop commits before observation and independently scores held-out laws', () => {
  const report = runDiscovery({ seedHex });
  assert.equal(report.ok, true);
  assert.equal(report.seed_reveal, seedHex);
  assert.equal(report.source_sha256, sha(readFileSync(join(here, 'run.mjs'))));
  assert.equal(report.kernel_sha256, sha(readFileSync(resolve(here, '../../runtime/core/telepathy.bend'))));
  assert.match(report.bend_version, /^bend 2\.0\.21/);
  assert.deepEqual(report.budget, { cases: 8, rounds_per_case: 6, probes_per_round: 1,
    candidate_scan_per_round: 16, heldout_per_case: 9, oracle_unit: 1000 });

  const caseDigests = [];
  for (const [index, item] of report.cases.entries()) {
    const bytes = createHmac('sha256', seed).update(`case:${index}`).digest();
    const law = lawFromId((bytes[0] % 5) * 25 + (bytes[1] % 5) * 5 + bytes[2] % 5);
    const censoredProbes = [0, [1, 2, 4, 5][bytes[3] % 4]];
    const expectedCase = createHmac('sha256', seed).update(JSON.stringify({
      id: item.id, family: item.family, law, out_of_bank: anomalyIndices.includes(index),
      censored_probes: censoredProbes, heldout,
    })).digest('hex');
    assert.equal(item.case_sha256, expectedCase);
    caseDigests.push(expectedCase);
    assert.deepEqual(item.results.map(row => row.strategy), ['evidence', 'recency', 'no-context']);
    for (const row of item.results) {
      let previous = sha(`genesis:${expectedCase}`);
      const tried = new Set();
      const prior = [];
      const bankIds = Array.from({ length: 125 }, (_, id) => id);
      const compatible = history => bankIds.filter(id => history.every(turn =>
        candidateResponse(item.family, lawFromId(id),
          { x: Math.floor(turn.point / 4), z: turn.point % 4 }) === turn.observed));
      const selectedHistory = history => row.strategy === 'evidence' ?
        history.filter(turn => turn.observed !== null) : row.strategy === 'recency' ?
        history.filter(turn => turn.observed !== null).slice(-1) : [];
      for (const trace of row.trace) {
        assert.equal(trace.previous, previous);
        assert.ok(!tried.has(trace.point));
        const frontier = compatible(selectedHistory(prior));
        assert.equal(trace.frontier_before, frontier.length);
        assert.equal(trace.frontier_sha256, sha(JSON.stringify(frontier)));
        const probeScores = Array.from({ length: 16 }, (_, id) => {
          if (tried.has(id)) return 0;
          const point = { x: Math.floor(id / 4), z: id % 4 };
          if (trace.falsification) return 1 + point.x * point.z + point.x + point.z;
          if (row.strategy === 'no-context') return 1;
          const counts = [0, 0, 0, 0, 0];
          for (const lawId of frontier) counts[candidateResponse(item.family, lawFromId(lawId), point)]++;
          return Math.max(1, frontier.length ** 2 - counts.reduce((sum, n) => sum + n * n, 0));
        });
        assert.equal(trace.point, probeScores.indexOf(Math.max(...probeScores)));
        assert.equal(trace.falsification, frontier.length === 1);
        tried.add(trace.point);
        const payload = { case_sha256: expectedCase, source_sha256: report.source_sha256,
          kernel_sha256: report.kernel_sha256, round: trace.round, point: trace.point,
          prediction: trace.predicted, frontier_sha256: trace.frontier_sha256, previous };
        assert.equal(trace.commitment_sha256, sha(JSON.stringify(payload)));
        const point = { x: Math.floor(trace.point / 4), z: trace.point % 4 };
        const expectedObservation = censoredProbes.includes(trace.point) ? null : independentTruth(index, point);
        assert.equal(trace.observed, expectedObservation);
        assert.equal(trace.classification, expectedObservation === null ? 'unknown'
          : expectedObservation === 0 ? 'negative' : 'positive');
        assert.equal(trace.receipt_sha256, sha(JSON.stringify({
          commitment_sha256: trace.commitment_sha256, observed: trace.observed,
          classification: trace.classification, previous,
        })));
        previous = trace.receipt_sha256;
        prior.push(trace);
      }
      const finalFrontier = compatible(selectedHistory(prior));
      assert.equal(row.final_frontier, finalFrontier.length);
      assert.equal(row.final_frontier_sha256, sha(JSON.stringify(finalFrontier)));
      assert.equal(row.usage.kernel_calls, row.trace.length);
      assert.equal(row.usage.kernel_scans, row.trace.length * 16);
      assert.equal(row.usage.experiment_calls, row.trace.length);
      assert.equal(row.usage.heldout_checks, 9);
      assert.equal(row.total_compute_units, row.usage.model_evaluations +
        row.usage.kernel_scans + 1000 * (row.usage.experiment_calls + row.usage.heldout_checks));
      assert.equal(row.negative, row.trace.filter(turn => turn.classification === 'negative').length);
      assert.equal(row.unknown, row.trace.filter(turn => turn.classification === 'unknown').length);
      const correct = row.chosen_law === null ? 0 : heldout.filter(point =>
        candidateResponse(item.family, lawFromId(row.chosen_law), point) ===
        independentTruth(index, point)).length;
      assert.equal(row.heldout_correct, correct);
      assert.equal(row.exact_law, row.chosen_law !== null && !anomalyIndices.includes(index) &&
        row.chosen_law === law.id);
      assert.equal(row.supported_abstention, row.chosen_law === null && anomalyIndices.includes(index));
      assert.equal(row.false_law_claim, row.chosen_law !== null && !row.exact_law);
    }
  }
  assert.equal(report.case_set_sha256,
    createHmac('sha256', seed).update(JSON.stringify(caseDigests)).digest('hex'));

  const [evidence, recency, noContext] = report.aggregate;
  assert.deepEqual([evidence.heldout_correct, recency.heldout_correct, noContext.heldout_correct], [54, 19, 12]);
  assert.deepEqual([evidence.exact_laws, evidence.supported_abstentions, evidence.false_law_claims], [6, 2, 0]);
  assert.equal(evidence.total_compute_units, 164544);
  assert.ok(evidence.correct_per_1000_compute > recency.correct_per_1000_compute);
  assert.ok(recency.correct_per_1000_compute > noContext.correct_per_1000_compute);
  assert.ok(report.cases.every(item => item.results[0].trace.length >= 5 && item.results[0].trace.length <= 6));
  assert.ok(new Set(report.cases.map(item => item.results[0].trace.map(turn => turn.point).join(','))).size > 2);
  assert.ok(report.cases.filter(item => item.truth_class_after_score === 'out-of-bank')
    .every(item => item.results[0].stop_reason === 'refuted'));
});

test('an agent-supplied score has no scoring authority or access to the hidden case', () => {
  let proposals = 0;
  const report = runDiscovery({ seedHex: '1'.repeat(64), proposalTransform(proposal, view) {
    proposals++;
    assert.deepEqual(Object.keys(view).sort(), ['family', 'id', 'receipts']);
    assert.ok(!Object.hasOwn(view, 'law') && !Object.hasOwn(view, 'heldout'));
    return { ...proposal, claimed_score: 1_000_000_000, claimed_exact_law: true };
  } });
  assert.ok(proposals > 0);
  assert.deepEqual(report.aggregate.map(row => [row.heldout_correct, row.exact_laws,
    row.supported_abstentions, row.false_law_claims]),
  [[54, 6, 2, 0], [12, 0, 0, 8], [12, 0, 0, 8]]);
  // Recency's extra model search spends compute without a gain on this seed.
  assert.ok(report.aggregate[1].correct_per_1000_compute < report.aggregate[2].correct_per_1000_compute);
  assert.ok(report.cases.some(item => item.results.some(row => row.false_law_claim)));
  assert.ok(report.cases.every(item => item.results.every(row => !Object.hasOwn(row, 'claimed_score'))));
});

test('the host rejects an unfunded probe before it can receive an observation', () => {
  assert.throws(() => runDiscovery({ seedHex, proposalTransform(proposal) {
    return { ...proposal, point: (proposal.point + 1) % 16 };
  } }), /agent changed the funded probe or frontier/);
});
