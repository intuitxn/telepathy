// Run: node --test runtime/adaptive/registry.test.mjs (requires Bend 2.0.21).
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
const adapter = path.join(here, 'registry.mjs');
async function invoke(args, env = {}) {
  const { stdout } = await exec(process.execPath, [adapter, ...args], {
    env: { ...process.env, BEND_NO_TELEMETRY: '1', ...env },
    timeout: 60_000, maxBuffer: 1024 * 1024,
  });
  return JSON.parse(stdout);
}

test('registry admits, reuses, transfers, and rejects invalid evidence', { timeout: 90_000 }, async t => {
  // macOS /var is a symlink; registry intentionally rejects symlink ancestors.
  const scratch = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'bend-registry-test-'));
  t.after(() => fs.rm(scratch, { recursive: true, force: true }));
  const registry = path.join(scratch, 'registry');
  const imported = path.join(scratch, 'imported');
  const exported = path.join(scratch, 'exported');
  const source = path.join(scratch, 'candidate.bend');
  await fs.copyFile(path.join(here, 'system.bend'), source);
  let receipt;

  await t.test('admission runs the real checker and independent evaluator', async () => {
    receipt = await invoke(['admit', registry, source]);
    assert.match(receipt.id, /^[a-f0-9]{64}$/);
    assert.equal(receipt.result, 'fresh-check-and-observed-runtime');
    const bundle = path.join(registry, 'entries', receipt.id);
    assert.equal((await fs.readFile(path.join(bundle, 'check.txt'), 'utf8')).trim(), 'All terms check.');
    const probe = JSON.parse(await fs.readFile(path.join(bundle, 'probe.json'), 'utf8'));
    assert.equal(probe.cases.length, 50);
    assert.deepEqual(probe.observed, probe.expected);
  });

  await t.test('listing does not execute Bend', async () => {
    const entries = await invoke(['list', registry], { BEND: path.join(scratch, 'absent-compiler') });
    assert.deepEqual(entries.map(entry => entry.id), [receipt.id]);
  });

  await t.test('replay freshly verifies and deduplicates the same bundle', async () => {
    const replay = await invoke(['replay', registry, receipt.id]);
    assert.equal(replay.id, receipt.id);
    assert.deepEqual(await fs.readdir(path.join(registry, 'entries')), [receipt.id]);
  });

  await t.test('export and staged import preserve evidence without executing it', async () => {
    assert.equal((await invoke(['export', registry, receipt.id, exported])).id, receipt.id);
    const staged = await invoke(['import', imported, exported], { BEND: path.join(scratch, 'absent-compiler') });
    assert.equal(staged.id, receipt.id);
    assert.equal(staged.executed, false);
    assert.deepEqual(await invoke(['list', imported]), []);
  });

  await t.test('explicit import execution performs local admission', async () => {
    const admitted = await invoke(['import', imported, exported, '--execute']);
    assert.equal(admitted.id, receipt.id);
    assert.equal(admitted.result, 'fresh-check-and-observed-runtime');
    assert.equal((await invoke(['list', imported])).length, 1);
  });

  await t.test('modified transfer is rejected before acceptance', async () => {
    await fs.appendFile(path.join(exported, 'system.bend'), '\n# modified after export\n');
    await assert.rejects(invoke(['import', imported, exported]), error => {
      assert.match(error.stderr, /digest mismatch: system\.bend/);
      return true;
    });
    assert.equal((await invoke(['list', imported])).length, 1);
  });

  await t.test('false law is rejected and retained as failure, preserving the accepted bundle', async () => {
    await fs.appendFile(source, '\nlaw registry_false_law:\n  {0n == 1n : Nat}\n\ndef registry_false_law():\n  {==}\n');
    await assert.rejects(invoke(['admit', registry, source]), error => {
      assert.match(error.stderr, /Bend command failed|checker success marker missing/);
      return true;
    });
    assert.deepEqual((await invoke(['list', registry])).map(entry => entry.id), [receipt.id]);
    const failures = await fs.readdir(path.join(registry, 'failures'));
    assert.equal(failures.length, 1);
    const failure = JSON.parse(await fs.readFile(path.join(registry, 'failures', failures[0], 'failure.json'), 'utf8'));
    assert.equal(failure.schema, 'intuitxn-learning-failure/v1');
    assert.match(failure.error, /Bend command failed|checker success marker missing/);
  });
});
