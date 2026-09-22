#!/usr/bin/env node
// Local operations only. Never deletes durable evidence or changes remote trust.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID } from 'node:crypto';
const hash = x => createHash('sha256').update(x).digest('hex');
const json = x => JSON.stringify(x, null, 2) + '\n';
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const idOK = x => /^[a-f0-9]{64}$/.test(x || '');
async function safe(p) {
  let cursor = path.parse(path.resolve(p)).root;
  for (const part of path.resolve(p).slice(cursor.length).split(path.sep)) {
    if (!part) continue;
    cursor = path.join(cursor, part);
    try { assert(!(await fs.lstat(cursor)).isSymbolicLink(), `symlink rejected: ${cursor}`); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return path.resolve(p);
}
async function read(p) {
  await safe(p); const s = await fs.stat(p);
  assert(s.isFile() && s.size <= 1024 * 1024, 'metadata must be bounded regular file');
  return fs.readFile(p);
}
async function names(p) { try { return await fs.readdir(p); } catch (e) { if (e.code === 'ENOENT') return []; throw e; } }
async function write(p, bytes) { await safe(p); await fs.writeFile(p, bytes, { flag: 'wx', mode: 0o600 }); }
async function replace(p, bytes) { const tmp = p + '.maintenance-' + randomUUID(); await write(tmp, bytes); await fs.rename(tmp, p); }
async function pair(dir) {
  const pub = (await read(path.join(dir, 'publisher-public.pem'))).toString();
  const privPath = path.join(dir, 'publisher-private.pem');
  assert(((await fs.stat(privPath)).mode & 0o077) === 0, 'private key permissions must exclude group and other');
  const priv = await read(privPath); const key = createPrivateKey(priv);
  assert(key.asymmetricKeyType === 'ed25519' && createPublicKey(pub).asymmetricKeyType === 'ed25519', 'expected Ed25519 keys');
  assert(createPublicKey(key).export({ type: 'spki', format: 'pem' }) === pub, 'keypair mismatch');
  return { pub, priv, fingerprint: hash(pub) };
}
async function config(root) {
  const c = JSON.parse(await read(path.join(root, 'sync/config.json')));
  assert(c.schema === 'intuitxn-learning-sync/v1' && idOK(c.publisher) && c.trusted && typeof c.trusted === 'object', 'invalid sync configuration');
  return c;
}
async function locks(root) {
  const result = [];
  for (const relative of ['sync/lock', '.mutation-lock', ...(await names(path.join(root, 'locks'))).map(n => 'locks/' + n)]) {
    const p = path.join(root, relative); await safe(p);
    try { const s = await fs.stat(p); result.push({ path: relative, age_seconds: Math.max(0, (Date.now() - s.mtimeMs) / 1000), status: 'possibly active; age does not prove abandonment' }); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return result;
}
async function exclusive(root, action) {
  await safe(root); await fs.stat(root);
  await safe(path.join(root, 'sync')); await fs.mkdir(path.join(root, 'sync'), { recursive: true, mode: 0o700 });
  const held = [];
  try {
    // Same order as sync -> registry import. Never wait while holding a second writer's lock.
    for (const relative of ['sync/lock', '.mutation-lock']) {
      const p = path.join(root, relative); await safe(p);
      try { await fs.mkdir(p, { mode: 0o700 }); held.push(p); }
      catch { throw new Error(`busy or abandoned lock: ${relative}; inspect manually`); }
    }
    assert((await names(path.join(root, 'locks'))).length === 0, 'publication locks exist; inspect manually');
    return await action();
  } finally { for (const p of held.reverse()) await fs.rmdir(p); }
}
async function usage(p, seen = new Set()) {
  await safe(p); const s = await fs.lstat(p);
  if (s.isDirectory()) { let total = 0; for (const n of await fs.readdir(p)) total += await usage(path.join(p, n), seen); return total; }
  assert(s.isFile(), 'unexpected special file');
  const key = `${s.dev}:${s.ino}`; if (seen.has(key)) return 0; seen.add(key); return s.size;
}
export async function doctor(root, budget = 1024 * 1024 * 1024) {
  await safe(root); assert(Number.isSafeInteger(budget) && budget > 0, 'invalid byte budget');
  const report = { integrity: [], locks: await locks(root), sync: { configured: false }, warnings: [] };
  for (const folder of ['entries', 'staged']) {
    for (const id of await names(path.join(root, folder))) {
      if (id.startsWith('.pending-')) continue;
      try {
        assert(idOK(id), 'invalid bundle directory');
        const dir = path.join(root, folder, id); const raw = await read(path.join(dir, 'manifest.json'));
        assert(hash(raw) === id, 'manifest ID mismatch'); const m = JSON.parse(raw);
        assert(m.files && typeof m.files === 'object' && !Array.isArray(m.files), 'missing inventory');
        assert(JSON.stringify((await names(dir)).sort()) === JSON.stringify(['manifest.json', ...Object.keys(m.files)].sort()), 'inventory mismatch');
        for (const [name, digest] of Object.entries(m.files)) {
          assert(name !== 'manifest.json' && /^[A-Za-z0-9_.-]+$/.test(name) && name !== '.' && name !== '..' && idOK(digest), 'invalid inventory entry');
          assert(hash(await read(path.join(dir, name))) === digest, `digest mismatch: ${name}`);
        }
        report.integrity.push({ folder, id, ok: true });
      } catch (e) { report.integrity.push({ folder, id, ok: false, error: e.message }); }
    }
  }
  try {
    const c = await config(root); const k = await pair(path.join(root, 'sync'));
    assert(c.publisher === k.fingerprint && c.trusted[c.publisher] === k.pub, 'publisher or self trust mismatch');
    for (const [id, pub] of Object.entries(c.trusted)) assert(hash(pub) === id && createPublicKey(pub).asymmetricKeyType === 'ed25519', 'invalid trusted key');
    report.sync = { configured: true, healthy: true, publisher: k.fingerprint, trusted_publishers: Object.keys(c.trusted).length };
  } catch (e) {
    if (e.code !== 'ENOENT' || (await names(path.join(root, 'sync'))).includes('config.json')) report.sync = { configured: true, healthy: false, error: 'sync configuration, keypair, or permissions failed validation' };
  }
  report.unique_file_bytes = await usage(root); report.budget_bytes = budget;
  if (report.unique_file_bytes > budget) report.warnings.push('Storage exceeds retention budget; no evidence is automatically deleted.');
  if (report.locks.length) report.warnings.push('Inspect reported locks; never infer inactivity from age alone.');
  report.ok = report.integrity.every(x => x.ok) && report.sync.healthy !== false;
  report.scope = 'read-only stored hashes and local keys; no source execution, remote access, or proof replay';
  return report;
}
export async function rotateStage(root) {
  return exclusive(root, async () => {
    const c = await config(root); const old = await pair(path.join(root, 'sync'));
    assert(old.fingerprint === c.publisher, 'current publisher mismatch');
    const dir = path.join(root, 'sync/rotation'); await fs.mkdir(dir, { mode: 0o700 });
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const pub = publicKey.export({ type: 'spki', format: 'pem' });
    await write(path.join(dir, 'publisher-private.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }));
    await write(path.join(dir, 'publisher-public.pem'), pub);
    await write(path.join(dir, 'rotation.json'), json({ previous: old.fingerprint, next: hash(pub) }));
    return { staged: hash(pub), current: old.fingerprint, public_key: path.join(dir, 'publisher-public.pem'), activated: false };
  });
}
export async function rotateActivate(root, previous, next) {
  assert(idOK(previous) && (next === undefined || idOK(next)), 'supply expected old fingerprint and optional new fingerprint');
  return exclusive(root, async () => {
    const dir = path.join(root, 'sync'); const c = await config(root); const old = await pair(dir); const fresh = await pair(path.join(dir, 'rotation'));
    const intent = JSON.parse(await read(path.join(dir, 'rotation/rotation.json')));
    assert(c.publisher === previous && old.fingerprint === previous && intent.previous === previous && intent.next === fresh.fingerprint && (!next || next === fresh.fingerprint), 'rotation fingerprint mismatch');
    assert(c.trusted[previous] === old.pub, 'old publisher trust mismatch');
    const configBytes = await read(path.join(dir, 'config.json'));
    const backup = path.join(dir, 'key-backups', previous + '-' + randomUUID());
    await safe(backup); await fs.mkdir(backup, { recursive: true, mode: 0o700 });
    await write(path.join(backup, 'publisher-private.pem'), old.priv); await write(path.join(backup, 'publisher-public.pem'), old.pub); await write(path.join(backup, 'config.json'), configBytes);
    try {
      await replace(path.join(dir, 'publisher-private.pem'), fresh.priv);
      await replace(path.join(dir, 'publisher-public.pem'), fresh.pub);
      await replace(path.join(dir, 'config.json'), json({ ...c, publisher: fresh.fingerprint, trusted: { ...c.trusted, [fresh.fingerprint]: fresh.pub } }));
    } catch (e) {
      await replace(path.join(dir, 'publisher-private.pem'), old.priv); await replace(path.join(dir, 'publisher-public.pem'), old.pub); await replace(path.join(dir, 'config.json'), configBytes); throw e;
    }
    await fs.rename(path.join(dir, 'rotation'), path.join(backup, 'activated'));
    return { publisher: fresh.fingerprint, previous, backup, remote_trust_updated: false };
  });
}
export async function cleanup(root, ageHours = 168, apply = false) {
  assert(Number.isFinite(ageHours) && ageHours >= 1, 'minimum age must be at least one hour');
  const inspect = async () => {
    const candidates = [];
    for (const relative of ['', 'staged']) {
      const parent = path.join(root, relative);
      for (const name of await names(parent)) {
        if (!/^\.pending-[A-Za-z0-9]+$/.test(name)) continue;
        const p = path.join(parent, name); await safe(p); const s = await fs.stat(p);
        if (!s.isDirectory() || Date.now() - s.mtimeMs < ageHours * 3600000) continue;
        await usage(p); // Reject symlinks/special files anywhere before removal.
        candidates.push(path.relative(root, p));
        if (apply) await fs.rm(p, { recursive: true });
      }
    }
    return { dry_run: !apply, candidates, removed: apply ? candidates.length : 0, durable_evidence_deleted: 0 };
  };
  await safe(root);
  if (!apply) { assert((await locks(root)).length === 0, 'locks exist; cleanup blocked'); return inspect(); }
  return exclusive(root, inspect);
}
async function main(args) {
  const [cmd, root, ...rest] = args; assert(root, 'REGISTRY required');
  if (cmd === 'doctor' && rest.length <= 1) return doctor(root, rest[0] === undefined ? undefined : Number(rest[0]));
  if (cmd === 'rotate-stage' && !rest.length) return rotateStage(root);
  if (cmd === 'rotate-activate' && rest.length >= 1 && rest.length <= 2) return rotateActivate(root, ...rest);
  if (cmd === 'cleanup' && rest.length <= 2 && (rest.length < 2 || rest[1] === '--apply')) return cleanup(root, rest[0] === undefined ? undefined : Number(rest[0]), rest[1] === '--apply');
  throw new Error('usage: doctor REGISTRY [BUDGET_BYTES] | rotate-stage REGISTRY | rotate-activate REGISTRY OLD_ID [NEW_ID] | cleanup REGISTRY [AGE_HOURS [--apply]]');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).then(x => { process.stdout.write(json(x)); if (x.ok === false) process.exitCode = 1; }).catch(e => { process.stderr.write(json({ error: e.message })); process.exitCode = 1; });
