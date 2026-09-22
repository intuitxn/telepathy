// Re-score the preserved synthetic task answers; does not start model sessions.
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const here = path.dirname(fileURLToPath(import.meta.url));
const hash = x => createHash('sha256').update(x).digest('hex');
const raw = await fs.readFile(path.join(here, 'cross-harness-protocol.json'));
const protocol = JSON.parse(raw);
const metrics = JSON.parse(await fs.readFile(path.join(here, 'cross-harness-metrics.json')));
const results = {};
for (const arm of ['baseline', 'memory']) {
  const original = await fs.readFile(path.join(here, `cross-harness-${arm}.txt`), 'utf8');
  // Remove only the model's Markdown wrapper; do not repair its implementation.
  const matches = [...original.matchAll(/```(?:javascript|js)?\s*\n([\s\S]*?)```/g)];
  assert(matches.length <= 1, 'ambiguous code answer');
  const source = matches.length ? matches[0][1] : original;
  const failures = []; let mutations = 0;
  for (const [index, example] of protocol.cases.entries()) {
    const context = vm.createContext({ input: JSON.stringify(example.input) }, { codeGeneration: { strings: false, wasm: false } });
    try {
      const text = vm.runInContext(`${source}\nconst xs=JSON.parse(input); const before=JSON.stringify(xs); const answer=batchMaximum(xs); JSON.stringify({answer,mutated:before!==JSON.stringify(xs)});`, context, { timeout: 1000 });
      const result = JSON.parse(text); if (result.mutated) mutations++;
      assert.equal(result.answer, example.expected); assert.equal(result.mutated, false);
    } catch (error) { failures.push({ case: index, error: error.message }); }
  }
  results[arm] = { correct: protocol.cases.length - failures.length, total: protocol.cases.length, mutations, failures,
    original_answer_sha256: hash(original), normalized_code_sha256: hash(source.trim()), output_words: source.trim().split(/\s+/).length, ...metrics[arm] };
  assert(results[arm].output_words <= protocol.budgets.max_output_words);
  assert(results[arm].toolCalls <= protocol.budgets.max_bash_tool_calls);
}
const report = { schema: protocol.schema, protocol_sha256: hash(raw), evaluator_sha256: hash(await fs.readFile(fileURLToPath(import.meta.url))),
  integration: metrics.integration, results, accuracy_difference: (results.memory.correct - results.baseline.correct) / protocol.cases.length,
  elapsed_difference_ms: results.memory.elapsedMs - results.baseline.elapsedMs,
  conclusion: 'Codex published checked correction evidence; fresh OpenCode retrieved it through a separate registry. Both task answers passed all cases. This single run demonstrates the lifecycle connection, not an accuracy benefit or general agent learning.' };
await fs.writeFile(path.join(here, 'cross-harness-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
