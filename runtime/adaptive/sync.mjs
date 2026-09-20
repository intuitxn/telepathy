#!/usr/bin/env node
// Git is transport; pinned Ed25519 keys authorize remote records, not source execution.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), 'registry.mjs');
const hash = x => createHash('sha256').update(x).digest('hex');
const json = x => JSON.stringify(x, null, 2) + '\n';
const idOK = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
function requireThat(ok, message) { if (!ok) throw new Error(message); }
async function noLinks(p) {
  const absolute = path.resolve(p); let cursor = path.parse(absolute).root;
  for (const part of absolute.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    try { requireThat(!(await fs.lstat(cursor)).isSymbolicLink(), `symlink rejected: ${cursor}`); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return absolute;
}
async function read(p) {
  await noLinks(p);
  const s = await fs.stat(p); requireThat(s.isFile() && s.size <= 1024 * 1024, 'oversized/non-file metadata');
  const data = await fs.readFile(p); requireThat(data.length <= 1024 * 1024, 'oversized metadata'); return data;
}
async function mkdir(p) { await noLinks(p); await fs.mkdir(p, { recursive: true, mode: 0o700 }); }
async function git(cwd, args) {
  return (await exec('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args],
    { cwd, timeout: 60_000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })).stdout;
}
async function registry(args) {
  return JSON.parse((await exec(process.execPath, [cli, ...args], { timeout: 300_000, maxBuffer: 4 * 1024 * 1024 })).stdout);
}
function validateRemote(remote) {
  requireThat(typeof remote === 'string' && remote.length < 2048 && !remote.startsWith('-'), 'invalid remote');
  if (remote.startsWith('https://')) {
    const url = new URL(remote); requireThat(!url.username && !url.password && !url.search && !url.hash, 'use a repository URL without embedded credentials, query, or fragment');
  } else requireThat(/^git@[A-Za-z0-9.-]+:[A-Za-z0-9_./-]+$/.test(remote) || path.isAbsolute(remote), 'use HTTPS, git@host:path, or absolute local test remote');
}
async function config(root) {
  const c = JSON.parse(await read(path.join(root, 'sync', 'config.json')));
  requireThat(c.schema === 'intuitxn-learning-sync/v1' && idOK(c.publisher), 'invalid sync config');
  validateRemote(c.remote); await git(root, ['check-ref-format', `refs/heads/${c.branch}`]);
  return c;
}
async function saveConfig(root, c) {
  const p = path.join(root, 'sync', 'config.json'); const tmp = p + '.next';
  await fs.writeFile(tmp, json(c), { flag: 'wx', mode: 0o600 }); await fs.rename(tmp, p);
}
async function checkpoint(root, dir, c) {
  const head = (await git(dir, ['rev-parse', 'HEAD'])).trim();
  let events = [];
  try { events = (await fs.readdir(path.join(dir, 'events'))).sort(); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  requireThat(events.length <= 10_000 && events.every(x => /^[a-f0-9]{64}\.json$/.test(x)), 'invalid event inventory');
  const file = path.join(root, 'sync', 'checkpoint.json');
  await fs.writeFile(file + '.next', json({ remote: c.remote, branch: c.branch, head, events }), { flag: 'wx', mode: 0o600 });
  await fs.rename(file + '.next', file);
}
async function checkout(root, c) {
  const dir = await fs.mkdtemp(path.join(root, '.sync-work-'));
  try {
    await git(dir, ['init', '--quiet']);
    let exists = true;
    try { await git(dir, ['ls-remote', '--exit-code', c.remote, `refs/heads/${c.branch}`]); }
    catch (e) { if (e.code === 2) exists = false; else throw e; }
    if (exists) {
      await git(dir, ['fetch', '--quiet', c.remote, `refs/heads/${c.branch}`]);
      await git(dir, ['checkout', '--quiet', '--detach', 'FETCH_HEAD']);
    } else await git(dir, ['checkout', '--quiet', '--orphan', 'registry']);
    let previous;
    try { previous = JSON.parse(await read(path.join(root, 'sync', 'checkpoint.json'))); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (previous) {
      requireThat(exists && previous.remote === c.remote && previous.branch === c.branch, 'remote history removed or configuration changed');
      try { await git(dir, ['merge-base', '--is-ancestor', previous.head, 'HEAD']); }
      catch { throw new Error('remote rollback or rewritten history rejected'); }
      const current = new Set(await fs.readdir(path.join(dir, 'events')));
      requireThat(previous.events.every(x => current.has(x)), 'remote removed previously observed events');
    }
    return { dir, exists };
  } catch (e) { await fs.rm(dir, { recursive: true, force: true }); throw e; }
}
async function underLock(root, action) {
  await mkdir(path.join(root, 'sync'));
  const lock = path.join(root, 'sync', 'lock');
  try { await fs.mkdir(lock, { mode: 0o700 }); }
  catch (e) { throw new Error(`sync busy or stale lock; inspect ${lock} (${e.code})`); }
  try { return await action(); } finally { await fs.rmdir(lock); }
}
async function init(root, remote, branch = 'learning/shared-v1') {
  validateRemote(remote); await git(root, ['check-ref-format', `refs/heads/${branch}`]);
  const dir = path.join(root, 'sync');
  try { await fs.access(path.join(dir, 'config.json')); throw new Error('sync already configured'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
  const publisher = hash(publicPem);
  await fs.writeFile(path.join(dir, 'publisher-private.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx', mode: 0o600 });
  await fs.writeFile(path.join(dir, 'publisher-public.pem'), publicPem, { flag: 'wx', mode: 0o600 });
  await saveConfig(root, { schema: 'intuitxn-learning-sync/v1', remote, branch, publisher, trusted: { [publisher]: publicPem } });
  return { remote, branch, publisher, publicKey: path.join(dir, 'publisher-public.pem') };
}
async function publish(root, c, id) {
  requireThat(idOK(id), 'invalid bundle ID');
  let revocation;
  try { revocation = JSON.parse(await read(path.join(root, 'revocations', `${id}.json`))); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  const privateKey = await read(path.join(root, 'sync', 'publisher-private.pem'));
  const publicPem = (await read(path.join(root, 'sync', 'publisher-public.pem'))).toString();
  requireThat(hash(publicPem) === c.publisher, 'publisher key mismatch');
  const payload = { schema: 'intuitxn-learning-event/v1', kind: revocation ? 'revoke' : 'bundle', id, publisher: c.publisher,
    ...(revocation ? { reason: String(revocation.reason || 'revoked by publisher').slice(0, 4096) } : {}) };
  const bytes = Buffer.from(JSON.stringify(payload));
  const envelope = { payload: bytes.toString('base64'), signature: sign(null, bytes, privateKey).toString('base64') };
  const encoded = json(envelope); const event = hash(encoded);
  // Retry a non-fast-forward race by fetching the winner and merging immutable records.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { dir } = await checkout(root, c);
    try {
      await mkdir(path.join(dir, 'events')); await mkdir(path.join(dir, 'bundles'));
      if (!revocation) {
        const dest = path.join(dir, 'bundles', id);
        try { await fs.access(dest); await registry(['import', root, dest]); }
        catch (e) { if (e.code !== 'ENOENT') throw e; await registry(['export', root, id, dest]); }
      }
      const eventFile = path.join(dir, 'events', `${event}.json`);
      try { requireThat((await read(eventFile)).toString() === encoded, 'event collision'); }
      catch (e) { if (e.code !== 'ENOENT') throw e; await fs.writeFile(eventFile, encoded, { flag: 'wx', mode: 0o600 }); }
      await git(dir, ['add', '--', 'events', 'bundles']);
      const changed = (await git(dir, ['status', '--porcelain'])).trim();
      if (!changed) { await checkpoint(root, dir, c); return { id, event, published: true, unchanged: true }; }
      await git(dir, ['-c', 'user.name=Codex learning publisher', '-c', 'user.email=codex@local.invalid', 'commit', '--quiet', '-m', `Record ${payload.kind} ${id}`]);
      try { await git(dir, ['push', '--quiet', c.remote, `HEAD:refs/heads/${c.branch}`]); }
      catch (e) { if (attempt < 2 && /rejected|fetch first|non-fast-forward|cannot lock ref|reference already exists/.test(e.stderr || '')) continue; throw e; }
      await checkpoint(root, dir, c);
      return { id, event, published: true, kind: payload.kind };
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  }
  throw new Error('concurrent remote writes; retry');
}
async function pull(root, c) {
  const { dir, exists } = await checkout(root, c);
  try {
    if (!exists) return { staged: [], revoked: [], ignored: [], remoteEmpty: true };
    const folder = path.join(dir, 'events'); await noLinks(folder);
    const names = (await fs.readdir(folder)).sort(); requireThat(names.length <= 10_000, 'too many remote events');
    const trusted = [], ignored = [];
    for (const name of names) {
      requireThat(/^[a-f0-9]{64}\.json$/.test(name), 'invalid event filename');
      const raw = await read(path.join(folder, name)); requireThat(hash(raw) + '.json' === name, 'event hash mismatch');
      const envelope = JSON.parse(raw); const bytes = Buffer.from(envelope.payload, 'base64'); const payload = JSON.parse(bytes);
      requireThat(payload.schema === 'intuitxn-learning-event/v1' && idOK(payload.id) && idOK(payload.publisher) && ['bundle', 'revoke'].includes(payload.kind), 'invalid event');
      const key = c.trusted[payload.publisher];
      if (!key) { ignored.push({ event: name, reason: 'untrusted publisher', publisher: payload.publisher }); continue; }
      requireThat(hash(key) === payload.publisher && verify(null, bytes, key, Buffer.from(envelope.signature, 'base64')), 'invalid publisher signature');
      trusted.push(payload);
    }
    const revoked = [];
    for (const event of trusted.filter(e => e.kind === 'revoke')) {
      await registry(['revoke', root, event.id, event.reason || 'remote publisher revocation']); revoked.push(event.id);
    }
    const staged = [];
    for (const event of trusted.filter(e => e.kind === 'bundle')) {
      if (revoked.includes(event.id)) continue;
      const bundle = path.join(dir, 'bundles', event.id);
      const manifest = await read(path.join(bundle, 'manifest.json'));
      requireThat(hash(manifest) === event.id, 'signed bundle ID mismatch');
      try { await fs.access(path.join(root, 'revocations', `${event.id}.json`)); continue; }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
      const result = await registry(['import', root, bundle]); staged.push(result.id);
    }
    await checkpoint(root, dir, c);
    return { staged: [...new Set(staged)], revoked: [...new Set(revoked)], ignored, executed: false };
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}
async function main(args) {
  const [command, rootArg, value, branch] = args;
  const counts = { init: [3, 4], trust: [3], push: [3], pull: [2], status: [2] };
  requireThat(counts[command]?.includes(args.length), 'usage: init REGISTRY REMOTE [BRANCH] | trust REGISTRY PUBLIC_KEY | push REGISTRY ID | pull REGISTRY | status REGISTRY');
  const root = await noLinks(rootArg); await mkdir(root);
  return underLock(root, async () => {
    if (command === 'init') return init(root, value, branch);
    const c = await config(root);
    if (command === 'status') return { remote: c.remote, branch: c.branch, publisher: c.publisher, trustedPublishers: Object.keys(c.trusted) };
    if (command === 'trust') {
      const key = (await read(value)).toString();
      requireThat(key.startsWith('-----BEGIN PUBLIC KEY-----'), 'expected public key');
      // Parsing verifies the public-key encoding; private keys are never accepted.
      requireThat(createPublicKey(key).asymmetricKeyType === 'ed25519', 'expected Ed25519 public key');
      const id = hash(key); c.trusted[id] = key; await saveConfig(root, c); return { trustedPublisher: id, authority: 'publish and revoke any bundle in this registry' };
    }
    if (command === 'push') return publish(root, c, value);
    return pull(root, c);
  });
}
main(process.argv.slice(2)).then(x => process.stdout.write(json(x))).catch(e => { process.stderr.write(`sync: ${e.message}\n`); process.exitCode = 1; });
