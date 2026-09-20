#!/usr/bin/env node
// Transport and evidence boundary only. All adaptive logic remains in system.bend.
// Explicit admit/replay/import execute local Bend source without an OS sandbox.
import fs from 'node:fs/promises';
import { cases, answers, probeEvidence, report, replayOutput } from './adaptive-evaluator.mjs';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify, isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const LIMIT = 1024 * 1024;
const EVALUATOR = 'adaptive-chunked-max-50-v1';
const SCHEMA = 'intuitxn-learning-bundle/v2';
const ADAPTIVE = { core: 'adaptive-max', contract: 'adaptive-max-v1', evaluator: EVALUATOR };
async function evaluator(core = 'adaptive-max') {
  if (core === 'adaptive-max') return ADAPTIVE;
  assert(core === 'lorenz-memory', 'unknown core');
  const module = await import('../lorenz/evaluate.mjs');
  return { ...module.metadata, evaluate: module.evaluate, validate: module.validate };
}
const coreOf = manifest => manifest.core || 'adaptive-max';
async function evaluatorDigest(core) {
  const name = core === 'adaptive-max' ? './adaptive-evaluator.mjs' : '../lorenz/evaluate.mjs';
  return hash(await read(fileURLToPath(new URL(name, import.meta.url))));
}
const bundleFiles = core => core === 'adaptive-max' ? FILES : ['system.bend', 'check.txt', 'report.json', 'probe.json'];
const FILES = ['system.bend', 'check.txt', 'report.json', 'record.txt', 'replay.txt', 'blocks.evidence', 'probe.json'];
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
async function verifyBundle(dir, expectedId) {
  await noLinks(dir);
  const raw = await read(path.join(dir, 'manifest.json'));
  const id = hash(raw);
  if (expectedId) assert(id === expectedId, 'manifest ID mismatch');
  const manifest = JSON.parse(raw);
  const adapter = await evaluator(coreOf(manifest));
  assert([SCHEMA, 'intuitxn-learning-bundle/v1'].includes(manifest.schema) && manifest.evaluator === adapter.evaluator, 'unsupported bundle schema/evaluator');
  if (manifest.schema === SCHEMA) {
    assert(manifest.core === adapter.core && manifest.contract === adapter.contract, 'unsupported core contract');
    assert(validHash(manifest.adapter_sha256) && manifest.evaluator_sha256 === await evaluatorDigest(adapter.core), 'unsupported evaluator revision');
  } else assert(!manifest.core && adapter.core === 'adaptive-max', 'invalid legacy core');
  assert(manifest.bend?.version === 'bend 2.0.21' && validHash(manifest.bend.sha256), 'unsupported toolchain receipt');
  assert(validHash(manifest.source_sha256), 'invalid source digest');
  const required = bundleFiles(adapter.core);
  const names = manifest.findings === 'agent-authored-unverified-narrative' ? [...required, 'findings.md'] : required;
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
  if (adapter.core === 'adaptive-max') {
    report(buffers['report.json'].toString());
    replayOutput(buffers['replay.txt'].toString());
    assert(isDeepStrictEqual(JSON.parse(buffers['probe.json']), probeEvidence), 'independent probe receipt mismatch');
  } else {
    assert(isDeepStrictEqual(JSON.parse(buffers['probe.json']), JSON.parse(buffers['report.json'])), 'probe/report mismatch');
    adapter.validate(JSON.parse(buffers['probe.json']));
  }
  return { id, manifest, buffers, raw };
}
async function admit(registry, sourceBytes, findingsBytes, core = 'adaptive-max') {
  const adapter = await evaluator(core);
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
    if (core === 'adaptive-max') {
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
    } else {
      const evidence = await adapter.evaluate({ bend, cwd: temp, run });
      adapter.validate(evidence);
      await write(path.join(temp, 'probe.json'), json(evidence));
      await write(path.join(temp, 'report.json'), json(evidence));
    }
    assert(hash(await read(path.join(temp, 'system.bend'))) === hash(sourceBytes), 'source changed during execution');
    assert(hash(await fs.readFile(bend)) === executableBefore, 'Bend executable changed during execution');
    const files = {};
    for (const name of findingsBytes === undefined ? bundleFiles(core) : [...bundleFiles(core), 'findings.md']) files[name] = hash(await read(path.join(temp, name)));
    const manifest = { schema: SCHEMA, core, contract: adapter.contract, evaluator: adapter.evaluator, evaluator_sha256: await evaluatorDigest(core), adapter_sha256: hash(await read(fileURLToPath(import.meta.url))), scope: core === 'adaptive-max' ? 'Bend checked source terms and independently compared chunked_max on 50 public fixed cases; adaptation outcomes remain author-controlled runtime reports' : 'Bend checked source terms and exercised fixed public Lorenz CLI fixtures; no universal memory quality claim', source_sha256: hash(sourceBytes),
      bend: { version, sha256: executableBefore }, findings: findingsBytes === undefined ? null : 'agent-authored-unverified-narrative', files };
    const raw = json(manifest);
    await write(path.join(temp, 'manifest.json'), raw);
    const id = hash(raw);
    await verifyBundle(temp, id);
    assert(!(await revoked(registry, id)), 'bundle is revoked');
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
    return { id, source_sha256: manifest.source_sha256, core, evaluator: adapter.evaluator, result: 'fresh-check-and-observed-runtime', path: dest };
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
async function revoked(registry, id) {
  try {
    const value = JSON.parse(await read(path.join(registry, 'revocations', id + '.json')));
    assert(value.schema === 'intuitxn-learning-revocation/v1' && value.id === id && typeof value.reason === 'string', 'invalid revocation');
    return true;
  } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function compact(registry, apply) {
  assert(apply === undefined || apply === '--apply', 'compact accepts only --apply');
  const files = new Map();
  let candidates = 0, bytes = 0, linked = 0;
  for (const area of ['entries', 'staged']) {
    const base = path.join(registry, area);
    await noLinks(base);
    let ids;
    try { ids = await fs.readdir(base); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    for (const id of ids.sort()) {
      if (id.startsWith('.pending-')) continue;
      assert(validHash(id), 'invalid entry name');
      const dir = path.join(base, id);
      const bundle = await verifyBundle(dir, id);
      for (const [name, digest] of Object.entries(bundle.manifest.files)) {
        const file = path.join(dir, name);
        const stat = await fs.lstat(file);
        const prior = files.get(digest);
        if (!prior) { files.set(digest, { file, stat }); continue; }
        if (prior.stat.dev === stat.dev && prior.stat.ino === stat.ino) continue;
        candidates++; bytes += stat.size;
        if (apply) {
          // Names never come from unvalidated inventories; write lock serializes registry mutations.
          const staging = await fs.mkdtemp(path.join(registry, '.compact-'));
          const link = path.join(staging, 'payload');
          try {
            await noLinks(prior.file); await noLinks(file);
            assert(hash(await read(prior.file)) === digest && hash(await read(file)) === digest, 'payload changed during compaction');
            await fs.link(prior.file, link);
            await fs.rename(link, file);
            linked++;
          } finally { await fs.rm(staging, { recursive: true, force: true }); }
        }
      }
      await verifyBundle(dir, id);
    }
  }
  return { dry_run: !apply, duplicate_payloads: candidates, reclaimable_bytes: bytes, linked_payloads: linked, evidence_deleted: 0, failures_deleted: 0, storage: 'hardlinks; registry files must be treated as immutable' };
}
async function lockedMain(args) {
  assert(['admit', 'list', 'find', 'replay', 'export', 'import', 'revoke', 'compact'].includes(args[0]), 'command must be first');
  assert(args[1] && !args[1].startsWith('--'), 'registry path must immediately follow command');
  if (!['admit', 'import', 'replay', 'revoke', 'compact'].includes(args[0]) || !args[1]) return main(args);
  const registry = await noLinks(args[1]);
  await directory(registry);
  const lock = path.join(registry, '.mutation-lock');
  const deadline = Date.now() + 60_000;
  while (true) {
    try { await fs.mkdir(lock, { mode: 0o700 }); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      await noLinks(lock);
      assert(Date.now() < deadline, 'registry mutation lock busy; inspect abandoned lock before retrying');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  try { return await main(args); } finally { await fs.rmdir(lock); }
}

async function main(args) {
  const options = {};
  args = args.filter((arg, i, all) => {
    if (['--core', '--query', '--limit'].includes(arg)) { assert(all[i + 1] && !all[i + 1].startsWith('--'), 'missing option value'); assert(options[arg] === undefined, 'duplicate option'); options[arg] = all[i + 1]; return false; }
    return !['--core', '--query', '--limit'].includes(all[i - 1]);
  });
  const [command, registryArg, idOrSource, destOrFindings] = args;
  const arity = { admit: [3, 4], list: [2], replay: [3], export: [4], import: [3, 4], find: [2], revoke: [4], compact: [2, 3] };
  assert(arity[command]?.includes(args.length), 'usage: admit REGISTRY SOURCE [FINDINGS] | list REGISTRY | replay REGISTRY ID | export REGISTRY ID DEST | import REGISTRY BUNDLE [--execute]');
  if (options['--core']) {
    assert(['admit', 'list', 'find'].includes(command), '--core unsupported for this command');
    await evaluator(options['--core']);
  }
  assert(command === 'find' || (!options['--query'] && !options['--limit']), 'retrieval options require find');
  if (command === 'find') {
    const limit = Number(options['--limit'] || 5);
    assert(Number.isInteger(limit) && limit >= 1 && limit <= 20, 'limit must be 1..20');
    assert(options['--query']?.trim() && options['--query'].length <= 4096, 'find needs bounded --query');
  }
  const registry = await noLinks(registryArg);
  if (command === 'admit') return admit(registry, await read(idOrSource), destOrFindings === undefined ? undefined : await read(destOrFindings), options['--core']);
  if (command === 'import') {
    assert(destOrFindings === undefined || destOrFindings === '--execute', 'import only accepts --execute');
    const bundle = await verifyBundle(idOrSource);
    assert(!(await revoked(registry, bundle.id)), 'bundle is revoked');
    if (destOrFindings === '--execute') return admit(registry, bundle.buffers['system.bend'], bundle.buffers['findings.md'], coreOf(bundle.manifest));
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
  if (command === 'compact') return compact(registry, idOrSource);
  if (command === 'revoke') {
    assert(validHash(idOrSource), 'invalid bundle ID');
    assert(destOrFindings.trim().length > 0 && destOrFindings.length <= 4096, 'invalid revocation reason');
    await directory(path.join(registry, 'revocations'));
    if (!(await revoked(registry, idOrSource))) await write(path.join(registry, 'revocations', idOrSource + '.json'), json({ schema: 'intuitxn-learning-revocation/v1', id: idOrSource, reason: destOrFindings }));
    return { id: idOrSource, revoked: true };
  }
  if (command === 'list' || command === 'find') {
    const entries = path.join(registry, 'entries');
    await noLinks(entries);
    const result = [];
    let ids;
    try { ids = await fs.readdir(entries); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    for (const id of ids.sort()) {
      assert(validHash(id), 'invalid registry entry name');
      if (await revoked(registry, id)) continue;
      const { manifest, buffers } = await verifyBundle(path.join(entries, id), id);
      if (options['--core'] && coreOf(manifest) !== options['--core']) continue;
      const narrative = buffers['findings.md']?.toString('utf8') || '';
      const tokens = new Set(narrative.toLowerCase().match(/[a-z0-9_]+/g) || []);
      const query = [...new Set((options['--query'] || '').toLowerCase().match(/[a-z0-9_]+/g) || [])];
      const score = query.filter(token => tokens.has(token)).length;
      if (command === 'find' && score === 0) continue;
      result.push({ id, core: coreOf(manifest), contract: manifest.contract || ADAPTIVE.contract, ...(command === 'find' ? { score, excerpt: narrative.slice(0, 1200), ranking: 'lexical-token-overlap; narrative unverified' } : {}), source_sha256: manifest.source_sha256, evaluator: manifest.evaluator, findings: manifest.findings, verification: 'receipt-integrity-only; replay performs fresh execution' });
    }
    if (command === 'find') {
      const limit = Number(options['--limit'] || 5);
      assert(Number.isInteger(limit) && limit >= 1 && limit <= 20, 'limit must be 1..20');
      assert(options['--query']?.trim() && options['--query'].length <= 4096, 'find needs bounded --query');
      return result.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
    }
    return result;
  }
  assert(validHash(idOrSource), 'invalid bundle ID');
  assert(!(await revoked(registry, idOrSource)), 'bundle is revoked');
  const bundle = await verifyBundle(path.join(registry, 'entries', idOrSource), idOrSource);
  if (command === 'replay') return admit(registry, bundle.buffers['system.bend'], bundle.buffers['findings.md'], coreOf(bundle.manifest));
  const dest = await noLinks(destOrFindings);
  await fs.mkdir(dest, { mode: 0o700 }); // Exclusive: never overwrite an existing destination.
  try {
    for (const [name, bytes] of Object.entries(bundle.buffers)) await write(path.join(dest, name), bytes);
    await write(path.join(dest, 'manifest.json'), bundle.raw);
    await verifyBundle(dest, bundle.id);
  } catch (error) { await fs.rm(dest, { recursive: true }); throw error; }
  return { id: bundle.id, exported: dest, verification: 'receipt-integrity-only; import --execute performs fresh execution' };
}

lockedMain(process.argv.slice(2)).then(result => process.stdout.write(json(result))).catch(error => {
  process.stderr.write(`registry: ${error.message}\n`);
  process.exitCode = 1;
});
