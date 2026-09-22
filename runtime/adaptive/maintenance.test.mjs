import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { doctor, rotateStage, rotateActivate, cleanup } from './maintenance.mjs';
const hash = x => createHash('sha256').update(x).digest('hex');
async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'learning-maintenance-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'sync'), { mode: 0o700 });
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const pub = publicKey.export({ type: 'spki', format: 'pem' });
  await fs.writeFile(path.join(root, 'sync/publisher-private.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  await fs.writeFile(path.join(root, 'sync/publisher-public.pem'), pub);
  await fs.writeFile(path.join(root, 'sync/config.json'), JSON.stringify({ schema: 'intuitxn-learning-sync/v1', publisher: hash(pub), trusted: { [hash(pub)]: pub }, remote: '/local/example', branch: 'learning/shared-v1' }));
  return { root, id: hash(pub), pub };
}
test('doctor reads integrity and keys, reports budget and locks without deleting', async t => {
  const { root } = await fixture(t);
  const bytes = Buffer.from('evidence'); const manifest = JSON.stringify({ files: { 'evidence.txt': hash(bytes) } }); const id = hash(manifest);
  const dir = path.join(root, 'entries', id); await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'manifest.json'), manifest); await fs.writeFile(path.join(dir, 'evidence.txt'), bytes);
  await fs.mkdir(path.join(root, '.mutation-lock'));
  let result = await doctor(root, 1); assert.equal(result.ok, true); assert.equal(result.integrity.length, 1); assert.equal(result.locks.length, 1); assert.equal(result.warnings.length, 2);
  await fs.writeFile(path.join(dir, 'evidence.txt'), 'changed'); result = await doctor(root); assert.equal(result.ok, false);
  await fs.stat(path.join(root, '.mutation-lock'));
});
test('rotation stages separately, checks fingerprints, preserves old trust and private backup', async t => {
  const { root, id, pub } = await fixture(t); const staged = await rotateStage(root);
  assert.equal((await doctor(root)).sync.publisher, id);
  await assert.rejects(rotateActivate(root, '0'.repeat(64)), /mismatch/);
  await assert.rejects(rotateActivate(root, id, '0'.repeat(64)), /mismatch/);
  const rotated = await rotateActivate(root, id, staged.staged);
  assert.equal((await doctor(root)).sync.publisher, staged.staged);
  const c = JSON.parse(await fs.readFile(path.join(root, 'sync/config.json'))); assert.equal(c.trusted[id], pub);
  assert.equal((await fs.stat(path.join(rotated.backup, 'publisher-private.pem'))).mode & 0o077, 0);
  assert.equal(rotated.remote_trust_updated, false);
  await rotateStage(root); // A later rotation is possible.
});
test('rotation rejects insecure keys and existing sync lock', async t => {
  const { root } = await fixture(t);
  await fs.chmod(path.join(root, 'sync/publisher-private.pem'), 0o644);
  assert.equal((await doctor(root)).sync.healthy, false); await assert.rejects(rotateStage(root), /permissions/);
  await fs.chmod(path.join(root, 'sync/publisher-private.pem'), 0o600);
  await fs.mkdir(path.join(root, 'sync/lock')); await assert.rejects(rotateStage(root), /lock/); await fs.stat(path.join(root, 'sync/lock'));
});
test('cleanup is dry by default and only removes old pending scratch', async t => {
  const { root } = await fixture(t);
  for (const name of ['.pending-old123', '.pending-new123', 'staged/.pending-old456', 'failures/attempt-1', 'runs/a', 'entries/keep', 'history/a']) {
    const p = path.join(root, name); await fs.mkdir(p, { recursive: true }); await fs.writeFile(path.join(p, 'data'), 'keep');
    if (!name.includes('new')) await fs.utimes(p, new Date(0), new Date(0));
  }
  const dry = await cleanup(root, 24); assert.equal(dry.removed, 0); assert.equal(dry.candidates.length, 2);
  const applied = await cleanup(root, 24, true); assert.equal(applied.removed, 2);
  for (const name of ['.pending-new123', 'failures/attempt-1', 'runs/a', 'entries/keep', 'history/a']) await fs.stat(path.join(root, name, 'data'));
});
test('cleanup refuses locks, symlinks and low age threshold', async t => {
  const { root } = await fixture(t);
  await fs.mkdir(path.join(root, '.mutation-lock')); await assert.rejects(cleanup(root, 24, true), /lock/); await fs.rmdir(path.join(root, '.mutation-lock'));
  const p = path.join(root, '.pending-old123'); await fs.mkdir(p); await fs.symlink(path.join(root, 'sync'), path.join(p, 'link')); await fs.utimes(p, new Date(0), new Date(0));
  await assert.rejects(cleanup(root, 24, true), /symlink/); await assert.rejects(cleanup(root, 0, true), /one hour/);
  await fs.stat(path.join(root, 'sync/config.json'));
});
