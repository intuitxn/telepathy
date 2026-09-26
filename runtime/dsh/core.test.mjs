import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, symlink, writeFile, mkdir, chmod, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { apply, runCandidate, scoreCandidate, selectCandidate, activeCandidate } from './core.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.env.TELEPATHY_DSH_TEST_ALLOW_UNSAFE_ARCHIVE = '1';
const digestOf = value => createHash('sha256').update(value).digest('hex');
const benchmarkRoot = process.env.TELEPATHY_DSH_BENCHMARK_ROOT ?? repo;
const referencePath = path.join(benchmarkRoot, 'benchmarks/core/reference.bend');
const reference = await readFile(referencePath).catch(error => {
  if (error.code === 'ENOENT') return null;
  throw error;
});
const digest = reference ? digestOf(reference) : null;
const prediction = {
  source: 'benchmarks/core/reference.bend', source_sha256: digest,
  predict_check_pass: true, predict_build_pass: true,
  cases: [{ name: 'batch-one', args: ['batch', '1'], predicted_stdout: 'clock=1;value=3\n' }],
};

test('registers the six raw-schema tools in the isolated keyless smoke profile', async () => {
  const registrations = [];
  apply({ tools: { register: tool => { registrations.push(tool); } } }, { mode: 'headless-smoke' });
  assert.deepEqual(registrations.map(tool => tool.name),
    ['algorithm_run', 'algorithm_score', 'algorithm_select', 'algorithm_compile', 'algorithm_active', 'algorithm_execute']);
  assert.deepEqual(registrations[0].parameters.required,
    ['source', 'source_sha256', 'predict_check_pass', 'predict_build_pass', 'cases']);
  const compiled = await registrations[3].execute({ source_text:
    'algorithm counter\nstate total = 0\nstep total = add(total, 1)\nreturn total\n',
  steps: [0, 3, 128] });
  assert.equal(compiled.ok, true);
  assert.match(compiled.bend_source, /def algorithm_step\(/);
  assert.match(compiled.bend_sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(compiled.simulations, [{ steps: 0, stdout: '0\n' },
    { steps: 3, stdout: '3\n' }, { steps: 128, stdout: '128\n' }]);
  assert.equal((await registrations[3].execute({ source_text: 'bad' })).ok, false);
  await assert.rejects(registrations[3].execute({ source_text: 'bad', steps: [1, 1] }),
    /distinct integers/);
});

test('funded profile requires control services and hides scoring and global selection', async () => {
  const taskRef = 'e'.repeat(64);
  const registrations = [];
  assert.throws(() => apply({ tools: { register() {} }, get: () => null },
    { mode: 'funded', taskRef }), /require task control and the tool boundary/);
  const reservations = [];
  const controller = { reserveAlgorithmCall: async (_taskRef, call) => {
    reservations.push(call);
    throw new Error('no bound grant');
  } };
  apply({ tools: { register: tool => registrations.push(tool) },
    get: name => name === 'telepathyTaskControl' ? controller
      : name === 'telepathyToolBoundary' ? { bindChildWorkspace() {} } : null },
  { mode: 'funded', taskRef });
  assert.deepEqual(registrations.map(tool => tool.name),
    ['algorithm_run', 'algorithm_compile', 'algorithm_active', 'algorithm_execute']);
  await assert.rejects(registrations[0].execute({}, { agent: { session: { id: 'session' } },
    callId: 'call-1' }), /no bound grant/);
  assert.equal(reservations.length, 1);
  assert.equal(reservations[0].tool, 'algorithm_run');
  assert.match(reservations[0].input_sha256, /^[a-f0-9]{64}$/);
  await assert.rejects(registrations[0].execute({}, { agent: { session: { id: 'session' } } }),
    /requires a DSH session and call ID/);
  assert.equal(reservations.length, 1);

  const accepted = [];
  const fundedTools = [];
  apply({ tools: { register: tool => fundedTools.push(tool) },
    get: name => name === 'telepathyTaskControl' ? { reserveAlgorithmCall: async (_ref, call) => accepted.push(call) }
      : name === 'telepathyToolBoundary' ? { bindChildWorkspace() {} } : null },
  { mode: 'funded', taskRef });
  const compiled = await fundedTools[1].execute({ source_text:
    'algorithm counter\nstate total = 0\nstep total = add(total, 1)\nreturn total\n' },
  { agent: { session: { id: 'session' } }, callId: 'compile-1' });
  assert.equal(compiled.ok, true);
  assert.equal(accepted[0].tool, 'algorithm_compile');
  assert.match(accepted[0].input_sha256, /^[a-f0-9]{64}$/);
});

test('checked production patch mounts only the funded algorithm catalog', async () => {
  const patch = await readFile(path.join(repo, 'runtime/dsh/cordis.patch.yml'), 'utf8');
  const block = patch.split('    - id: telepathy-algorithm-core\n')[1]?.split('\n    - id:')[0];
  assert.ok(block, 'production algorithm plugin is missing');
  assert.match(block, /inject: \[telepathyTaskControl, telepathyToolBoundary\]/);
  assert.match(block, /mode: funded/);
  assert.match(block, /taskRef: !!js process\.env\.TELEPATHY_TASK_REF/);
  assert.doesNotMatch(block, /mode: headless-smoke/);
});

test('production startup rejects an archive in sandbox-writable temporary storage', async () => {
  const previous = process.env.TELEPATHY_DSH_TEST_ALLOW_UNSAFE_ARCHIVE;
  delete process.env.TELEPATHY_DSH_TEST_ALLOW_UNSAFE_ARCHIVE;
  const previousArchive = process.env.TELEPATHY_DSH_ARCHIVE;
  process.env.TELEPATHY_DSH_ARCHIVE = await mkdtemp(path.join(os.tmpdir(), 'telepathy-dsh-unsafe-'));
  try { assert.throws(() => apply({ tools: { register() {} } }), /archive must be outside/); }
  finally {
    process.env.TELEPATHY_DSH_TEST_ALLOW_UNSAFE_ARCHIVE = previous;
    if (previousArchive === undefined) delete process.env.TELEPATHY_DSH_ARCHIVE;
    else process.env.TELEPATHY_DSH_ARCHIVE = previousArchive;
  }
});

test('pins, checks, builds, executes and reuses exact source under Bend', async t => {
  if (!reference) return t.skip('benchmark source is not integrated');
  const archiveRoot = await mkdtemp(path.join(os.tmpdir(), 'telepathy-dsh-test-'));
  const options = { workspaceRoot: benchmarkRoot, archiveRoot, timeoutMs: 30_000 };
  let first;
  try {
    first = await runCandidate(prediction, options);
  } catch (error) {
    if (/bend executable was not found/.test(String(error))) return t.skip('Bend is unavailable');
    throw error;
  }
  assert.equal(first.status, 'executed', first.error);
  assert.equal(first.observation.cache_hit, false);
  assert.equal(first.observation.check.ok, true);
  assert.equal(first.observation.build.ok, true);
  assert.match(first.compiler, /clang/i);
  assert.equal(first.observation.cases[0].observed.stdout, prediction.cases[0].predicted_stdout);
  assert.equal(first.observation.cases[0].prediction_match, true);
  assert.deepEqual(first.discrepancy, { check: false, build: false, cases: [] });
  assert.equal(digestOf(await readFile(path.join(archiveRoot, 'candidates', `${digest}.bend`))), digest);
  assert.equal(digestOf(await readFile(first.receipt_path)), first.receipt_sha256);

  const second = await runCandidate({ ...prediction,
    cases: [{ ...prediction.cases[0], predicted_stdout: 'wrong prediction\n' }],
  }, options);
  assert.equal(second.status, 'executed');
  assert.equal(second.observation.cache_hit, true);
  assert.equal(second.observation.check.cached, true);
  assert.equal(second.observation.check.exit_code, 0);
  assert.equal(second.observation.build.exit_code, 0);
  assert.equal(second.observation.check.origin_elapsed_ms, first.observation.check.elapsed_ms);
  assert.equal(second.compiler, first.compiler);
  assert.equal(second.observation.cases[0].prediction_match, false);
  assert.deepEqual(second.discrepancy.cases, ['batch-one']);
  assert.notEqual(first.receipt_id, second.receipt_id);
});

test('native candidate cannot read a private canary through Base.File.open', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'telepathy-dsh-canary-source-'));
  const archiveRoot = await mkdtemp(path.join(os.tmpdir(), 'telepathy-dsh-canary-archive-'));
  const privateRoot = await mkdtemp(path.join(os.tmpdir(), 'telepathy-dsh-private-'));
  const privateFile = path.join(privateRoot, 'canary.txt');
  const canary = `private-canary-${Date.now()}`;
  const source = `import Base\n\ndef show_read(pair: File & Result<&1, &1, U32 & String, String>) -> IO(Unit):\n  (handle, result) = pair\n  do IO<Unit>:\n    text : String <- IO.pass(String, result)\n    File.close(handle)\n    IO.print(text)\n\ndef main() -> IO(Unit):\n  do IO<Unit>:\n    file : File <- IO.try(File, File.open(${JSON.stringify(privateFile)}, "r"))\n    pair : File & Result<&1, &1, U32 & String, String> <- File.read(file, 128)\n    show_read(pair)\n`;
  await writeFile(privateFile, canary);
  await writeFile(path.join(workspaceRoot, 'candidate.bend'), source);
  try {
    const run = await runCandidate({ source: 'candidate.bend', source_sha256: digestOf(source),
      predict_check_pass: true, predict_build_pass: true,
      cases: [{ name: 'private-read', args: [], predicted_stdout: 'blocked\n' }],
    }, { workspaceRoot, archiveRoot, timeoutMs: 30_000 });
    assert.equal(run.observation?.check?.ok, true, JSON.stringify(run));
    assert.equal(run.observation?.build?.ok, true, JSON.stringify(run));
    assert.equal(run.status, 'run-failed', JSON.stringify(run));
    assert.equal(run.observation.cases[0].observed.ok, false);
    assert.equal(JSON.stringify(run.observation.cases[0].observed).includes(canary), false);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(archiveRoot, { recursive: true, force: true });
    await rm(privateRoot, { recursive: true, force: true });
  }
});

test('rejects a stale digest before checking or building', async t => {
  if (!reference) return t.skip('benchmark source is not integrated');
  const archiveRoot = await mkdtemp(path.join(os.tmpdir(), 'telepathy-dsh-stale-'));
  let result;
  try {
    result = await runCandidate({ ...prediction, source_sha256: '0'.repeat(64) }, { workspaceRoot: benchmarkRoot, archiveRoot });
  } catch (error) {
    if (/bend executable was not found/.test(String(error))) return t.skip('Bend is unavailable');
    throw error;
  }
  assert.equal(result.status, 'rejected');
  assert.match(result.error, /source digest changed before execution/);
  assert.equal(digestOf(await readFile(result.receipt_path)), result.receipt_sha256);
});

test('rejects a source symlink that leaves the workspace', async t => {
  if (!reference) return t.skip('benchmark source is not integrated');
  const root = await mkdtemp(path.join(os.tmpdir(), 'telepathy-dsh-root-'));
  const archiveRoot = await mkdtemp(path.join(os.tmpdir(), 'telepathy-dsh-archive-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'telepathy-dsh-outside-'));
  await mkdir(path.join(root, 'kernels'));
  await writeFile(path.join(outside, 'outside.bend'), reference);
  await symlink(path.join(outside, 'outside.bend'), path.join(root, 'kernels', 'escape.bend'));
  let result;
  try {
    result = await runCandidate({ ...prediction, source: 'kernels/escape.bend' }, { workspaceRoot: root, archiveRoot });
  } catch (error) {
    if (/bend executable was not found/.test(String(error))) return t.skip('Bend is unavailable');
    throw error;
  }
  assert.equal(result.status, 'rejected');
  assert.match(result.error, /symlink escapes workspace/);
});

test('host-pinned evaluator scores a source receipt independently', async t => {
  if (!reference) return t.skip('benchmark source is not integrated');
  const evaluatorPath = path.join(benchmarkRoot, 'benchmarks/core/run.mjs');
  const caseSetPath = path.join(benchmarkRoot, 'benchmarks/core/cases.json');
  let evaluator;
  let caseSet;
  try { evaluator = await readFile(evaluatorPath); caseSet = await readFile(caseSetPath); }
  catch (error) { if (error.code === 'ENOENT') return t.skip('benchmark files are in another integration workspace'); throw error; }
  const archiveRoot = await mkdtemp(path.join(os.tmpdir(), 'telepathy-dsh-score-'));
  let run;
  try { run = await runCandidate(prediction, { workspaceRoot: benchmarkRoot, archiveRoot, timeoutMs: 30_000 },
    { sessionId: 'score-own-session' }); }
  catch (error) { if (/bend executable was not found/.test(String(error))) return t.skip('Bend is unavailable'); throw error; }
  assert.equal(run.status, 'executed');
  const request = { receipt_id: run.receipt_id, receipt_sha256: run.receipt_sha256 };
  const settings = {
    archiveRoot, evaluatorPath, evaluatorSha256: digestOf(evaluator),
    caseSetPath, caseSetSha256: digestOf(caseSet), scoreTimeoutMs: 180_000,
  };
  await assert.rejects(scoreCandidate(request, settings, { sessionId: 'different-session' }),
    /another DSH session/);
  const score = await scoreCandidate(request, settings, { sessionId: 'score-own-session' });
  assert.equal(score.status, 'scored');
  assert.equal(score.source_sha256, digest);
  assert.equal(score.receipt_sha256, run.receipt_sha256);
  assert.equal(digestOf(await readFile(score.score_path)), score.score_sha256);
  assert.equal(score.coverage.total, score.cases.length);
  assert.equal(score.coverage.passed, 11);
});

test('selection requires a complete passing gain and pins session reads', async () => {
  const archiveRoot = await mkdtemp(path.join(os.tmpdir(), 'telepathy-dsh-select-'));
  await mkdir(path.join(archiveRoot, 'scores'));
  const evaluatorPath = path.join(archiveRoot, 'evaluator.mjs');
  const caseSetPath = path.join(archiveRoot, 'cases.json');
  await writeFile(evaluatorPath, 'host evaluator fixture\n');
  await writeFile(caseSetPath, 'host case set fixture\n');
  const evaluatorSha256 = digestOf(await readFile(evaluatorPath));
  const caseSetSha256 = digestOf(await readFile(caseSetPath));
  const settings = { archiveRoot, evaluatorPath, evaluatorSha256, caseSetPath, caseSetSha256 };
  const report = passes => ({ schema: 1, mode: 'receipt', evaluator_sha256: evaluatorSha256, case_set_sha256: caseSetSha256,
    toolchain: { bend_version: 'bend 2.0.21', target: 'darwin-arm64' },
    coverage: { total: 3, observed: 3, passed: passes, failed: 3 - passes }, ok: passes === 3,
    timing: { repeats: 2 },
    cases: ['one', 'two', 'three'].map((id, index) => ({ id, pass: index < passes })) });
  const save = async (passes, source) => {
    const value = { schema: 1, evaluator_sha256: evaluatorSha256, case_set_sha256: caseSetSha256,
      source_sha256: source.repeat(64), receipt_sha256: 'f'.repeat(64), report: report(passes) };
    const bytes = `${JSON.stringify(value)}\n`;
    const hash = digestOf(bytes);
    await writeFile(path.join(archiveRoot, 'scores', `${hash}.json`), bytes);
    return hash;
  };
  const baseline = await save(1, '1');
  const improved = await save(2, '2');
  const final = await save(3, '3');
  const old = await activeCandidate({ archiveRoot }, { sessionId: 'session-before-selection' });
  assert.equal(old.active, null);
  const partial = await selectCandidate({ candidate_score_sha256: improved,
    incumbent_score_sha256: baseline, expected_active_score_sha256: null }, settings);
  assert.equal(partial.status, 'rejected');
  assert.match(partial.reason, /complete passing/);
  const first = await selectCandidate({ candidate_score_sha256: final,
    incumbent_score_sha256: baseline, expected_active_score_sha256: null }, settings);
  assert.equal(first.status, 'selected');
  assert.deepEqual(first.gains, ['two', 'three']);
  const a = await activeCandidate({ archiveRoot }, { sessionId: 'session-a' });
  assert.equal(a.active.score_sha256, final);
  assert.equal((await activeCandidate({ archiveRoot }, { sessionId: 'session-before-selection' })).active, null);
  const rejected = await selectCandidate({ candidate_score_sha256: baseline,
    incumbent_score_sha256: final, expected_active_score_sha256: final }, settings);
  assert.equal(rejected.status, 'rejected');
  assert.match(rejected.reason, /complete passing/);
  assert.equal((await activeCandidate({ archiveRoot }, { sessionId: 'session-b' })).active.score_sha256, final);
  await assert.rejects(selectCandidate({ candidate_score_sha256: final,
    incumbent_score_sha256: baseline, expected_active_score_sha256: null }, settings), /active pointer changed/);
});

test('concurrent first reads publish one complete session pin', async () => {
  const archiveRoot = await mkdtemp(path.join(os.tmpdir(), 'telepathy-dsh-pin-race-'));
  await mkdir(path.join(archiveRoot, 'scores'));
  const source = 'a'.repeat(64);
  const receipt = 'b'.repeat(64);
  const scoreBytes = `${JSON.stringify({ source_sha256: source, receipt_sha256: receipt })}\n`;
  const score = digestOf(scoreBytes);
  await writeFile(path.join(archiveRoot, 'scores', `${score}.json`), scoreBytes);
  await writeFile(path.join(archiveRoot, 'active.json'), `${JSON.stringify({
    score_sha256: score, source_sha256: source, receipt_sha256: receipt,
    padding: 'x'.repeat(1024 * 1024),
  })}\n`);
  const reads = await Promise.all(Array.from({ length: 24 }, () =>
    activeCandidate({ archiveRoot }, { sessionId: 'simultaneous-session' })));
  assert.ok(reads.every(item => item.pinned_at_ms === reads[0].pinned_at_ms));
  assert.ok(reads.every(item => item.active.score_sha256 === score));
  const files = await readdir(path.join(archiveRoot, 'session-pins'));
  assert.equal(files.length, 1);
  const onDisk = JSON.parse(await readFile(path.join(archiveRoot, 'session-pins', files[0]), 'utf8'));
  assert.deepEqual(onDisk, reads[0]);
});

test('concurrent builds publish a complete shared manifest', async t => {
  if (!reference) return t.skip('benchmark source is not integrated');
  const archiveRoot = await mkdtemp(path.join(os.tmpdir(), 'telepathy-dsh-build-race-'));
  let runs;
  try {
    runs = await Promise.all(Array.from({ length: 3 }, () => runCandidate(prediction,
      { workspaceRoot: benchmarkRoot, archiveRoot, timeoutMs: 30_000 })));
  } catch (error) {
    if (/bend executable was not found/.test(String(error))) return t.skip('Bend is unavailable');
    throw error;
  }
  assert.ok(runs.every(run => run.status === 'executed'), runs.map(run => run.error).join('; '));
  const builds = await readdir(path.join(archiveRoot, 'builds'));
  assert.equal(builds.length, 1);
  const manifest = JSON.parse(await readFile(path.join(archiveRoot, 'builds', builds[0], 'manifest.json'), 'utf8'));
  assert.equal(manifest.source_sha256, digest);
  assert.equal(manifest.compiler, runs[0].compiler);
  assert.equal(manifest.check.exit_code, 0);
  assert.equal(manifest.build.exit_code, 0);
  assert.equal(digestOf(await readFile(path.join(archiveRoot, 'builds', builds[0], 'program'))), manifest.binary_sha256);
});

test('compiler identity changes the build cache key', async t => {
  if (!reference) return t.skip('benchmark source is not integrated');
  const archiveRoot = await mkdtemp(path.join(os.tmpdir(), 'telepathy-dsh-compiler-'));
  const bin = await mkdtemp(path.join(os.tmpdir(), 'telepathy-dsh-bin-'));
  const clangPath = path.join(bin, 'clang');
  const originalPath = process.env.PATH;
  const realClang = spawnSync('which', ['clang'], { encoding: 'utf8' }).stdout.trim();
  assert.ok(realClang);
  const realVersion = spawnSync(realClang, ['--version'], { encoding: 'utf8' }).stdout.trim().split('\n')[0];
  try {
    for (const identity of [`${realVersion} test-A`, `${realVersion} test-B`]) {
      await writeFile(clangPath, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "${identity}"; else exec ${realClang} "$@"; fi\n`);
      await chmod(clangPath, 0o755);
      process.env.PATH = `${bin}${path.delimiter}${originalPath}`;
      const run = await runCandidate(prediction, { workspaceRoot: benchmarkRoot, archiveRoot, timeoutMs: 30_000 });
      assert.equal(run.status, 'executed', JSON.stringify(run));
      assert.equal(run.compiler, identity);
      assert.equal(run.observation.cache_hit, false);
    }
  } finally { process.env.PATH = originalPath; }
  const builds = (await readdir(path.join(archiveRoot, 'builds'))).filter(name => !name.startsWith('.'));
  assert.equal(builds.length, 2);
});

test('an old linked binary without its manifest is quarantined and rebuilt', async t => {
  if (!reference) return t.skip('benchmark source is not integrated');
  const archiveRoot = await mkdtemp(path.join(os.tmpdir(), 'telepathy-dsh-orphan-'));
  const options = { workspaceRoot: benchmarkRoot, archiveRoot, timeoutMs: 30_000 };
  const first = await runCandidate(prediction, options);
  if (first.status === 'rejected' && /bend executable was not found/.test(first.error)) return t.skip('Bend is unavailable');
  assert.equal(first.status, 'executed', first.error);
  const buildsDir = path.join(archiveRoot, 'builds');
  const key = (await readdir(buildsDir)).find(name => !name.startsWith('.'));
  await rm(path.join(buildsDir, key, 'manifest.json'));
  const second = await runCandidate(prediction, options);
  assert.equal(second.status, 'executed', second.error);
  assert.equal(second.observation.cache_hit, false);
  const entries = await readdir(buildsDir);
  assert.ok(entries.some(name => name.startsWith(`.${key}-orphan-`)));
  assert.equal(digestOf(await readFile(path.join(buildsDir, key, 'program'))), second.binary_sha256);
});

test('a killed selector releases the OS lock and a fully passing score can bootstrap active', async () => {
  const archiveRoot = await mkdtemp(path.join(os.tmpdir(), 'telepathy-dsh-lock-'));
  await mkdir(path.join(archiveRoot, 'scores'));
  const evaluatorPath = path.join(archiveRoot, 'evaluator.mjs');
  const caseSetPath = path.join(archiveRoot, 'cases.json');
  await writeFile(evaluatorPath, 'pinned evaluator');
  await writeFile(caseSetPath, 'pinned cases');
  const evaluatorSha256 = digestOf(await readFile(evaluatorPath));
  const caseSetSha256 = digestOf(await readFile(caseSetPath));
  const score = { schema: 1, evaluator_sha256: evaluatorSha256, case_set_sha256: caseSetSha256,
    source_sha256: 'a'.repeat(64), receipt_sha256: 'b'.repeat(64),
    report: { schema: 1, mode: 'receipt', evaluator_sha256: evaluatorSha256, case_set_sha256: caseSetSha256,
      toolchain: { bend_version: 'bend test', compiler: 'clang test', target: `${process.platform}-${process.arch}` },
      coverage: { total: 1, observed: 1, passed: 1, failed: 0 }, ok: true, timing: { repeats: 1 },
      cases: [{ id: 'one', pass: true }] } };
  const bytes = `${JSON.stringify(score)}\n`;
  const digest = digestOf(bytes);
  await writeFile(path.join(archiveRoot, 'scores', `${digest}.json`), bytes);
  const dbPath = path.join(archiveRoot, 'active-lock.sqlite');
  const child = spawnSync(process.execPath, ['-e',
    'const {DatabaseSync}=require("node:sqlite"); const db=new DatabaseSync(process.argv[1]); db.exec("BEGIN IMMEDIATE"); process.kill(process.pid,"SIGKILL")', dbPath]);
  assert.equal(child.signal, 'SIGKILL');
  const selected = await selectCandidate({ candidate_score_sha256: digest,
    incumbent_score_sha256: null, expected_active_score_sha256: null },
    { archiveRoot, evaluatorPath, evaluatorSha256, caseSetPath, caseSetSha256 });
  assert.equal(selected.status, 'selected');
  assert.deepEqual(selected.gains, ['one']);
  assert.equal((await activeCandidate({ archiveRoot }, { sessionId: 'after-kill' })).active.score_sha256, digest);
});
