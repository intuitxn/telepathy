// One local algorithm capability for DeepSeek Harness. The model proposes a
// source digest and predictions; this host copies the exact bytes, checks and
// builds them once, then runs bounded cases. DSH persists the call and result.
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, realpathSync,
  renameSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SOURCE_LIMIT = 512 * 1024;
const OUTPUT_LIMIT = 64 * 1024;
const CASE_LIMIT = 16;
const ARG_LIMIT = 16;
const DEFAULT_TIMEOUT_MS = 60_000;
// A native candidate receives arguments as its only task input. Its binary is
// the sole non-system file it may read, including through Base.File.open.
function seatbeltProfile(binary) {
  const literals = [];
  for (let current = binary; ; current = path.dirname(current)) {
    literals.push(`(literal ${JSON.stringify(current)})`);
    if (current === path.dirname(current)) break;
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
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const digestPattern = /^[a-f0-9]{64}$/;
function canonicalLocation(location) {
  const missing = [];
  let existing = path.resolve(location);
  for (;;) {
    try { return path.join(realpathSync(existing), ...missing.reverse()); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = path.dirname(existing);
      if (parent === existing) throw error;
      missing.push(path.basename(existing));
      existing = parent;
    }
  }
}

function contained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function archiveLocation(settings) {
  const location = path.resolve(settings.archiveRoot ?? process.env.TELEPATHY_DSH_ARCHIVE
    ?? path.join(process.env.DSH_HOME ?? path.join(os.homedir(), '.local', 'state', 'telepathy-dsh'), 'algorithms'));
  if (process.env.TELEPATHY_DSH_TEST_ALLOW_UNSAFE_ARCHIVE !== '1') {
    const archive = canonicalLocation(location);
    const extraRoots = settings.archiveGuardRoots ?? [];
    if (!Array.isArray(extraRoots) || extraRoots.length > 8 ||
        extraRoots.some(root => typeof root !== 'string' || !path.isAbsolute(root))) {
      throw new Error('archive guard roots must be up to eight absolute paths');
    }
    const workspaces = [settings.workspaceRoot ?? process.env.TELEPATHY_DSH_WORKSPACE ?? process.cwd(),
      ...extraRoots].map(canonicalLocation);
    const temporaryRoots = [os.tmpdir(), '/tmp', '/var/tmp'].map(canonicalLocation);
    if ([...workspaces, ...temporaryRoots].some(root => contained(root, archive))) {
      throw new Error('algorithm archive must be outside the workspace and sandbox-writable temporary roots');
    }
  }
  return location;
}

async function resolveBend(configured) {
  if (configured) return fs.realpath(configured);
  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, 'bend');
    try {
      await fs.access(candidate, fs.constants.X_OK);
      return fs.realpath(candidate);
    } catch { /* next PATH entry */ }
  }
  throw new Error('bend executable was not found on PATH');
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function validateRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('request must be an object');
  const allowed = new Set(['source', 'source_sha256', 'predict_check_pass', 'predict_build_pass', 'cases']);
  if (Object.keys(value).some(key => !allowed.has(key))) throw new Error('unknown request field');
  const { source, source_sha256: digest, predict_check_pass: check, predict_build_pass: build, cases } = value;
  if (typeof source !== 'string' || source.length > 1024 || !source.endsWith('.bend') || path.isAbsolute(source) || source.includes('\0')) {
    throw new Error('source must be a relative .bend path');
  }
  if (typeof digest !== 'string' || !digestPattern.test(digest)) throw new Error('source_sha256 must be lowercase SHA-256');
  if (typeof check !== 'boolean' || typeof build !== 'boolean') throw new Error('check and build predictions must be boolean');
  if (!Array.isArray(cases) || cases.length < 1 || cases.length > CASE_LIMIT) throw new Error('cases must contain 1 to 16 entries');
  const names = new Set();
  for (const item of cases) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('each case must be an object');
    if (Object.keys(item).some(key => !['name', 'args', 'predicted_stdout'].includes(key))) throw new Error('unknown case field');
    if (typeof item.name !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(item.name) || names.has(item.name)) {
      throw new Error('case names must be unique short identifiers');
    }
    names.add(item.name);
    if (!Array.isArray(item.args) || item.args.length > ARG_LIMIT || item.args.some(arg => typeof arg !== 'string' || arg.length > 256 || arg.includes('\0'))) {
      throw new Error('case args must contain at most 16 short strings');
    }
    if (typeof item.predicted_stdout !== 'string' || item.predicted_stdout.length > 4096) {
      throw new Error('each case needs a bounded predicted_stdout');
    }
  }
  return { source, digest, check, build, cases };
}

function command(file, args, options) {
  const start = performance.now();
  const deadline = AbortSignal.timeout(options.timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  return new Promise(resolve => {
    execFile(file, args, {
      cwd: options.cwd,
      env: options.env,
      encoding: 'utf8',
      maxBuffer: options.outputLimit ?? OUTPUT_LIMIT,
      signal,
      windowsHide: true,
    }, (error, stdout, stderr) => resolve({
      ok: !error,
      exit_code: error ? (typeof error.code === 'number' ? error.code : null) : 0,
      timed_out: deadline.aborted,
      aborted: Boolean(options.signal?.aborted),
      stdout: stdout ?? '',
      stderr: stderr ?? '',
      elapsed_ms: Math.round(performance.now() - start),
      ...(error && typeof error.code !== 'number' ? { error: String(error.code ?? error.message).slice(0, 256) } : {}),
    }));
  });
}

function nativePolicy() {
  if (process.platform === 'darwin') return 'darwin-seatbelt-isolated-read-v2';
  if (process.platform === 'linux') return 'linux-bwrap-isolated-read-v2';
  throw new Error('native candidate execution requires a supported OS sandbox');
}

export function runIsolatedNative(binary, args, options) {
  const resolved = realpathSync(binary);
  const safeOptions = { ...options, env: {
    PATH: options.env?.PATH ?? '/usr/bin:/bin', HOME: options.cwd, BEND_NO_TELEMETRY: '1',
  } };
  if (process.platform === 'darwin') {
    return command('/usr/bin/sandbox-exec', ['-p', seatbeltProfile(resolved), '--', resolved, ...args], safeOptions);
  }
  if (process.platform === 'linux') {
    return command('bwrap', linuxNativeArgs(resolved, args), safeOptions);
  }
  throw new Error('native candidate execution requires a supported OS sandbox');
}

// An exclusive write exposes its destination before all bytes are present.
// A same-directory hard link publishes a fully written immutable artifact in
// one filesystem operation while preserving the first writer's bytes.
async function publishImmutable(file, bytes, mode = 0o444) {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}-${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, bytes, { flag: 'wx', mode });
    try {
      await fs.link(temporary, file);
      return true;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      return false;
    }
  } finally {
    await fs.unlink(temporary).catch(() => {});
  }
}

async function frozenSource(request, root, archiveRoot) {
  const requested = path.resolve(root, request.source);
  if (!inside(root, requested)) throw new Error('source escapes workspace');
  const resolved = await fs.realpath(requested);
  if (!inside(root, resolved)) throw new Error('source symlink escapes workspace');
  const stat = await fs.stat(resolved);
  if (!stat.isFile() || stat.size > SOURCE_LIMIT) throw new Error('source is not a bounded regular file');
  const bytes = await fs.readFile(resolved);
  if (bytes.length > SOURCE_LIMIT || sha256(bytes) !== request.digest) {
    throw new Error(`source digest changed before execution (observed ${sha256(bytes)})`);
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  for (const match of text.matchAll(/^\s*import\s+([^\s#]+)/gm)) {
    if (match[1] !== 'Base') throw new Error('one-file candidates may import Base only');
  }
  const dir = path.join(archiveRoot, 'candidates');
  await fs.mkdir(dir, { recursive: true });
  const frozen = path.join(dir, `${request.digest}.bend`);
  await publishImmutable(frozen, bytes);
  if (!(await fs.lstat(frozen)).isFile() || sha256(await fs.readFile(frozen)) !== request.digest) {
    throw new Error('candidate archive conflicts with source digest');
  }
  return { path: frozen, bytes: bytes.length };
}

async function cachedBinary(candidate, bend, version, compiler, options) {
  const target = `${process.platform}-${process.arch}`;
  const key = sha256(`${candidate.digest}\n${bend}\n${version}\n${compiler}\n${target}`);
  const builds = path.join(options.archiveRoot, 'builds');
  await fs.mkdir(builds, { recursive: true });
  const dir = path.join(builds, key);
  const binary = path.join(dir, 'program');
  const manifest = path.join(dir, 'manifest.json');
  const loadRecord = async () => {
    const record = JSON.parse(await fs.readFile(manifest, 'utf8'));
    if (record.source_sha256 !== candidate.digest || record.bend_version !== version ||
      record.compiler !== compiler || record.target !== target ||
      !digestPattern.test(record.binary_sha256 ?? '') || !(await fs.lstat(binary)).isFile() ||
      sha256(await fs.readFile(binary)) !== record.binary_sha256) throw new Error('build cache integrity mismatch');
    if (!record.check?.ok || !record.build?.ok || !record.check.stdout?.includes('All terms check.')) {
      throw new Error('build cache lacks successful checker and compiler evidence');
    }
    return record;
  };
  try {
    const record = await loadRecord();
    return { binary, cache_hit: true,
      check: { ...record.check, cached: true, origin_elapsed_ms: record.check.elapsed_ms, elapsed_ms: 0 },
      build: { ...record.build, cached: true, origin_elapsed_ms: record.build.elapsed_ms, elapsed_ms: 0 },
      binary_sha256: record.binary_sha256 };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  // A complete directory is one atomic publication. A process killed during
  // build leaves only a .tmp directory, never an incomplete cache entry.
  const stage = path.join(builds, `.${key}-${randomUUID()}.tmp`);
  await fs.mkdir(stage, { mode: 0o700 });
  try {
    const check = await command(bend, [candidate.path, '--check-only'], options);
    if (!check.ok || !check.stdout.includes('All terms check.')) return { cache_hit: false, check, build: null };
    const stageBinary = path.join(stage, 'program');
    const build = await command(bend, [candidate.path, '-o', stageBinary], options);
    if (!build.ok) return { cache_hit: false, check, build };
    const binarySha = sha256(await fs.readFile(stageBinary));
    const data = { source_sha256: candidate.digest, bend_version: version, compiler, target,
      binary_sha256: binarySha, check, build };
    await fs.writeFile(path.join(stage, 'manifest.json'), `${JSON.stringify(data)}\n`, { flag: 'wx', mode: 0o444 });
    for (;;) {
      try {
        await fs.rename(stage, dir);
        return { binary, cache_hit: false, check, build, binary_sha256: binarySha };
      } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
      }
      try {
        const winner = await loadRecord();
        // Bend can encode the temporary output path, so the winning binary's
        // digest, not this build's digest, belongs in the receipt.
        return { binary, cache_hit: false, concurrent_reuse: true, check, build,
          binary_sha256: winner.binary_sha256 };
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      // Previous plugin versions could die after linking program but before
      // writing manifest. Move that orphan aside rather than trusting it.
      // The current publisher never creates an incomplete final directory.
      try { await fs.rename(dir, path.join(builds, `.${key}-orphan-${randomUUID()}`)); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }
}

/** Run one source-pinned batch. Prediction quality is separate from correctness. */
export async function runCandidate(input, settings = {}, execution = {}) {
  const request = validateRequest(input);
  const workspaceRoot = await fs.realpath(settings.workspaceRoot ?? process.env.TELEPATHY_DSH_WORKSPACE ?? process.cwd());
  const archiveRoot = archiveLocation(settings);
  const bend = await resolveBend(settings.bendBin ?? process.env.BEND_BIN);
  const timeoutMs = settings.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 300_000) throw new Error('timeoutMs must be 100..300000');
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'telepathy-dsh-'));
  const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: scratch, BEND_NO_TELEMETRY: '1' };
  const totalDeadline = AbortSignal.timeout(timeoutMs);
  const signal = execution.signal ? AbortSignal.any([execution.signal, totalDeadline]) : totalDeadline;
  const commandOptions = { cwd: scratch, env, timeoutMs, signal };
  const receiptId = randomUUID();
  const started = Date.now();
  let result;
  try {
    const source = await frozenSource(request, workspaceRoot, archiveRoot);
    const versionResult = await command(bend, ['version'], commandOptions);
    if (!versionResult.ok) throw new Error('Bend version command failed');
    const version = versionResult.stdout.split('\n', 1)[0].trim();
    const compilerResult = await command('clang', ['--version'], commandOptions);
    if (!compilerResult.ok) throw new Error('Clang version command failed');
    const compiler = compilerResult.stdout.split('\n', 1)[0].trim();
    if (!compiler) throw new Error('Clang version command returned no identity');
    const prepared = await cachedBinary({ ...source, digest: request.digest }, bend, version, compiler,
      { ...commandOptions, archiveRoot });
    const cases = [];
    if (prepared.binary) {
      for (const item of request.cases) {
        if (signal.aborted) break;
        const observed = await runIsolatedNative(prepared.binary, item.args, commandOptions);
        cases.push({ name: item.name, args: item.args, predicted_stdout: item.predicted_stdout,
          observed, prediction_match: observed.stdout === item.predicted_stdout });
        if (observed.timed_out || observed.aborted) break;
      }
    }
    result = {
      schema: 1, receipt_id: receiptId, session_id: String(execution.sessionId ?? ''), call_id: String(execution.callId ?? ''),
      source: request.source, source_sha256: request.digest, source_bytes: source.bytes,
      bend_version: version, compiler, target: `${process.platform}-${process.arch}`,
      execution_policy: nativePolicy(),
      binary_sha256: prepared.binary_sha256 ?? null,
      prediction: { check_pass: request.check, build_pass: request.build },
      observation: { check: prepared.check, build: prepared.build, cases, cache_hit: prepared.cache_hit,
        concurrent_reuse: prepared.concurrent_reuse ?? false },
      discrepancy: { check: prepared.check.ok !== request.check, build: prepared.build?.ok !== request.build,
        cases: cases.filter(item => !item.prediction_match).map(item => item.name) },
      measured: { started_at_ms: started, elapsed_ms: Date.now() - started },
      status: !prepared.check.ok ? 'check-failed' : !prepared.build?.ok ? 'build-failed'
        : cases.length !== request.cases.length || cases.some(item => !item.observed.ok) ? 'run-failed' : 'executed',
    };
  } catch (error) {
    result = { schema: 1, receipt_id: receiptId, session_id: String(execution.sessionId ?? ''), call_id: String(execution.callId ?? ''),
      source: request.source, source_sha256: request.digest,
      prediction: { check_pass: request.check, build_pass: request.build },
      measured: { started_at_ms: started, elapsed_ms: Date.now() - started },
      status: 'rejected', error: String(error.message ?? error).slice(0, 512) };
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
  const receipts = path.join(archiveRoot, 'receipts');
  await fs.mkdir(receipts, { recursive: true });
  const content = `${JSON.stringify(result)}\n`;
  const receiptPath = path.join(receipts, `${receiptId}.json`);
  await fs.writeFile(receiptPath, content, { flag: 'wx', mode: 0o444 });
  return { ...result, receipt_sha256: sha256(content), receipt_path: receiptPath };
}

function validateDigest(value, label) {
  if (typeof value !== 'string' || !digestPattern.test(value)) throw new Error(`${label} must be lowercase SHA-256`);
  return value;
}

async function pinnedFile(file, digest, label) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error(`${label} must be an absolute host path`);
  validateDigest(digest, `${label} digest`);
  const real = await fs.realpath(file);
  if (!(await fs.stat(real)).isFile() || sha256(await fs.readFile(real)) !== digest) {
    throw new Error(`${label} differs from the host-pinned digest`);
  }
  return real;
}

async function archivedJson(directory, digest) {
  validateDigest(digest, 'artifact digest');
  const file = path.join(directory, `${digest}.json`);
  const bytes = await fs.readFile(file);
  if (sha256(bytes) !== digest) throw new Error('archived artifact digest mismatch');
  return JSON.parse(bytes.toString('utf8'));
}

async function saveArtifact(directory, value) {
  await fs.mkdir(directory, { recursive: true });
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
  const digest = sha256(bytes);
  const file = path.join(directory, `${digest}.json`);
  await publishImmutable(file, bytes);
  if (sha256(await fs.readFile(file)) !== digest) throw new Error('archived artifact conflict');
  return { digest, file };
}

/** Run the host-pinned evaluator against the archived candidate and fixed cases. */
export async function scoreCandidate(input, settings = {}, execution = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
    Object.keys(input).some(key => !['receipt_id', 'receipt_sha256'].includes(key))) throw new Error('invalid score request');
  const { receipt_id: receiptId, receipt_sha256: receiptDigest } = input;
  if (typeof receiptId !== 'string' || !/^[a-f0-9-]{36}$/.test(receiptId)) throw new Error('invalid receipt_id');
  validateDigest(receiptDigest, 'receipt_sha256');
  const archiveRoot = archiveLocation(settings);
  const receiptFile = path.join(archiveRoot, 'receipts', `${receiptId}.json`);
  const receiptBytes = await fs.readFile(receiptFile);
  if (sha256(receiptBytes) !== receiptDigest) throw new Error('receipt digest mismatch');
  const receipt = JSON.parse(receiptBytes.toString('utf8'));
  if (receipt.receipt_id !== receiptId || receipt.status !== 'executed') throw new Error('receipt is not an executed candidate');
  if (execution.sessionId && receipt.session_id !== execution.sessionId)
    throw new Error('receipt belongs to another DSH session');
  const sourceDigest = validateDigest(receipt.source_sha256, 'source_sha256');
  const sourceFile = await pinnedFile(path.join(archiveRoot, 'candidates', `${sourceDigest}.bend`), sourceDigest, 'candidate');
  const evaluatorDigest = settings.evaluatorSha256 ?? process.env.TELEPATHY_DSH_EVALUATOR_SHA256;
  const caseDigest = settings.caseSetSha256 ?? process.env.TELEPATHY_DSH_CASE_SET_SHA256;
  const evaluator = await pinnedFile(settings.evaluatorPath ?? process.env.TELEPATHY_DSH_EVALUATOR, evaluatorDigest, 'evaluator');
  const caseSet = await pinnedFile(settings.caseSetPath ?? process.env.TELEPATHY_DSH_CASE_SET, caseDigest, 'case set');
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'telepathy-dsh-score-'));
  let observed;
  try {
    observed = await command(process.execPath,
      [evaluator, '--source', sourceFile, '--cases', caseSet, '--receipt', receiptFile,
        '--cache-dir', path.join(archiveRoot, 'score-builds'), '--timeout-ms', '120000'],
      { cwd: scratch, env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: scratch,
        BEND_BINARY: settings.bendBin ?? process.env.BEND_BIN ?? 'bend', BEND_NO_TELEMETRY: '1',
      }, signal: execution.signal, timeoutMs: settings.scoreTimeoutMs ?? 180_000, outputLimit: 2 * 1024 * 1024 });
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
  if (observed.timed_out || observed.aborted || ![0, 1].includes(observed.exit_code)) {
    throw new Error(`evaluator did not finish: ${observed.error ?? observed.stderr.slice(0, 256)}`);
  }
  let report;
  try { report = JSON.parse(observed.stdout); } catch { throw new Error('evaluator did not emit one JSON report'); }
  if (report.schema !== 1 || report.mode !== 'receipt' || report.source_sha256 !== sourceDigest ||
    report.receipt_sha256 !== receiptDigest || report.evaluator_sha256 !== evaluatorDigest ||
    report.case_set_sha256 !== caseDigest || !Array.isArray(report.cases) ||
    !Number.isSafeInteger(report.coverage?.total) || report.coverage.total !== report.cases.length ||
    report.coverage.observed !== report.cases.length || report.ok !== (observed.exit_code === 0)) {
    throw new Error(`evaluator returned an incomplete or mismatched report: ${report.error ?? ''}`);
  }
  const score = { schema: 1, receipt_id: receiptId, receipt_sha256: receiptDigest,
    source_sha256: sourceDigest, evaluator_sha256: evaluatorDigest, case_set_sha256: caseDigest,
    report, scored_at_ms: Date.now() };
  const saved = await saveArtifact(path.join(archiveRoot, 'scores'), score);
  return { status: 'scored', score_sha256: saved.digest, score_path: saved.file,
    source_sha256: sourceDigest, receipt_sha256: receiptDigest,
    evaluator_sha256: evaluatorDigest, case_set_sha256: caseDigest,
    coverage: report.coverage, passed: report.ok, cases: report.cases.map(row => ({ id: row.id, pass: row.pass, failures: row.failures })) };
}

/** Compare complete reports on the same fixed task set and change only the future-session pointer. */
export async function selectCandidate(input, settings = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
    Object.keys(input).some(key => !['candidate_score_sha256', 'incumbent_score_sha256', 'expected_active_score_sha256'].includes(key))) {
    throw new Error('invalid selection request');
  }
  const candidateDigest = validateDigest(input.candidate_score_sha256, 'candidate_score_sha256');
  const incumbentDigest = input.incumbent_score_sha256 === null ? null
    : validateDigest(input.incumbent_score_sha256, 'incumbent_score_sha256');
  const expected = input.expected_active_score_sha256;
  if (expected !== null) validateDigest(expected, 'expected_active_score_sha256');
  if (candidateDigest === incumbentDigest) throw new Error('candidate and incumbent scores are identical');
  const archiveRoot = archiveLocation(settings);
  const evaluatorDigest = settings.evaluatorSha256 ?? process.env.TELEPATHY_DSH_EVALUATOR_SHA256;
  const caseDigest = settings.caseSetSha256 ?? process.env.TELEPATHY_DSH_CASE_SET_SHA256;
  await pinnedFile(settings.evaluatorPath ?? process.env.TELEPATHY_DSH_EVALUATOR, evaluatorDigest, 'evaluator');
  await pinnedFile(settings.caseSetPath ?? process.env.TELEPATHY_DSH_CASE_SET, caseDigest, 'case set');
  const scoreDir = path.join(archiveRoot, 'scores');
  const candidate = await archivedJson(scoreDir, candidateDigest);
  const incumbent = incumbentDigest ? await archivedJson(scoreDir, incumbentDigest) : null;
  const left = candidate.report;
  const right = incumbent?.report;
  for (const score of [candidate, incumbent].filter(Boolean)) {
    const report = score.report;
    const rows = report?.cases;
    if (score.schema !== 1 || report?.schema !== 1 || report?.mode !== 'receipt' ||
      score.evaluator_sha256 !== evaluatorDigest || score.case_set_sha256 !== caseDigest ||
      report.evaluator_sha256 !== evaluatorDigest || report.case_set_sha256 !== caseDigest ||
      !digestPattern.test(score.source_sha256 ?? '') || !digestPattern.test(score.receipt_sha256 ?? '') ||
      !Array.isArray(rows) || !Number.isSafeInteger(report.coverage?.total) ||
      rows.length !== report.coverage.total || report.coverage.observed !== rows.length ||
      report.coverage.passed !== rows.filter(row => row.pass === true).length ||
      report.coverage.failed !== rows.length - report.coverage.passed ||
      rows.some(row => typeof row.id !== 'string' || typeof row.pass !== 'boolean') ||
      new Set(rows.map(row => row.id)).size !== rows.length ||
      report.ok !== (report.coverage.failed === 0)) throw new Error('score report is incomplete or differs from host pins');
  }
  if (!left.ok || left.coverage.failed !== 0 || left.coverage.total === 0) {
    return { status: 'rejected', gains: [], regressions: [], reason: 'selection requires a complete passing candidate score' };
  }
  let gains;
  let regressions;
  if (incumbent) {
    if (candidate.evaluator_sha256 !== incumbent.evaluator_sha256 || candidate.case_set_sha256 !== incumbent.case_set_sha256 ||
      left.evaluator_sha256 !== right.evaluator_sha256 || left.case_set_sha256 !== right.case_set_sha256 ||
      JSON.stringify(left.toolchain) !== JSON.stringify(right.toolchain) || left.timing?.repeats !== right.timing?.repeats ||
      left.coverage?.total !== right.coverage?.total || left.cases?.length !== left.coverage?.total || right.cases?.length !== right.coverage?.total) {
      throw new Error('scores do not share one evaluator, case set, toolchain and compute schedule');
    }
    const previous = new Map(right.cases.map(row => [row.id, row.pass]));
    if (previous.size !== right.cases.length || left.cases.some(row => !previous.has(row.id))) throw new Error('case identities differ');
    regressions = left.cases.filter(row => previous.get(row.id) && !row.pass).map(row => row.id);
    gains = left.cases.filter(row => !previous.get(row.id) && row.pass).map(row => row.id);
    if (regressions.length || gains.length === 0) return { status: 'rejected', gains, regressions, reason: 'candidate does not strictly dominate incumbent' };
  } else {
    gains = left.cases.map(row => row.id);
    regressions = [];
  }
  await fs.mkdir(archiveRoot, { recursive: true });
  // SQLite's OS lock is released if the process dies. Keep the synchronous
  // critical section short so competing selectors cannot interleave a CAS.
  const db = new DatabaseSync(path.join(archiveRoot, 'active-lock.sqlite'));
  let transaction = false;
  try {
    db.exec('PRAGMA busy_timeout=5000');
    db.exec('BEGIN IMMEDIATE');
    transaction = true;
    const pointerFile = path.join(archiveRoot, 'active.json');
    let active = null;
    try { active = JSON.parse(readFileSync(pointerFile, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if ((active?.score_sha256 ?? null) !== expected || (active && active.score_sha256 !== incumbentDigest)) {
      throw new Error('active pointer changed; rescore or retry with its exact incumbent');
    }
    const pointer = { schema: 1, score_sha256: candidateDigest, source_sha256: candidate.source_sha256,
      receipt_sha256: candidate.receipt_sha256, evaluator_sha256: candidate.evaluator_sha256,
      case_set_sha256: candidate.case_set_sha256, parent_score_sha256: incumbentDigest,
      selected_at_ms: Date.now() };
    const temporary = path.join(archiveRoot, `active-${randomUUID()}.json`);
    try {
      const temporaryFd = openSync(temporary, 'wx', 0o600);
      try {
        writeFileSync(temporaryFd, `${JSON.stringify(pointer)}\n`);
        fsyncSync(temporaryFd);
      } finally { closeSync(temporaryFd); }
      renameSync(temporary, pointerFile);
      const directoryFd = openSync(archiveRoot, 'r');
      try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); }
    } finally { try { unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
    db.exec('COMMIT');
    transaction = false;
    return { status: 'selected', gains, regressions, active: pointer };
  } finally {
    if (transaction) db.exec('ROLLBACK');
    db.close();
  }
}

/** The first read in a session pins that session even after later selections. */
export async function activeCandidate(settings = {}, execution = {}) {
  const sessionId = String(execution.sessionId ?? '');
  if (!sessionId) throw new Error('algorithm_active requires a DSH session');
  const archiveRoot = archiveLocation(settings);
  const pins = path.join(archiveRoot, 'session-pins');
  await fs.mkdir(pins, { recursive: true });
  const file = path.join(pins, `${sha256(sessionId)}.json`);
  try {
    const pinned = JSON.parse(await fs.readFile(file, 'utf8'));
    if (pinned.session_id !== sessionId) throw new Error('session pin collision');
    return pinned;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let active = null;
  try { active = JSON.parse(await fs.readFile(path.join(archiveRoot, 'active.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (active) {
    const selected = await archivedJson(path.join(archiveRoot, 'scores'), active.score_sha256);
    if (selected.source_sha256 !== active.source_sha256 || selected.receipt_sha256 !== active.receipt_sha256) {
      throw new Error('active pointer differs from its scored artifact');
    }
  }
  const pin = { schema: 1, session_id: sessionId, active, pinned_at_ms: Date.now() };
  if (await publishImmutable(file, `${JSON.stringify(pin)}\n`)) return pin;
  const winner = JSON.parse(await fs.readFile(file, 'utf8'));
  if (winner.session_id !== sessionId) throw new Error('session pin collision');
  return winner;
}

/** Execute the exact binary selected and pinned for this DSH session. */
function validateExecuteArgs(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
    Object.keys(input).some(key => key !== 'args') || !Array.isArray(input.args) ||
    input.args.length > ARG_LIMIT || input.args.some(arg => typeof arg !== 'string' || arg.length > 256 || arg.includes('\0'))) {
    throw new Error('args must contain at most 16 short strings');
  }
}

export async function executeCandidate(input, settings = {}, execution = {}) {
  validateExecuteArgs(input);
  const pin = await activeCandidate(settings, execution);
  const active = pin.active;
  if (!active) throw new Error('this session has no selected algorithm');
  const archiveRoot = archiveLocation(settings);
  const score = await archivedJson(path.join(archiveRoot, 'scores'), active.score_sha256);
  if (score.source_sha256 !== active.source_sha256 || score.receipt_sha256 !== active.receipt_sha256 ||
    score.report?.ok !== true || score.report?.coverage?.failed !== 0) {
    throw new Error('selected score does not match the session pin');
  }
  const receiptBytes = await fs.readFile(path.join(archiveRoot, 'receipts', `${score.receipt_id}.json`));
  if (sha256(receiptBytes) !== active.receipt_sha256) throw new Error('selected receipt digest mismatch');
  const receipt = JSON.parse(receiptBytes.toString('utf8'));
  if (receipt.status !== 'executed' || receipt.source_sha256 !== active.source_sha256 ||
    !digestPattern.test(receipt.binary_sha256 ?? '')) throw new Error('selected receipt lacks an executed binary');
  const source = await pinnedFile(path.join(archiveRoot, 'candidates', `${active.source_sha256}.bend`),
    active.source_sha256, 'selected source');
  const bend = await resolveBend(settings.bendBin ?? process.env.BEND_BIN);
  const timeoutMs = settings.executeTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 300_000) throw new Error('executeTimeoutMs must be 100..300000');
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'telepathy-dsh-execute-'));
  try {
    const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: scratch, BEND_NO_TELEMETRY: '1' };
    const deadline = AbortSignal.timeout(timeoutMs);
    const signal = execution.signal ? AbortSignal.any([execution.signal, deadline]) : deadline;
    const options = { cwd: scratch, env, timeoutMs, signal, archiveRoot };
    const bendResult = await command(bend, ['version'], options);
    const clangResult = await command('clang', ['--version'], options);
    if (!bendResult.ok || !clangResult.ok) throw new Error('selected toolchain cannot be identified');
    const version = bendResult.stdout.split('\n', 1)[0].trim();
    const compiler = clangResult.stdout.split('\n', 1)[0].trim();
    if (score.report.toolchain?.bend_version !== version || score.report.toolchain?.compiler !== compiler ||
      score.report.toolchain?.target !== `${process.platform}-${process.arch}` ||
      score.report.toolchain?.execution_policy !== nativePolicy() ||
      receipt.execution_policy !== nativePolicy()) {
      throw new Error('selected score toolchain differs from current toolchain');
    }
    const prepared = await cachedBinary({ path: source, digest: active.source_sha256 }, bend, version, compiler, options);
    if (!prepared.binary || prepared.binary_sha256 !== receipt.binary_sha256) {
      throw new Error('selected binary differs from its pinned receipt digest');
    }
    const observed = await runIsolatedNative(prepared.binary, input.args, options);
    return { schema: 1, status: observed.ok ? 'executed' : 'run-failed', session_id: pin.session_id,
      active_score_sha256: active.score_sha256, source_sha256: active.source_sha256,
      binary_sha256: prepared.binary_sha256, args: input.args, observed };
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
}

export function createTool(settings) {
  return {
    name: 'algorithm_run',
    description: 'Freeze a one-file Bend candidate at an exact SHA-256, check and build it once, run up to 16 bounded cases, and return a durable prediction/observation receipt. Case names are unique 1..64 character identifiers using letters, digits, underscore or hyphen. This measures execution, not task correctness.',
    parameters: {
      type: 'object', additionalProperties: false,
      required: ['source', 'source_sha256', 'predict_check_pass', 'predict_build_pass', 'cases'],
      properties: {
        source: { type: 'string', description: 'Relative .bend path in the workspace' },
        source_sha256: { type: 'string', description: 'Exact lowercase SHA-256 of the source bytes before the call' },
        predict_check_pass: { type: 'boolean' }, predict_build_pass: { type: 'boolean' },
        cases: { type: 'array', minItems: 1, maxItems: 16,
          items: { type: 'object', additionalProperties: false,
          required: ['name', 'args', 'predicted_stdout'], properties: {
            name: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,64}$' },
            args: { type: 'array', items: { type: 'string' } },
            predicted_stdout: { type: 'string' },
          } } },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify({
        status: value.status, source_sha256: value.source_sha256,
        binary_sha256: value.binary_sha256 ?? null, compiler: value.compiler ?? null,
        receipt_id: value.receipt_id, receipt_sha256: value.receipt_sha256,
        discrepancy: value.discrepancy ?? null,
        cases: value.observation?.cases?.map(item => ({
          name: item.name, exit_code: item.observed.exit_code,
          stdout: item.observed.stdout.slice(0, 2048), prediction_match: item.prediction_match,
        })) ?? [],
        error: value.error ?? null,
      }) }],
    },
    execute: (args, exec) => runCandidate(args, settings, {
      signal: exec.signal, sessionId: exec.agent?.session?.id, callId: exec.callId,
    }),
  };
}

export function createCompileTool() {
  return {
    name: 'algorithm_compile',
    description: 'Compile one bounded recurrence pseudocode text into deterministic one-file Bend and simulate up to 16 step counts in process. Return exact source, digests, outputs or diagnostics. This does not run native Bend or score correctness.',
    parameters: { type: 'object', additionalProperties: false, required: ['source_text'],
      properties: { source_text: { type: 'string', maxLength: 16 * 1024 },
        steps: { type: 'array', maxItems: 16, uniqueItems: true,
          items: { type: 'integer', minimum: 0, maximum: 128 } } } },
    output: { schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async args => {
      const steps = args?.steps ?? [];
      if (!Array.isArray(steps) || steps.length > 16 ||
          steps.some(step => !Number.isSafeInteger(step) || step < 0 || step > 128) ||
          new Set(steps).size !== steps.length) throw new Error('steps must be up to 16 distinct integers in 0..128');
      const { compileAlgorithmText, prepareAlgorithmText } = await import('./algorithm-language.mjs');
      const compiled = compileAlgorithmText(args?.source_text);
      if (!compiled.ok || !steps.length) return { ...compiled, simulations: [] };
      const prepared = prepareAlgorithmText(args.source_text);
      if (!prepared.ok) throw new Error('compiled source differs from prepared simulation');
      return { ...compiled, simulations: steps.map(step => ({ steps: step,
        stdout: prepared.simulate(step).stdout })) };
    },
  };
}

export function createScoreTool(settings) {
  return {
    name: 'algorithm_score',
    description: 'Score one immutable algorithm_run receipt against the host-pinned independent Bend evaluator and case set. Model predictions do not define expected results.',
    parameters: { type: 'object', additionalProperties: false,
      required: ['receipt_id', 'receipt_sha256'], properties: {
        receipt_id: { type: 'string' }, receipt_sha256: { type: 'string' },
      } },
    output: { schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify({
        status: value.status, score_sha256: value.score_sha256, source_sha256: value.source_sha256,
        evaluator_sha256: value.evaluator_sha256, case_set_sha256: value.case_set_sha256,
        coverage: value.coverage, passed: value.passed,
        cases: value.cases.map(row => ({ id: row.id, pass: row.pass,
          failure: row.failures?.[0]?.slice(0, 256) ?? null })),
      }) }] },
    execute: (args, exec) => scoreCandidate(args, settings, {
      signal: exec.signal, sessionId: exec.agent?.session?.id,
    }),
  };
}

export function createSelectTool(settings) {
  return {
    name: 'algorithm_select',
    description: 'Atomically select a scored candidate for future sessions. First selection needs a complete passing score; later selections need strict fixed-case improvement without regressions.',
    parameters: { type: 'object', additionalProperties: false,
      required: ['candidate_score_sha256', 'incumbent_score_sha256', 'expected_active_score_sha256'],
      properties: { candidate_score_sha256: { type: 'string' }, incumbent_score_sha256: { type: ['string', 'null'] },
        expected_active_score_sha256: { type: ['string', 'null'] } } },
    output: { schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: args => selectCandidate(args, settings),
  };
}

export function createActiveTool(settings) {
  return {
    name: 'algorithm_active',
    description: 'Read and pin the active scored Bend version for this DSH session. A later selection does not change this session pin.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    output: { schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: (_args, exec) => activeCandidate(settings, { sessionId: exec.agent?.session?.id }),
  };
}

export function createExecuteTool(settings) {
  return {
    name: 'algorithm_execute',
    description: 'Run up to 16 short string arguments against this session’s selected, archived Bend binary. The source and binary digests come from the session pin, not the model.',
    parameters: { type: 'object', additionalProperties: false, required: ['args'],
      properties: { args: { type: 'array', maxItems: ARG_LIMIT,
        items: { type: 'string', maxLength: 256 } } } },
    output: { schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: (args, exec) => executeCandidate(args, settings, {
      signal: exec.signal, sessionId: exec.agent?.session?.id,
    }),
  };
}

export const name = 'telepathy-algorithm-core';
export const inject = ['tools'];
export function apply(ctx, config = {}) {
  archiveLocation({});
  const tools = [createTool(), createCompileTool(), createActiveTool(), createExecuteTool()];
  if (config.mode === 'headless-smoke') {
    // The separate keyless smoke patch deliberately has no task grants. This
    // mode must never be configured by the production release patch.
    for (const tool of [tools[0], createScoreTool(), createSelectTool(), ...tools.slice(1)])
      ctx.tools.register(tool);
    return;
  }
  if (config.mode !== 'funded') throw new Error('algorithm core requires an explicit funded or headless-smoke mode');
  const taskRef = validateDigest(config.taskRef, 'funded task_ref');
  const controller = ctx.get?.('telepathyTaskControl');
  if (typeof controller?.reserveAlgorithmCall !== 'function' ||
      typeof ctx.get?.('telepathyToolBoundary')?.bindChildWorkspace !== 'function') {
    throw new Error('funded algorithm tools require task control and the tool boundary');
  }
  for (const tool of tools) {
    ctx.tools.register({ ...tool, execute: async (args, exec) => {
      const sessionId = exec?.agent?.session?.id;
      const callId = exec?.callId;
      if (typeof sessionId !== 'string' || !sessionId || typeof callId !== 'string' || !callId)
        throw new Error('funded algorithm call requires a DSH session and call ID');
      // Reject malformed requests before spending the native-run reservation.
      // The provider turn still consumes its separately metered model tokens.
      if (tool.name === 'algorithm_run') validateRequest(args);
      if (tool.name === 'algorithm_execute') validateExecuteArgs(args);
      await controller.reserveAlgorithmCall(taskRef, { session_id: sessionId,
        call_id: callId, tool: tool.name, input_sha256: sha256(JSON.stringify(args)) });
      return tool.execute(args, exec);
    } });
  }
  // Scoring invokes the independent evaluator and selection changes the
  // global future-session pointer. Neither can be authorized by a simple
  // compute charge; both remain host-only until evaluation and integration
  // reservations bind their exact provenance and independent verdicts.
}
