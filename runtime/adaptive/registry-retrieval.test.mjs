// Deliberately tests index-free bounded retrieval: all evidence still gets verified.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const hash = x => createHash('sha256').update(x).digest('hex');
async function invoke(args) {
  return JSON.parse((await exec(process.execPath, [path.join(here, 'registry.mjs'), ...args], { timeout: 60000, maxBuffer: 4 * 1024 * 1024 })).stdout);
}
test('bounded lexical retrieval matches full ranking and still rejects unselected tampering', { timeout: 120000 }, async t => {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'bounded-learning-retrieval-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const registry = path.join(root, 'registry');
  const admitted = await invoke(['admit', registry, path.join(here, 'system.bend')]);
  const original = path.join(registry, 'entries', admitted.id);
  const manifest = JSON.parse(await fs.readFile(path.join(original, 'manifest.json')));
  const narratives = Array.from({ length: 40 }, (_, i) => `${'Alpha '.repeat(i % 4)}${i % 3 ? 'BETA beta ' : ''}${i % 2 ? 'gamma ' : ''} irrelevant_${i}`);
  const fixtures = [];
  for (const narrative of narratives) {
    const m = { ...manifest, findings: 'agent-authored-unverified-narrative', files: { ...manifest.files, 'findings.md': hash(narrative) } };
    const raw = JSON.stringify(m, null, 2) + '\n'; const id = hash(raw); const dir = path.join(registry, 'entries', id);
    await fs.mkdir(dir);
    for (const name of Object.keys(manifest.files)) await fs.copyFile(path.join(original, name), path.join(dir, name));
    await fs.writeFile(path.join(dir, 'findings.md'), narrative); await fs.writeFile(path.join(dir, 'manifest.json'), raw);
    const tokens = new Set(narrative.toLowerCase().match(/[a-z0-9_]+/g) || []);
    fixtures.push({ id, score: ['alpha', 'beta', 'gamma'].filter(x => tokens.has(x)).length });
  }
  const expected = fixtures.filter(x => x.score).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const start = performance.now();
  const result = await invoke(['find', registry, '--query', 'ALPHA alpha beta gamma', '--limit', '3']);
  const elapsed = performance.now() - start;
  assert.deepEqual(result.map(({ id, score }) => ({ id, score })), expected.slice(0, 3));
  assert.equal((await invoke(['list', registry])).length, 41);
  t.diagnostic(`41 bundles scanned; ${expected.length} matches; 3 retained results; ${elapsed.toFixed(1)} ms including Node startup. Full evidence hashing remains required.`);
  await invoke(['revoke', registry, expected[0].id, 'test correction']);
  assert.deepEqual((await invoke(['find', registry, '--query', 'alpha beta gamma', '--limit', '3'])).map(x => x.id), expected.slice(1, 4).map(x => x.id));
  // This finding cannot rank in the result, but corruption must still fail retrieval.
  const unselected = fixtures.find(x => x.score === 0); assert.ok(unselected);
  for (const name of ['findings.md', 'system.bend', 'check.txt', 'manifest.json']) {
    const file = path.join(registry, 'entries', unselected.id, name); const prior = await fs.readFile(file);
    await fs.appendFile(file, 'tamper');
    await assert.rejects(invoke(['find', registry, '--query', 'alpha beta gamma', '--limit', '1']), /digest mismatch|manifest ID mismatch/);
    await fs.writeFile(file, prior);
  }
  assert.deepEqual(await invoke(['find', registry, '--query', 'no_match_anywhere', '--limit', '1']), []);
  await assert.rejects(invoke(['find', registry, '--query', 'alpha', '--limit', '0']), /limit must/);
});
