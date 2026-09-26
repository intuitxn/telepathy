import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { compileAlgorithmText } from './algorithm-language.mjs';
import { activeCandidate } from './core.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.env.TELEPATHY_DSH_TEST_ALLOW_UNSAFE_ARCHIVE = '1';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function execute(file, args, options) {
  return new Promise((resolve, reject) => execFile(file, args, { ...options, maxBuffer: 4 * 1024 * 1024,
    timeout: 120_000 }, (error, stdout, stderr) => error ? reject(new Error(`${error.message}\n${stderr}\n${stdout}`))
      : resolve({ stdout, stderr })));
}

test('keyless DSH session invokes the bounded pseudocode compiler', async t => {
  const cli = process.env.TELEPATHY_DSH_CLI_BIN;
  const llmModule = process.env.TELEPATHY_DSH_LLM_MODULE;
  if (!cli || !llmModule) return t.skip('set pinned DSH CLI and LLM module paths');
  const home = await mkdtemp(path.join(os.tmpdir(), 'telepathy-dsh-compile-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const source = 'algorithm counter\nstate total = 0\nstep total = add(total, 1)\nreturn total\n';
  const { stdout } = await execute(process.execPath,
    [cli, '--profile', 'headless', '--patch', 'runtime/dsh/headless-smoke.patch.yml', '--json',
      'Compile the bounded pseudocode.'],
    { cwd: repo, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? home,
      DSH_HOME: home, TELEPATHY_DSH_ARCHIVE: path.join(home, 'algorithms'),
      TELEPATHY_DSH_TEST_ALLOW_UNSAFE_ARCHIVE: '1', TELEPATHY_DSH_LLM_MODULE: llmModule,
      TELEPATHY_DSH_MOCK_COMPILE_SOURCE: source, TELEPATHY_DSH_WORKSPACE: repo } });
  const events = stdout.trim().split('\n').map(line => JSON.parse(line));
  const tool = events.find(row => row.type === 'tool_result' && row.callId === 'algorithm-compile-smoke');
  assert.equal(tool?.status, 'completed');
  assert.deepEqual(JSON.parse(tool.result), compileAlgorithmText(source));
  assert.equal(events.at(-1)?.type, 'final');
});

test('keyless DSH session runs, scores, selects and pins a new session', async t => {
  const cli = process.env.TELEPATHY_DSH_CLI_BIN;
  const llmModule = process.env.TELEPATHY_DSH_LLM_MODULE;
  if (!cli || !llmModule) return t.skip('set TELEPATHY_DSH_CLI_BIN and TELEPATHY_DSH_LLM_MODULE to a built pinned DSH clone');
  try { await execute(process.env.BEND_BIN ?? 'bend', ['version'], { env: { PATH: process.env.PATH ?? '/usr/bin:/bin' } }); }
  catch (error) { if (/ENOENT|not found/.test(String(error))) return t.skip('Bend is unavailable'); throw error; }
  const benchRoot = process.env.TELEPATHY_DSH_BENCHMARK_ROOT ?? repo;
  const evaluatorPath = path.join(benchRoot, 'benchmarks/core/run.mjs');
  const caseSetPath = path.join(benchRoot, 'benchmarks/core/cases.json');
  const referencePath = path.join(benchRoot, 'benchmarks/core/reference.bend');
  let evaluator, cases, reference;
  try { evaluator = await readFile(evaluatorPath); cases = await readFile(caseSetPath); reference = await readFile(referencePath); }
  catch (error) { if (error.code === 'ENOENT') return t.skip('benchmark files are not integrated'); throw error; }
  const home = await mkdtemp(path.join(os.tmpdir(), 'telepathy-dsh-headless-'));
  const archiveRoot = path.join(home, 'algorithms');
  const settings = { archiveRoot, evaluatorPath, evaluatorSha256: sha256(evaluator),
    caseSetPath, caseSetSha256: sha256(cases) };
  const baseEnv = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? home,
    DSH_HOME: home, TELEPATHY_DSH_ARCHIVE: archiveRoot, TELEPATHY_DSH_LLM_MODULE: llmModule,
    TELEPATHY_DSH_TEST_ALLOW_UNSAFE_ARCHIVE: '1',
    TELEPATHY_DSH_EVALUATOR: evaluatorPath, TELEPATHY_DSH_EVALUATOR_SHA256: settings.evaluatorSha256,
    TELEPATHY_DSH_CASE_SET: caseSetPath, TELEPATHY_DSH_CASE_SET_SHA256: settings.caseSetSha256 };
  const runSession = async (workspace, source, digest, args, predicted, selectIncumbent, executeActive = false) => {
    const { stdout } = await execute(process.execPath,
      [cli, '--profile', 'headless', '--patch', 'runtime/dsh/headless-smoke.patch.yml', '--json',
        'Run the exact Bend candidate and score it against the host case set.'],
      { cwd: repo, env: { ...baseEnv, TELEPATHY_DSH_WORKSPACE: workspace,
        TELEPATHY_DSH_MOCK_SOURCE: source, TELEPATHY_DSH_MOCK_SOURCE_SHA256: digest,
        TELEPATHY_DSH_MOCK_CASE_ARGS: JSON.stringify(args), TELEPATHY_DSH_MOCK_PREDICTED_STDOUT: predicted,
        TELEPATHY_DSH_MOCK_SELECT: selectIncumbent === undefined ? '0' : '1',
        TELEPATHY_DSH_MOCK_INCUMBENT_SHA256: selectIncumbent ?? '',
        TELEPATHY_DSH_MOCK_EXECUTE: executeActive ? '1' : '0' } });
    const events = stdout.trim().split('\n').map(line => JSON.parse(line));
    const session = events.find(row => row.type === 'session');
    assert.ok(session?.sessionId);
    assert.equal(events.at(-1)?.type, 'final');
    const result = tool => {
      const event = events.find(row => row.type === 'tool_result' && row.callId === `${tool}-smoke`);
      assert.equal(event?.status, 'completed', `${tool} did not complete`);
      return JSON.parse(event.result);
    };
    return { sessionId: session.sessionId, active: result('algorithm-active'),
      run: executeActive ? null : result('algorithm-run'),
      score: executeActive ? null : result('algorithm-score'),
      select: selectIncumbent === undefined ? null : result('algorithm-select'),
      execute: executeActive ? result('algorithm-execute') : null, events };
  };
  const baselineRoot = await mkdtemp(path.join(os.tmpdir(), 'telepathy-dsh-baseline-'));
  const baseline = reference.toString('utf8').replace(
    /def dispatch_args\(args: List<String>\) -> IO\(Unit\):[\s\S]*?(?=\ndef main\(\) -> IO\(Unit\):)/,
    'def dispatch_args(args: List<String>) -> IO(Unit):\n  IO.print("baseline")\n\n');
  assert.notEqual(baseline, reference.toString('utf8'));
  await writeFile(path.join(baselineRoot, 'baseline.bend'), baseline);
  const incumbent = await runSession(baselineRoot, 'baseline.bend', sha256(baseline),
    ['batch', '1'], 'baseline\n');
  assert.equal(incumbent.active.active, null);
  assert.equal(incumbent.run.status, 'executed');
  assert.equal(incumbent.score.coverage.total, 11);
  assert.equal(incumbent.score.coverage.passed, 0);
  const candidate = await runSession(benchRoot, 'benchmarks/core/reference.bend', sha256(reference),
    ['batch', '256'], 'clock=256;value=768\n', incumbent.score.score_sha256);
  assert.equal(candidate.run.status, 'executed');
  assert.equal(candidate.score.coverage.passed, 11);
  assert.equal(candidate.select.status, 'selected');
  assert.equal(candidate.select.gains.length, 11);
  assert.equal((await activeCandidate(settings, { sessionId: incumbent.sessionId })).active, null);
  const next = await runSession(benchRoot, 'benchmarks/core/reference.bend', sha256(reference),
    ['batch', '256'], 'clock=256;value=768\n', undefined, true);
  assert.equal(next.active.active.score_sha256, candidate.score.score_sha256);
  assert.equal(next.execute.status, 'executed');
  assert.equal(next.execute.binary_sha256, candidate.run.binary_sha256);
  assert.equal(next.execute.observed.stdout, 'clock=256;value=768\n');
});
