import test from 'node:test';
import assert from 'node:assert/strict';
import { oracle, score, cases } from './workflow-transfer.mjs';
const reference = oracle.toString().replace('function oracle', 'function schedule');
test('frozen oracle and evaluator agree on all deterministic cases', () => {
  const result = score(reference, cases()); assert.equal(result.correct, 652);
});
test('evaluation detects missing descendant invalidation and input mutation', () => {
  const broken = reference.replace('if (affected.has(x.id))', 'if (x.id === e.id)');
  assert.ok(score(broken, cases()).correct < 652);
  const mutating = reference.replace('const records = [];', 'events.push({type:"ignored"}); const records = [];');
  assert.equal(score(mutating, cases()).correct, 0);
});
