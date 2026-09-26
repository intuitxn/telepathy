#!/usr/bin/env node
// Reproducible local throughput measurement; no machine-dependent pass threshold.
import { performance } from 'node:perf_hooks';
import { compileAlgorithmText, prepareAlgorithmText,
  simulateAlgorithmText } from '../../runtime/dsh/algorithm-language.mjs';

const source = `algorithm service_queue
state backlog = 5
state served = 0
step backlog = sub(backlog, if_lt(backlog, 2, backlog, 2))
step served = add(served, if_lt(backlog, 2, backlog, 2))
return served
`;
const canonical = /^(0|[1-9][0-9]*)$/;
const [iterationsText = '10000', stepsText = '128', ...extra] = process.argv.slice(2);
if (extra.length || !canonical.test(iterationsText) || !canonical.test(stepsText))
  throw new Error('usage: node benchmarks/algorithm-language/run.mjs [ITERATIONS] [STEPS]');
const iterations = Number(iterationsText);
const steps = Number(stepsText);
if (!Number.isSafeInteger(iterations) || iterations < 100 || iterations > 100_000 ||
    !Number.isSafeInteger(steps) || steps < 0 || steps > 128)
  throw new Error('iterations must be 100..100000 and steps must be 0..128');

const compiled = compileAlgorithmText(source);
const prepared = prepareAlgorithmText(source);
if (!compiled.ok || !prepared.ok) throw new Error('benchmark source did not compile');
const expected = simulateAlgorithmText(source, steps).stdout;
if (prepared.simulate(steps).stdout !== expected) throw new Error('prepared simulation differs');
for (let index = 0; index < 500; index += 1) {
  compileAlgorithmText(source);
  simulateAlgorithmText(source, steps);
  prepared.simulate(steps);
}
function measure(action) {
  const start = performance.now();
  for (let index = 0; index < iterations; index += 1) action();
  const elapsed = performance.now() - start;
  return { elapsed_ms: Math.round(elapsed * 1000) / 1000,
    per_second: Math.round(iterations * 1000 / elapsed) };
}
const compile = measure(() => compileAlgorithmText(source));
const simulateWithParse = measure(() => simulateAlgorithmText(source, steps));
const simulatePrepared = measure(() => prepared.simulate(steps));
process.stdout.write(`${JSON.stringify({ schema: 1, source_sha256: compiled.source_sha256,
  bend_sha256: compiled.bend_sha256, iterations, steps, expected_stdout: expected,
  compile, simulate_with_parse: simulateWithParse,
  simulate_prepared: simulatePrepared })}\n`);
