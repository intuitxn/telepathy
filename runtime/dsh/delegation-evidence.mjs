// Host-only adapter for measured delegation width. The model and task planner
// never supply paired scores, compute charges, capacity, or plan independence.
// A frozen task policy pins the immutable trial manifest before the task opens.
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SHA = /^[a-f0-9]{64}$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;
const WIDTHS = [1, 2, 4];
const MAX_FILE_BYTES = 256 * 1024;
const fail = message => { throw new Error(`delegation evidence: ${message}`); };
const digest = (value, label) => {
  if (typeof value !== 'string' || !SHA.test(value)) fail(`${label} must be SHA-256`);
  return value;
};
const integer = (value, min, max, label) => {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    fail(`${label} must be an integer in ${min}..${max}`);
  return value;
};
function object(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).some(key => !fields.includes(key))) fail(`${label} is invalid`);
  return value;
}
function fields(value, names, label) {
  object(value, names, label);
  if (Object.keys(value).length !== names.length ||
      names.some(name => !Object.hasOwn(value, name))) fail(`${label} has missing fields`);
  return value;
}
function boundedId(value, label) {
  if (typeof value !== 'string' || !ID.test(value)) fail(`${label} is invalid`);
  return value;
}
function canonical(value) {
  const seen = new Set();
  function walk(item, depth) {
    if (depth > 24) fail('archive JSON is too deep');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (Array.isArray(item)) {
      if (seen.has(item)) fail('archive JSON has a cycle');
      seen.add(item);
      const result = item.map(child => walk(child, depth + 1));
      seen.delete(item);
      return result;
    }
    object(item, Object.keys(item ?? {}), 'archive JSON');
    if (seen.has(item)) fail('archive JSON has a cycle');
    seen.add(item);
    const result = {};
    for (const key of Object.keys(item).sort()) result[key] = walk(item[key], depth + 1);
    seen.delete(item);
    return result;
  }
  return JSON.stringify(walk(value, 0));
}
const sha = value => createHash('sha256').update(value).digest('hex');
const within = (root, target) => target === root || target.startsWith(`${root}${path.sep}`);

async function privateDirectory(location, unsafeTest) {
  if (typeof location !== 'string' || !path.isAbsolute(location) ||
      path.normalize(location) !== location) fail('archive root must be a normalized absolute path');
  const actual = await fs.realpath(location);
  if (actual !== location) fail('archive root must have no symlinked parent');
  if (!unsafeTest) {
    const forbidden = await Promise.all([process.cwd(), os.tmpdir(), '/tmp', '/var/tmp']
      .map(root => fs.realpath(root).catch(() => path.resolve(root))));
    if (forbidden.some(root => within(root, actual)))
      fail('production archive must be outside workspaces and temporary roots');
  }
  const stat = await fs.lstat(actual);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() ||
      (stat.mode & 0o077) !== 0) fail('archive root must be private and host-owned');
  for (const name of ['trials', 'verdicts', 'compute']) {
    const sub = await fs.lstat(path.join(actual, name));
    if (!sub.isDirectory() || sub.isSymbolicLink() || sub.uid !== process.getuid() ||
        (sub.mode & 0o077) !== 0) fail(`${name} archive must be private and host-owned`);
  }
  return actual;
}

async function readArchived(root, subdir, expected) {
  digest(expected, 'archived receipt digest');
  const file = path.join(root, subdir, `${expected}.json`);
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 ||
      stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0 ||
      stat.size > MAX_FILE_BYTES) fail(`${subdir} receipt is not a private regular file`);
  const bytes = await fs.readFile(file);
  if (bytes.length > MAX_FILE_BYTES || sha(bytes) !== expected)
    fail(`${subdir} receipt differs from pinned digest`);
  let value;
  try { value = JSON.parse(bytes); }
  catch { fail(`${subdir} receipt is not JSON`); }
  if (canonical(value) !== bytes.toString('utf8').trimEnd())
    fail(`${subdir} receipt is not canonical JSON`);
  return value;
}

function checkedManifest(value, taskFamily, evaluator, caseSet, toolchain) {
  fields(value, ['schema', 'task_family_sha256', 'evaluator_sha256',
    'case_set_sha256', 'toolchain', 'budget_units', 'episodes'], 'trial manifest');
  if (value.schema !== 1 || value.task_family_sha256 !== taskFamily ||
      value.evaluator_sha256 !== evaluator ||
      value.case_set_sha256 !== caseSet || value.toolchain !== toolchain)
    fail('manifest differs from frozen task family, evaluator, case set, or toolchain');
  digest(value.task_family_sha256, 'task family');
  integer(value.budget_units, 1, 1e9, 'paired budget');
  if (!Array.isArray(value.episodes) || value.episodes.length > 128)
    fail('manifest needs at most 128 paired episodes');
  const ids = new Set(), taskSets = new Set();
  let widthSignature = null;
  for (const episode of value.episodes) {
    fields(episode, ['id', 'task_set_sha256', 'receipts'], 'paired episode');
    boundedId(episode.id, 'paired episode id');
    digest(episode.task_set_sha256, 'episode task set');
    if (ids.has(episode.id) || taskSets.has(episode.task_set_sha256))
      fail('paired episodes must have distinct ids and task sets');
    ids.add(episode.id); taskSets.add(episode.task_set_sha256);
    if (!Array.isArray(episode.receipts) || episode.receipts.length < 2 ||
        episode.receipts.length > WIDTHS.length) fail('episode needs matched width receipts');
    const widths = new Set();
    for (const ref of episode.receipts) {
      fields(ref, ['width', 'verdict_sha256', 'compute_sha256',
        'source_settlement_event'], 'trial receipt reference');
      if (!WIDTHS.includes(ref.width) || widths.has(ref.width)) fail('trial width is invalid or repeated');
      widths.add(ref.width);
      digest(ref.verdict_sha256, 'verdict reference');
      digest(ref.compute_sha256, 'compute reference');
      digest(ref.source_settlement_event, 'source settlement reference');
    }
    if (!widths.has(1) || !widths.has(2) || (widths.has(4) && !widths.has(2)))
      fail('paired widths must begin at one and two');
    const signature = [...widths].sort().join(',');
    if (widthSignature !== null && signature !== widthSignature)
      fail('every paired episode must trial the same widths');
    widthSignature = signature;
  }
  return value;
}

function sharedReceipt(value, expected, manifest, episode, width, label) {
  if (value.schema !== 1 || value.source !== expected || value.trial_id !== episode.id ||
      value.width !== width || value.task_set_sha256 !== episode.task_set_sha256 ||
      value.evaluator_sha256 !== manifest.evaluator_sha256 ||
      value.case_set_sha256 !== manifest.case_set_sha256 ||
      value.budget_units !== manifest.budget_units)
    fail(`${label} differs from frozen paired trial`);
  digest(value.source_task_ref, `${label} source task`);
  if (Object.hasOwn(value, 'source_settlement_event'))
    digest(value.source_settlement_event, `${label} source settlement`);
}

async function checkedEpisode(root, manifest, episode, replaySource, confirmCompute,
  used, usedSources, usedMeterReceipts) {
  const receipts = [];
  for (const ref of episode.receipts) {
    for (const field of ['verdict_sha256', 'compute_sha256']) {
      if (used.has(ref[field])) fail('a trial receipt is reused');
      used.add(ref[field]);
    }
    const verdict = await readArchived(root, 'verdicts', ref.verdict_sha256);
    fields(verdict, ['schema', 'source', 'trial_id', 'width', 'task_set_sha256',
      'evaluator_sha256', 'case_set_sha256', 'budget_units', 'source_task_ref',
      'verified_gain', 'unsupported_claims',
      'regressions', 'unsettled_verdicts'], 'archived verdict');
    sharedReceipt(verdict, 'independent-verifier', manifest, episode, ref.width, 'verdict');
    if (usedSources.has(verdict.source_task_ref) ||
        usedSources.has(ref.source_settlement_event))
      fail('a source task or settlement is reused by another paired trial');
    usedSources.add(verdict.source_task_ref);
    usedSources.add(ref.source_settlement_event);
    for (const field of ['verified_gain', 'unsupported_claims', 'regressions'])
      integer(verdict[field], 0, 1e9, field);
    if (verdict.unsettled_verdicts !== 0) fail('trial has an unsettled verdict');
    const source = await replaySource(verdict.source_task_ref);
    if (source?.task_ref !== verdict.source_task_ref ||
        source.spec?.pinned_versions?.evaluator_sha256 !== manifest.evaluator_sha256 ||
        source.spec?.pinned_versions?.case_set_sha256 !== manifest.case_set_sha256 ||
        source.spec?.pinned_versions?.toolchain !== manifest.toolchain ||
        source.spec?.policy_version !==
          `delegation-trial:${episode.task_set_sha256}:${ref.width}:${manifest.budget_units}` ||
        !Array.isArray(source.events)) fail('trial source task is unavailable or has different pinned inputs');
    const settled = source.events.find(event => event.digest === ref.source_settlement_event);
    if (!settled || !['settled', 'result_settled'].includes(settled.type) ||
        settled.result?.status !== 'accepted' ||
        settled.result?.receipt_sha256 !== ref.verdict_sha256)
      fail('independent verdict is absent from the immutable settled task chain');
    const compute = await readArchived(root, 'compute', ref.compute_sha256);
    fields(compute, ['schema', 'source', 'trial_id', 'width', 'task_set_sha256',
      'evaluator_sha256', 'case_set_sha256', 'budget_units', 'source_task_ref',
      'source_settlement_event', 'worker_compute', 'verifier_compute',
      'integration_compute', 'coordination_compute', 'meter_receipt_sha256'],
    'archived compute');
    sharedReceipt(compute, 'host-meter', manifest, episode, ref.width, 'compute');
    if (compute.source_task_ref !== verdict.source_task_ref ||
        compute.source_settlement_event !== ref.source_settlement_event)
      fail('verdict and compute receipts name different source settlements');
    digest(compute.meter_receipt_sha256, 'underlying meter receipt');
    if (usedMeterReceipts.has(compute.meter_receipt_sha256))
      fail('a host meter receipt is reused');
    usedMeterReceipts.add(compute.meter_receipt_sha256);
    let spent = 0;
    for (const field of ['worker_compute', 'verifier_compute',
      'integration_compute', 'coordination_compute'])
      spent += integer(compute[field], 0, 1e9, field);
    if (!Number.isSafeInteger(spent) || spent < 1 || spent > manifest.budget_units)
      fail('measured total compute exceeds frozen paired budget');
    const confirmed = await confirmCompute({ ...compute, compute_receipt_sha256: ref.compute_sha256 });
    if (confirmed !== true) fail('host meter did not authenticate compute receipt');
    receipts.push({ width: ref.width, verdict_source: 'independent',
      verdict_receipt_sha256: ref.verdict_sha256,
      task_set_sha256: episode.task_set_sha256,
      evaluator_sha256: manifest.evaluator_sha256,
      budget_units: manifest.budget_units,
      verified_gain: verdict.verified_gain,
      unsupported_claims: verdict.unsupported_claims,
      regressions: verdict.regressions,
      unsettled_verdicts: 0,
      worker_compute: compute.worker_compute,
      verifier_compute: compute.verifier_compute,
      integration_compute: compute.integration_compute,
      coordination_compute: compute.coordination_compute });
  }
  return { id: episode.id, task_set_sha256: episode.task_set_sha256,
    evaluator_sha256: manifest.evaluator_sha256,
    budget_units: manifest.budget_units, receipts };
}

function measuredCapacity(raw, input, now, maximumAgeMs) {
  fields(raw, ['task_ref', 'causal_cut', 'observed_at_ms', 'window_ms',
    'worker_completed', 'verifier_completed', 'integration_completed',
    'provider_slots', 'workspace_slots', 'verifier_backlog',
    'integration_backlog', 'unknown_verdicts'], 'capacity observation');
  if (raw.task_ref !== input.task_ref || raw.causal_cut !== input.causal_cut)
    fail('capacity observation is for a different task or causal cut');
  const observed = integer(raw.observed_at_ms, 1, Number.MAX_SAFE_INTEGER, 'capacity observation time');
  if (observed > now || now - observed > maximumAgeMs)
    fail('capacity observation is stale or from the future');
  const window = integer(raw.window_ms, 1, 86_400_000, 'capacity window');
  const workers = integer(raw.worker_completed, 0, 1e9, 'measured worker completions');
  const verified = integer(raw.verifier_completed, 0, 1e9, 'measured verifier completions');
  const integrated = integer(raw.integration_completed, 0, 1e9, 'measured integration completions');
  const active = input.active_grants.length;
  const selected = input.eligible_plans.length;
  return { eligible_independent: active + selected,
    funded_grants: active + selected,
    provider_slots: integer(raw.provider_slots, 0, 64, 'provider slots'),
    workspace_slots: integer(raw.workspace_slots, 0, 64, 'workspace slots'),
    verifier_backlog: integer(raw.verifier_backlog, 0, 1e6, 'verifier backlog'),
    integration_backlog: integer(raw.integration_backlog, 0, 1e6, 'integration backlog'),
    unknown_verdicts: integer(raw.unknown_verdicts, 0, 1e6, 'unknown verdicts'),
    horizon_units: window / 3_600_000,
    worker_rate: workers / (window / 3_600_000),
    verifier_rate: verified / (window / 3_600_000),
    integration_rate: integrated / (window / 3_600_000) };
}

/**
 * The host freezes `policy_version = delegation:<manifestSha256>` before open.
 * `confirmCompute` must inspect its protected meter archive, not the receipt's
 * `source` string. `observeCapacity` must read live host-owned counters.
 * `independentPlans` must return a conflict-free subset of eligible plan refs.
 * No writer is exported: this adapter only reads the host's private archive.
 */
export function createArchivedDelegationEvidence(settings) {
  object(settings, ['archiveRoot', 'manifestSha256', 'taskFamilySha256',
    'controller', 'confirmCompute',
    'observeCapacity', 'independentPlans', 'allowUnsafeArchiveForTest',
    'maximumAgeMs', 'now', 'plannerGrantRef'], 'adapter settings');
  const manifestSha = digest(settings.manifestSha256, 'pinned manifest');
  const taskFamilySha = digest(settings.taskFamilySha256, 'pinned task family');
  const plannerGrantRef = settings.plannerGrantRef === undefined ? null :
    digest(settings.plannerGrantRef, 'planner grant ref');
  if (typeof settings.controller?.replay !== 'function' ||
      typeof settings.confirmCompute !== 'function' ||
      typeof settings.observeCapacity !== 'function' ||
      typeof settings.independentPlans !== 'function')
    fail('trusted replay, meter, capacity, and independence callbacks are required');
  if (settings.now !== undefined &&
      (settings.allowUnsafeArchiveForTest !== true || typeof settings.now !== 'function'))
    fail('injected clock is test-only');
  const maximumAgeMs = integer(settings.maximumAgeMs ?? 30_000,
    1, 300_000, 'maximum capacity age');
  const clock = settings.now ?? Date.now;
  return async input => {
    fields(input, ['task_ref', 'causal_cut', 'evaluator_sha256', 'case_set_sha256',
      'active_grants', 'eligible_plans', 'eligible_total', 'pending_evaluations',
      'remaining'], 'delegation request');
    digest(input.task_ref, 'task ref'); digest(input.causal_cut, 'causal cut');
    digest(input.evaluator_sha256, 'frozen evaluator');
    digest(input.case_set_sha256, 'frozen case set');
    if (!Array.isArray(input.active_grants) || !Array.isArray(input.eligible_plans) ||
        input.eligible_plans.length > 64 || !Array.isArray(input.pending_evaluations))
      fail('delegation request lists are invalid');
    integer(input.eligible_total, input.eligible_plans.length, 100_000, 'eligible total');
    fields(input.remaining, ['tasks', 'branches', 'tokens',
      'fuel', 'integrations', 'evaluations'], 'remaining grant');
    integer(input.remaining.branches, 0, 20_000, 'remaining branches');
    for (const key of ['tokens', 'fuel', 'integrations', 'evaluations'])
      integer(input.remaining[key], 0, 1e9, `remaining ${key}`);
    const current = await settings.controller.replay(input.task_ref);
    if (current?.task_ref !== input.task_ref || current.log_head !== input.causal_cut ||
        current.terminal ||
        current.spec?.policy_version !== `delegation:${manifestSha}` ||
        current.spec?.pinned_versions?.evaluator_sha256 !== input.evaluator_sha256 ||
        current.spec?.pinned_versions?.case_set_sha256 !== input.case_set_sha256)
      fail('task snapshot or frozen trial policy differs from request');
    if (!Array.isArray(current.grants) || !Array.isArray(current.plans) ||
        !Array.isArray(current.pending_evaluations) ||
        canonical(current.remaining) !== canonical(input.remaining) ||
        canonical(current.pending_evaluations) !== canonical(input.pending_evaluations))
      fail('delegation request differs from the replayed task state');
    const actualActive = current.grants.filter(row =>
      (row.status === 'active' || row.status === 'ready') &&
      row.ref !== plannerGrantRef);
    const byRef = new Map(current.plans.map(row => [row.ref, row]));
    const eligible = current.plans.filter(row => row.status === 'planned' &&
      row.depends_on.every(ref => byRef.get(ref)?.status === 'accepted'));
    if (canonical(actualActive) !== canonical(input.active_grants) ||
        canonical(eligible.slice(0, 64)) !== canonical(input.eligible_plans) ||
        eligible.length !== input.eligible_total)
      fail('delegation plans or active grants differ from the replayed task state');
    const checkedRoot = await privateDirectory(settings.archiveRoot,
      settings.allowUnsafeArchiveForTest === true);
    const manifest = checkedManifest(await readArchived(checkedRoot, 'trials', manifestSha),
      taskFamilySha, input.evaluator_sha256, input.case_set_sha256,
      current.spec.pinned_versions.toolchain);
    const used = new Set(), usedSources = new Set(),
      usedMeterReceipts = new Set(), sourceCache = new Map();
    const replaySource = async taskRef => {
      if (taskRef === input.task_ref) fail('a live task cannot be its own prior trial');
      if (!sourceCache.has(taskRef)) sourceCache.set(taskRef,
        await settings.controller.replay(taskRef));
      return sourceCache.get(taskRef);
    };
    const episodes = [];
    for (const episode of manifest.episodes)
      episodes.push(await checkedEpisode(checkedRoot, manifest, episode,
        replaySource, settings.confirmCompute, used, usedSources,
        usedMeterReceipts));
    const proposed = await settings.independentPlans({ task_ref: input.task_ref,
      causal_cut: input.causal_cut, active_grants: input.active_grants,
      eligible_plans: input.eligible_plans });
    if (!Array.isArray(proposed) || proposed.length > input.eligible_plans.length)
      fail('independence certificate must select visible eligible plans');
    const visible = new Set(input.eligible_plans.map(plan => plan.ref));
    const independent = new Set();
    const funded = [];
    const left = { ...input.remaining };
    const visiblePlans = new Map(input.eligible_plans.map(plan => [plan.ref, plan]));
    for (const ref of proposed) {
      digest(ref, 'independent plan ref');
      if (!visible.has(ref) || independent.has(ref))
        fail('independence certificate contains an ineligible or duplicate plan');
      independent.add(ref);
      const budget = fields(visiblePlans.get(ref).budget,
        ['tokens', 'fuel', 'children', 'integrations', 'evaluations'], 'eligible plan budget');
      for (const key of ['tokens', 'fuel', 'children', 'integrations', 'evaluations'])
        integer(budget[key], 0, 1e9, `eligible plan ${key}`);
      if (left.branches < 1 || ['tokens', 'fuel', 'integrations', 'evaluations']
        .some(key => budget[key] > left[key])) continue;
      left.branches--;
      for (const key of ['tokens', 'fuel', 'integrations', 'evaluations'])
        left[key] -= budget[key];
      funded.push(ref);
    }
    const raw = await settings.observeCapacity({ task_ref: input.task_ref,
      causal_cut: input.causal_cut });
    const capacity = measuredCapacity(raw, { ...input,
      eligible_plans: funded }, clock(), maximumAgeMs);
    capacity.unknown_verdicts = Math.max(capacity.unknown_verdicts,
      input.pending_evaluations.length);
    if ((await settings.controller.replay(input.task_ref))?.log_head !== input.causal_cut)
      fail('task advanced during delegation evidence selection');
    return { capacity, episodes, independent_plan_refs: funded };
  };
}
