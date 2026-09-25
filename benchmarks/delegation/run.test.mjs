import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { recommendWidth, capacityCap } from '../../runtime/dsh/delegation-governor.mjs';
import { runFamily } from './run.mjs';

const h = letter => letter.repeat(64);
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const capacity = { eligible_independent: 8, funded_grants: 8, provider_slots: 8,
  workspace_slots: 8, worker_rate: 1, verifier_rate: 4, integration_rate: 4,
  horizon_units: 1, verifier_backlog: 0, integration_backlog: 0,
  unknown_verdicts: 0 };

function episode(index, gains = [10, 20, 30]) {
  const taskSet = h('a'), evaluator = h('b'), budget = 48;
  return { id: `pair-${index}`, task_set_sha256: taskSet,
    evaluator_sha256: evaluator, budget_units: budget,
    receipts: [1, 2, 4].map((width, position) => ({
      width, verdict_source: 'independent', verdict_receipt_sha256: sha({ index, width }),
      task_set_sha256: taskSet, evaluator_sha256: evaluator, budget_units: budget,
      verified_gain: gains[position], unsupported_claims: 0, regressions: 0,
      unsettled_verdicts: 0,
      worker_compute: 20, verifier_compute: 10, integration_compute: 5,
      coordination_compute: width - 1,
    })) };
}

test('fixed-oracle paired families select two only when independently verified yield improves', () => {
  const diverse = runFamily('complementary');
  assert.equal(diverse.decision.width, 2);
  assert.ok(diverse.decision.comparisons[0].candidate_gain_per_compute >
    diverse.decision.comparisons[0].incumbent_gain_per_compute);
  assert.equal(diverse.decision.comparisons[1].supported, false);
  assert.equal(diverse.decision.comparisons[1].unsupported_candidate, 8);
  assert.ok(diverse.traces.every(row => row.width_runs.every(run => run.total_compute <= 48)));
  const narrow = runFamily('serial-favor');
  assert.equal(narrow.decision.width, 1);
  assert.ok(narrow.decision.comparisons[0].candidate_gain_per_compute <
    narrow.decision.comparisons[0].incumbent_gain_per_compute);
});

test('verified gain cannot override a present verifier bottleneck', () => {
  assert.equal(runFamily('complementary', { verifier_backlog: 3 }).decision.width, 1);
  assert.equal(runFamily('complementary', { verifier_backlog: 4 }).decision.width, 0);
  assert.equal(runFamily('complementary', { unknown_verdicts: 1 }).decision.width, 0);
  assert.equal(capacityCap({ ...capacity, eligible_independent: 0 }), 0);
  assert.equal(recommendWidth({ capacity: { ...capacity, funded_grants: 0 },
    episodes: [] }).width, 0);
});

test('zero observed completions permit one funded pilot and never widen', () => {
  const cold = { ...capacity, worker_rate: 0, verifier_rate: 0,
    integration_rate: 0 };
  assert.equal(capacityCap(cold), 1);
  assert.equal(recommendWidth({ capacity: cold, episodes: [] }).width, 1);
  assert.equal(capacityCap({ ...cold, verifier_backlog: 1 }), 0);
  assert.equal(capacityCap({ ...cold, unknown_verdicts: 1 }), 0);
  assert.equal(capacityCap({ ...cold, provider_slots: 0 }), 0);
  const slowVerifier = { ...capacity, worker_rate: 2,
    verifier_rate: 1, integration_rate: 1 };
  assert.equal(capacityCap(slowVerifier), 1);
  assert.equal(capacityCap({ ...slowVerifier, verifier_backlog: 1 }), 0);
});

test('stepwise escalation may reach four on consistent paired gains', () => {
  const episodes = [0, 1, 2, 3].map(index => episode(index));
  assert.equal(recommendWidth({ capacity, episodes }).width, 4);
  assert.equal(recommendWidth({ capacity: { ...capacity, provider_slots: 2 }, episodes }).width, 2);
  assert.equal(recommendWidth({ capacity, episodes: episodes.slice(0, 3) }).width, 1);
});

test('a bad pair or more unsupported claims blocks escalation despite a better average', () => {
  const episodes = [0, 1, 2, 3].map(index => episode(index));
  episodes[0].receipts[1].verified_gain = 5;
  assert.equal(recommendWidth({ capacity, episodes }).width, 1);
  episodes[0].receipts[1].verified_gain = 20;
  episodes[0].receipts[1].unsupported_claims = 1;
  assert.equal(recommendWidth({ capacity, episodes }).width, 1);
});

test('pairing and independent verdict provenance are mandatory', () => {
  const episodes = [0, 1, 2, 3].map(index => episode(index));
  episodes[0].receipts[1].verdict_source = 'model_self_score';
  assert.throws(() => recommendWidth({ capacity, episodes }), /independent verifier/);
  episodes[0].receipts[1].verdict_source = 'independent';
  episodes[0].receipts[1].evaluator_sha256 = h('d');
  assert.throws(() => recommendWidth({ capacity, episodes }), /different task set, evaluator or budget/);
  episodes[0].receipts[1].evaluator_sha256 = h('b');
  episodes[0].receipts[1].worker_compute = 48;
  assert.throws(() => recommendWidth({ capacity, episodes }), /within the frozen paired budget/);
  episodes[0].receipts[1].worker_compute = 20;
  episodes[0].receipts[1].unsettled_verdicts = 1;
  assert.throws(() => recommendWidth({ capacity, episodes }), /unsettled verdict/);
  episodes[0].receipts[1].unsettled_verdicts = 0;
  episodes[0].receipts[1].verdict_receipt_sha256 = episodes[0].receipts[0].verdict_receipt_sha256;
  assert.throws(() => recommendWidth({ capacity, episodes }), /cannot be reused/);
});
