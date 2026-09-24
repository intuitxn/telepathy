#!/usr/bin/env node
// External experiment runner. The executable algorithms remain in system.bend.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';

const exec = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const budget = Object.freeze({ max_elements_per_task: 32, max_tasks: 128, process_timeout_ms: 60000 });
const contract = 'maximum-nonempty-naturals-v1';
const evaluator = 'transfer-v1';
const bend = process.env.BEND || path.join(os.homedir(), '.bend/bin/bend');

async function runBend(args, cwd) {
  const started = performance.now();
  const { stdout } = await exec(bend, args, {
    cwd, timeout: budget.process_timeout_ms, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, BEND_NO_TELEMETRY: '1' },
  });
  return { stdout, elapsed_ms: Math.round(performance.now() - started) };
}

async function evaluate(dir, policy, tasks, label) {
  assert(tasks.length <= budget.max_tasks);
  for (const values of tasks) {
    assert(values.length > 0 && values.length <= budget.max_elements_per_task);
    assert(values.every(v => Number.isSafeInteger(v) && v >= 0 && v <= 1000));
  }
  assert(['first', 'chunked_max'].includes(policy));
  const literal = values => '[' + values.map(v => `${v}n`).join(', ') + ']';
  const calls = tasks.map(values => policy === 'first'
    ? `S.solve(0n, ${values[0]}n, ${literal(values.slice(1))})`
    : `S.chunked_max(${literal(values)})`);
  const probe = `import Base\nimport ./system.bend as S\n\ndef main() -> +List<Nat>:\n  [${calls.join(', ')}]\n`;
  await fs.writeFile(path.join(dir, `${label}.bend`), probe);
  const result = await runBend([`${label}.bend`], dir);
  assert(/^\[\d+n(?:, \d+n)*\]\s*$/.test(result.stdout), 'Unexpected Bend output');
  const observed = JSON.parse(result.stdout.replace(/n/g, ''));
  assert.equal(observed.length, tasks.length);
  const expected = tasks.map(values => Math.max(...values));
  return { policy, correct: observed.filter((v, i) => v === expected[i]).length,
    total: tasks.length, observed, expected,
    element_visits: tasks.reduce((sum, values) => sum + (policy === 'first' ? 1 : values.length), 0),
    elapsed_ms: result.elapsed_ms, probe_sha256: hash(probe) };
}

// Each treatment is a separate Node and Bend process. It reads only the frozen
// evidence variant, source snapshot and tasks. No training state is inherited.
async function worker(dir, arm) {
  const memory = JSON.parse(await fs.readFile(path.join(dir, `${arm}.memory.json`), 'utf8'));
  const sourceHash = hash(await fs.readFile(path.join(dir, 'system.bend')));
  const applicable = memory.filter(m => m.contract === contract && m.evaluator === evaluator
    && m.source_sha256 === sourceHash && m.block === 'chunked_max'
    && m.training_correct === m.training_total && m.training_total > 0
    && m.baseline_failures > 0);
  const policy = arm === 'exact_without_memory' ? 'chunked_max' : applicable.length ? 'chunked_max' : 'first';
  const tasks = JSON.parse(await fs.readFile(path.join(dir, 'tasks.json'), 'utf8'));
  const result = await evaluate(dir, policy, tasks, arm);
  process.stdout.write(json({ ...result, evidence_used: applicable.length, budget }));
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--worker') return worker(args[1], args[2]);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    assert(['--seed', '--output', '--source'].includes(args[i]) && args[i + 1], 'Usage: transfer.mjs [--seed UINT32] [--output FILE] [--source FILE]');
    options[args[i].slice(2)] = args[i + 1];
  }
  const source = await fs.readFile(options.source || path.join(here, '../system.bend'));
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'bend-transfer-'));
  try {
    await fs.writeFile(path.join(scratch, 'system.bend'), source);
    const checked = await runBend(['system.bend', '--check-only'], scratch);
    assert(checked.stdout.includes('All terms check.'), 'Missing successful checker marker');
    const training = [[1, 2], [3, 1, 7], [0, 4, 4], [8, 2], [2, 6, 1, 5], [5]];
    const before = await evaluate(scratch, 'first', training, 'training_first');
    const candidate = await evaluate(scratch, 'chunked_max', training, 'training_candidate');
    assert.equal(candidate.correct, training.length);
    assert(before.correct < training.length);
    const memory = { contract, evaluator, source_sha256: hash(source), block: 'chunked_max',
      training_correct: candidate.correct, training_total: training.length,
      baseline_failures: training.length - before.correct,
      failures: training.flatMap((input, i) => before.observed[i] === before.expected[i] ? []
        : [{ input, predicted: before.observed[i], expected: before.expected[i] }]) };
    // Freeze/write evidence BEFORE drawing or reading the evaluation seed.
    const frozen = json(memory);
    await fs.writeFile(path.join(scratch, 'frozen-memory.json'), frozen, { flag: 'wx' });
    const seed = options.seed === undefined ? randomBytes(4).readUInt32LE() : Number(options.seed);
    assert(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff, 'Seed must be UINT32');
    let state = seed;
    const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
    const trainingSet = new Set(training.map(v => JSON.stringify(v)));
    const tasks = [];
    while (tasks.length < budget.max_tasks) {
      const values = Array.from({ length: 1 + Math.floor(random() * 24) }, () => Math.floor(random() * 96));
      if (!trainingSet.has(JSON.stringify(values))) tasks.push(values);
    }
    await fs.writeFile(path.join(scratch, 'tasks.json'), json(tasks));
    const arms = { frozen_baseline: [], retained_evidence: [memory], no_memory: [],
      irrelevant_only: [{ ...memory, contract: 'sum-naturals-v1' }],
      stale_only: [{ ...memory, source_sha256: '0'.repeat(64) }],
      mixed_evidence: [{ ...memory, contract: 'sum-naturals-v1' }, { ...memory, source_sha256: '0'.repeat(64) }, memory],
      exact_without_memory: [] };
    const results = {};
    for (const [arm, entries] of Object.entries(arms)) {
      await fs.writeFile(path.join(scratch, `${arm}.memory.json`), json(entries));
      const { stdout } = await exec(process.execPath, [fileURLToPath(import.meta.url), '--worker', scratch, arm],
        { timeout: budget.process_timeout_ms + 5000, maxBuffer: 4 * 1024 * 1024 });
      results[arm] = JSON.parse(stdout);
    }
    for (const arm of ['no_memory', 'irrelevant_only', 'stale_only'])
      assert.deepEqual(results[arm].observed, results.frozen_baseline.observed);
    for (const arm of ['retained_evidence', 'mixed_evidence', 'exact_without_memory'])
      assert.equal(results[arm].correct, tasks.length);
    assert(results.retained_evidence.correct > results.frozen_baseline.correct);
    assert.equal(results.stale_only.evidence_used, 0);
    assert.equal(results.irrelevant_only.evidence_used, 0);
    const report = { schema: 'bounded-transfer-v1', seed,
      scope: 'Fresh-process reuse of a training-selected authored Bend kernel on subsequently generated author-visible inputs; not LLM or neural-weight learning.',
      source_sha256: hash(source), runner_sha256: hash(await fs.readFile(fileURLToPath(import.meta.url))),
      bend_version: (await runBend(['version'], scratch)).stdout.trim(),
      checked: checked.stdout.trim(), evidence_sha256: hash(frozen), evidence: memory,
      budget, training: { inputs: training, baseline: before, candidate },
      heldout: { inputs: tasks, inputs_sha256: hash(json(tasks)), generation: 'LCG UINT32; lengths 1..24, values 0..95; exact training inputs excluded' },
      results, accuracy_gain: (results.retained_evidence.correct - results.frozen_baseline.correct) / tasks.length,
      conclusions: { compatible_evidence_improves_fixed_policy: true, stale_and_irrelevant_evidence_ignored: true,
        gain_over_always_exact_control: 0, proves_llm_learning: false, proves_generalization_to_new_algorithms: false,
        equal_caps_not_equal_consumption: true, semantic_proof_of_memory_admission: false } };
    const output = path.resolve(options.output || path.join(here, 'transfer-report.json'));
    await fs.writeFile(output, json(report));
    process.stdout.write(json({ output, seed, accuracy_gain: report.accuracy_gain,
      results: Object.fromEntries(Object.entries(results).map(([arm, r]) => [arm,
        { correct: r.correct, total: r.total, element_visits: r.element_visits, elapsed_ms: r.elapsed_ms }])) }));
  } finally { await fs.rm(scratch, { recursive: true, force: true }); }
}

main().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
