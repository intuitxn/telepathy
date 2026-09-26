import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compileAlgorithmText, prepareAlgorithmText, selectModelRoute,
  simulateAlgorithmText } from './algorithm-language.mjs';
import { defineAlgorithmTask, runAlgorithmTask } from './algorithm-spec.mjs';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const source = `# A bounded service queue. Each step reads the previous state.
algorithm service_queue
state backlog = 5
state served = 0
step backlog = sub(backlog, if_lt(backlog, 2, backlog, 2))
step served = add(served, if_lt(backlog, 2, backlog, 2))
return served
`;

test('compiles one pseudocode file deterministically and simulates simultaneous state steps', () => {
  const compiled = compileAlgorithmText(source);
  assert.equal(compiled.ok, true);
  assert.equal(compiled.source_sha256, sha256(source));
  assert.equal(compiled.bend_sha256, sha256(compiled.bend_source));
  assert.deepEqual(compiled.interface, { argv_types: ['nat'], stdout_type: 'nat_line', max_steps: 128 });
  assert.deepEqual(compiled, compileAlgorithmText(source));
  assert.match(compiled.bend_source, /def algorithm_repeat\(/);
  assert.deepEqual([0, 1, 2, 3, 4].map(steps => simulateAlgorithmText(source, steps).stdout),
    ['0\n', '2\n', '4\n', '5\n', '5\n']);
  const prepared = prepareAlgorithmText(source);
  assert.equal(prepared.ok, true);
  assert.deepEqual([0, 1, 2, 3, 4].map(steps => prepared.simulate(steps).stdout),
    ['0\n', '2\n', '4\n', '5\n', '5\n']);
  const tick = 'algorithm tick_sum\nstate total = 0\nstep total = add(total, tick)\nreturn total\n';
  assert.equal(simulateAlgorithmText(tick, 5).stdout, '10\n');
  const bendKeyword = 'algorithm keyword\nstate match = 1\nstep match = add(match, 1)\nreturn match\n';
  const keywordCompiled = compileAlgorithmText(bendKeyword);
  assert.equal(keywordCompiled.ok, true);
  assert.match(keywordCompiled.bend_source, /AlgorithmState\{v0: Nat\}/);
  assert.equal(simulateAlgorithmText(bendKeyword, 3).stdout, '4\n');
});

test('emits bounded LSP-shaped source diagnostics for invalid names and syntax', () => {
  const invalid = 'algorithm bad\nstate total = 0\nstep total = add(total, mystery)\nreturn total\n';
  const result = compileAlgorithmText(invalid);
  assert.equal(result.ok, false);
  assert.equal(result.bend_source, undefined);
  assert.equal(result.diagnostics[0].code, 'unknown-name');
  assert.deepEqual(result.diagnostics[0].range,
    { start: { line: 2, character: 24 }, end: { line: 2, character: 31 } });
  assert.equal(result.diagnostics[0].severity, 1);
  assert.equal(compileAlgorithmText('algorithm a\nstate x = 01\nstep x = add(x, 1)\nreturn x\n').ok, false);
  assert.equal(compileAlgorithmText('algorithm a\nstate x = 0\nstep x = add(x, add(x, 1))\nreturn x\n').ok, true);
  assert.equal(simulateAlgorithmText(source, 129).diagnostics[0].code, 'step-range');
  assert.equal(compileAlgorithmText(`${source}state another = 0\n`).diagnostics[0].code, 'statement-order');
});

test('a model declaration requests a route without changing simulation semantics', () => {
  const requested = source.replace('algorithm service_queue\n',
    'algorithm service_queue\nmodel deepseek-flash\n');
  assert.equal(compileAlgorithmText(source).model_request, null);
  assert.equal(compileAlgorithmText(requested).model_request, 'deepseek-flash');
  assert.equal(prepareAlgorithmText(requested).model_request, 'deepseek-flash');
  assert.equal(simulateAlgorithmText(requested, 3).stdout, simulateAlgorithmText(source, 3).stdout);
  assert.equal(compileAlgorithmText(requested.replace('model deepseek-flash\n',
    'model deepseek-flash\nmodel auto\n')).diagnostics[0].code, 'statement-order');
  assert.equal(compileAlgorithmText(source.replace('state backlog = 5\n',
    'state backlog = 5\nmodel deepseek-flash\n')).diagnostics[0].code, 'statement-order');
});

test('host index selects available measured gain per compute and rejects credential fields', () => {
  const receipt = sha256('measured receipt');
  const index = { generation_sha256: sha256('same held-out generation'), routes: [
    { name: 'fast', provider: 'provider-a', model: 'model-a', available: true,
      measurement: { passed: 8, cases: 10, compute_units: 20, receipt_sha256: receipt } },
    { name: 'accurate', provider: 'provider-b', model: 'model-b', available: true,
      measurement: { passed: 9, cases: 10, compute_units: 30, receipt_sha256: receipt } },
    { name: 'offline', provider: 'provider-c', model: 'model-c', available: false,
      measurement: { passed: 10, cases: 10, compute_units: 1, receipt_sha256: receipt } },
  ] };
  assert.equal(selectModelRoute('auto', index).name, 'fast');
  assert.equal(selectModelRoute('accurate', index).model, 'model-b');
  assert.throws(() => selectModelRoute('offline', index), /unavailable/);
  assert.throws(() => selectModelRoute('unknown', index), /unavailable/);
  assert.throws(() => selectModelRoute('auto', { generation_sha256: null,
    routes: [{ name: 'deepseek-flash', provider: 'deepseek-official',
      model: 'deepseek-flash', available: true, measurement: null }] }),
  /no available measured route/);
  assert.throws(() => selectModelRoute('auto', { ...index, routes: [
    { ...index.routes[0], api_key: 'must-never-be-an-index-field' }] }), /route is invalid/);
  assert.throws(() => selectModelRoute('auto', { ...index, routes: [
    { ...index.routes[0], measurement: { ...index.routes[0].measurement, cases: 9 } },
    index.routes[1]] }), /same case count/);
});

test('one-file CLI checks, simulates, and emits exact Bend bytes from pseudocode', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'telepathy-algorithm-cli-'));
  try {
    const sourcePath = path.join(workspaceRoot, 'service_queue.algo');
    await writeFile(sourcePath, source);
    const run = (...args) => spawnSync(process.execPath,
      [path.resolve('runtime/dsh/algorithm-language.mjs'), ...args],
      { encoding: 'utf8', cwd: path.resolve('.') });
    const check = run('check', sourcePath);
    assert.equal(check.status, 0, check.stderr);
    assert.deepEqual(JSON.parse(check.stdout), {
      ok: true, source_sha256: sha256(source),
      bend_sha256: compileAlgorithmText(source).bend_sha256, diagnostics: [],
    });
    const simulate = run('simulate', sourcePath, '3');
    assert.equal(simulate.status, 0, simulate.stderr);
    assert.equal(simulate.stdout, '5\n');
    assert.equal(run('simulate', sourcePath, '129').status, 1);
    const compiled = run('compile', sourcePath);
    assert.equal(compiled.status, 0, compiled.stderr);
    assert.equal(compiled.stdout, compileAlgorithmText(source).bend_source);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('one-file CLI runs native Bend against its prediction and retains an exact receipt', async t => {
  const bend = process.env.BEND ?? path.join(os.homedir(), '.bend/bin/bend');
  if (!existsSync(bend)) { t.skip('Bend is unavailable'); return; }
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'telepathy-algorithm-cli-run-'));
  const archiveRoot = await mkdtemp(path.join(os.tmpdir(), 'telepathy-algorithm-cli-archive-'));
  try {
    const sourcePath = path.join(workspaceRoot, 'service_queue.algo');
    await writeFile(sourcePath, source);
    const run = (...args) => spawnSync(process.execPath,
      [path.resolve('runtime/dsh/algorithm-language.mjs'), 'run', sourcePath, ...args],
      { encoding: 'utf8', cwd: path.resolve('.'), timeout: 90_000,
        env: { ...process.env, BEND: bend, TELEPATHY_DSH_ARCHIVE: archiveRoot,
          TELEPATHY_DSH_TEST_ALLOW_UNSAFE_ARCHIVE: '1' } });
    assert.equal(run('01').status, 1);
    const native = run('3');
    assert.equal(native.status, 0, native.stderr);
    const output = JSON.parse(native.stdout);
    const compiled = compileAlgorithmText(source);
    assert.equal(output.source_sha256, compiled.source_sha256);
    assert.equal(output.bend_sha256, compiled.bend_sha256);
    assert.equal(output.steps, 3);
    assert.equal(output.predicted_stdout, '5\n');
    assert.equal(output.observed_stdout, '5\n');
    assert.equal(output.prediction_match, true);
    assert.equal(output.status, 'executed');
    const receiptBytes = await readFile(output.receipt_path);
    assert.equal(output.receipt_sha256, sha256(receiptBytes));
    const receipt = JSON.parse(receiptBytes);
    assert.equal(output.receipt_id, receipt.receipt_id);
    assert.equal(receipt.source_sha256, compiled.bend_sha256);
    assert.equal(receipt.observation.cases[0].prediction_match, true);
    assert.equal(receipt.observation.cases[0].name, 'step-3');
    assert.equal(await readFile(path.join(archiveRoot, 'candidates', `${compiled.bend_sha256}.bend`), 'utf8'),
      compiled.bend_source);

    const evaluatorPath = path.resolve('benchmarks/core/run.mjs');
    const caseSetPath = path.resolve('benchmarks/algorithm-language/cases.json');
    const score = spawnSync(process.execPath,
      [path.resolve('runtime/dsh/algorithm-language.mjs'), 'score',
        receipt.receipt_id, output.receipt_sha256],
      { encoding: 'utf8', cwd: path.resolve('.'), timeout: 90_000,
        env: { ...process.env, BEND: bend, TELEPATHY_DSH_ARCHIVE: archiveRoot,
          TELEPATHY_DSH_TEST_ALLOW_UNSAFE_ARCHIVE: '1',
          TELEPATHY_DSH_EVALUATOR: evaluatorPath,
          TELEPATHY_DSH_EVALUATOR_SHA256: sha256(await readFile(evaluatorPath)),
          TELEPATHY_DSH_CASE_SET: caseSetPath,
          TELEPATHY_DSH_CASE_SET_SHA256: sha256(await readFile(caseSetPath)) } });
    assert.equal(score.status, 0, score.stderr);
    const scored = JSON.parse(score.stdout);
    assert.equal(scored.passed, true);
    assert.deepEqual(scored.coverage, { total: 6, observed: 6, passed: 6, failed: 0 });
    assert.equal(JSON.parse(await readFile(scored.score_path)).report.receipt_case_overlap, 1);

    const changedCases = JSON.parse(await readFile(caseSetPath, 'utf8'));
    changedCases.cases[3].expect.stdout = '6\n';
    const changedCasePath = path.join(archiveRoot, 'changed-cases.json');
    const changedCaseBytes = `${JSON.stringify(changedCases)}\n`;
    await writeFile(changedCasePath, changedCaseBytes);
    const rejected = spawnSync(process.execPath,
      [path.resolve('runtime/dsh/algorithm-language.mjs'), 'score',
        receipt.receipt_id, output.receipt_sha256],
      { encoding: 'utf8', cwd: path.resolve('.'), timeout: 90_000,
        env: { ...process.env, BEND: bend, TELEPATHY_DSH_ARCHIVE: archiveRoot,
          TELEPATHY_DSH_TEST_ALLOW_UNSAFE_ARCHIVE: '1',
          TELEPATHY_DSH_EVALUATOR: evaluatorPath,
          TELEPATHY_DSH_EVALUATOR_SHA256: sha256(await readFile(evaluatorPath)),
          TELEPATHY_DSH_CASE_SET: changedCasePath,
          TELEPATHY_DSH_CASE_SET_SHA256: sha256(changedCaseBytes) } });
    assert.equal(rejected.status, 1, rejected.stderr);
    const failedScore = JSON.parse(rejected.stdout);
    assert.equal(failedScore.passed, false);
    assert.deepEqual(failedScore.coverage, { total: 6, observed: 6, passed: 5, failed: 1 });
    assert.equal(failedScore.cases.find(item => item.id === 'step-3').pass, false);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(archiveRoot, { recursive: true, force: true });
  }
});

test('operator CLI rejects an archive inside the original pseudocode workspace', async t => {
  const workspaceRoot = await mkdtemp(path.join(os.homedir(), '.telepathy-algorithm-archive-guard-'));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  await mkdir(path.join(workspaceRoot, '.jj'));
  await mkdir(path.join(workspaceRoot, 'nested'));
  const sourcePath = path.join(workspaceRoot, 'nested', 'service_queue.algo');
  const archiveRoot = path.join(workspaceRoot, 'archive');
  await writeFile(sourcePath, source);
  const env = { ...process.env, TELEPATHY_DSH_ARCHIVE: archiveRoot };
  delete env.TELEPATHY_DSH_TEST_ALLOW_UNSAFE_ARCHIVE;
  const run = spawnSync(process.execPath,
    [path.resolve('runtime/dsh/algorithm-language.mjs'), 'run', sourcePath, '3'],
    { encoding: 'utf8', cwd: path.resolve('.'), env });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /archive must be outside the workspace/);
  assert.equal(existsSync(archiveRoot), false);
});

test('generated one-file Bend is checked and executed by the existing pinned receipt path', async t => {
  const bend = process.env.BEND ?? path.join(os.homedir(), '.bend/bin/bend');
  if (!existsSync(bend)) { t.skip('Bend is unavailable'); return; }
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'telepathy-algorithm-language-'));
  const archiveRoot = await mkdtemp(path.join(os.tmpdir(), 'telepathy-algorithm-language-archive-'));
  const oldUnsafe = process.env.TELEPATHY_DSH_TEST_ALLOW_UNSAFE_ARCHIVE;
  process.env.TELEPATHY_DSH_TEST_ALLOW_UNSAFE_ARCHIVE = '1';
  try {
    const compiled = compileAlgorithmText(source);
    assert.equal(compiled.ok, true);
    await writeFile(path.join(workspaceRoot, 'service_queue.bend'), compiled.bend_source);
    const task = defineAlgorithmTask({
      material: { kind: 'pseudocode', reference: 'algorithm-language.test:service_queue', text: source },
      claim: 'At most five jobs can be served from a fixed five-job queue.',
      assumptions: ['No arrivals; natural subtraction saturates at zero.'],
      interface: { argv_types: ['nat'], stdout_type: 'nat_line' },
      probes: [{ name: 'empty', args: ['0'] }, { name: 'partial', args: ['1'] },
        { name: 'saturated', args: ['3'] }],
      counterexample_requests: [{ name: 'after-empty', args: ['4'], reason: 'Check saturation.' }],
    });
    const result = await runAlgorithmTask(task, {
      source: 'service_queue.bend', predict_check_pass: true, predict_build_pass: true,
      case_predictions: [{ name: 'empty', predicted_stdout: '0\n' },
        { name: 'partial', predicted_stdout: '2\n' },
        { name: 'saturated', predicted_stdout: '5\n' }],
    }, { workspaceRoot, archiveRoot, bendBin: bend, timeoutMs: 45_000 });
    assert.equal(result.receipt.status, 'executed', JSON.stringify(result.receipt));
    assert.equal(result.assessment.checker.ok, true);
    assert.match(result.assessment.checker.stdout, /All terms check\./);
    assert.deepEqual(result.assessment.prediction_counterexamples, []);
    assert.equal(result.assessment.correctness, 'unscored');
    assert.equal(result.experiment.source_sha256, compiled.bend_sha256);

    const tickSource = 'algorithm tick_sum\nstate total = 0\nstep total = add(total, tick)\nreturn total\n';
    const tickCompiled = compileAlgorithmText(tickSource);
    await writeFile(path.join(workspaceRoot, 'tick_sum.bend'), tickCompiled.bend_source);
    const tickTask = defineAlgorithmTask({
      material: { kind: 'pseudocode', reference: 'algorithm-language.test:tick_sum', text: tickSource },
      claim: 'Five ticks sum the values zero through four.', assumptions: [],
      interface: { argv_types: ['nat'], stdout_type: 'nat_line' },
      probes: [{ name: 'five-ticks', args: ['5'] }], counterexample_requests: [],
    });
    const tickResult = await runAlgorithmTask(tickTask, {
      source: 'tick_sum.bend', predict_check_pass: true, predict_build_pass: true,
      case_predictions: [{ name: 'five-ticks', predicted_stdout: '10\n' }],
    }, { workspaceRoot, archiveRoot, bendBin: bend, timeoutMs: 45_000 });
    assert.equal(tickResult.receipt.status, 'executed', JSON.stringify(tickResult.receipt));
    assert.deepEqual(tickResult.assessment.prediction_counterexamples, []);

    const keywordSource = 'algorithm keyword\nstate match = 1\nstep match = add(match, 1)\nreturn match\n';
    const keywordPath = path.join(workspaceRoot, 'keyword.bend');
    await writeFile(keywordPath, compileAlgorithmText(keywordSource).bend_source);
    const keywordCheck = spawnSync(bend, [keywordPath, '--check-only'], {
      encoding: 'utf8', env: { ...process.env, BEND_NO_TELEMETRY: '1' },
    });
    assert.equal(keywordCheck.status, 0, keywordCheck.stderr);
    assert.match(keywordCheck.stdout, /All terms check\./);
  } finally {
    if (oldUnsafe === undefined) delete process.env.TELEPATHY_DSH_TEST_ALLOW_UNSAFE_ARCHIVE;
    else process.env.TELEPATHY_DSH_TEST_ALLOW_UNSAFE_ARCHIVE = oldUnsafe;
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(archiveRoot, { recursive: true, force: true });
  }
});
