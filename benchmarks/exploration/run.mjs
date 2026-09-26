#!/usr/bin/env node
// A fixed-oracle policy comparison that executes the checked Bend kernel.
// This is a simulator, not a scientific verifier or a release gate.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const source = join(root, 'runtime/core/telepathy.bend');
const fixtures = join(here, 'scenarios.json');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function check(ok, message) { if (!ok) throw new Error('exploration benchmark: ' + message); }
function nat(value, maximum, label) {
  check(Number.isSafeInteger(value) && value >= 0 && value <= maximum, label + ' is out of range');
}

function command(binary, args, cwd, timeout = 120000) {
  const result = spawnSync(binary, args, {
    cwd, encoding: 'utf8', timeout, maxBuffer: 1024 * 1024,
    env: { PATH: process.env.PATH || '/usr/bin:/bin', HOME: '/nonexistent', BEND_NO_TELEMETRY: '1' },
  });
  check(!result.error && result.status === 0 && !result.signal,
    binary + ' failed: ' + (result.stderr || result.stdout || result.error?.message || result.status));
  return result.stdout;
}

function seatbeltProfile(binary) {
  const paths = [];
  for (let current = binary; ; current = dirname(current)) {
    paths.push('(literal ' + JSON.stringify(current) + ')');
    if (current === dirname(current)) break;
  }
  return '(version 1) (allow default) (deny file-read*) (deny file-write*) (deny network*) ' +
    '(allow file-read* ' + paths.join(' ') + ' (subpath "/System/Library") ' +
    '(subpath "/usr/lib") (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random"))';
}

function native(binary, args) {
  if (process.platform === 'darwin') {
    return command('/usr/bin/sandbox-exec', ['-p', seatbeltProfile(binary), '--', binary, ...args], root, 30000);
  }
  if (process.platform === 'linux') {
    const mounts = ['--tmpfs', '/', '--dev', '/dev', '--proc', '/proc', '--dir', '/usr'];
    for (const directory of ['/lib', '/lib64', '/usr/lib', '/usr/lib64']) {
      try { realpathSync(directory); mounts.push('--ro-bind', directory, directory); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return command('bwrap', ['--unshare-all', '--die-with-parent', '--new-session', '--clearenv',
      '--setenv', 'HOME', '/', '--setenv', 'PATH', '/usr/bin:/bin', ...mounts,
      '--ro-bind', binary, '/program', '--chdir', '/', '--', '/program', ...args], root, 30000);
  }
  throw new Error('exploration benchmark requires macOS Seatbelt or Linux Bubblewrap');
}

function validate(fixturesDoc) {
  check(fixturesDoc.version === 1 && Array.isArray(fixturesDoc.scenarios) &&
    fixturesDoc.scenarios.length > 0, 'scenario set is invalid');
  const ids = new Set();
  for (const s of fixturesDoc.scenarios) {
    check(typeof s.id === 'string' && /^[a-z0-9-]+$/.test(s.id) && !ids.has(s.id), 'scenario id is invalid');
    ids.add(s.id);
    nat(s.rounds, 64, 'rounds'); check(s.rounds > 0, 'rounds must be positive');
    nat(s.scope, 65535, 'scope'); nat(s.document_scan, 128, 'document scan');
    nat(s.top_k, 128, 'top k'); nat(s.default_estimate, 65535, 'default estimate');
    check(s.document_scan > 0 && s.top_k > 0 && s.top_k <= s.document_scan, 'scan cap is invalid');
    check(Array.isArray(s.actions) && s.actions.length > 0 && s.actions.length <= 128, 'actions are invalid');
    const actions = new Set();
    for (const a of s.actions) {
      nat(a.id, 65535, 'action id'); nat(a.one_time_gain, 65535, 'oracle gain');
      check(!actions.has(a.id), 'duplicate action'); actions.add(a.id);
    }
    check(Array.isArray(s.seed), 'seed is invalid');
    for (const e of [...s.seed, s.arrival_each_round]) {
      check(e && actions.has(e.action) && typeof e.verified === 'boolean', 'evidence record is invalid');
      nat(e.scope, 65535, 'evidence scope'); nat(e.estimate, 65535, 'evidence estimate');
    }
    nat(s.arrival_each_round.count, 16, 'arrival count');
    check(s.seed.length + s.rounds * (s.arrival_each_round.count + 1) <= 128,
      'evidence exceeds Bend row cap');
  }
}

function buildKernel() {
  const sourceBytes = readFileSync(source);
  const sourceText = sourceBytes.toString('utf8');
  check((sourceText.match(/^\s*import\s+[^\n]+$/gm) || []).every(line => /^\s*import\s+Base\s*$/.test(line)),
    'kernel must have only Base imports');
  const bend = process.env.BEND_BINARY || process.env.BEND || 'bend';
  const version = command(bend, ['version'], root).trim().split('\n')[0];
  check(version.startsWith('bend '), 'Bend version is invalid');
  const checked = command(bend, [source, '--check-only'], root);
  check(checked.includes('All terms check.'), 'Bend checker did not pass');
  const temp = mkdtempSync(join(tmpdir(), 'telepathy-exploration-'));
  try {
    const binary = join(temp, 'kernel');
    command(bend, [source, '-o', binary], root);
    check(hash(readFileSync(source)) === hash(sourceBytes), 'source changed during build');
    return { binary, temp, version, source_sha256: hash(sourceBytes) };
  } catch (error) { rmSync(temp, { recursive: true, force: true }); throw error; }
}

function invoke(binary, eventRows, candidateRows, docs, eventScan, candidateScan, documentScan, scope, topK) {
  const args = ['batch', String(eventScan), String(candidateScan), String(documentScan),
    String(scope), String(topK), eventRows.join('\n'), candidateRows.join('\n'), docs.join('\n')];
  check(args.slice(6).every(part => part.length <= 4096), 'batch payload is too large');
  const result = JSON.parse(native(binary, args));
  check(result.schema === 'telepathy.kernel/v4' && result.verdict_source === 'host_supplied_unauthed',
    'unexpected Bend kernel contract');
  return result;
}

function orderEvidence(evidence, latestVerified, actionIds, strategy, scan) {
  // A write-time index keeps selection work bounded by action count and scan
  // cap. Include one extra row so Bend can report an uninspected suffix.
  if (strategy === 'recency') {
    const rows = evidence.slice(-scan - 1).reverse();
    return { rows, inspected: rows.length };
  }
  const primary = actionIds.map(id => latestVerified.get(id)).filter(Boolean);
  primary.sort((a, b) => b.id - a.id);
  const rows = primary.slice(0, scan + 1);
  const chosen = new Set(rows.map(e => e.id));
  let inspected = actionIds.length;
  for (let i = evidence.length - 1; i >= 0 && rows.length < scan + 1; i--) {
    inspected++;
    const e = evidence[i];
    if (!chosen.has(e.id)) { rows.push(e); chosen.add(e.id); }
  }
  return { rows, inspected };
}

function simulate(s, strategy, binary) {
  // Selector functions receive action IDs and evidence only. Payoffs remain in
  // this evaluator closure and are never encoded in a Bend candidate row.
  const payoff = new Map(s.actions.map(a => [a.id, a.one_time_gain]));
  const actionIds = s.actions.map(a => a.id);
  const evidence = [];
  const byId = new Map();
  const latestVerified = new Map();
  const usage = { host_items_considered: 0, document_scans: 0, candidate_scans: 0,
    event_scans: 0, oracle_calls: 0, native_calls: 0 };
  let nextId = 1;
  const append = e => {
    const record = { id: nextId++, action: e.action, scope: e.scope,
      value: e.estimate, verified: e.verified };
    evidence.push(record);
    byId.set(record.id, record);
    usage.host_items_considered++; // Host records the item once on admission.
    if (strategy === 'bounded-evidence' && record.verified && record.scope === s.scope) {
      latestVerified.set(record.action, record);
      usage.host_items_considered++; // Maintain one latest verified pointer.
    }
  };
  for (const e of s.seed) append(e);
  const attempted = new Set();
  const events = [];
  const trace = [];
  let gain = 0, duplicates = 0, unsupported = 0, predictionError = 0;

  for (let round = 1; round <= s.rounds; round++) {
    for (let i = 0; i < s.arrival_each_round.count; i++) append(s.arrival_each_round);
    const ordered = orderEvidence(evidence, latestVerified, actionIds, strategy, s.document_scan);
    usage.host_items_considered += ordered.inspected;
    const docs = ordered.rows.map(e => [e.id, e.scope, e.value].join('\n'));
    const retrieval = invoke(binary, [], [], docs, 0, 0, s.document_scan, s.scope, s.top_k);
    usage.native_calls++;
    usage.document_scans += retrieval.retrieval.scanned;
    check(retrieval.retrieval.scanned <= s.document_scan, 'retrieval overspent scan');
    const estimates = new Map(actionIds.map(id => [id, s.default_estimate]));
    const supported = new Set();
    for (const doc of retrieval.retrieval.docs) {
      const e = byId.get(doc.id);
      check(e && e.scope === s.scope && doc.value === e.value && doc.scope === e.scope,
        'retrieved evidence differs from source');
      if (!supported.has(e.action)) { estimates.set(e.action, e.value); supported.add(e.action); }
    }
    const rows = actionIds.map(id => [id, 1, 1, estimates.get(id)].join('\n'));
    const choice = invoke(binary, [], rows, [], 0, actionIds.length, 0, s.scope, 0);
    usage.native_calls++;
    usage.candidate_scans += choice.choice.scanned;
    check(choice.choice.scanned === actionIds.length, 'frontier scan did not cover actions');
    if (!choice.choice.selected) { trace.push({ round, action: null, gain: 0 }); continue; }
    const action = choice.choice.action;
    check(payoff.has(action) && choice.choice.estimate === estimates.get(action), 'choice differs from estimates');
    const predicted = estimates.get(action);
    const duplicate = attempted.has(action);
    const observed = duplicate ? 0 : payoff.get(action);
    attempted.add(action);
    gain += observed;
    duplicates += Number(duplicate);
    unsupported += Number(predicted > 0 && observed === 0);
    predictionError += Math.abs(predicted - observed);
    usage.oracle_calls++;
    events.push([events.length, predicted, observed, 1, observed > 0 ? 1 : 0].join('\n'));
    append({ action, scope: s.scope, estimate: 0, verified: true });
    trace.push({ round, action, predicted, observed, duplicate, gain: observed });
  }

  const audit = invoke(binary, events, [], [], events.length, 0, 0, s.scope, 0);
  usage.native_calls++;
  usage.event_scans += audit.events.scanned;
  const quality = audit.events.quality;
  check(audit.events.scanned === events.length && quality.success + quality.failure === events.length &&
    quality.success === trace.filter(row => row.gain > 0).length && quality.unknown === 0,
    'kernel event audit disagrees with hidden oracle');
  const units = usage.host_items_considered + usage.document_scans + usage.candidate_scans +
    usage.event_scans + usage.oracle_calls;
  return { strategy, verified_gain: gain, simulated_compute_units: units,
    verified_gain_per_compute: Number((gain / units).toFixed(6)),
    duplicate_proposals: duplicates, unsupported_claims: unsupported,
    absolute_prediction_error: predictionError, usage, kernel_quality: quality,
    kernel_calibration: audit.events.calibration, trace };
}

export function runExploration() {
  const fixtureBytes = readFileSync(fixtures);
  const suite = JSON.parse(fixtureBytes.toString('utf8'));
  validate(suite);
  const built = buildKernel();
  try {
    return { schema: 1, ok: true, source_sha256: built.source_sha256,
      fixture_sha256: hash(fixtureBytes), bend_version: built.version,
      scenarios: suite.scenarios.map(s => ({ id: s.id,
        budget: { rounds: s.rounds, document_scan_per_round: s.document_scan,
          candidate_scan_per_round: s.actions.length, oracle_calls_per_round: 1 },
        results: ['bounded-evidence', 'recency'].map(strategy =>
          simulate(s, strategy, built.binary)) })) };
  } finally { rmSync(built.temp, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify(runExploration()) + '\n'); }
  catch (error) { process.stdout.write(JSON.stringify({ schema: 1, ok: false, error: error.message }) + '\n'); process.exitCode = 1; }
}
