#!/usr/bin/env node
// Transport and evidence boundary only. All adaptive logic remains in system.bend.
// Explicit admit/replay/import execute local Bend source without an OS sandbox.
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify, isDeepStrictEqual } from 'node:util';

const exec = promisify(execFile);
const LIMIT = 1024 * 1024;
const EVALUATOR = 'adaptive-chunked-max-50-v1';
const SCHEMA = 'intuitxn-learning-bundle/v1';
const FILES = ['system.bend', 'check.txt', 'report.json', 'record.txt', 'replay.txt', 'blocks.evidence', 'probe.json'];
const cases = [];
function enumerate(prefix) {
  cases.push(prefix);
  if (prefix.length < 3) for (const value of [0, 1, 2]) enumerate([...prefix, value]);
}
enumerate([]);
cases.push([17, 4, 23, 23, 8], [1, 2], [2, 1], [23, 0], [0, 23], [7, 7, 7, 7], [5, 4, 3, 2, 1], [1, 2, 3, 4, 5], [0, 0, 0, 0], [23]);
const answers = cases.map(values => Math.max(0, ...values));
const probeEvidence = { scope: '50 public fixed examples; finite empirical checks, not a universal proof or hidden benchmark', cases, expected: answers, observed: answers };
const expected = {
  schema: 'intuitxn-adaptive-blocks/v1',
  adaptation: {
    experiment: 'fixed-fixture-bounded-policy-learning', forecast: { numerator: 5, denominator: 6 },
    surprise: true, no_shift_surprise: false, causal_confirmed: true,
    development: { baseline_correct: 4, exact_correct: 8, count: 8 },
    interventions: { paired_count: 4, reorder_shortcut_regressions: 4, sham_shortcut_regressions: 0, reorder_exact_regressions: 0 },
    final_admission: { adaptive: 1, disabled_learning: 0, no_surprise: 0 },
    adaptive: { policy: 1, heldout_correct: 8, heldout_count: 8, element_visits: 24, transfer_correct: 4, transfer_count: 4 },
    disabled_learning: { policy: 0, heldout_correct: 4, heldout_count: 8, element_visits: 8, transfer_correct: 3, transfer_count: 4 },
    no_surprise_control: { policy: 0, heldout_correct: 4, heldout_count: 8, element_visits: 8, transfer_correct: 3, transfer_count: 4 },
  },
  algebra: { original: 23, chunked: 23, transported: 23, empty_identity: 0, speedup_claimed: false },
  evidence: { ids_are_labels_not_hashes: true, history_size: 2, retained_failures: 1, counterexample_id: 12,
    counterexample_input: [1, 2], counterexample_observed: 1, counterexample_expected: 2,
    reused_source_id: 2, new_task_result: 23, changed_dependency_reuse: 0, algorithm_change_kind: 0, reformulation_kind: 1 },
  scope: 'finite authored kernels and fixtures; local reuse, no network synchronization or neural training',
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

async function noLinks(file) {
  const absolute = path.resolve(file);
  let cursor = path.parse(absolute).root;
  for (const part of absolute.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    try { assert(!(await fs.lstat(cursor)).isSymbolicLink(), `symlink rejected: ${cursor}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return absolute;
}
async function read(file) {
  await noLinks(file);
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    assert(stat.isFile() && stat.size <= LIMIT, `not a bounded regular file: ${file}`);
    const buffer = Buffer.alloc(LIMIT + 1);
    let count = 0;
    while (count < buffer.length) {
      const { bytesRead } = await handle.read(buffer, count, buffer.length - count, null);
      if (!bytesRead) break;
      count += bytesRead;
    }
    assert(count <= LIMIT, `oversized file: ${file}`);
    return buffer.subarray(0, count);
  } finally { await handle.close(); }
}
async function write(file, data) {
  assert(Buffer.byteLength(data) <= LIMIT, `oversized output: ${file}`);
  await fs.writeFile(file, data, { flag: 'wx', mode: 0o600 });
}
async function directory(dir) {
  await noLinks(dir);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  assert((await fs.lstat(dir)).isDirectory(), `not a directory: ${dir}`);
}
async function run(bend, args, cwd) {
  try {
    const { stdout, stderr } = await exec(bend, args, {
      cwd, timeout: 60_000, maxBuffer: LIMIT, env: { ...process.env, BEND_NO_TELEMETRY: '1' },
    });
    assert(!stderr.trim(), `unexpected Bend stderr: ${stderr.slice(0, 500)}`);
    return stdout;
  } catch (error) {
    throw new Error(`Bend command failed (${args[1] || args[0]}): ${String(error.stderr || error.message).slice(0, 2000)}`);
  }
}
function sourcePolicy(bytes) {
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const imports = source.split('\n').filter(line => /^\s*import\b/.test(line));
  assert(imports.length === 1 && imports[0].trim() === 'import Base', 'only one import Base is supported');
  // This is a dependency restriction, not an IO sandbox or a proof of usefulness.
  return source;
}
function report(text) {
  assert(isDeepStrictEqual(JSON.parse(text), expected), 'fixed evaluator report mismatch');
}
function replayOutput(text) {
  const lines = text.trim().split('\n');
  assert(lines.length === 3 && lines[0] === 'evidence_reused: stored text matches current computed evidence', 'invalid replay output');
  assert(isDeepStrictEqual(JSON.parse(lines[1]), { restored_source_id: 2, restored_task_result: 23 }), 'replay dispatch mismatch');
  report(lines[2]);
}
async function verifyBundle(dir, expectedId) {
  await noLinks(dir);
  const raw = await read(path.join(dir, 'manifest.json'));
  const id = hash(raw);
  if (expectedId) assert(id === expectedId, 'manifest ID mismatch');
  const manifest = JSON.parse(raw);
  assert(manifest.schema === SCHEMA && manifest.evaluator === EVALUATOR, 'unsupported bundle schema/evaluator');
  assert(manifest.bend?.version === 'bend 2.0.21' && validHash(manifest.bend.sha256), 'unsupported toolchain receipt');
  assert(validHash(manifest.source_sha256), 'invalid source digest');
  const names = manifest.findings === 'agent-authored-unverified-narrative' ? [...FILES, 'findings.md'] : FILES;
  assert(manifest.findings === null || manifest.findings === 'agent-authored-unverified-narrative', 'invalid findings label');
  assert(isDeepStrictEqual(Object.keys(manifest.files || {}).sort(), [...names].sort()), 'invalid file inventory');
  assert(isDeepStrictEqual((await fs.readdir(dir)).sort(), [...names, 'manifest.json'].sort()), 'unexpected bundle entries');
  const buffers = {};
  for (const name of names) {
    buffers[name] = await read(path.join(dir, name));
    assert(validHash(manifest.files[name]) && hash(buffers[name]) === manifest.files[name], `digest mismatch: ${name}`);
  }
  assert(hash(buffers['system.bend']) === manifest.source_sha256, 'source digest mismatch');
  sourcePolicy(buffers['system.bend']);
  assert(buffers['check.txt'].toString().trim() === 'All terms check.', 'missing checker evidence');
  report(buffers['report.json'].toString());
  replayOutput(buffers['replay.txt'].toString());
  assert(isDeepStrictEqual(JSON.parse(buffers['probe.json']), probeEvidence), 'independent probe receipt mismatch');
  return { id, manifest, buffers, raw };
}
async function admit(registry, sourceBytes, findingsBytes) {
  registry = await noLinks(registry);
  await directory(registry);
  await directory(path.join(registry, 'entries'));
  await directory(path.join(registry, 'failures'));
  await directory(path.join(registry, 'locks'));
  const temp = await fs.mkdtemp(path.join(registry, '.pending-'));
  let lock;
  try {
    sourcePolicy(sourceBytes);
    await write(path.join(temp, 'system.bend'), sourceBytes);
    if (findingsBytes !== undefined) await write(path.join(temp, 'findings.md'), findingsBytes);
    const bend = await fs.realpath(process.env.BEND || path.join(os.homedir(), '.bend/bin/bend'));
    const executableBefore = hash(await fs.readFile(bend));
    const version = (await run(bend, ['version'], temp)).trim();
    assert(version === 'bend 2.0.21', `unsupported Bend version: ${version}`);
    const check = await run(bend, ['system.bend', '--check-only'], temp);
    assert(check.trim() === 'All terms check.', 'checker success marker missing');
    await write(path.join(temp, 'check.txt'), check);
    const probeSource = 'import Base\nimport ./system.bend as S\n\ndef main() -> +List<Nat>:\n  [' + cases.map(values => `S.chunked_max([${values.map(value => `${value}n`).join(', ')}])`).join(', ') + ']\n';
    await write(path.join(temp, 'probe.bend'), probeSource);
    const probeOutput = (await run(bend, ['probe.bend'], temp)).trim();
    assert(/^\[\d+n(?:, \d+n)*\]$/.test(probeOutput), 'invalid independent probe output');
    const observed = JSON.parse(probeOutput.replace(/n/g, ''));
    assert(isDeepStrictEqual(observed, answers), 'independent chunked_max probe failed');
    await write(path.join(temp, 'probe.json'), json({ ...probeEvidence, observed }));
    await fs.unlink(path.join(temp, 'probe.bend'));
    const output = await run(bend, ['system.bend'], temp);
    report(output);
    await write(path.join(temp, 'report.json'), output);
    const record = await run(bend, ['system.bend', '--', 'record', 'blocks.evidence', 'system.bend'], temp);
    const recordLines = record.trim().split('\n');
    assert(recordLines.length === 2 && recordLines[0].startsWith('evidence_recorded:'), 'invalid record output');
    report(recordLines[1]);
    await write(path.join(temp, 'record.txt'), record);
    const replay = await run(bend, ['system.bend', '--', 'replay', 'blocks.evidence', 'system.bend'], temp);
    replayOutput(replay);
    await write(path.join(temp, 'replay.txt'), replay);
    assert(hash(await read(path.join(temp, 'system.bend'))) === hash(sourceBytes), 'source changed during execution');
    assert(hash(await fs.readFile(bend)) === executableBefore, 'Bend executable changed during execution');
    const files = {};
    for (const name of findingsBytes === undefined ? FILES : [...FILES, 'findings.md']) files[name] = hash(await read(path.join(temp, name)));
    const manifest = { schema: SCHEMA, evaluator: EVALUATOR, scope: 'Bend checked source terms and independently compared chunked_max on 50 public fixed cases; adaptation outcomes remain author-controlled runtime reports', source_sha256: hash(sourceBytes),
      bend: { version, sha256: executableBefore }, findings: findingsBytes === undefined ? null : 'agent-authored-unverified-narrative', files };
    const raw = json(manifest);
    await write(path.join(temp, 'manifest.json'), raw);
    const id = hash(raw);
    await verifyBundle(temp, id);
    lock = path.join(registry, 'locks', id);
    try { await fs.mkdir(lock, { mode: 0o700 }); }
    catch (error) { lock = undefined; throw new Error(`publication lock unavailable: ${error.code}; retry after the active writer finishes`); }
    const dest = path.join(registry, 'entries', id);
    try {
      await fs.lstat(dest);
      await verifyBundle(dest, id);
      await fs.rm(temp, { recursive: true });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await fs.rename(temp, dest);
    }
    return { id, source_sha256: manifest.source_sha256, evaluator: EVALUATOR, result: 'fresh-check-and-observed-runtime', path: dest };
  } catch (error) {
    try {
      await write(path.join(temp, 'failure.json'), json({ schema: 'intuitxn-learning-failure/v1', source_sha256: hash(sourceBytes), error: error.message }));
      await fs.rename(temp, path.join(registry, 'failures', path.basename(temp).replace('.pending-', 'attempt-')));
    } catch { /* Preserve original error; partial .pending directory is never listed as accepted. */ }
    throw error;
  } finally {
    if (lock) await fs.rmdir(lock);
    // Failed runs are retained as data; no entry is published until every check passes.
  }
}
async function main(args) {
  const [command, registryArg, idOrSource, destOrFindings] = args;
  const arity = { admit: [3, 4], list: [2], replay: [3], export: [4], import: [3, 4] };
  assert(arity[command]?.includes(args.length), 'usage: admit REGISTRY SOURCE [FINDINGS] | list REGISTRY | replay REGISTRY ID | export REGISTRY ID DEST | import REGISTRY BUNDLE [--execute]');
  const registry = await noLinks(registryArg);
  if (command === 'admit') return admit(registry, await read(idOrSource), destOrFindings === undefined ? undefined : await read(destOrFindings));
  if (command === 'import') {
    assert(destOrFindings === undefined || destOrFindings === '--execute', 'import only accepts --execute');
    const bundle = await verifyBundle(idOrSource);
    if (destOrFindings === '--execute') return admit(registry, bundle.buffers['system.bend'], bundle.buffers['findings.md']);
    await directory(registry);
    await directory(path.join(registry, 'staged'));
    const temp = await fs.mkdtemp(path.join(registry, 'staged', '.pending-'));
    try {
      for (const [name, bytes] of Object.entries(bundle.buffers)) await write(path.join(temp, name), bytes);
      await write(path.join(temp, 'manifest.json'), bundle.raw);
      const dest = path.join(registry, 'staged', bundle.id);
      try { await fs.rename(temp, dest); }
      catch (error) {
        if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
        await verifyBundle(dest, bundle.id);
        await fs.rm(temp, { recursive: true });
      }
      return { id: bundle.id, staged: dest, executed: false, verification: 'receipt-integrity-only; use import --execute for fresh local execution' };
    } catch (error) { await fs.rm(temp, { recursive: true, force: true }); throw error; }
  }
  if (command === 'list') {
    const entries = path.join(registry, 'entries');
    await noLinks(entries);
    const result = [];
    let ids;
    try { ids = await fs.readdir(entries); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    for (const id of ids.sort()) {
      assert(validHash(id), 'invalid registry entry name');
      const { manifest } = await verifyBundle(path.join(entries, id), id);
      result.push({ id, source_sha256: manifest.source_sha256, evaluator: manifest.evaluator, findings: manifest.findings, verification: 'receipt-integrity-only; replay performs fresh execution' });
    }
    return result;
  }
  assert(validHash(idOrSource), 'invalid bundle ID');
  const bundle = await verifyBundle(path.join(registry, 'entries', idOrSource), idOrSource);
  if (command === 'replay') return admit(registry, bundle.buffers['system.bend'], bundle.buffers['findings.md']);
  const dest = await noLinks(destOrFindings);
  await fs.mkdir(dest, { mode: 0o700 }); // Exclusive: never overwrite an existing destination.
  try {
    for (const [name, bytes] of Object.entries(bundle.buffers)) await write(path.join(dest, name), bytes);
    await write(path.join(dest, 'manifest.json'), bundle.raw);
    await verifyBundle(dest, bundle.id);
  } catch (error) { await fs.rm(dest, { recursive: true }); throw error; }
  return { id: bundle.id, exported: dest, verification: 'receipt-integrity-only; import --execute performs fresh execution' };
}

main(process.argv.slice(2)).then(result => process.stdout.write(json(result))).catch(error => {
  process.stderr.write(`registry: ${error.message}\n`);
  process.exitCode = 1;
});
