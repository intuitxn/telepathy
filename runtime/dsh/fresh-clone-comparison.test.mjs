import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFreshCloneComparison } from './fresh-clone-comparison.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const BASE = 'a'.repeat(40);
const CANDIDATE = 'b'.repeat(40);
const evaluatorSource = [
  'import { readFileSync } from "node:fs";',
  'import { createHash } from "node:crypto";',
  'const sha = bytes => createHash("sha256").update(bytes).digest("hex");',
  'const arg = name => process.argv[process.argv.indexOf(name) + 1];',
  'const taskBytes = readFileSync(arg("--task-set"));',
  'const tasks = JSON.parse(taskBytes);',
  'const run = JSON.parse(readFileSync(arg("--run")));',
  'const cases = tasks.cases.map((item, index) => {',
  '  const answer = run.outputs[index].answer;',
  '  return { id: item.id, quality: answer === item.expected ? 1 : 0,',
  '    supported: answer !== "refuted", counterexample: answer === "refuted",',
  '    unsupported_claims: answer === "refuted" ? 1 : 0 };',
  '});',
  'process.stdout.write(JSON.stringify({ schema: 1, task_set_sha256: sha(taskBytes),',
  '  evaluator_sha256: sha(readFileSync(process.argv[1])),',
  '  run_receipt_sha256: arg("--run-sha"), cases }));',
].join('\n') + '\n';

async function save(root, directory, object) {
  const bytes = JSON.stringify(object) + '\n';
  const digest = sha(bytes);
  await mkdir(path.join(root, directory), { recursive: true });
  await writeFile(path.join(root, directory, digest + '.json'), bytes);
  return digest;
}
async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'fresh-clones-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspaceRoot = path.join(root, 'workspace');
  const privateRoot = path.join(root, 'private');
  await mkdir(workspaceRoot);
  await mkdir(privateRoot, { mode: 0o700 });
  const taskSetPath = path.join(privateRoot, 'fresh-tasks.json');
  const taskBytes = JSON.stringify({ schema: 1, cases: [
    { id: 'one', expected: 'yes' }, { id: 'two', expected: 'yes' },
    { id: 'three', expected: 'yes' } ] }) + '\n';
  await writeFile(taskSetPath, taskBytes);
  const evaluatorPath = path.join(privateRoot, 'frozen-evaluator.mjs');
  await writeFile(evaluatorPath, evaluatorSource);
  const settings = { workspaceRoot, privateRoot, taskSetPath, taskSetSha256: sha(taskBytes),
    evaluatorPath, evaluatorSha256: sha(evaluatorSource),
    modelSha256: 'c'.repeat(64), toolchainSha256: 'd'.repeat(64),
    budgetUnits: 100, allowUnsafeRootsForTest: true };
  async function arm(role, answers, probabilities, usage) {
    const commit = role === 'baseline' ? BASE : CANDIDATE;
    const clone = role === 'baseline' ? '1'.repeat(64) : '2'.repeat(64);
    const predictionSha = await save(privateRoot, 'fresh-predictions', {
      schema: 1, role, commit, clone_sha256: clone, task_set_sha256: settings.taskSetSha256,
      predictions: ['one', 'two', 'three'].map((id, index) =>
        ({ id, success_probability: probabilities[index] })) });
    return save(privateRoot, 'fresh-runs', { schema: 1, role, commit,
      clone_sha256: clone, session_sha256: role === 'baseline' ? '3'.repeat(64) : '4'.repeat(64),
      task_set_sha256: settings.taskSetSha256, evaluator_sha256: settings.evaluatorSha256,
      model_sha256: settings.modelSha256, toolchain_sha256: settings.toolchainSha256,
      budget_units: settings.budgetUnits, prediction_receipt_sha256: predictionSha,
      outputs: ['one', 'two', 'three'].map((id, index) => ({ id, answer: answers[index] })),
      usage });
  }
  return { root, privateRoot, settings, arm };
}
const baselineUsage = { model: 70, tools: 20, verification: 5, branch: 0, coordination: 5 };
const candidateUsage = { model: 65, tools: 20, verification: 5, branch: 5, coordination: 5 };
const overheadUsage = { model: 45, tools: 15, verification: 5, branch: 30, coordination: 5 };
const input = (baseline, candidate) => ({ baseline_commit: BASE, candidate_commit: CANDIDATE,
  baseline_receipt_sha256: baseline, candidate_receipt_sha256: candidate });

test('fresh clone comparison binds frozen pins, predictions, equal total compute and a durable decision', async t => {
  const f = await fixture(t);
  const baseline = await f.arm('baseline', ['yes', 'no', 'yes'], [1, 0, 1], baselineUsage);
  const candidate = await f.arm('candidate', ['yes', 'yes', 'yes'], [1, 1, 1], candidateUsage);
  const host = createFreshCloneComparison(f.settings);
  const result = await host.compare(input(baseline, candidate));
  assert.equal(result.verdict, 'supported');
  assert.equal(result.baseline.quality, 2);
  assert.equal(result.candidate.quality, 3);
  assert.equal(result.baseline.compute.total, 100);
  assert.equal(result.candidate.compute.total, 100);
  assert.equal(result.candidate.compute.branch, 5);
  assert.deepEqual(result.regressions, []);
  assert.equal(result.fresh.baseline_receipt_sha256, baseline);
  assert.equal(result.fresh.candidate_receipt_sha256, candidate);
  assert.match(result.fresh.compute_budget_sha256, /^[a-f0-9]{64}$/);
  const receipt = JSON.parse(await readFile(result.comparison_path));
  assert.equal(sha(await readFile(result.comparison_path)), result.comparison_sha256);
  assert.equal(receipt.verdict, 'supported');
  assert.equal(receipt.baseline_cases.length, 3);
  const index = JSON.parse(await readFile(path.join(f.privateRoot,
    'fresh-comparisons', 'by-fresh', result.fresh_sha256 + '.json')));
  assert.equal(index.comparison_sha256, result.comparison_sha256);
  assert.equal((await host.compare(input(baseline, candidate))).comparison_sha256, result.comparison_sha256);
});

test('plausible branched variant loses to a fixed oracle after overhead and a counterexample', async t => {
  const f = await fixture(t);
  const baseline = await f.arm('baseline', ['yes', 'no', 'yes'], [1, 0, 1], baselineUsage);
  const candidate = await f.arm('candidate', ['yes', 'yes', 'refuted'], [1, 1, 1], overheadUsage);
  const result = await createFreshCloneComparison(f.settings).compare(input(baseline, candidate));
  assert.equal(result.verdict, 'rejected');
  assert.equal(result.candidate.compute.branch, 30);
  assert.equal(result.candidate.compute.total, result.baseline.compute.total);
  assert.deepEqual(result.regressions, ['three']);
  assert.deepEqual(result.counterexamples, ['three']);
  assert.ok(result.candidate.brier > result.baseline.brier);
  assert.deepEqual(result.reasons, ['no_strict_verified_gain', 'paired_task_regression',
    'candidate_counterexample', 'unsupported_claim', 'calibration_regression']);
});

test('self-graded fields, changed pins and unequal compute are rejected before oracle replay', async t => {
  const f = await fixture(t);
  const baseline = await f.arm('baseline', ['yes', 'no', 'yes'], [1, 0, 1], baselineUsage);
  const selfGrade = await f.arm('candidate', ['yes', 'yes', 'yes'], [1, 1, 1], candidateUsage);
  const file = path.join(f.privateRoot, 'fresh-runs', selfGrade + '.json');
  const forged = { ...JSON.parse(await readFile(file)), model_score: 999 };
  const forgedSha = await save(f.privateRoot, 'fresh-runs', forged);
  const host = createFreshCloneComparison(f.settings);
  await assert.rejects(host.compare(input(baseline, forgedSha)), /run receipt fields differ from schema/);
  const unequal = { ...forged, model_score: undefined,
    usage: { ...candidateUsage, branch: 4 } };
  const unequalSha = await save(f.privateRoot, 'fresh-runs', unequal);
  await assert.rejects(host.compare(input(baseline, unequalSha)), /same frozen total compute/);
  await writeFile(f.settings.evaluatorPath, evaluatorSource + '\n// changed');
  await assert.rejects(host.compare(input(baseline, selfGrade)), /evaluator differs from host pin/);
});
