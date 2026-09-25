import { createHash } from 'node:crypto';

const SHA = /^[a-f0-9]{64}$/;
const TYPES = new Set(['hypothesis', 'source_assertion', 'simulated_prediction',
  'direct_measurement', 'reproducible_computation', 'attempted_refutation']);
const FIELDS = ['schema', 'claim_type', 'proposition', 'domain', 'method', 'assumptions',
  'source_refs', 'input_refs', 'predicted_observation', 'observed_refs',
  'counterexample_refs', 'uncertainty', 'causal_parent'];
const CLAIM_FIELDS = FIELDS.filter(field => field !== 'causal_parent');

function fail(message) { throw new Error(`research claim: ${message}`); }
function sentence(value, name, max = 4096) {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > max)
    fail(`${name} must be nonempty and at most ${max} UTF-8 bytes`);
  return value;
}
function refs(value, name) {
  if (!Array.isArray(value) || value.length > 32 ||
      value.some(ref => typeof ref !== 'string' || !SHA.test(ref)) ||
      new Set(value).size !== value.length)
    fail(`${name} must contain at most 32 distinct SHA-256 references`);
  return value;
}

/**
 * Validate a worker's bounded proposal, not the truth of its references or
 * proposition. Only a host-pinned verifier may settle a result. The exact
 * worker bytes and causal parent remain in the dispatch archive; this digest
 * identifies the normalized claim content across different causal cuts.
 */
export function parseResearchClaim(raw, causalParent) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > 1024 * 1024)
    fail('artifact must be a JSON string of at most 1 MiB');
  if (typeof causalParent !== 'string' || !SHA.test(causalParent))
    fail('causal parent must be SHA-256');
  let value;
  try { value = JSON.parse(raw); }
  catch { fail('artifact must be JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join('\n') !== [...FIELDS].sort().join('\n'))
    fail('artifact fields differ from the research proposal schema');
  if (value.schema !== 'telepathy.research-proposal/v1' || !TYPES.has(value.claim_type))
    fail('schema or claim type is invalid');
  if (value.causal_parent !== causalParent)
    fail('proposal differs from the granted causal parent');
  for (const name of ['proposition', 'domain', 'method', 'uncertainty'])
    sentence(value[name], name);
  if (!Array.isArray(value.assumptions) || value.assumptions.length > 16)
    fail('assumptions must be a bounded array');
  value.assumptions.forEach((item, index) => sentence(item, `assumption ${index}`, 1024));
  for (const name of ['source_refs', 'input_refs', 'observed_refs', 'counterexample_refs'])
    refs(value[name], name);
  if (value.predicted_observation !== null)
    sentence(value.predicted_observation, 'predicted_observation');
  if (['hypothesis', 'simulated_prediction'].includes(value.claim_type) &&
      value.predicted_observation === null)
    fail('a hypothesis or simulation needs a discriminating prediction');
  if (value.claim_type === 'source_assertion' && value.source_refs.length === 0)
    fail('a source assertion needs a source reference');
  if (['direct_measurement', 'reproducible_computation'].includes(value.claim_type) &&
      value.observed_refs.length === 0)
    fail('a measurement or computation needs an observation reference');
  if (value.claim_type === 'attempted_refutation' &&
      value.counterexample_refs.length === 0)
    fail('an attempted refutation needs a counterexample reference');
  const normalized = Object.fromEntries(FIELDS.map(key => [key,
    Array.isArray(value[key]) ? Object.freeze([...value[key]]) : value[key]]));
  const claimContent = Object.fromEntries(CLAIM_FIELDS.map(key => [key, normalized[key]]));
  const claimSha256 = createHash('sha256').update(JSON.stringify(claimContent)).digest('hex');
  return Object.freeze({ proposal: Object.freeze(normalized), claim_sha256: claimSha256 });
}
