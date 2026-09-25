#!/usr/bin/env node
// A keyless, closed-world discovery pilot. The policy sees the model family,
// probe domain, and its own receipts. Only this host owns the simulator law and
// the disjoint held-out domain. This is a benchmark, not evidence about nature.
import { spawnSync } from 'node:child_process';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const kernelFile = join(root, 'runtime/core/telepathy.bend');
const MOD = 5;
const ROUNDS = 6;
const CASES = 8;
const ORACLE_UNIT = 1000;
const strategies = ['evidence', 'recency', 'no-context'];
const probes = Object.freeze(Array.from({ length: 16 }, (_, id) =>
  Object.freeze({ id, x: Math.floor(id / 4), z: id % 4 })));
const heldout = Object.freeze(Array.from({ length: 25 }, (_, id) =>
  Object.freeze({ id, x: Math.floor(id / 5), z: id % 5 }))
  .filter(point => point.x === 4 || point.z === 4));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => JSON.stringify(value);
function check(ok, message) { if (!ok) throw new Error('discovery benchmark: ' + message); }

function models() {
  const all = [];
  for (let a = 0; a < MOD; a++) for (let b = 0; b < MOD; b++)
    for (let c = 0; c < MOD; c++) all.push(Object.freeze({ id: a * 25 + b * 5 + c, a, b, c }));
  return Object.freeze(all);
}
const bank = models();
function response(family, model, point) {
  return (family === 'additive'
    ? model.a * point.x + model.b * point.z + model.c
    : model.a * point.x * point.z + model.b * point.x + model.c) % MOD;
}
function truthResponse(spec, point) {
  const base = response(spec.family, spec.law, point);
  if (!spec.out_of_bank) return base;
  // These two extensions cannot be represented by the announced bank over the
  // full grid. A fit on the first three measured points is not a proof.
  return (base + (spec.family === 'additive' ? point.x * point.z : point.z)) % MOD;
}
function caseFor(seed, index) {
  const family = index % 2 === 0 ? 'additive' : 'interaction';
  const bytes = createHmac('sha256', seed).update(`case:${index}`).digest();
  const anomalyBytes = createHmac('sha256', seed).update('out-of-bank-cases').digest();
  const law = bank[(bytes[0] % 5) * 25 + (bytes[1] % 5) * 5 + bytes[2] % 5];
  const id = `${family}-${index + 1}`;
  const out_of_bank = index === 2 * (anomalyBytes[0] % 4) ||
    index === 2 * (anomalyBytes[1] % 4) + 1;
  const censored_probes = Object.freeze([0, [1, 2, 4, 5][bytes[3] % 4]]);
  // The commitment is keyed until the seed is revealed in the final report.
  // It binds the hidden law, censor rule, and held-out cases before any policy runs.
  const case_sha256 = createHmac('sha256', seed).update(canonical({
    id, family, law, out_of_bank, censored_probes, heldout,
  })).digest('hex');
  return Object.freeze({ id, family, law, out_of_bank, censored_probes, case_sha256 });
}

function command(binary, args, timeout = 120000) {
  const result = spawnSync(binary, args, {
    cwd: root, encoding: 'utf8', timeout, maxBuffer: 1024 * 1024,
    env: { PATH: process.env.PATH || '/usr/bin:/bin', HOME: '/nonexistent', BEND_NO_TELEMETRY: '1' },
  });
  check(!result.error && result.status === 0 && !result.signal,
    `${binary} failed: ${result.stderr || result.stdout || result.error?.message || result.status}`);
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
  if (process.platform === 'darwin')
    return command('/usr/bin/sandbox-exec', ['-p', seatbeltProfile(binary), '--', binary, ...args], 30000);
  if (process.platform === 'linux') {
    const mounts = ['--tmpfs', '/', '--dev', '/dev', '--proc', '/proc', '--dir', '/usr'];
    for (const directory of ['/lib', '/lib64', '/usr/lib', '/usr/lib64']) {
      try { realpathSync(directory); mounts.push('--ro-bind', directory, directory); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return command('bwrap', ['--unshare-all', '--die-with-parent', '--new-session', '--clearenv',
      '--setenv', 'HOME', '/', '--setenv', 'PATH', '/usr/bin:/bin', ...mounts,
      '--ro-bind', binary, '/program', '--chdir', '/', '--', '/program', ...args], 30000);
  }
  throw new Error('discovery benchmark requires macOS Seatbelt or Linux Bubblewrap');
}
function buildKernel() {
  const source = readFileSync(kernelFile);
  const code = source.toString('utf8');
  check((code.match(/^\s*import\s+[^\n]+$/gm) || []).every(line => /^\s*import\s+Base\s*$/.test(line)),
    'kernel may import only Base');
  const bend = process.env.BEND_BINARY || process.env.BEND || 'bend';
  const version = command(bend, ['version']).trim().split('\n')[0];
  check(version.startsWith('bend '), 'Bend version is invalid');
  check(command(bend, [kernelFile, '--check-only']).includes('All terms check.'), 'Bend check failed');
  const temp = mkdtempSync(join(tmpdir(), 'telepathy-discovery-'));
  try {
    const binary = join(temp, 'kernel');
    command(bend, [kernelFile, '-o', binary]);
    check(sha(readFileSync(kernelFile)) === sha(source), 'kernel changed during build');
    return { binary, temp, version, sha256: sha(source) };
  } catch (error) { rmSync(temp, { recursive: true, force: true }); throw error; }
}
function kernelChoice(binary, scores, used) {
  const rows = scores.map((score, id) => [id, used.has(id) ? 0 : 1, 1, score].join('\n'));
  const output = native(binary, ['batch', '0', String(rows.length), '0', '0', '0', '', rows.join('\n'), '']);
  const result = JSON.parse(output);
  check(result.schema === 'telepathy.kernel/v4' && result.choice.scanned === probes.length &&
    result.choice.selected && !result.choice.exhausted, 'Bend did not select the complete funded frontier');
  check(!used.has(result.choice.action) && scores[result.choice.action] > 0, 'Bend selected an invalid probe');
  return result.choice.action;
}
function frontierFor(strategy, family, receipts, usage) {
  const evidence = strategy === 'evidence' ? receipts.filter(row => row.observed !== null)
    : strategy === 'recency' ? receipts.filter(row => row.observed !== null).slice(-1) : [];
  return bank.filter(model => evidence.every(row => {
    usage.model_evaluations++;
    return response(family, model, probes[row.point]) === row.observed;
  }));
}
function histogram(family, frontier, point, usage) {
  const counts = [0, 0, 0, 0, 0];
  for (const model of frontier) {
    counts[response(family, model, point)]++;
    usage.model_evaluations++;
  }
  return counts;
}
function predicted(counts) {
  return counts.indexOf(Math.max(...counts));
}
function actionScores(strategy, family, frontier, used, usage) {
  return probes.map(point => {
    if (used.has(point.id)) return 0;
    if (strategy === 'no-context') return 1;
    const counts = histogram(family, frontier, point, usage);
    // N^2 - sum(n_y^2) is proportional to expected hypotheses eliminated.
    // At N <= 125 it fits Bend's canonical 0..65535 integer contract.
    return Math.max(1, frontier.length ** 2 - counts.reduce((sum, n) => sum + n * n, 0));
  });
}
function falsificationScores(used) {
  // A distant corner probes a consequence of the fitted law outside the
  // observations used to fit it. Bend still chooses the funded maximum.
  return probes.map(point => used.has(point.id) ? 0 :
    1 + point.x * point.z + point.x + point.z);
}
function makeOracle(spec, source_sha256, kernel_sha256) {
  const pending = new Map();
  const receipts = [];
  let previous = sha(`genesis:${spec.case_sha256}`);
  return Object.freeze({
    commit({ round, point, prediction, frontier_sha256 }) {
      check(Number.isInteger(round) && round === receipts.length + 1 && !pending.has(round), 'round is invalid');
      check(probes[point] && Number.isInteger(prediction) && prediction >= 0 && prediction < MOD,
        'proposal is invalid');
      const payload = Object.freeze({ case_sha256: spec.case_sha256, source_sha256,
        kernel_sha256, round, point, prediction, frontier_sha256, previous });
      const commitment_sha256 = sha(canonical(payload));
      pending.set(round, { payload, commitment_sha256 });
      return Object.freeze({ payload, commitment_sha256 });
    },
    observe(round, commitment_sha256) {
      const entry = pending.get(round);
      check(entry && entry.commitment_sha256 === commitment_sha256, 'uncommitted or altered prediction');
      pending.delete(round);
      const observed = spec.censored_probes.includes(entry.payload.point) ? null :
        truthResponse(spec, probes[entry.payload.point]);
      const classification = observed === null ? 'unknown' : observed === 0 ? 'negative' : 'positive';
      const receipt = Object.freeze({ ...entry.payload, commitment_sha256, observed, classification,
        receipt_sha256: sha(canonical({ commitment_sha256, observed, classification, previous })) });
      previous = receipt.receipt_sha256;
      receipts.push(receipt);
      return receipt;
    },
    // The runner calls this once after the probe budget. No policy callback
    // receives it, the hidden law, or the held-out responses.
    score(chosenModel, usage) {
      check(pending.size === 0 && receipts.length > 0 && receipts.length <= ROUNDS &&
        (chosenModel === null || bank[chosenModel.id] === chosenModel),
      'score requires a bounded settled transcript and a bank law or abstention');
      let correct = 0;
      for (const point of heldout) {
        usage.heldout_checks++;
        if (chosenModel !== null && response(spec.family, chosenModel, point) === truthResponse(spec, point)) correct++;
      }
      return Object.freeze({ heldout_correct: correct, heldout_total: heldout.length,
        exact_law: chosenModel !== null && !spec.out_of_bank && chosenModel.id === spec.law.id,
        supported_abstention: chosenModel === null && spec.out_of_bank,
        false_law_claim: chosenModel !== null && (spec.out_of_bank || chosenModel.id !== spec.law.id) });
    },
  });
}

function episode(spec, strategy, built, source_sha256, proposalTransform) {
  const oracle = makeOracle(spec, source_sha256, built.sha256);
  const usage = { model_evaluations: 0, kernel_scans: 0, kernel_calls: 0,
    experiment_calls: 0, heldout_checks: 0 };
  const used = new Set();
  const receipts = [];
  const trace = [];
  let falsificationDone = false;
  for (let round = 1; round <= ROUNDS; round++) {
    const frontier = frontierFor(strategy, spec.family, receipts, usage);
    if (frontier.length === 0 || (frontier.length === 1 && falsificationDone)) break;
    const frontier_sha256 = sha(canonical(frontier.map(model => model.id)));
    const falsification = frontier.length === 1;
    const scores = falsification ? falsificationScores(used) :
      actionScores(strategy, spec.family, frontier, used, usage);
    const point = kernelChoice(built.binary, scores, used);
    usage.kernel_calls++;
    usage.kernel_scans += probes.length;
    const prediction = predicted(histogram(spec.family, frontier, probes[point], usage));
    const proposed = Object.freeze({ round, point, prediction, frontier_sha256 });
    const visibleReceipts = strategy === 'evidence' ? receipts : strategy === 'recency' ?
      receipts.filter(row => row.observed !== null).slice(-1) : [];
    const submitted = proposalTransform ? proposalTransform(proposed, Object.freeze({
      id: spec.id, family: spec.family, receipts: Object.freeze([...visibleReceipts]),
    })) : proposed;
    check(submitted && submitted.round === round && submitted.point === point &&
      Number.isInteger(submitted.prediction) && submitted.prediction >= 0 && submitted.prediction < MOD &&
      submitted.frontier_sha256 === frontier_sha256, 'agent changed the funded probe or frontier');
    // claimed_score, if supplied by an agent, has no route into host scoring.
    const commitment = oracle.commit(submitted);
    const receipt = oracle.observe(round, commitment.commitment_sha256);
    if (falsification) falsificationDone = true;
    used.add(point);
    receipts.push(receipt);
    usage.experiment_calls++;
    trace.push({ round, point, predicted: submitted.prediction, observed: receipt.observed,
      classification: receipt.classification, falsification, frontier_before: frontier.length,
      frontier_sha256, commitment_sha256: commitment.commitment_sha256,
      receipt_sha256: receipt.receipt_sha256, previous: commitment.payload.previous });
  }
  const finalFrontier = frontierFor(strategy, spec.family, receipts, usage);
  const chosen = finalFrontier[0] ?? null;
  const verified = oracle.score(chosen, usage);
  const stop_reason = finalFrontier.length === 0 ? 'refuted' :
    finalFrontier.length === 1 && falsificationDone ? 'falsification-passed' : 'budget';
  const total_compute_units = usage.model_evaluations + usage.kernel_scans +
    ORACLE_UNIT * (usage.experiment_calls + usage.heldout_checks);
  return { strategy, case_sha256: spec.case_sha256, chosen_law: chosen?.id ?? null,
    stop_reason, final_frontier: finalFrontier.length,
    final_frontier_sha256: sha(canonical(finalFrontier.map(model => model.id))),
    ...verified, negative: receipts.filter(row => row.classification === 'negative').length,
    unknown: receipts.filter(row => row.classification === 'unknown').length,
    prediction_matches: receipts.filter(row => row.observed !== null && row.prediction === row.observed).length,
    total_compute_units, correct_per_1000_compute: Number((1000 * verified.heldout_correct / total_compute_units).toFixed(6)),
    usage, trace };
}

/** Fresh entropy is the default. A 64-hex seed allows exact local replay.
 * proposalTransform is a test seam for untrusted agent proposals; it receives
 * no oracle or held-out handle and cannot supply the reported score. */
export function runDiscovery({ seedHex = randomBytes(32).toString('hex'), proposalTransform = null } = {}) {
  check(typeof seedHex === 'string' && /^[a-f0-9]{64}$/.test(seedHex), 'seed must be 64 lowercase hex characters');
  check(proposalTransform === null || typeof proposalTransform === 'function', 'proposalTransform must be a function');
  const seed = Buffer.from(seedHex, 'hex');
  const sourceBefore = readFileSync(fileURLToPath(import.meta.url));
  const source_sha256 = sha(sourceBefore);
  const specs = Array.from({ length: CASES }, (_, index) => caseFor(seed, index));
  const case_set_sha256 = createHmac('sha256', seed).update(canonical(specs.map(spec => spec.case_sha256))).digest('hex');
  const built = buildKernel();
  try {
    const cases = specs.map(spec => ({ id: spec.id, family: spec.family,
      case_sha256: spec.case_sha256,
      truth_class_after_score: spec.out_of_bank ? 'out-of-bank' : 'in-bank',
      results: strategies.map(strategy => episode(spec, strategy, built, source_sha256, proposalTransform)) }));
    check(sha(readFileSync(fileURLToPath(import.meta.url))) === source_sha256, 'source changed during run');
    const aggregate = strategies.map(strategy => {
      const rows = cases.map(item => item.results.find(row => row.strategy === strategy));
      const heldout_correct = rows.reduce((sum, row) => sum + row.heldout_correct, 0);
      const total_compute_units = rows.reduce((sum, row) => sum + row.total_compute_units, 0);
      return { strategy, heldout_correct, heldout_total: rows.length * heldout.length,
        exact_laws: rows.filter(row => row.exact_law).length,
        supported_abstentions: rows.filter(row => row.supported_abstention).length,
        false_law_claims: rows.filter(row => row.false_law_claim).length,
        negative: rows.reduce((sum, row) => sum + row.negative, 0),
        unknown: rows.reduce((sum, row) => sum + row.unknown, 0),
        total_compute_units,
        correct_per_1000_compute: Number((1000 * heldout_correct / total_compute_units).toFixed(6)) };
    });
    return { schema: 'telepathy.discovery-benchmark/v1', ok: true,
      source_sha256, kernel_sha256: built.sha256, bend_version: built.version,
      case_set_sha256, seed_reveal: seedHex,
      budget: { cases: CASES, rounds_per_case: ROUNDS, probes_per_round: 1,
        candidate_scan_per_round: probes.length, heldout_per_case: heldout.length,
        oracle_unit: ORACLE_UNIT }, aggregate, cases };
  } finally { rmSync(built.temp, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify(runDiscovery({ seedHex: process.argv[2] })) + '\n'); }
  catch (error) { process.stdout.write(JSON.stringify({ schema: 'telepathy.discovery-benchmark/v1', ok: false,
    error: error.message }) + '\n'); process.exitCode = 1; }
}
