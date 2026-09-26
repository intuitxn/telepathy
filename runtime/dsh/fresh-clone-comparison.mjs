// Host-only evidence seam for an unchanged agent clone versus a proposed
// descendant. The caller must run and meter both clones, and archive each
// prediction before dispatch. This module independently replays the pinned
// evaluator; it never launches a model, changes a task set, or selects a variant.
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promises as fs, realpathSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SHA = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40,64}$/;
const ID = /^[a-zA-Z0-9_.:-]{1,128}$/;
const MAX_BYTES = 1024 * 1024;
const fail = message => { throw new Error('fresh clone comparison: ' + message); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function plain(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) fail(name + ' must be a plain object');
  return value;
}
function fields(value, keys, name) {
  plain(value, name);
  if (Object.keys(value).sort().join(',') !== [...keys].sort().join(','))
    fail(name + ' fields differ from schema');
}
function digest(value, name) {
  if (typeof value !== 'string' || !SHA.test(value)) fail(name + ' must be SHA-256');
  return value;
}
function commit(value, name) {
  if (typeof value !== 'string' || !COMMIT.test(value)) fail(name + ' must be an exact commit');
  return value;
}
function units(value, name, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum || value > 1e9)
    fail(name + ' must be bounded integer compute units');
  return value;
}
function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  plain(value, 'canonical value');
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}
function beneath(root, target) { return target === root || target.startsWith(root + path.sep); }
function hostPath(value, name, workspaceRoot, allowUnsafe) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.resolve(value) !== value)
    fail(name + ' must be a normalized absolute path');
  const real = realpathSync(value);
  if (real !== value) fail(name + ' must be a real path');
  if (!allowUnsafe && [workspaceRoot, os.tmpdir(), '/tmp', '/var/tmp']
    .some(root => beneath(realpathSync(root), real))) {
    fail(name + ' must be outside the workspace and temporary roots');
  }
  return real;
}
async function pinned(file, expected, name) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.size > MAX_BYTES) fail(name + ' must be a bounded regular file');
  const bytes = await fs.readFile(file);
  if (hash(bytes) !== expected) fail(name + ' differs from host pin');
  return bytes;
}
async function archived(root, directory, sha, name) {
  const bytes = await pinned(path.join(root, directory, sha + '.json'), sha, name);
  let value;
  try { value = JSON.parse(bytes); } catch { fail(name + ' must be JSON'); }
  return plain(value, name);
}
async function immutable(file, value) {
  const content = canonical(value) + '\n';
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = path.join(path.dirname(file), '.' + path.basename(file) + '-' + randomUUID());
  const handle = await fs.open(temporary, 'wx', 0o600);
  try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
  try {
    try { await fs.link(temporary, file); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const directory = await fs.open(path.dirname(file), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } finally { await fs.unlink(temporary).catch(() => {}); }
  if (await fs.readFile(file, 'utf8') !== content) fail('comparison receipt conflicts with prior result');
}
function taskIds(bytes) {
  let tasks;
  try { tasks = JSON.parse(bytes); } catch { fail('task set must be JSON'); }
  if (tasks?.schema !== 1 || !Array.isArray(tasks.cases) ||
      tasks.cases.length < 1 || tasks.cases.length > 128) fail('task set needs 1..128 cases');
  const ids = tasks.cases.map(item => item?.id);
  if (ids.some(id => typeof id !== 'string' || !ID.test(id)) || new Set(ids).size !== ids.length)
    fail('task identities are invalid or repeated');
  return ids;
}
function sameIds(rows, ids, name) {
  if (!Array.isArray(rows) || rows.length !== ids.length ||
      rows.some((row, index) => row?.id !== ids[index])) fail(name + ' must cover every frozen task in order');
}
function validatePrediction(value, role, run, ids) {
  fields(value, ['schema', 'role', 'commit', 'clone_sha256', 'task_set_sha256', 'predictions'], 'prediction receipt');
  if (value.schema !== 1 || value.role !== role || value.commit !== run.commit ||
      value.clone_sha256 !== run.clone_sha256 || value.task_set_sha256 !== run.task_set_sha256)
    fail('prediction receipt does not bind the clone and task set');
  sameIds(value.predictions, ids, 'predictions');
  for (const item of value.predictions) {
    fields(item, ['id', 'success_probability'], 'prediction');
    if (typeof item.success_probability !== 'number' || !Number.isFinite(item.success_probability) ||
        item.success_probability < 0 || item.success_probability > 1)
      fail('prediction probability must be in 0..1');
  }
}
function validateRun(value, role, expectedCommit, pins, ids) {
  fields(value, ['schema', 'role', 'commit', 'clone_sha256', 'session_sha256',
    'task_set_sha256', 'evaluator_sha256', 'model_sha256', 'toolchain_sha256',
    'budget_units', 'prediction_receipt_sha256', 'outputs', 'usage'], 'run receipt');
  if (value.schema !== 1 || value.role !== role || value.commit !== expectedCommit ||
      value.task_set_sha256 !== pins.taskSetSha256 || value.evaluator_sha256 !== pins.evaluatorSha256 ||
      value.model_sha256 !== pins.modelSha256 || value.toolchain_sha256 !== pins.toolchainSha256 ||
      value.budget_units !== pins.budgetUnits) fail('run receipt differs from frozen comparison');
  digest(value.clone_sha256, 'clone SHA-256');
  digest(value.session_sha256, 'session SHA-256');
  digest(value.prediction_receipt_sha256, 'prediction receipt SHA-256');
  sameIds(value.outputs, ids, 'outputs');
  for (const item of value.outputs) {
    fields(item, ['id', 'answer'], 'output');
    if (typeof item.answer !== 'string' || Buffer.byteLength(item.answer) > 16 * 1024)
      fail('output answer must be at most 16 KiB');
  }
  fields(value.usage, ['model', 'tools', 'verification', 'branch', 'coordination'], 'host usage');
  const spent = Object.entries(value.usage).reduce((sum, [name, amount]) =>
    sum + units(amount, name), 0);
  // Every arm is charged the same *actual* measured total. The host meter
  // includes branch and verification overhead; no unused allowance is scored.
  if (spent !== pins.budgetUnits) fail('clones must spend the same frozen total compute');
}
async function evaluate(evaluator, taskSetPath, runFile, runSha, taskSetSha, evaluatorSha, ids) {
  const output = await new Promise((resolve, reject) => execFile(process.execPath,
    [evaluator, '--task-set', taskSetPath, '--run', runFile, '--run-sha', runSha],
    { cwd: path.dirname(evaluator), env: { PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: path.dirname(evaluator), NODE_OPTIONS: '' }, timeout: 60_000, maxBuffer: MAX_BYTES },
    (error, stdout) => error ? reject(new Error('fresh clone comparison: evaluator failed: ' + error.message)) : resolve(stdout)));
  let report;
  try { report = JSON.parse(output); } catch { fail('evaluator did not return JSON'); }
  fields(report, ['schema', 'task_set_sha256', 'evaluator_sha256', 'run_receipt_sha256', 'cases'], 'evaluator report');
  if (report.schema !== 1 || report.task_set_sha256 !== taskSetSha ||
      report.evaluator_sha256 !== evaluatorSha || report.run_receipt_sha256 !== runSha)
    fail('evaluator report differs from pinned inputs');
  sameIds(report.cases, ids, 'evaluator cases');
  for (const item of report.cases) {
    fields(item, ['id', 'quality', 'supported', 'counterexample', 'unsupported_claims'], 'evaluator case');
    units(item.quality, 'quality');
    units(item.unsupported_claims, 'unsupported claims');
    if (typeof item.supported !== 'boolean' || typeof item.counterexample !== 'boolean' ||
        ((!item.supported || item.counterexample) && item.quality !== 0))
      fail('evaluator case support, counterexample and quality conflict');
  }
  return report;
}
function metrics(report, prediction, usage) {
  const quality = report.cases.reduce((sum, item) => sum + item.quality, 0);
  const unsupported = report.cases.reduce((sum, item) => sum + item.unsupported_claims, 0);
  const brier = report.cases.reduce((sum, item, index) => {
    const observed = item.supported && item.quality > 0 ? 1 : 0;
    return sum + (prediction.predictions[index].success_probability - observed) ** 2;
  }, 0) / report.cases.length;
  return { quality, unsupported_claims: unsupported, brier,
    compute: { ...usage, total: Object.values(usage).reduce((sum, amount) => sum + amount, 0) } };
}

/**
 * Private-root run receipts and predictions are written by the trusted host,
 * outside any model-writable workspace. The evaluator is a separately reviewed
 * CLI file, pinned by SHA-256, and must emit a complete independent case report.
 * A supported decision is evidence for a later host gate, never promotion.
 */
export function createFreshCloneComparison(settings) {
  plain(settings, 'settings');
  const required = ['workspaceRoot', 'privateRoot', 'taskSetPath', 'taskSetSha256',
    'evaluatorPath', 'evaluatorSha256', 'modelSha256', 'toolchainSha256', 'budgetUnits'];
  const keys = Object.keys(settings);
  if (required.some(key => !keys.includes(key)) ||
      keys.some(key => !required.includes(key) && key !== 'allowUnsafeRootsForTest'))
    fail('settings fields differ from schema');
  const workspaceRoot = realpathSync(settings.workspaceRoot);
  const allowUnsafe = settings.allowUnsafeRootsForTest === true;
  if (!allowUnsafe && workspaceRoot !== settings.workspaceRoot) fail('workspace root must be real');
  const privateRoot = hostPath(settings.privateRoot, 'private root', workspaceRoot, allowUnsafe);
  const privateStat = statSync(privateRoot);
  if (!privateStat.isDirectory() || privateStat.uid !== process.getuid() ||
      (privateStat.mode & 0o077) !== 0)
    fail('private root must be owned by this account and mode 0700');
  const taskSetPath = hostPath(settings.taskSetPath, 'task set', workspaceRoot, allowUnsafe);
  const evaluatorPath = hostPath(settings.evaluatorPath, 'evaluator', workspaceRoot, allowUnsafe);
  const pins = { taskSetSha256: digest(settings.taskSetSha256, 'task set SHA-256'),
    evaluatorSha256: digest(settings.evaluatorSha256, 'evaluator SHA-256'),
    modelSha256: digest(settings.modelSha256, 'model SHA-256'),
    toolchainSha256: digest(settings.toolchainSha256, 'toolchain SHA-256'),
    budgetUnits: units(settings.budgetUnits, 'budget', 1) };
  const computeBudgetSha = hash(canonical({ schema: 1, budget_units: pins.budgetUnits,
    model_sha256: pins.modelSha256, toolchain_sha256: pins.toolchainSha256 }));

  async function compare(input) {
    fields(input, ['baseline_commit', 'candidate_commit', 'baseline_receipt_sha256',
      'candidate_receipt_sha256'], 'comparison request');
    const baselineCommit = commit(input.baseline_commit, 'baseline commit');
    const candidateCommit = commit(input.candidate_commit, 'candidate commit');
    if (baselineCommit === candidateCommit) fail('candidate must differ from unchanged baseline');
    const baselineSha = digest(input.baseline_receipt_sha256, 'baseline receipt SHA-256');
    const candidateSha = digest(input.candidate_receipt_sha256, 'candidate receipt SHA-256');
    if (baselineSha === candidateSha) fail('clones need distinct run receipts');
    const taskSet = await pinned(taskSetPath, pins.taskSetSha256, 'task set');
    await pinned(evaluatorPath, pins.evaluatorSha256, 'evaluator');
    const ids = taskIds(taskSet);
    const runs = await Promise.all([
      archived(privateRoot, 'fresh-runs', baselineSha, 'baseline run'),
      archived(privateRoot, 'fresh-runs', candidateSha, 'candidate run') ]);
    validateRun(runs[0], 'baseline', baselineCommit, pins, ids);
    validateRun(runs[1], 'candidate', candidateCommit, pins, ids);
    if (runs[0].clone_sha256 === runs[1].clone_sha256 ||
        runs[0].session_sha256 === runs[1].session_sha256)
      fail('baseline and candidate must use distinct clone and session identities');
    const predictions = await Promise.all(runs.map((run, index) =>
      archived(privateRoot, 'fresh-predictions', run.prediction_receipt_sha256,
        index === 0 ? 'baseline prediction' : 'candidate prediction')));
    validatePrediction(predictions[0], 'baseline', runs[0], ids);
    validatePrediction(predictions[1], 'candidate', runs[1], ids);
    const reports = [];
    for (const sha of [baselineSha, candidateSha]) {
      const runFile = path.join(privateRoot, 'fresh-runs', sha + '.json');
      reports.push(await evaluate(evaluatorPath, taskSetPath, runFile, sha,
        pins.taskSetSha256, pins.evaluatorSha256, ids));
    }
    // A pin changed while the evaluator ran: no receipt is published.
    await pinned(taskSetPath, pins.taskSetSha256, 'task set');
    await pinned(evaluatorPath, pins.evaluatorSha256, 'evaluator');
    for (const [sha, run] of [[baselineSha, runs[0]], [candidateSha, runs[1]]]) {
      await pinned(path.join(privateRoot, 'fresh-runs', sha + '.json'), sha, 'run receipt');
      await pinned(path.join(privateRoot, 'fresh-predictions',
        run.prediction_receipt_sha256 + '.json'), run.prediction_receipt_sha256, 'prediction receipt');
    }
    const baseline = metrics(reports[0], predictions[0], runs[0].usage);
    const candidate = metrics(reports[1], predictions[1], runs[1].usage);
    const regressions = ids.filter((id, index) =>
      reports[1].cases[index].quality < reports[0].cases[index].quality);
    const counterexamples = ids.filter((id, index) => reports[1].cases[index].counterexample);
    const reasons = [];
    if (candidate.quality <= baseline.quality) reasons.push('no_strict_verified_gain');
    if (regressions.length) reasons.push('paired_task_regression');
    if (counterexamples.length) reasons.push('candidate_counterexample');
    if (candidate.unsupported_claims > 0) reasons.push('unsupported_claim');
    if (candidate.brier > baseline.brier + 1e-12) reasons.push('calibration_regression');
    const fresh = { task_set_sha256: pins.taskSetSha256,
      baseline_commit: baselineCommit, candidate_commit: candidateCommit,
      baseline_receipt_sha256: baselineSha, candidate_receipt_sha256: candidateSha,
      compute_budget_sha256: computeBudgetSha };
    const receipt = { schema: 1, policy: 'telepathy.fresh-clone-comparison/v1',
      fresh, evaluator_sha256: pins.evaluatorSha256,
      model_sha256: pins.modelSha256, toolchain_sha256: pins.toolchainSha256,
      baseline_prediction_sha256: runs[0].prediction_receipt_sha256,
      candidate_prediction_sha256: runs[1].prediction_receipt_sha256,
      baseline_cases: reports[0].cases, candidate_cases: reports[1].cases,
      baseline, candidate, regressions, counterexamples,
      verdict: reasons.length === 0 ? 'supported' : 'rejected', reasons };
    const receiptSha = hash(canonical(receipt) + '\n');
    await immutable(path.join(privateRoot, 'fresh-comparisons', receiptSha + '.json'), receipt);
    // The promotion adapter's exact fresh block has no comparison field. Its
    // pinned verifier can resolve this immutable index using that block alone.
    const freshSha = hash(canonical(fresh));
    await immutable(path.join(privateRoot, 'fresh-comparisons', 'by-fresh',
      freshSha + '.json'), { schema: 1, fresh_sha256: freshSha,
      comparison_sha256: receiptSha });
    return { verdict: receipt.verdict, reasons, comparison_sha256: receiptSha,
      comparison_path: path.join(privateRoot, 'fresh-comparisons', receiptSha + '.json'),
      fresh_sha256: freshSha, fresh, baseline, candidate, regressions, counterexamples };
  }
  return Object.freeze({ compare });
}
