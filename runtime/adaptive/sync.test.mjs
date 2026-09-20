import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
async function command(file, args, cwd) {
  return (await exec(file, args, { cwd, timeout: 90_000, maxBuffer: 2 * 1024 * 1024 })).stdout;
}
async function cli(name, args) { return JSON.parse(await command(process.execPath, [path.join(here, name), ...args])); }
const registry = args => cli('registry.mjs', args);
const sync = args => cli('sync.mjs', args);
const git = (cwd, args) => command('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], cwd);

test('signed Git transport stages trusted bundles and propagates revocation', { timeout: 120_000 }, async t => {
  const scratch = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'learning-sync-test-'));
  t.after(() => fs.rm(scratch, { recursive: true, force: true }));
  const remote = path.join(scratch, 'remote.git');
  await git(scratch, ['init', '--bare', '--quiet', remote]);
  const publisher = path.join(scratch, 'publisher'), receiver = path.join(scratch, 'receiver');
  const identity = await sync(['init', publisher, remote]);
  await sync(['init', receiver, remote]);
  const admitted = await registry(['admit', publisher, path.join(here, 'system.bend')]);
  const id = admitted.id;
  let initialHead;
  await t.test('publisher pushes only bundle and signed event', async () => {
    assert.equal((await sync(['push', publisher, id])).published, true);
    const files = await git(remote, ['ls-tree', '-r', '--name-only', 'refs/heads/learning/shared-v1']);
    assert.match(files, /manifest\.json/); assert.doesNotMatch(files, /private|config\.json/);
    initialHead = (await git(remote, ['rev-parse', 'refs/heads/learning/shared-v1'])).trim();
  });
  await t.test('untrusted publisher is not imported', async () => {
    const result = await sync(['pull', receiver]);
    assert.equal(result.staged.length, 0); assert.equal(result.ignored.length, 1);
  });
  await t.test('pinned publisher stages without executing and local admission rechecks', async () => {
    await sync(['trust', receiver, identity.publicKey]);
    assert.deepEqual((await sync(['pull', receiver])).staged, [id]);
    assert.deepEqual(await registry(['list', receiver]), []);
    assert.equal((await registry(['import', receiver, path.join(receiver, 'staged', id), '--execute'])).id, id);
    assert.equal((await sync(['push', publisher, id])).unchanged, true);
  });
  await t.test('revocation reaches another registry and prevents replay', async () => {
    await registry(['revoke', publisher, id, 'test correction']);
    assert.equal((await sync(['push', publisher, id])).kind, 'revoke');
    assert.deepEqual((await sync(['pull', receiver])).revoked, [id]);
    assert.deepEqual(await registry(['list', receiver]), []);
    await assert.rejects(registry(['replay', receiver, id]), /revoked/);
  });
  await t.test('previously observed revocation cannot be hidden by a rollback', async () => {
    const latest = (await git(remote, ['rev-parse', 'refs/heads/learning/shared-v1'])).trim();
    await git(remote, ['update-ref', 'refs/heads/learning/shared-v1', initialHead]);
    try { await assert.rejects(sync(['pull', receiver]), /rollback|rewritten history/); }
    finally { await git(remote, ['update-ref', 'refs/heads/learning/shared-v1', latest]); }
  });
  await t.test('a modified event cannot impersonate a pinned publisher', async () => {
    const attacker = path.join(scratch, 'attacker');
    await git(scratch, ['clone', '--quiet', '--branch', 'learning/shared-v1', remote, attacker]);
    const events = path.join(attacker, 'events');
    const filename = (await fs.readdir(events))[0];
    const envelope = JSON.parse(await fs.readFile(path.join(events, filename), 'utf8'));
    const payload = JSON.parse(Buffer.from(envelope.payload, 'base64'));
    payload.id = 'a'.repeat(64);
    envelope.payload = Buffer.from(JSON.stringify(payload)).toString('base64');
    const raw = JSON.stringify(envelope, null, 2) + '\n';
    const digest = createHash('sha256').update(raw).digest('hex');
    await fs.writeFile(path.join(events, digest + '.json'), raw);
    await git(attacker, ['add', 'events']);
    await git(attacker, ['-c', 'user.name=Test', '-c', 'user.email=test@local.invalid', 'commit', '--quiet', '-m', 'Invalid signature test']);
    await git(attacker, ['push', '--quiet', 'origin', 'HEAD:learning/shared-v1']);
    await assert.rejects(sync(['pull', receiver]), /invalid publisher signature/);
  });
});

test('concurrent initial publishers preserve both signed events', { timeout: 120_000 }, async t => {
  const scratch = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'learning-sync-race-'));
  t.after(() => fs.rm(scratch, { recursive: true, force: true }));
  const remote = path.join(scratch, 'remote.git');
  await git(scratch, ['init', '--bare', '--quiet', remote]);
  const a = path.join(scratch, 'a'), b = path.join(scratch, 'b');
  await sync(['init', a, remote]); await sync(['init', b, remote]);
  const first = await registry(['admit', a, path.join(here, 'system.bend')]);
  const second = await registry(['admit', b, path.join(here, 'system.bend')]);
  const outcomes = await Promise.all([sync(['push', a, first.id]), sync(['push', b, second.id])]);
  assert(outcomes.every(x => x.published));
  const files = await git(remote, ['ls-tree', '-r', '--name-only', 'refs/heads/learning/shared-v1']);
  assert.equal(files.split('\n').filter(x => x.startsWith('events/')).length, 2);
});
