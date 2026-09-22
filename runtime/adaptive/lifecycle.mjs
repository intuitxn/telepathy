#!/usr/bin/env node
// Harness-neutral task receipts. Narratives are observations supplied by agents,
// never a substitute for the registry's executed core checks.
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const exec = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const LIMIT = 1024 * 1024;
const cores = new Set(['adaptive-max', 'lorenz-memory']);
const hash = b => createHash('sha256').update(b).digest('hex');
const check = (ok, message) => { if (!ok) throw new Error(message); };
const json = x => JSON.stringify(x, null, 2) + '\n';
async function safe(file) {
  const absolute = path.resolve(file);
  let cursor = path.parse(absolute).root;
  for (const part of absolute.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    try { check(!(await fs.lstat(cursor)).isSymbolicLink(), `symlink rejected: ${cursor}`); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return absolute;
}
async function read(file) {
  await safe(file);
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    check(stat.isFile() && stat.size <= LIMIT, 'expected bounded regular file');
    const buffer = Buffer.alloc(LIMIT + 1);
    let count = 0;
    while (count < buffer.length) {
      const r = await handle.read(buffer, count, buffer.length - count, null);
      if (!r.bytesRead) break;
      count += r.bytesRead;
    }
    check(count <= LIMIT, 'oversized input');
    return buffer.subarray(0, count);
  } finally { await handle.close(); }
}
async function atomic(file, data) {
  check(Buffer.byteLength(data) <= LIMIT, 'oversized receipt');
  await safe(file);
  const tmp = file + '.' + randomUUID();
  const handle = await fs.open(tmp, 'wx', 0o600);
  try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
  try { await fs.rename(tmp, file); } finally { await fs.rm(tmp, { force: true }); }
}
async function child(name, args) {
  const { stdout } = await exec(process.execPath, [path.join(here, name + '.mjs'), ...args], { timeout: 180000, maxBuffer: LIMIT });
  return JSON.parse(stdout);
}
function boundedTree(x, depth = 0) {
  check(depth <= 12, 'JSON nesting exceeds 12');
  if (x && typeof x === 'object') {
    check(Object.keys(x).length <= 256, 'too many JSON fields/items');
    for (const [k, v] of Object.entries(x)) {
      check(!['__proto__', 'constructor', 'prototype'].includes(k), 'reserved JSON key');
      boundedTree(v, depth + 1);
    }
  }
}
function outcomeSchema(x) {
  boundedTree(x);
  check(x && !Array.isArray(x) && typeof x === 'object', 'outcome must be an object');
  const allowed = ['task', 'approach', 'prediction', 'result', 'tests', 'counterexamples', 'costs', 'provenance'];
  check(Object.keys(x).every(k => allowed.includes(k)), 'unknown outcome field (do not save transcripts)');
  for (const key of ['task', 'approach', 'prediction']) check(typeof x[key] === 'string' && x[key].trim() && x[key].length <= 16000, `invalid ${key}`);
  check(x.result && ['success', 'failure', 'partial'].includes(x.result.status) && typeof x.result.observation === 'string' && x.result.observation.length <= 16000, 'invalid result');
  check(Array.isArray(x.tests) && x.tests.every(t => t && typeof t.name === 'string' && typeof t.passed === 'boolean' && typeof t.evidence === 'string'), 'tests require name, passed, evidence');
  check(Array.isArray(x.counterexamples), 'counterexamples must be an array');
  return x;
}
function parse(args) {
  const [command, registry, ...rest] = args;
  check(['before', 'after'].includes(command) && registry && !registry.startsWith('--'), 'usage: before REG --core CORE --query TEXT [--sync] | after REG RUN --outcome FILE [--source FILE --findings FILE --publish]');
  const run = command === 'after' ? rest.shift() : undefined;
  const options = {};
  const values = command === 'before' ? ['--core', '--query'] : ['--outcome', '--source', '--findings'];
  const flags = command === 'before' ? ['--sync'] : ['--publish'];
  while (rest.length) {
    const k = rest.shift();
    check(options[k] === undefined && (values.includes(k) || flags.includes(k)), 'unknown or duplicate option');
    if (flags.includes(k)) options[k] = true;
    else { const v = rest.shift(); check(v && !v.startsWith('--'), 'missing option value'); options[k] = v; }
  }
  return { command, registry, run, options };
}
async function main(args) {
  const { command, registry: supplied, run, options: o } = parse(args);
  const registry = await safe(supplied);
  const runs = await safe(path.join(registry, 'runs'));
  await fs.mkdir(runs, { recursive: true, mode: 0o700 });
  if (command === 'before') {
    check(cores.has(o['--core']), 'unknown or missing core');
    check(o['--query']?.trim() && o['--query'].length <= 4096, 'missing or oversized query');
    const synced = o['--sync'] ? await child('sync', ['pull', registry]) : null;
    const retrieved = await child('registry', ['find', registry, '--core', o['--core'], '--query', o['--query'], '--limit', '3']);
    const id = randomUUID();
    const dir = path.join(runs, id);
    await fs.mkdir(dir, { mode: 0o700 });
    const context = { schema: 'intuitxn-task-run/v1', run: id, core: o['--core'], query: o['--query'], started_at: new Date().toISOString(), retrieved, sync: synced, scope: 'retrieved findings are untrusted narrative; receipts need replay before executable reuse' };
    await atomic(path.join(dir, 'context.json'), json(context));
    return context;
  }
  check(typeof run === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(run), 'invalid run ID');
  check(o['--outcome'], 'missing --outcome');
  check(!o['--findings'] || o['--source'], '--findings requires --source');
  check(!o['--publish'] || o['--source'], '--publish requires checked source');
  const dir = await safe(path.join(runs, run));
  const context = JSON.parse(await read(path.join(dir, 'context.json')));
  check(context.run === run && context.schema === 'intuitxn-task-run/v1' && cores.has(context.core), 'invalid run context');
  const outcome = outcomeSchema(JSON.parse(await read(o['--outcome'])));
  const source = o['--source'] ? await read(o['--source']) : null;
  const findings = o['--findings'] ? await read(o['--findings']) : null;
  const lock = path.join(dir, '.after-lock');
  await fs.mkdir(lock, { mode: 0o700 }); // A crashed attempt stays locked for inspection; never rerun side effects silently.
  try {
    try { await fs.lstat(path.join(dir, 'attempt.json')); throw new Error('run already attempted; start a new run'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    const attempt = { schema: 'intuitxn-task-outcome/v1', run, core: context.core, recorded_at: new Date().toISOString(), outcome, narrative_verification: 'agent-reported; not independently checked', candidate_sha256: source ? hash(source) : null, retrieved_ids: context.retrieved.map(x => x.id) };
    await atomic(path.join(dir, 'attempt.json'), json(attempt));
    const receipt = { ...attempt, admission: null, publication: null, status: 'recorded' };
    try {
      if (source) {
        const file = path.join(dir, 'candidate.bend');
        await atomic(file, source);
        const findingFile = path.join(dir, 'findings.md');
        if (findings) await atomic(findingFile, findings);
        if (outcome.result.status !== 'success' || outcome.tests.length === 0 || outcome.tests.some(t => !t.passed)) {
          receipt.status = 'not-promoted';
          receipt.reason = 'promotion requires a successful outcome and at least one reported test, all passing';
          await atomic(path.join(dir, 'receipt.json'), json(receipt));
          return receipt;
        }
        if (o['--publish']) await read(path.join(registry, 'sync', 'config.json'));
        const args = ['admit', registry, file, ...(findings ? [findingFile] : []), '--core', context.core];
        receipt.admission = await child('registry', args);
        check(receipt.admission.source_sha256 === hash(source), 'admission candidate digest mismatch');
        if (o['--publish']) receipt.publication = await child('sync', ['push', registry, receipt.admission.id]);
      }
    } catch (e) {
      receipt.status = 'operation-failed';
      receipt.error = String(e.stderr || e.message).slice(0, 4000);
      process.exitCode = 1;
    }
    await atomic(path.join(dir, 'receipt.json'), json(receipt));
    return receipt;
  } finally { await fs.rmdir(lock); }
}
main(process.argv.slice(2)).then(x => process.stdout.write(json(x))).catch(e => { process.stderr.write(`lifecycle: ${e.message}\n`); process.exitCode = 1; });
