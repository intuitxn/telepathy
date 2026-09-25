#!/usr/bin/env node
// Independent, exact-output scorer for executable Bend candidates.
// A receipt is an observation to verify, never an authority for expected results.

import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const evaluatorSha256 = sha256(readFileSync(fileURLToPath(import.meta.url)));
const MAX_OUTPUT = 8 * 1024 * 1024;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function options(argv) {
  const out = {
    source: join(here, 'reference.bend'),
    cases: join(here, 'cases.json'),
    cacheDir: join(tmpdir(), 'telepathy-core-bench-cache'),
    repeat: 2,
    timeoutMs: 120000,
    receipt: null,
  };
  const names = new Map([
    ['--source', 'source'], ['--cases', 'cases'], ['--cache-dir', 'cacheDir'],
    ['--repeat', 'repeat'], ['--timeout-ms', 'timeoutMs'], ['--receipt', 'receipt'],
  ]);
  for (let i = 0; i < argv.length; i++) {
    const name = names.get(argv[i]);
    assert(name && i + 1 < argv.length, `unknown or incomplete option: ${argv[i]}`);
    const value = argv[++i];
    out[name] = name === 'repeat' || name === 'timeoutMs' ? Number(value) : value;
  }
  assert(Number.isSafeInteger(out.repeat) && out.repeat >= 1 && out.repeat <= 20, 'repeat must be 1..20');
  assert(Number.isSafeInteger(out.timeoutMs) && out.timeoutMs >= 1 && out.timeoutMs <= 600000, 'timeout-ms must be 1..600000');
  out.source = resolve(out.source);
  out.cases = resolve(out.cases);
  out.cacheDir = resolve(out.cacheDir);
  if (out.receipt) out.receipt = resolve(out.receipt);
  assert(out.source.endsWith('.bend'), 'source must be a .bend file');
  return out;
}

function readCases(path) {
  const bytes = readFileSync(path);
  const manifest = JSON.parse(bytes.toString('utf8'));
  assert(manifest && manifest.version === 1 && Array.isArray(manifest.cases) && manifest.cases.length > 0, 'invalid case manifest');
  const names = new Set();
  for (const c of manifest.cases) {
    assert(typeof c.id === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(c.id) && !names.has(c.id), 'case ids must be unique lowercase slugs');
    names.add(c.id);
    assert(typeof c.category === 'string' && c.category.length > 0, `${c.id}: missing category`);
    assert(Array.isArray(c.args) && c.args.every(a => typeof a === 'string'), `${c.id}: args must be strings`);
    assert(Number.isSafeInteger(c.items) && c.items > 0, `${c.id}: items must be positive`);
    assert(c.expect && Number.isSafeInteger(c.expect.exit) && c.expect.exit >= 0 && c.expect.exit <= 255, `${c.id}: invalid expected exit`);
    assert(typeof c.expect.stdout === 'string' && typeof c.expect.stderr === 'string', `${c.id}: expected stdout/stderr must be exact strings`);
  }
  return { manifest, digest: sha256(bytes) };
}

// Only a self-contained Base-only source can be scored from a one-file archive.
function sourceClosure(entry) {
  const root = dirname(entry);
  const seen = new Set();
  const files = [];
  function visit(path) {
    const file = realpathSync(path);
    if (seen.has(file)) return;
    seen.add(file);
    const bytes = readFileSync(file);
    files.push({ file, path: relative(root, file), digest: sha256(bytes), bytes });
    const text = bytes.toString('utf8');
    for (const match of text.matchAll(/^\s*import\s+([^\s#]+)/gm)) {
      assert(match[1] === 'Base', `only Base imports are allowed in ${file}`);
    }
    const importLines = text.match(/^\s*import\s+[^\n]+$/gm) ?? [];
    const matched = [...text.matchAll(/^\s*import\s+Base\s*$/gm)].length;
    assert(importLines.length === matched, `unsupported import in ${file}; benchmark does not fetch packages`);
  }
  visit(entry);
  files.sort((a, b) => a.path.localeCompare(b.path));
  const closure = createHash('sha256');
  for (const f of files) closure.update(f.path).update('\0').update(f.digest).update('\0');
  return { sourceSha256: files.find(f => f.file === realpathSync(entry)).digest, closureSha256: closure.digest('hex'), files };
}

function runProcess(command, args, cwd, timeoutMs) {
  const start = process.hrtime.bigint();
  const result = spawnSync(command, args, {
    cwd, encoding: 'utf8', timeout: timeoutMs, maxBuffer: MAX_OUTPUT,
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: '/nonexistent', BEND_NO_TELEMETRY: '1' },
  });
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  return {
    exit: result.status,
    signal: result.signal,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    elapsed_ms: elapsedMs,
    error: result.error?.message ?? null,
  };
}

function seatbeltProfile(binary) {
  const literals = [];
  for (let current = binary; ; current = dirname(current)) {
    literals.push(`(literal ${JSON.stringify(current)})`);
    if (current === dirname(current)) break;
  }
  return `(version 1) (allow default) (deny file-read*) (deny file-write*) (deny network*) ` +
    `(allow file-read* ${literals.join(' ')} (subpath "/System/Library") ` +
    `(subpath "/usr/lib") (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random"))`;
}

function linuxNativeArgs(binary, args) {
  const mounts = ['--tmpfs', '/', '--dev', '/dev', '--proc', '/proc', '--dir', '/usr'];
  for (const directory of ['/lib', '/lib64', '/usr/lib', '/usr/lib64']) {
    if (existsSync(directory)) mounts.push('--ro-bind', directory, directory);
  }
  return ['--unshare-all', '--die-with-parent', '--new-session', '--clearenv',
    '--setenv', 'HOME', '/', '--setenv', 'PATH', '/usr/bin:/bin', ...mounts,
    '--ro-bind', binary, '/program', '--chdir', '/', '--', '/program', ...args];
}
function nativePolicy() {
  if (process.platform === 'darwin') return 'darwin-seatbelt-isolated-read-v2';
  if (process.platform === 'linux') return 'linux-bwrap-isolated-read-v2';
  throw new Error('native benchmark execution requires a supported OS sandbox');
}
function runNative(binary, args, cwd, timeoutMs) {
  const resolved = realpathSync(binary);
  if (process.platform === 'darwin') {
    return runProcess('/usr/bin/sandbox-exec', ['-p', seatbeltProfile(resolved), '--', resolved, ...args], cwd, timeoutMs);
  }
  if (process.platform === 'linux') {
    return runProcess('bwrap', linuxNativeArgs(resolved, args), cwd, timeoutMs);
  }
  throw new Error('native benchmark execution requires a supported OS sandbox');
}

function toolchain(timeoutMs) {
  const bend = process.env.BEND_BINARY || 'bend';
  const b = runProcess(bend, ['version'], process.cwd(), timeoutMs);
  assert(b.exit === 0 && b.stdout.trim().startsWith('bend '), `bend version failed: ${b.stderr || b.error}`);
  const clang = runProcess('clang', ['--version'], process.cwd(), timeoutMs);
  assert(clang.exit === 0, `clang version failed: ${clang.stderr || clang.error}`);
  return {
    bend,
    bend_version: b.stdout.trim().split('\n')[0],
    compiler: clang.stdout.trim().split('\n')[0],
    target: `${process.platform}-${process.arch}`,
    execution_policy: nativePolicy(),
  };
}

function checkedAndBuilt(config, source) {
  const tools = toolchain(config.timeoutMs);
  const check = runProcess(tools.bend, [config.source, '--check-only'], dirname(config.source), config.timeoutMs);
  assert(check.exit === 0 && !check.error && /(?:^|\n)All terms check\.(?:\n|$)/.test(check.stdout),
    `Bend check failed (exit ${check.exit}): ${check.stderr || check.stdout || check.error}`);

  const key = sha256(`${source.closureSha256}\0${tools.bend_version}\0${tools.compiler}\0${tools.target}`);
  const finalDir = join(config.cacheDir, key);
  const binary = join(finalDir, 'program');
  const metaPath = join(finalDir, 'build.json');
  const validRecord = () => {
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
      return meta.key === key && /^[a-f0-9]{64}$/.test(meta.binary_sha256) &&
        statSync(binary).isFile() && sha256(readFileSync(binary)) === meta.binary_sha256 ? meta : null;
    } catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes(error.code) || error instanceof SyntaxError) return null;
      throw error;
    }
  };
  mkdirSync(config.cacheDir, { recursive: true, mode: 0o700 });
  // A DB transaction is an OS-released lock across scorer processes. The
  // winner publishes an already complete directory; waiters verify and reuse
  // it. A killed writer leaves only its private staging directory.
  const db = new DatabaseSync(join(config.cacheDir, '.cache-lock.sqlite'));
  let transaction = false;
  let cacheHit = false;
  let buildMs = 0;
  try {
    db.exec(`PRAGMA busy_timeout=${Math.min(config.timeoutMs + 30_000, 630_000)}`);
    db.exec('BEGIN IMMEDIATE');
    transaction = true;
    cacheHit = validRecord() !== null;
    if (!cacheHit) {
      // An incomplete directory from an older scorer is preserved for audit.
      // Never delete a valid published cache entry.
      if (existsSync(finalDir)) renameSync(finalDir, join(config.cacheDir, `.${key}-orphan-${randomUUID()}`));
      const tempDir = mkdtempSync(join(config.cacheDir, `.${key}-${process.pid}-`));
      try {
        const built = runProcess(tools.bend, [config.source, '-o', join(tempDir, 'program')], dirname(config.source), config.timeoutMs);
        buildMs = built.elapsed_ms;
        assert(built.exit === 0 && !built.error && existsSync(join(tempDir, 'program')),
          `Bend build failed (exit ${built.exit}): ${built.stderr || built.stdout || built.error}`);
        assert(sourceClosure(config.source).closureSha256 === source.closureSha256,
          'source changed during build');
        const binarySha256 = sha256(readFileSync(join(tempDir, 'program')));
        writeFileSync(join(tempDir, 'build.json'), JSON.stringify({ key, binary_sha256: binarySha256 }) + '\n', { mode: 0o600 });
        renameSync(tempDir, finalDir);
        assert(validRecord() !== null, 'published build cache failed integrity check');
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    }
    db.exec('COMMIT');
    transaction = false;
  } finally {
    if (transaction) db.exec('ROLLBACK');
    db.close();
  }
  return { tools, checkMs: check.elapsed_ms, buildMs, cacheHit, binary, binarySha256: sha256(readFileSync(binary)) };
}

function compare(observed, expected) {
  const failures = [];
  if (observed.error) failures.push(`process error: ${observed.error}`);
  if (observed.signal) failures.push(`signal: ${observed.signal}`);
  if (observed.exit !== expected.exit) failures.push(`exit ${observed.exit} != ${expected.exit}`);
  if (observed.stdout !== expected.stdout) failures.push(`stdout mismatch: expected ${JSON.stringify(expected.stdout)}, got ${JSON.stringify(observed.stdout)}`);
  if (observed.stderr !== expected.stderr) failures.push(`stderr mismatch: expected ${JSON.stringify(expected.stderr)}, got ${JSON.stringify(observed.stderr)}`);
  return failures;
}

function baseReport(mode, source, cases) {
  return {
    schema: 1, mode, ok: false, passed: false,
    source_sha256: source.sourceSha256,
    source_closure_sha256: source.closureSha256,
    evaluator_sha256: evaluatorSha256,
    case_set_sha256: cases.digest,
    coverage: { total: cases.manifest.cases.length, observed: 0, passed: 0, failed: 0 },
    cases: [],
  };
}

function finish(report) {
  report.coverage.observed = report.cases.length;
  report.coverage.passed = report.cases.filter(c => c.pass).length;
  report.coverage.failed = report.coverage.total - report.coverage.passed;
  report.ok = report.coverage.observed === report.coverage.total && report.coverage.failed === 0;
  report.passed = report.ok;
  return report;
}

function execute(config, source, cases) {
  const report = baseReport('execute', source, cases);
  const build = checkedAndBuilt(config, source);
  assert(sourceClosure(config.source).closureSha256 === source.closureSha256, 'source changed during check/build');
  report.toolchain = { bend_version: build.tools.bend_version, compiler: build.tools.compiler,
    target: build.tools.target, execution_policy: build.tools.execution_policy };
  report.binary_sha256 = build.binarySha256;
  let coldMs = 0;
  let warmMs = 0;
  let runtimeMs = 0;
  let totalItems = 0;
  let warmBatchMs = 0;
  let warmBatchItems = 0;
  for (const c of cases.manifest.cases) {
    const samples = [];
    const failures = [];
    let firstObserved = null;
    for (let i = 0; i < config.repeat; i++) {
      const observed = runNative(build.binary, c.args, tmpdir(), config.timeoutMs);
      if (i === 0) firstObserved = { exit: observed.exit, signal: observed.signal, stdout: observed.stdout, stderr: observed.stderr };
      samples.push(observed.elapsed_ms);
      failures.push(...compare(observed, c.expect).map(reason => `repeat ${i + 1}: ${reason}`));
      if (report.cases.length === 0 && i === 0) coldMs = observed.elapsed_ms;
      else warmMs += observed.elapsed_ms;
      if (c.category === 'throughput' && i > 0) {
        warmBatchMs += observed.elapsed_ms;
        warmBatchItems += c.items;
      }
      runtimeMs += observed.elapsed_ms;
      totalItems += c.items;
    }
    report.cases.push({ id: c.id, category: c.category, args: c.args, items: c.items,
      pass: failures.length === 0, failures, observed: firstObserved, elapsed_ms: samples });
  }
  report.timing = {
    check_ms: build.checkMs, build_ms: build.buildMs, cache_hit: build.cacheHit,
    cold_run_ms: coldMs, warm_run_ms: warmMs, runtime_ms: runtimeMs,
    runtime_items: totalItems, items_per_second: runtimeMs > 0 ? totalItems * 1000 / runtimeMs : null,
    warm_batch_items: warmBatchItems,
    warm_batch_items_per_second: warmBatchMs > 0 ? warmBatchItems * 1000 / warmBatchMs : null,
    repeats: config.repeat,
  };
  assert(sourceClosure(config.source).closureSha256 === source.closureSha256, 'source changed during execution');
  return finish(report);
}

function scoreReceipt(config, source, cases) {
  assert(source.files.length === 1, 'receipt mode requires one self-contained Bend file');
  const raw = readFileSync(config.receipt);
  const receipt = JSON.parse(raw.toString('utf8'));
  assert(receipt.schema === 1 && receipt.observation && Array.isArray(receipt.observation.cases), 'invalid algorithm_run receipt');
  assert(receipt.source_sha256 === source.sourceSha256 && receipt.source_bytes === source.files[0].bytes.length,
    'receipt source digest/size does not match archived candidate');
  assert(typeof receipt.bend_version === 'string' && typeof receipt.compiler === 'string' && receipt.compiler.length > 0 &&
    receipt.execution_policy === nativePolicy() &&
    typeof receipt.target === 'string' && /^[a-f0-9]{64}$/.test(receipt.binary_sha256),
    'receipt lacks toolchain/build identity');
  const check = receipt.observation.check;
  assert(check && check.ok === true && check.exit_code === 0 && check.timed_out === false && check.aborted === false &&
    /(?:^|\n)All terms check\.(?:\n|$)/.test(check.stdout), 'receipt Bend check did not pass');
  const build = receipt.observation.build;
  assert(build && build.ok === true && build.exit_code === 0 && build.timed_out === false && build.aborted === false,
    'receipt Bend build did not pass');
  assert(Number.isFinite(check.elapsed_ms) && check.elapsed_ms >= 0 &&
    Number.isFinite(build.elapsed_ms) && build.elapsed_ms >= 0, 'receipt check/build timings invalid');
  if (receipt.observation.cache_hit) {
    assert(check.cached === true && build.cached === true &&
      Number.isFinite(check.origin_elapsed_ms) && check.origin_elapsed_ms >= 0 &&
      Number.isFinite(build.origin_elapsed_ms) && build.origin_elapsed_ms >= 0,
    'cached receipt lacks original successful check/build observations');
  }
  const report = execute(config, source, cases);
  report.mode = 'receipt';
  report.receipt_sha256 = sha256(raw);
  assert(report.toolchain.bend_version === receipt.bend_version && report.toolchain.compiler === receipt.compiler &&
    report.toolchain.execution_policy === receipt.execution_policy &&
    report.toolchain.target === receipt.target,
    'receipt toolchain differs from independent evaluator toolchain');
  report.receipt_binary_sha256 = receipt.binary_sha256;
  report.receipt_timing = {
    check_ms: check.elapsed_ms, build_ms: build.elapsed_ms,
    cache_hit: receipt.observation.cache_hit,
    original_check_ms: check.origin_elapsed_ms ?? check.elapsed_ms,
    original_build_ms: build.origin_elapsed_ms ?? build.elapsed_ms,
  };
  const byName = new Map();
  for (const row of receipt.observation.cases) {
    assert(typeof row.name === 'string' && !byName.has(row.name), 'duplicate or unnamed receipt case');
    assert(Array.isArray(row.args) && row.args.every(a => typeof a === 'string') && row.observed,
      `${row.name}: malformed receipt case`);
    byName.set(row.name, row);
  }
  report.receipt_case_count = byName.size;
  let matched = 0;
  for (const [index, c] of cases.manifest.cases.entries()) {
    const row = byName.get(c.id);
    if (!row) continue;
    matched++;
    const scored = report.cases[index];
    if (JSON.stringify(row.args) !== JSON.stringify(c.args)) {
      scored.failures.push('receipt case id matches but args differ from frozen case');
    } else {
      const obs = row.observed;
      if (obs.exit_code !== scored.observed.exit || obs.stdout !== scored.observed.stdout || obs.stderr !== scored.observed.stderr ||
          obs.timed_out === true || obs.aborted === true) {
        scored.failures.push('receipt observation differs from independent replay');
      }
      scored.prediction = typeof row.predicted_stdout === 'string' ? {
        matches_observation: row.predicted_stdout === obs.stdout,
        matches_expected: row.predicted_stdout === c.expect.stdout,
      } : null;
    }
    scored.pass = scored.failures.length === 0;
  }
  report.receipt_case_overlap = matched;
  return finish(report);
}

export function runBenchmark(argv = []) {
  const config = options(argv);
  const source = sourceClosure(config.source);
  const cases = readCases(config.cases);
  return config.receipt ? scoreReceipt(config, source, cases) : execute(config, source, cases);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = runBenchmark(process.argv.slice(2));
    process.stdout.write(JSON.stringify(report) + '\n');
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    process.stdout.write(JSON.stringify({ schema: 1, ok: false, passed: false, error: error.message }) + '\n');
    process.exitCode = 1;
  }
}
