import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runBenchmark } from './run.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, 'reference.bend');
const executionPolicy = process.platform === 'darwin' ? 'darwin-seatbelt-isolated-read-v2' : 'linux-bwrap-isolated-read-v2';
const bendVersion = spawnSync(process.env.BEND_BINARY ?? 'bend', ['version'], { encoding: 'utf8' }).stdout.trim().split('\n')[0];
const target = `${process.platform}-${process.arch}`;
const temp = mkdtempSync(join(tmpdir(), 'telepathy-core-bench-test-'));
const compiler = spawnSync('clang', ['--version'], { encoding: 'utf8' }).stdout.trim().split('\n')[0];

function manifest(name, cases) {
  const path = join(temp, `${name}.json`);
  writeFileSync(path, JSON.stringify({ version: 1, name, cases }) + '\n');
  return path;
}

const predictionCase = {
  id: 'prediction-correct', category: 'prediction', args: ['predict', '2', '3', '0'], items: 1,
  expect: { exit: 0, stdout: 'predicted=5;observed=5;error=0\n', stderr: '' },
};

test('reference kernel checks, builds, executes all cases, and reuses exact cache', () => {
  const args = ['--source', source, '--cases', join(here, 'cases.json'), '--cache-dir', join(temp, 'cache'), '--repeat', '2'];
  const first = runBenchmark(args);
  assert.equal(first.ok, true);
  assert.deepEqual(first.coverage, { total: 11, observed: 11, passed: 11, failed: 0 });
  assert.equal(first.timing.cache_hit, false);
  assert.ok(first.timing.check_ms > 0 && first.timing.build_ms > 0 && first.timing.runtime_ms > 0);
  assert.ok(first.timing.warm_batch_items_per_second > 0);
  const second = runBenchmark(args);
  assert.equal(second.ok, true);
  assert.equal(second.timing.cache_hit, true);
  assert.equal(second.timing.build_ms, 0);
  assert.equal(second.source_sha256, first.source_sha256);
  assert.equal(second.binary_sha256, first.binary_sha256);
});

test('independent evaluator cannot read a private canary or inherit host secrets', () => {
  const privateRoot = mkdtempSync(join(tmpdir(), 'telepathy-eval-private-'));
  const privateFile = join(privateRoot, 'canary.txt');
  const canary = `evaluator-private-canary-${Date.now()}`;
  const environmentSecret = `evaluator-environment-secret-${Date.now()}`;
  const oldEnvironmentSecret = process.env.TELEPATHY_NATIVE_TEST_SECRET;
  writeFileSync(privateFile, canary);
  const readSource = `import Base\n\ndef show_read(pair: File & Result<&1, &1, U32 & String, String>) -> IO(Unit):\n  (handle, result) = pair\n  do IO<Unit>:\n    text : String <- IO.pass(String, result)\n    File.close(handle)\n    IO.print(text)\n\ndef main() -> IO(Unit):\n  do IO<Unit>:\n    file : File <- IO.try(File, File.open(${JSON.stringify(privateFile)}, "r"))\n    pair : File & Result<&1, &1, U32 & String, String> <- File.read(file, 128)\n    show_read(pair)\n`;
  const environmentSource = `import Base\n\ndef main() -> IO(Unit):\n  do IO<Unit>:\n    value : String <- IO.try(String, IO.get_env("TELEPATHY_NATIVE_TEST_SECRET"))\n    IO.print(value)\n`;
  try {
    process.env.TELEPATHY_NATIVE_TEST_SECRET = environmentSecret;
    for (const [name, sourceText, secret] of [
      ['private-file', readSource, canary], ['private-environment', environmentSource, environmentSecret],
    ]) {
      const sourcePath = join(temp, `${name}.bend`);
      writeFileSync(sourcePath, sourceText);
      const report = runBenchmark(['--source', sourcePath, '--cases', manifest(name, [{
        id: name, category: 'confidentiality', args: [], items: 1,
        expect: { exit: 0, stdout: `${secret}\n`, stderr: '' },
      }]), '--cache-dir', join(temp, `${name}-cache`), '--repeat', '1']);
      assert.equal(report.ok, false);
      assert.equal(report.cases[0].observed.stdout.includes(secret), false);
      assert.equal(report.cases[0].observed.stderr.includes(secret), false);
      assert.notEqual(report.cases[0].observed.exit, 0);
    }
  } finally {
    if (oldEnvironmentSecret === undefined) delete process.env.TELEPATHY_NATIVE_TEST_SECRET;
    else process.env.TELEPATHY_NATIVE_TEST_SECRET = oldEnvironmentSecret;
    rmSync(privateRoot, { recursive: true, force: true });
  }
});

test('evaluator rejects local candidate imports before check and build', () => {
  const candidate = join(temp, 'local-import.bend');
  writeFileSync(candidate, 'import "./extra.bend"\n\ndef main() -> IO(Unit):\n  IO.print("wrong")\n');
  assert.throws(() => runBenchmark(['--source', candidate, '--cases', manifest('local-import', [predictionCase])]),
    /only Base imports are allowed/);
});

test('concurrent scorer processes publish one complete build and reuse the winner', async () => {
  const cache = join(temp, 'concurrent-cache');
  const cases = manifest('concurrent-one-case', [predictionCase]);
  const args = [join(here, 'run.mjs'), '--source', source, '--cases', cases,
    '--cache-dir', cache, '--repeat', '1'];
  const run = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { env: process.env });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
  const results = await Promise.all(Array.from({ length: 5 }, run));
  const reports = results.map(({ code, stdout, stderr }) => {
    assert.equal(code, 0, `${stderr}\n${stdout}`);
    assert.equal(stdout.trim().split('\n').length, 1);
    const report = JSON.parse(stdout);
    assert.equal(report.ok, true);
    return report;
  });
  assert.equal(reports.filter(report => !report.timing.cache_hit).length, 1);
  assert.equal(new Set(reports.map(report => report.binary_sha256)).size, 1);
  const directories = readdirSync(cache).filter(name => !name.startsWith('.'));
  assert.equal(directories.length, 1);
  const entry = join(cache, directories[0]);
  const manifestRecord = JSON.parse(readFileSync(join(entry, 'build.json'), 'utf8'));
  assert.equal(manifestRecord.binary_sha256,
    createHash('sha256').update(readFileSync(join(entry, 'program'))).digest('hex'));
});

test('exact output regression fails', () => {
  const bad = { ...predictionCase, expect: { ...predictionCase.expect, stdout: 'predicted=6;observed=6;error=0\n' } };
  const report = runBenchmark(['--source', source, '--cases', manifest('wrong-output', [bad]), '--cache-dir', join(temp, 'cache'), '--repeat', '1']);
  assert.equal(report.ok, false);
  assert.equal(report.coverage.failed, 1);
  assert.match(report.cases[0].failures.join(' '), /stdout mismatch/);
});

test('PASS text cannot hide a nonzero process exit', () => {
  const caseWithLie = {
    id: 'failing-process', category: 'exit-status', args: ['fail'], items: 1,
    expect: { exit: 0, stdout: 'PASS\n', stderr: 'intentional failure\n' },
  };
  const report = runBenchmark(['--source', source, '--cases', manifest('nonzero-exit', [caseWithLie]), '--cache-dir', join(temp, 'cache'), '--repeat', '1']);
  assert.equal(report.ok, false);
  assert.match(report.cases[0].failures.join(' '), /exit 7 != 0/);
});

test('CLI emits one parseable report and nonzero status on regression', () => {
  const casePath = manifest('cli-nonzero', [{
    id: 'failing-process', category: 'exit-status', args: ['fail'], items: 1,
    expect: { exit: 0, stdout: 'PASS\n', stderr: 'intentional failure\n' },
  }]);
  const child = spawnSync(process.execPath, [join(here, 'run.mjs'), '--source', source,
    '--cases', casePath, '--cache-dir', join(temp, 'cache'), '--repeat', '1'], { encoding: 'utf8' });
  assert.equal(child.status, 1);
  assert.equal(child.stderr, '');
  assert.equal(child.stdout.trim().split('\n').length, 1);
  const report = JSON.parse(child.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.cases[0].observed.exit, 7);
});

test('receipt scoring binds archived source and independent case expectations', () => {
  const bytes = readFileSync(source);
  const expected = predictionCase.expect.stdout;
  const receipt = {
    schema: 1,
    source_sha256: createHash('sha256').update(bytes).digest('hex'),
    source_bytes: bytes.length,
    bend_version: bendVersion,
    compiler,
    execution_policy: executionPolicy,
    target,
    binary_sha256: 'a'.repeat(64),
    observation: {
      cache_hit: false,
      check: { ok: true, exit_code: 0, timed_out: false, aborted: false, stdout: 'All terms check.\n', stderr: '', elapsed_ms: 2 },
      build: { ok: true, exit_code: 0, timed_out: false, aborted: false, stdout: '', stderr: '', elapsed_ms: 5 },
      cases: [{ name: predictionCase.id, args: predictionCase.args, predicted_stdout: 'wrong prediction\n',
        observed: { ok: true, exit_code: 0, timed_out: false, aborted: false, stdout: expected, stderr: '', elapsed_ms: 3 } }],
    },
  };
  const receiptPath = join(temp, 'receipt.json');
  const casePath = manifest('receipt-cases', [predictionCase]);
  const args = ['--source', source, '--cases', casePath, '--receipt', receiptPath];
  writeFileSync(receiptPath, JSON.stringify(receipt) + '\n');
  const pass = runBenchmark(args);
  assert.equal(pass.ok, true);
  assert.equal(pass.mode, 'receipt');
  assert.equal(pass.cases[0].prediction.matches_observation, false);
  assert.equal(pass.cases[0].prediction.matches_expected, false);

  receipt.observation.cases[0].observed.stdout = 'wrong result\n';
  writeFileSync(receiptPath, JSON.stringify(receipt) + '\n');
  const failed = runBenchmark(args);
  assert.equal(failed.ok, false);
  assert.match(failed.cases[0].failures.join(' '), /receipt observation differs from independent replay/);

  receipt.observation.cases[0].observed.stdout = expected;
  writeFileSync(receiptPath, JSON.stringify(receipt) + '\n');
  const heldOut = runBenchmark(['--source', source, '--cases', manifest('held-out', [{
    id: 'replay-prefix', category: 'causal-replay', args: ['replay', '2', '2', '3', '4'], items: 2,
    expect: { exit: 0, stdout: 'clock=2;value=5\n', stderr: '' },
  }]), '--receipt', receiptPath]);
  assert.equal(heldOut.ok, true);
  assert.equal(heldOut.receipt_case_overlap, 0);

  receipt.compiler = 'unrelated clang build';
  writeFileSync(receiptPath, JSON.stringify(receipt) + '\n');
  assert.throws(() => runBenchmark(args), /receipt toolchain differs/);
  receipt.compiler = compiler;

  receipt.source_sha256 = 'b'.repeat(64);
  writeFileSync(receiptPath, JSON.stringify(receipt) + '\n');
  assert.throws(() => runBenchmark(args), /source digest\/size/);
});

test('unsubstantiated cached check is rejected', () => {
  const bytes = readFileSync(source);
  const receipt = {
    schema: 1,
    source_sha256: createHash('sha256').update(bytes).digest('hex'),
    source_bytes: bytes.length,
    bend_version: bendVersion, compiler, execution_policy: executionPolicy,
    target, binary_sha256: 'a'.repeat(64),
    observation: { cache_hit: true, check: { ok: true, cached: true }, build: { ok: true, cached: true }, cases: [] },
  };
  const receiptPath = join(temp, 'forged-cache.json');
  writeFileSync(receiptPath, JSON.stringify(receipt) + '\n');
  assert.throws(() => runBenchmark(['--source', source, '--cases', manifest('one-case', [predictionCase]), '--receipt', receiptPath]), /check did not pass/);
});

test('cached receipt requires its original successful check and build evidence', () => {
  const bytes = readFileSync(source);
  const receipt = {
    schema: 1,
    source_sha256: createHash('sha256').update(bytes).digest('hex'), source_bytes: bytes.length,
    bend_version: bendVersion, compiler, execution_policy: executionPolicy,
    target, binary_sha256: 'a'.repeat(64),
    observation: {
      cache_hit: true,
      check: { ok: true, cached: true, exit_code: 0, timed_out: false, aborted: false,
        stdout: 'All terms check.\n', stderr: '', elapsed_ms: 0, origin_elapsed_ms: 2 },
      build: { ok: true, cached: true, exit_code: 0, timed_out: false, aborted: false,
        stdout: '', stderr: '', elapsed_ms: 0, origin_elapsed_ms: 5 },
      cases: [],
    },
  };
  const receiptPath = join(temp, 'verified-cache.json');
  writeFileSync(receiptPath, JSON.stringify(receipt) + '\n');
  const report = runBenchmark(['--source', source, '--cases', manifest('cached-one-case', [predictionCase]), '--receipt', receiptPath]);
  assert.equal(report.ok, true);
  assert.equal(report.receipt_timing.cache_hit, true);
  assert.ok(report.timing.check_ms > 0); // independent recheck, regardless of prior cache
});

test.after(() => rmSync(temp, { recursive: true, force: true }));
