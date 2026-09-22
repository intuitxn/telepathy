// Frozen before model calls. Re-score saved code; never starts a provider session.
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { gunzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const here = path.dirname(fileURLToPath(import.meta.url));
const hash = x => createHash('sha256').update(x).digest('hex');
export const spec = `Write only a JavaScript function declaration named schedule(events), at most 1800 words. No imports, tools, external calls, test execution or revisions. Inputs are JSON and must never be mutated. Return {states, ready}.
Process the events array in its given order. All events are objects with well-typed fields as described; IDs and workers are arbitrary nonempty strings including __proto__. Unknown event types and references to missing work IDs are ignored. Work event: {type:'work',id,deps,priority}, deps is an array of nonempty strings (duplicates allowed), priority is a safe integer. First work declaration for an id wins; later work events with that id are ignored. Dependencies may reference missing/future IDs or form cycles. New work starts pending with worker null. Dependencies are immutable.
Claim event: {type:'claim',id,worker}. Succeeds only when that item is pending, every direct dependency exists and is done, and no other claimed item has the same worker. Successful claim changes it to claimed with that worker. Unsuccessful claims have no effect. Empty-dependency pending work is ready. A worker can hold at most one claim.
Return event: {type:'return',id,worker,ok}, ok is boolean. Succeeds only for an item currently claimed by exactly that worker AND all direct dependencies still exist and are done. If successful, ok true sets done, ok false sets pending; both clear worker to null. Otherwise no effect. Completed items do not need worker ownership afterward.
Correction event: {type:'correct',id}. If id exists, compute the target plus ALL its transitive dependents in the currently declared graph, regardless of status (follow reverse dependency edges to a fixed point). Every affected non-revoked item becomes pending with worker null, including previously done/claimed descendants. Revoked items remain revoked. Old returns after correction cannot complete an item without a fresh valid claim, even if upstream work is repaired. Missing correction targets have no effect.
Revocation event: {type:'revoke',id}. If id exists, compute the same closure. Target becomes permanently revoked with worker null; every other affected non-revoked item becomes pending with worker null. Previously revoked nodes remain revoked forever. Re-declaring/correcting/re-returning never unrevokes an item. Missing revocation targets have no effect.
After all events, states is an array of {id,status,worker}, containing every declared item sorted by ascending JavaScript code-unit string order, not locale order. status is pending/claimed/done/revoked. ready is an array of pending IDs whose direct dependencies all exist and are done, sorted by descending priority then ascending code-unit ID. Cycles and missing, revoked or unfinished ancestors cannot be bypassed by claims. Do not truncate either output.`;
export const memory = { source: 'runtime/lorenz/README.md', finding: 'A corrected memory supersedes the old memory. Its descendants disappear from active-memory retrieval until explicitly rechecked and corrected against active dependencies. History preserves them as needs-review. This retained project finding suggests checking the full dependent closure and requiring explicit repair rather than silently restoring descendants.' };
export function oracle(events) {
  const records = [];
  const lookup = id => records.find(x => x.id === id);
  const ready = x => x.status === 'pending' && x.deps.every(id => lookup(id)?.status === 'done');
  for (const e of events) {
    if (e.type === 'work') { if (!lookup(e.id)) records.push({ id: e.id, deps: [...e.deps], priority: e.priority, status: 'pending', worker: null }); continue; }
    const item = lookup(e.id); if (!item) continue;
    if (e.type === 'claim' && ready(item) && !records.some(x => x.status === 'claimed' && x.worker === e.worker)) Object.assign(item, { status: 'claimed', worker: e.worker });
    if (e.type === 'return' && item.status === 'claimed' && item.worker === e.worker && item.deps.every(id => lookup(id)?.status === 'done')) Object.assign(item, { status: e.ok ? 'done' : 'pending', worker: null });
    if (e.type === 'correct' || e.type === 'revoke') {
      const affected = new Set([e.id]); let size;
      do { size = affected.size; for (const x of records) if (x.deps.some(id => affected.has(id))) affected.add(x.id); } while (size !== affected.size);
      for (const x of records) if (affected.has(x.id)) { x.status = x.status === 'revoked' || (e.type === 'revoke' && x.id === e.id) ? 'revoked' : 'pending'; x.worker = null; }
    }
  }
  const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  return { states: records.map(({ id, status, worker }) => ({ id, status, worker })).sort((a, b) => order(a.id, b.id)), ready: records.filter(ready).sort((a, b) => b.priority - a.priority || order(a.id, b.id)).map(x => x.id) };
}
const work = (id, deps = [], priority = 0) => ({ type: 'work', id, deps, priority });
const claim = (id, worker = 'worker') => ({ type: 'claim', id, worker });
const done = (id, worker = 'worker') => ({ type: 'return', id, worker, ok: true });
export function cases() {
  const chain = [work('a'), work('b', ['a']), work('c', ['b']), claim('a'), done('a'), claim('b'), done('b'), claim('c'), done('c')];
  const examples = [[], chain, [...chain, { type: 'correct', id: 'a' }], [...chain, { type: 'correct', id: 'a' }, claim('a'), done('a'), done('b')], [...chain, { type: 'revoke', id: 'b' }, { type: 'correct', id: 'b' }, work('b'), claim('b'), done('b')], [work('a', ['b']), work('b', ['a']), claim('a'), done('a'), claim('b')], [work('a', ['missing']), claim('a'), done('a')], [work('__proto__'), work('constructor'), claim('__proto__'), claim('constructor'), done('__proto__'), claim('constructor')], [work('A'), work('a'), work('Z'), work('z', [], 10)], [work('x'), claim('x'), done('x', 'other')], [work('x'), claim('x'), { type: 'return', id: 'x', worker: 'worker', ok: false }], [work('b', ['a', 'a']), work('a'), claim('a'), done('a'), claim('b')]];
  // Every prefix exercises intermediate states, not just mostly-blocked final graphs.
  let seed = 173091;
  const rand = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  for (let run = 0; run < 32; run++) {
    const events = []; const ids = ['a', 'b', 'c', 'd', '__proto__', 'Z'];
    for (let i = 0; i < 6; i++) events.push(work(ids[i], i && rand(3) ? [ids[rand(i)]] : [], rand(5) - 2));
    for (let i = 0; i < 80; i++) {
      const id = ids[rand(ids.length)]; const worker = ['x', 'y', '__proto__'][rand(3)]; const kind = rand(8);
      events.push(kind < 3 ? claim(id, worker) : kind < 6 ? { type: 'return', id, worker, ok: rand(4) !== 0 } : { type: kind === 6 ? 'correct' : 'revoke', id });
      if (i % 4 === 0) examples.push(structuredClone(events));
    }
  }
  return examples.map((input, i) => ({ name: `case-${i}`, input, expected: oracle(input) }));
}
export function score(source, examples) {
  const failures = [];
  for (const example of examples) {
    try {
      const context = vm.createContext({ input: JSON.stringify(example.input) }, { codeGeneration: { strings: false, wasm: false } });
      const output = vm.runInContext(`${source}\nconst events=JSON.parse(input); const before=JSON.stringify(events); const actual=schedule(events); JSON.stringify({actual,mutated:before!==JSON.stringify(events)});`, context, { timeout: 200 });
      const result = JSON.parse(output); assert.equal(result.mutated, false); assert.deepEqual(result.actual, example.expected);
    } catch (e) { failures.push({ case: example.name, error: e.message.slice(0, 300) }); }
  }
  return { correct: examples.length - failures.length, total: examples.length, failures };
}
async function main() {
  const protocolPath = path.join(here, 'workflow-transfer-protocol.json');
  if (process.argv[2] === 'freeze') {
    try { await fs.access(protocolPath + '.gz'); throw new Error('protocol already frozen'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    assert.deepEqual(oracle([work('a'), work('b', ['a']), claim('a'), done('a')]).ready, ['b']);
    assert.deepEqual(oracle([...cases()[1].input, { type: 'correct', id: 'a' }]).states.map(x => x.status), ['pending', 'pending', 'pending']);
    await fs.writeFile(protocolPath, JSON.stringify({ schema: 'workflow-transfer-paired-pilot-v1', spec, memory, limits: { timeout_ms: 120000, tools: 0, revisions: 0, max_output_words: 1800 }, cases: cases() }) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ frozen: true, cases: cases().length, protocol_sha256: hash(await fs.readFile(protocolPath)), evaluator_sha256: hash(await fs.readFile(fileURLToPath(import.meta.url))) })); return;
  }
  const prefix = process.argv[2] === 'initial' ? 'workflow-transfer-initial' : 'workflow-transfer';
  const raw = gunzipSync(await fs.readFile(protocolPath + '.gz')); const protocol = JSON.parse(raw); const metrics = JSON.parse(await fs.readFile(path.join(here, `${prefix}-metrics.json`))); const results = {};
  for (const arm of ['baseline', 'memory']) {
    const source = await fs.readFile(path.join(here, `${prefix}-${arm}.txt`), 'utf8');
    results[arm] = { ...score(source, protocol.cases), ...metrics[arm], code_sha256: hash(source), output_words: source.trim().split(/\s+/).length };
    results[arm].budget_compliant = results[arm].output_words <= protocol.limits.max_output_words && results[arm].toolCalls === 0;
  }
  const report = { frozen_evaluator_sha256: 'cd40f70ebdd2c19cf0eb2d87e7ecb9f739122e78e47618bfad2387b5422e3c51', report_plumbing_change: 'Report plumbing retains budget compliance, supports both initial and corrected follow-up trials, and reads losslessly gzipped fixtures; frozen decompressed protocol, oracle and scorer unchanged.', budget_compliant_comparison: Object.values(results).every(x => x.budget_compliant), schema: protocol.schema, protocol_sha256: hash(raw), evaluator_sha256: hash(await fs.readFile(fileURLToPath(import.meta.url))), results, accuracy_difference: (results.memory.correct - results.baseline.correct) / protocol.cases.length, limitation: 'One task and one compliant paired trial; initial policy-violating pair also retained. Fixed fixtures, no statistical or general-learning claim. Memory is supplied retained project prose, not autonomous retrieval.' };
  await fs.writeFile(path.join(here, `${prefix}-report.json`), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
