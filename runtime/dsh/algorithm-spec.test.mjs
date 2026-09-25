import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { defineAlgorithmTask, inspectBendReceipt, prepareBendExperiment,
  runAlgorithmTask } from './algorithm-spec.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const taskInput = {
  material: { kind: 'pseudocode', reference: 'example:repeat',
    text: 'Given n, begin at zero and apply +3 exactly n times. Return the final state.' },
  claim: 'The batch command advances value by three for each bounded step.',
  assumptions: ['The example uses the reference Bend CLI contract.'],
  interface: { argv_types: ['text', 'nat'], stdout_type: 'text' },
  probes: [{ name: 'one-step', args: ['batch', '1'] }],
  counterexample_requests: [{ name: 'zero-boundary', args: ['batch', '0'],
    reason: 'Check the empty repeat case against the source claim.' }],
};
const candidate = {
  source: 'benchmarks/core/reference.bend', predict_check_pass: true, predict_build_pass: true,
  case_predictions: [{ name: 'one-step', predicted_stdout: 'clock=1;value=3\n' }],
};

test('freezes an attributed typed task and rejects malformed inputs and mutated task content', async () => {
  const task = defineAlgorithmTask(taskInput);
  assert.equal(task.material_sha256, sha256(taskInput.material.text));
  assert.match(task.task_sha256, /^[a-f0-9]{64}$/);
  assert.equal(task.interface.argv_types[1], 'nat');
  const experiment = await prepareBendExperiment(task, candidate, { workspaceRoot: root });
  assert.equal(experiment.task_sha256, task.task_sha256);
  assert.equal(experiment.request.cases[0].predicted_stdout, 'clock=1;value=3\n');
  assert.match(experiment.source_sha256, /^[a-f0-9]{64}$/);
  await assert.rejects(prepareBendExperiment({ ...task, claim: 'changed claim' }, candidate,
    { workspaceRoot: root }), /digest mismatch/);
  assert.throws(() => defineAlgorithmTask({ ...taskInput,
    probes: [{ name: 'bad', args: ['batch', '01'] }] }), /canonical/);
  assert.throws(() => defineAlgorithmTask({ ...taskInput,
    material: { ...taskInput.material, reference: '' } }), /material reference/);
  assert.throws(() => defineAlgorithmTask({ ...taskInput,
    material: { ...taskInput.material, text: '界'.repeat(16384) } }), /material text/);
  await assert.rejects(prepareBendExperiment(task, { ...candidate,
    source: '../outside.bend' }, { workspaceRoot: root }), /relative one-file/);
  await assert.rejects(prepareBendExperiment(task, { ...candidate,
    case_predictions: [] }, { workspaceRoot: root }), /one prediction/);
});

test('runs the one-file Bend candidate and preserves checker and prediction evidence', async t => {
  const archiveRoot = await mkdtemp(path.join(os.tmpdir(), 'telepathy-algorithm-spec-'));
  const oldUnsafe = process.env.TELEPATHY_DSH_TEST_ALLOW_UNSAFE_ARCHIVE;
  process.env.TELEPATHY_DSH_TEST_ALLOW_UNSAFE_ARCHIVE = '1';
  try {
    const task = defineAlgorithmTask(taskInput);
    const settings = { workspaceRoot: root, archiveRoot,
      bendBin: process.env.BEND ?? path.join(os.homedir(), '.bend/bin/bend'), timeoutMs: 30_000 };
    const result = await runAlgorithmTask(task, candidate, settings);
    assert.equal(result.receipt.status, 'executed', result.receipt.error);
    assert.equal(result.assessment.checker.ok, true);
    assert.match(result.assessment.checker.stdout, /All terms check\./);
    assert.equal(result.assessment.build.ok, true);
    assert.deepEqual(result.assessment.prediction_counterexamples, []);
    assert.equal(result.assessment.counterexample_requests[0].name, 'zero-boundary');
    assert.equal(result.assessment.correctness, 'unscored');
    assert.equal(result.experiment.source_sha256, result.receipt.source_sha256);
    assert.throws(() => inspectBendReceipt(task,
      { ...result.experiment, source_sha256: '0'.repeat(64) }, result.receipt), /binding mismatch/);

    const wrong = await runAlgorithmTask(task, { ...candidate,
      case_predictions: [{ name: 'one-step', predicted_stdout: 'wrong\n' }] }, settings);
    assert.equal(wrong.receipt.status, 'executed');
    assert.deepEqual(wrong.assessment.prediction_counterexamples, [{
      name: 'one-step', predicted_stdout: 'wrong\n', observed_stdout: 'clock=1;value=3\n',
    }]);
    assert.equal(wrong.assessment.correctness, 'unscored');
    assert.throws(() => inspectBendReceipt(task, result.experiment, wrong.receipt),
      /receipt case binding mismatch/);
  } catch (error) {
    if (error.code === 'ENOENT' && /bend/.test(String(error.path))) t.skip('Bend is unavailable');
    else throw error;
  } finally {
    if (oldUnsafe === undefined) delete process.env.TELEPATHY_DSH_TEST_ALLOW_UNSAFE_ARCHIVE;
    else process.env.TELEPATHY_DSH_TEST_ALLOW_UNSAFE_ARCHIVE = oldUnsafe;
    await rm(archiveRoot, { recursive: true, force: true });
  }
});

test('returns concrete checker diagnostics for an invalid translation', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'telepathy-algorithm-bad-'));
  const archiveRoot = await mkdtemp(path.join(os.tmpdir(), 'telepathy-algorithm-bad-archive-'));
  const oldUnsafe = process.env.TELEPATHY_DSH_TEST_ALLOW_UNSAFE_ARCHIVE;
  process.env.TELEPATHY_DSH_TEST_ALLOW_UNSAFE_ARCHIVE = '1';
  try {
    await writeFile(path.join(workspaceRoot, 'bad.bend'), 'import Base\n\ndef main() -> IO(Unit):\n  definitely_unknown_symbol\n');
    const task = defineAlgorithmTask(taskInput);
    const result = await runAlgorithmTask(task, { ...candidate, source: 'bad.bend',
      predict_check_pass: false, predict_build_pass: false }, {
      workspaceRoot, archiveRoot,
      bendBin: process.env.BEND ?? path.join(os.homedir(), '.bend/bin/bend'), timeoutMs: 30_000,
    });
    assert.equal(result.receipt.status, 'check-failed');
    assert.equal(result.assessment.checker.ok, false);
    assert.equal(result.assessment.build, null);
    assert.equal(result.assessment.predictions.length, 0);
    assert.equal(result.assessment.correctness, 'unscored');
    assert.match(result.assessment.checker.stdout + result.assessment.checker.stderr, /unknown|unbound|not found|undefined/i);
  } finally {
    if (oldUnsafe === undefined) delete process.env.TELEPATHY_DSH_TEST_ALLOW_UNSAFE_ARCHIVE;
    else process.env.TELEPATHY_DSH_TEST_ALLOW_UNSAFE_ARCHIVE = oldUnsafe;
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(archiveRoot, { recursive: true, force: true });
  }
});
