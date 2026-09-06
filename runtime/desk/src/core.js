import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import { mkdirSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
export const ROOT = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
export const hash = text => createHash('sha256').update(text).digest('hex');
export const now = () => new Date().toISOString();
export const TYPES = ['report', 'announcement', 'blog', 'proposal', 'writing'];
export function home() { return resolve(process.env.INTUITXN_HOME || join(ROOT, '.local')); }
export function config() { return JSON.parse(readFileSync(join(home(), 'config.json'), 'utf8')); }
export function confined(base, path) {
  const actual = realpathSync(resolve(base, path));
  const rel = relative(realpathSync(base), actual);
  if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) throw Error('Path escapes its workspace');
  return actual;
}
export function store(directory = home()) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(join(directory, 'desk.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, source TEXT UNIQUE, state TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, state TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS cursors (channel TEXT PRIMARY KEY, stamp INTEGER NOT NULL);`);
  return db;
}
export function get(db, table, id) {
  if (!['jobs', 'artifacts', 'outbox'].includes(table)) throw Error('Invalid table');
  const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
  if (!row) throw Error(`${table}: ${id} not found`);
  return { ...JSON.parse(row.data), ...(row.state ? { state: row.state } : {}) };
}
export function list(db, table) {
  if (!['jobs', 'artifacts', 'outbox'].includes(table)) throw Error('Invalid table');
  return db.prepare(`SELECT * FROM ${table} ORDER BY rowid DESC`).all().map(row => ({ ...JSON.parse(row.data), ...(row.state ? { state: row.state } : {}) }));
}
export function put(db, table, value) {
  if (!['jobs', 'artifacts', 'outbox'].includes(table)) throw Error('Invalid table');
  if (table === 'artifacts') db.prepare('INSERT INTO artifacts VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(value.id, JSON.stringify(value));
  else if (table === 'jobs') db.prepare('INSERT INTO jobs VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,data=excluded.data').run(value.id, value.source ?? null, value.state, JSON.stringify(value));
  else db.prepare('INSERT INTO outbox VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,data=excluded.data').run(value.id, value.state, JSON.stringify(value));
  return value;
}
export function createArtifact(db, type, title, directory = home()) {
  if (!TYPES.includes(type)) throw Error(`Choose: ${TYPES.join(', ')}`);
  if (!title?.trim()) throw Error('A title is required');
  const id = randomUUID(); const folder = join(directory, 'artifacts', id);
  mkdirSync(folder, { recursive: true });
  const template = readFileSync(join(ROOT, 'artifacts/templates', `${type}.md`), 'utf8');
  const file = join(folder, 'draft.md');
  writeFileSync(file, template.replace('{{title}}', title.replace(/[\r\n]/g, ' ')), { flag: 'wx' });
  return put(db, 'artifacts', { id, type, title, file, audience: 'public', state: 'draft', created: now() });
}
export function approveArtifact(db, id, reviewer, directory = home()) {
  if (!reviewer?.trim()) throw Error('Name the human reviewer');
  const a = get(db, 'artifacts', id); const text = readFileSync(a.file, 'utf8');
  if (/\[TODO[^\]]*\]|\{\{[^}]+\}\}/i.test(text)) throw Error('Finish the draft placeholders before review');
  const digest = hash(text); const snapshot = join(directory, 'artifacts', id, `${digest}.md`);
  writeFileSync(snapshot, text, { mode: 0o600 });
  return put(db, 'artifacts', { ...a, state: 'reviewed', reviewedBy: reviewer, reviewedAt: now(), digest, snapshot });
}
export function exportArtifact(db, id, directory = home()) {
  const a = get(db, 'artifacts', id);
  if (!a.digest || a.state !== 'reviewed') throw Error('Review this artifact before exporting');
  if (hash(readFileSync(a.file, 'utf8')) !== a.digest) throw Error('Draft changed after review; review the new revision');
  const text = readFileSync(a.snapshot, 'utf8');
  if (hash(text) !== a.digest) throw Error('Reviewed snapshot changed');
  const folder = join(directory, 'exports', id); mkdirSync(folder, { recursive: true });
  const file = join(folder, `${a.type}.md`); writeFileSync(file, text);
  writeFileSync(join(folder, 'receipt.json'), JSON.stringify({ id, type: a.type, title: a.title, sha256: a.digest, reviewedBy: a.reviewedBy, reviewedAt: a.reviewedAt, exportedAt: now(), published: false }, null, 2));
  return { file, published: false, sha256: a.digest };
}
export function newJob(db, spec) {
  if (!['codex','opencode'].includes(spec.runtime)) throw Error('Runtime must be codex or opencode');
  for (const field of ['request','repository','owner','acceptance']) if (!spec[field]?.trim()) throw Error(`Job needs ${field}`);
  const job = { ...spec, id: randomUUID(), state: 'queued', created: now() };
  if (job.source) {
    const existing = db.prepare('SELECT id FROM jobs WHERE source=?').get(job.source);
    if (existing) return get(db, 'jobs', existing.id);
  }
  return put(db, 'jobs', job);
}
