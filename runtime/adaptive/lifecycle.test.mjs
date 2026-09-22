import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
async function invoke(args) {
  const { stdout } = await exec(process.execPath, [path.join(here, 'lifecycle.mjs'), ...args], { timeout: 180000, maxBuffer: 1024 * 1024 });
  return JSON.parse(stdout);
}
const observation = { task: 'Find a compatible maximum block', approach: 'Compare full reduction with first item', prediction: 'First item fails on increasing input', result: { status: 'failure', observation: '[1,2] returned 1 instead of 2' }, tests: [{ name: 'ascending pair', passed: false, evidence: 'observed=1 expected=2' }], counterexamples: [{ input: [1,2], observed: 1, expected: 2 }] };
test('task lifecycle isolates runs, preserves failures, and checks explicit candidates', { timeout: 180000 }, async t => {
  const tmp = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'lifecycle-test-'));
  t.after(() => fs.rm(tmp, { recursive: true, force: true }));
  const reg = path.join(tmp, 'registry');
  const out = path.join(tmp, 'outcome.json');
  await fs.writeFile(out, JSON.stringify(observation));
  const start = (extra = []) => invoke(['before', reg, '--core', 'adaptive-max', '--query', 'maximum increasing', ...extra]);
  const finish = (id, extra = []) => invoke(['after', reg, id, '--outcome', out, ...extra]);
  await t.test('independent runs and reported failure never claim kernel verification', async () => {
    const [a, b] = await Promise.all([start(), start()]);
    assert.notEqual(a.run, b.run);
    assert.deepEqual(a.retrieved, []);
    const result = await finish(a.run);
    assert.equal(result.admission, null);
    assert.equal(result.outcome.result.status, 'failure');
    assert.equal(result.narrative_verification, 'agent-reported; not independently checked');
    assert.equal((await fs.stat(path.join(reg, 'runs', a.run))).mode & 0o777, 0o700);
    assert.equal((await fs.stat(path.join(reg, 'runs', a.run, 'receipt.json'))).mode & 0o777, 0o600);
    await assert.rejects(finish(a.run), /already attempted/);
    const races = await Promise.allSettled([finish(b.run), finish(b.run)]);
    assert.equal(races.filter(r => r.status === 'fulfilled').length, 1);
  });
  await t.test('malformed, oversized, symlinked, and traversal inputs are rejected', async () => {
    const a = await start();
    await assert.rejects(finish('../outside'), /invalid run ID/);
    await assert.rejects(finish(a.run, ['--publish']), /requires checked source/);
    const malformed = path.join(tmp, 'malformed.json');
    await fs.writeFile(malformed, JSON.stringify({ ...observation, transcript: 'private' }));
    await assert.rejects(invoke(['after', reg, a.run, '--outcome', malformed]), /unknown outcome field/);
    await fs.writeFile(malformed, ' '.repeat(1024 * 1024 + 1));
    await assert.rejects(invoke(['after', reg, a.run, '--outcome', malformed]), /bounded regular file/);
    const link = path.join(tmp, 'link');
    await fs.symlink(out, link);
    await assert.rejects(invoke(['after', reg, a.run, '--outcome', link]), /symlink rejected/);
    await assert.rejects(start(['--sync']), /Command failed/);
    await finish(a.run);
  });
  await t.test('actual failed source admission preserves the task attempt and rejection', async () => {
    await fs.writeFile(out, JSON.stringify({ ...observation, result: { status: 'success', observation: 'Candidate believed corrected' }, tests: [{ name: 'reported check', passed: true, evidence: 'Agent claim to independently verify' }] }));
    const a = await start();
    const bad = path.join(tmp, 'bad.bend');
    await fs.writeFile(bad, 'import Base\ndef main = this is not valid Bend\n');
    await assert.rejects(finish(a.run, ['--source', bad]));
    const receipt = JSON.parse(await fs.readFile(path.join(reg, 'runs', a.run, 'receipt.json')));
    assert.equal(receipt.status, 'operation-failed');
    assert.equal(receipt.admission, null);
    assert.match(receipt.candidate_sha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(receipt.outcome.counterexamples, observation.counterexamples);
    await assert.rejects(finish(a.run), /already attempted/);
  });
  await t.test('valid core with failed, partial, failing-test or untested task never admits', async () => {
    for (const [status, tests] of [['failure', observation.tests], ['partial', [{ name: 'partial check', passed: true, evidence: 'one case' }]], ['success', observation.tests], ['success', []]]) {
      const a = await start();
      await fs.writeFile(out, JSON.stringify({ ...observation, result: { status, observation: 'Incomplete or failed work' }, tests }));
      const receipt = await finish(a.run, ['--source', path.join(here, 'system.bend'), '--publish']);
      assert.equal(receipt.status, 'not-promoted');
      assert.equal(receipt.admission, null);
      assert.equal(receipt.publication, null);
      assert.match(receipt.candidate_sha256, /^[0-9a-f]{64}$/);
      assert.deepEqual(receipt.outcome.counterexamples, observation.counterexamples);
      assert.deepEqual(await fs.readdir(path.join(reg, 'entries')), []);
    }
  });
  await t.test('real core admission and subsequent bounded retrieval share exact evidence', async () => {
    await fs.writeFile(out, JSON.stringify({ ...observation, result: { status: 'success', observation: 'Historical shortcut failure reproduced; verified full reduction used' }, tests: [{ name: 'historical regression reproduction', passed: true, evidence: 'Shortcut observed 1 as predicted; full reduction returned expected 2' }] }));
    const a = await start();
    const findings = path.join(tmp, 'findings.md');
    await fs.writeFile(findings, 'Maximum first-item fails on increasing input [1,2]. Full reduction returns 2.');
    const receipt = await finish(a.run, ['--source', path.join(here, 'system.bend'), '--findings', findings]);
    assert.equal(receipt.admission.result, 'fresh-check-and-observed-runtime');
    assert.equal(receipt.admission.source_sha256, receipt.candidate_sha256);
    const b = await start();
    assert.equal(b.retrieved.length, 1);
    assert.equal(b.retrieved[0].id, receipt.admission.id);
    assert.match(b.retrieved[0].excerpt, /\[1,2\]/);
    const end = await finish(b.run);
    assert.deepEqual(end.retrieved_ids, [receipt.admission.id]);
    assert.equal(end.admission, null);
    const other = await invoke(['before', reg, '--core', 'lorenz-memory', '--query', 'maximum']);
    assert.deepEqual(other.retrieved, []);
  });
});
