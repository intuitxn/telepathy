#!/usr/bin/env node
// Deterministic paired trial: the proposer sees a catalog and frozen grant;
// the payoff map stays inside the simulator's verifier closure.
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recommendWidth } from '../../runtime/dsh/delegation-governor.mjs';

const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const BUDGET = 48;
const PER_PROPOSAL = { worker_compute: 4, verifier_compute: 2, integration_compute: 1 };
const catalog = Object.freeze(['A', 'B', 'C', 'D'].flatMap(domain =>
  Array.from({ length: 8 }, (_, index) => `${domain}${index}`)));

function propose(width, ordinal) {
  // One worker specializes in A. Two workers alternate A and B; four split
  // among four distinct domains. The generator has no access to oracle gain.
  const domainIndex = ordinal % width;
  const localIndex = Math.floor(ordinal / width);
  return `${'ABCD'[domainIndex]}${localIndex}`;
}

function makeVerifier(family, episodeIndex) {
  const gains = new Map(catalog.map(id => {
    const domain = id[0];
    const base = family === 'complementary'
      ? { A: 2, B: 8, C: 0, D: 0 }[domain]
      : { A: 8, B: 1, C: 0, D: 0 }[domain];
    // Small task variation preserves paired identities without cloning an
    // identical numeric outcome four times.
    return [id, base ? base + ((episodeIndex + Number(id.slice(1))) % 2) : 0];
  }));
  const digest = sha([...gains]);
  const observed = new Set();
  return {
    digest,
    verify(id) {
      if (!gains.has(id)) throw new Error('candidate is outside frozen catalog');
      if (observed.has(id)) return { accepted_gain: 0, duplicate: true };
      observed.add(id);
      return { accepted_gain: gains.get(id), duplicate: false };
    },
  };
}

function runWidth(family, episodeIndex, width) {
  const verifier = makeVerifier(family, episodeIndex);
  const coordination = (width - 1) * 3;
  const proposalCost = Object.values(PER_PROPOSAL).reduce((sum, value) => sum + value, 0);
  const count = Math.floor((BUDGET - coordination) / proposalCost);
  let verifiedGain = 0, unsupported = 0, duplicates = 0;
  const chosen = [];
  const verdicts = [];
  for (let i = 0; i < count; i++) {
    const candidate = propose(width, i);
    chosen.push(candidate);
    const verdict = verifier.verify(candidate);
    verdicts.push({ candidate, ...verdict });
    verifiedGain += verdict.accepted_gain;
    if (verdict.accepted_gain === 0 && !verdict.duplicate) unsupported++;
    if (verdict.duplicate) duplicates++;
  }
  const receipt = {
    width, verdict_source: 'independent', verified_gain: verifiedGain,
    // An exact verdict receipt binds the trial identity as well as its
    // contents; equal outcomes on two episodes are still separate trials.
    verdict_receipt_sha256: sha({ family, episodeIndex, width, verdicts }),
    unsupported_claims: unsupported, regressions: 0,
    unsettled_verdicts: 0,
    worker_compute: count * PER_PROPOSAL.worker_compute,
    verifier_compute: count * PER_PROPOSAL.verifier_compute,
    integration_compute: count * PER_PROPOSAL.integration_compute,
    coordination_compute: coordination,
  };
  return { receipt, chosen, duplicates, oracle_sha256: verifier.digest };
}

export function runFamily(family, capacityOverrides = {}) {
  if (!['complementary', 'serial-favor'].includes(family)) throw new Error('unknown family');
  const episodes = [];
  const traces = [];
  for (let index = 0; index < 4; index++) {
    const runs = [1, 2, 4].map(width => runWidth(family, index, width));
    if (new Set(runs.map(run => run.oracle_sha256)).size !== 1)
      throw new Error('paired widths used different oracle versions');
    const taskSetSha = sha({ family, index, catalog });
    for (const run of runs) Object.assign(run.receipt, {
      task_set_sha256: taskSetSha,
      evaluator_sha256: runs[0].oracle_sha256,
      budget_units: BUDGET,
    });
    episodes.push({ id: `${family}-${index}`, budget_units: BUDGET,
      task_set_sha256: taskSetSha, evaluator_sha256: runs[0].oracle_sha256,
      receipts: runs.map(run => run.receipt) });
    traces.push({ id: `${family}-${index}`, width_runs: runs.map(run => ({
      width: run.receipt.width, chosen: run.chosen, verified_gain: run.receipt.verified_gain,
      total_compute: run.receipt.worker_compute + run.receipt.verifier_compute +
        run.receipt.integration_compute + run.receipt.coordination_compute,
      unsupported_claims: run.receipt.unsupported_claims, duplicates: run.duplicates,
    })) });
  }
  const capacity = {
    eligible_independent: 8, funded_grants: 8, provider_slots: 8, workspace_slots: 8,
    worker_rate: 1, verifier_rate: 4, integration_rate: 4, horizon_units: 1,
    verifier_backlog: 0, integration_backlog: 0, unknown_verdicts: 0,
    ...capacityOverrides,
  };
  return { family, budget_units_per_episode_and_width: BUDGET,
    paired_receipts_sha256: sha(episodes), capacity,
    decision: recommendWidth({ capacity, episodes }), traces };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.stdout.write(JSON.stringify({ schema: 'telepathy.delegation-benchmark/v1',
    complementary: runFamily('complementary'),
    serial_favor: runFamily('serial-favor'),
    backlog: runFamily('complementary', { verifier_backlog: 3 }) }, null, 2) + '\n');
}
