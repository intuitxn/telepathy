// A pure host policy. Call it only with independently settled, paired trial
// receipts; it never launches sessions or trusts a worker's self-assigned score.
const SHA = /^[a-f0-9]{64}$/;
const WIDTHS = [1, 2, 4];
const fail = message => { throw new Error(`delegation governor: ${message}`); };

function plain(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) fail(`${label} must be a plain object`);
}
function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    fail(`${label} must be an integer in ${min}..${max}`);
  return value;
}
function digest(value, label) {
  if (typeof value !== 'string' || !SHA.test(value)) fail(`${label} must be SHA-256`);
}
function finiteRate(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1e9)
    fail(`${label} must be a positive finite measured rate`);
  return value;
}
function nonnegativeRate(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e9)
    fail(`${label} must be a nonnegative finite measured rate`);
  return value;
}

// Rates are measured completions per the same unit of time, and backlog is
// due within the named horizon. The caller owns independence and slot facts.
export function capacityCap(input) {
  plain(input, 'capacity');
  const eligible = integer(input.eligible_independent, 0, 1e6, 'eligible independent tasks');
  const funded = integer(input.funded_grants, 0, 1e6, 'funded grants');
  const provider = integer(input.provider_slots, 0, 1e6, 'provider slots');
  const workspace = integer(input.workspace_slots, 0, 1e6, 'workspace slots');
  const verifierBacklog = integer(input.verifier_backlog, 0, 1e6, 'verifier backlog');
  const integrationBacklog = integer(input.integration_backlog, 0, 1e6, 'integration backlog');
  const unknown = integer(input.unknown_verdicts, 0, 1e6, 'unknown verdicts');
  const horizon = finiteRate(input.horizon_units, 'backlog horizon');
  const workerRate = nonnegativeRate(input.worker_rate, 'worker rate');
  const verifierRate = nonnegativeRate(input.verifier_rate, 'verifier rate');
  const integrationRate = nonnegativeRate(input.integration_rate, 'integration rate');
  if (unknown > 0) return 0; // audit the uncertain invocation before any new grant
  const physical = Math.min(eligible, funded, provider, workspace);
  if (physical === 0) return 0;
  // No completion in a fresh observation window is not a measured zero
  // throughput. Permit one funded pilot while queues are clear; paired evidence
  // is still required before width can grow. A backlog without an observed
  // service rate cannot safely receive more work.
  if (workerRate === 0 || verifierRate === 0 || integrationRate === 0)
    return verifierBacklog + integrationBacklog > 0 ? 0 : Math.min(physical, 1);
  const verifierSlots = Math.max(0, Math.floor((verifierRate - verifierBacklog / horizon) / workerRate));
  const integrationSlots = Math.max(0, Math.floor((integrationRate - integrationBacklog / horizon) / workerRate));
  const sustainable = Math.min(physical, verifierSlots, integrationSlots);
  // A measured rate ratio below one forbids parallel width, but it should not
  // deadlock the first serial job when both downstream queues are clear.
  return sustainable === 0 && verifierBacklog + integrationBacklog === 0
    ? Math.min(physical, 1) : sustainable;
}

function validateEpisodes(episodes) {
  if (!Array.isArray(episodes) || episodes.length > 128) fail('paired episodes must be an array of at most 128');
  const ids = new Set();
  const receiptDigests = new Set();
  let widths = null;
  for (const episode of episodes) {
    plain(episode, 'episode');
    if (typeof episode.id !== 'string' || !/^[a-zA-Z0-9_.:-]{1,128}$/.test(episode.id) || ids.has(episode.id))
      fail('episode id is invalid or repeated');
    ids.add(episode.id);
    digest(episode.task_set_sha256, 'task set digest');
    digest(episode.evaluator_sha256, 'evaluator digest');
    const budget = integer(episode.budget_units, 1, 1e9, 'frozen budget');
    if (!Array.isArray(episode.receipts) || episode.receipts.length < 1 || episode.receipts.length > 3)
      fail('episode needs 1..3 width receipts');
    const seen = new Set();
    for (const receipt of episode.receipts) {
      plain(receipt, 'receipt');
      const width = integer(receipt.width, 1, 4, 'width');
      if (!WIDTHS.includes(width) || seen.has(width)) fail('receipt width is invalid or repeated');
      seen.add(width);
      if (receipt.verdict_source !== 'independent') fail('receipt must come from an independent verifier');
      digest(receipt.verdict_receipt_sha256, 'verdict receipt digest');
      if (receiptDigests.has(receipt.verdict_receipt_sha256))
        fail('a verdict receipt cannot be reused by another paired trial');
      receiptDigests.add(receipt.verdict_receipt_sha256);
      if (receipt.task_set_sha256 !== episode.task_set_sha256 ||
          receipt.evaluator_sha256 !== episode.evaluator_sha256 ||
          receipt.budget_units !== budget)
        fail('paired receipt has a different task set, evaluator or budget');
      integer(receipt.verified_gain, 0, 1e9, 'verified gain');
      integer(receipt.unsupported_claims, 0, 1e9, 'unsupported claims');
      integer(receipt.regressions, 0, 1e9, 'regressions');
      if (integer(receipt.unsettled_verdicts, 0, 1e9, 'unsettled verdicts') > 0)
        fail('paired trial contains an unsettled verdict');
      let spent = 0;
      for (const field of ['worker_compute', 'verifier_compute', 'integration_compute', 'coordination_compute'])
        spent += integer(receipt[field], 0, 1e9, field);
      if (!Number.isSafeInteger(spent) || spent < 1 || spent > budget)
        fail('total compute must be positive and within the frozen paired budget');
    }
    if (!seen.has(1) || (seen.has(4) && !seen.has(2))) fail('widths must start at 1 and grow through 2');
    const signature = [...seen].sort().join(',');
    if (widths !== null && signature !== widths) fail('every episode must trial the same widths');
    widths = signature;
  }
  return widths;
}

function totalCompute(receipt) {
  return receipt.worker_compute + receipt.verifier_compute +
    receipt.integration_compute + receipt.coordination_compute;
}

function comparison(episodes, from, to) {
  const deltas = [];
  let incumbentGain = 0, candidateGain = 0, incumbentCompute = 0, candidateCompute = 0;
  let unsupportedIncumbent = 0, unsupportedCandidate = 0, regressionsCandidate = 0;
  for (const episode of episodes) {
    const left = episode.receipts.find(receipt => receipt.width === from);
    const right = episode.receipts.find(receipt => receipt.width === to);
    const lc = totalCompute(left), rc = totalCompute(right);
    deltas.push(right.verified_gain / rc - left.verified_gain / lc);
    incumbentGain += left.verified_gain;
    candidateGain += right.verified_gain;
    incumbentCompute += lc;
    candidateCompute += rc;
    unsupportedIncumbent += left.unsupported_claims;
    unsupportedCandidate += right.unsupported_claims;
    regressionsCandidate += right.regressions;
  }
  return {
    from, to, pairs: episodes.length,
    incumbent_gain: incumbentGain, candidate_gain: candidateGain,
    incumbent_compute: incumbentCompute, candidate_compute: candidateCompute,
    incumbent_gain_per_compute: incumbentGain / incumbentCompute,
    candidate_gain_per_compute: candidateGain / candidateCompute,
    paired_deltas: deltas,
    unsupported_incumbent: unsupportedIncumbent,
    unsupported_candidate: unsupportedCandidate,
    regressions_candidate: regressionsCandidate,
    // This is an observed worst-pair guard, not a statistical confidence bound.
    supported: deltas.every(delta => delta > 0) &&
      candidateGain / candidateCompute > incumbentGain / incumbentCompute &&
      unsupportedCandidate <= unsupportedIncumbent && regressionsCandidate === 0,
  };
}

export function recommendWidth({ capacity, episodes, minimum_pairs = 4 }) {
  const cap = capacityCap(capacity);
  const trialWidths = validateEpisodes(episodes);
  integer(minimum_pairs, 1, 128, 'minimum pairs');
  if (cap === 0) return { width: 0, cap,
    reason: capacity.unknown_verdicts > 0 ? 'unknown verdict requires audit' :
      'no funded independent capacity', comparisons: [] };
  if (episodes.length < minimum_pairs) return { width: 1, cap,
    reason: 'insufficient paired independent verdicts', comparisons: [] };
  const comparisons = [];
  let width = 1;
  for (const next of [2, 4]) {
    if (next > cap || !trialWidths?.split(',').includes(String(next))) break;
    const result = comparison(episodes, width, next);
    comparisons.push(result);
    if (!result.supported) break;
    width = next;
  }
  return { width, cap, reason: cap < 2 ? 'current verifier or resource capacity holds width at one' :
    width === 1 ? 'larger width lacks measured support' :
      'paired verified gain per total compute supports this width', comparisons };
}
