import assert from 'node:assert/strict';
import test from 'node:test';
import { parseResearchClaim } from './research-claim.mjs';

const parent = 'a'.repeat(64);
const source = 'b'.repeat(64);
const observed = 'c'.repeat(64);
const proposal = {
  schema: 'telepathy.research-proposal/v1', claim_type: 'hypothesis',
  proposition: 'Intervention A changes output B', domain: 'synthetic experiment',
  method: 'Compare A with a matched control under the pinned simulator.',
  assumptions: ['The simulator is deterministic.'], source_refs: [], input_refs: [],
  predicted_observation: 'B increases in the intervention arm.', observed_refs: [],
  counterexample_refs: [], uncertainty: 'The intervention has not been run.',
  causal_parent: parent,
};

test('proposal is bounded, causal, and cannot assert its own acceptance', () => {
  const parsed = parseResearchClaim(JSON.stringify(proposal), parent);
  assert.equal(parsed.proposal.claim_type, 'hypothesis');
  assert.equal(parsed.proposal.status, undefined);
  assert.match(parsed.claim_sha256, /^[a-f0-9]{64}$/);
  assert.equal(parseResearchClaim(JSON.stringify(Object.fromEntries(
    Object.entries(proposal).reverse())), parent).claim_sha256, parsed.claim_sha256);
  assert.throws(() => parseResearchClaim(JSON.stringify({ ...proposal, status: 'task_accepted' }), parent),
    /fields differ/);
  assert.throws(() => parseResearchClaim(JSON.stringify(proposal), source), /causal parent/);
});

test('claim identity is stable across causal cuts but changes with claim content', () => {
  const first = parseResearchClaim(JSON.stringify(proposal), parent);
  const later = parseResearchClaim(JSON.stringify({ ...proposal, causal_parent: source }), source);
  assert.equal(later.claim_sha256, first.claim_sha256);
  assert.equal(first.proposal.causal_parent, parent);
  assert.equal(later.proposal.causal_parent, source);
  const revised = parseResearchClaim(JSON.stringify({ ...proposal,
    predicted_observation: 'B decreases in the intervention arm.',
    causal_parent: source }), source);
  assert.notEqual(revised.claim_sha256, first.claim_sha256);
});

test('evidence requirements distinguish source, observation, and counterexample', () => {
  assert.throws(() => parseResearchClaim(JSON.stringify({ ...proposal,
    claim_type: 'source_assertion', predicted_observation: null }), parent), /source reference/);
  assert.throws(() => parseResearchClaim(JSON.stringify({ ...proposal,
    claim_type: 'direct_measurement', predicted_observation: null }), parent), /observation reference/);
  assert.throws(() => parseResearchClaim(JSON.stringify({ ...proposal,
    claim_type: 'attempted_refutation', predicted_observation: null }), parent), /counterexample reference/);
  const measured = parseResearchClaim(JSON.stringify({ ...proposal,
    claim_type: 'direct_measurement', source_refs: [source],
    predicted_observation: null, observed_refs: [observed] }), parent);
  assert.deepEqual(measured.proposal.source_refs, [source]);
  assert.throws(() => parseResearchClaim(JSON.stringify({ ...proposal,
    source_refs: [source, source] }), parent), /distinct SHA-256/);
});

test('malformed or oversized claims cannot pass the independent claim parser', () => {
  assert.throws(() => parseResearchClaim('not json', parent), /must be JSON/);
  assert.throws(() => parseResearchClaim(JSON.stringify({ ...proposal,
    predicted_observation: null }), parent), /discriminating prediction/);
  assert.throws(() => parseResearchClaim(' '.repeat(1024 * 1024 + 1), parent), /1 MiB/);
});
