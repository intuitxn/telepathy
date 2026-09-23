import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const jj = process.env.JJ || 'jj';
const available = spawnSync(jj, ['--version']).status === 0;
const guard = fileURLToPath(new URL('./durability-guard.sh', import.meta.url));
const workspaceGuard = fileURLToPath(new URL('./worktree-guard.sh', import.meta.url));
const run = (cmd, args, cwd, env = {}) => spawnSync(cmd, args, { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
const ok = result => { assert.equal(result.status, 0, result.stderr); return result.stdout; };

test('jj guard preserves candidate and ignored files without touching outside symlink targets', { skip: !available && 'jj not installed' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'jj-guard-'));
  const repo = join(dir, 'repo'), backups = join(dir, 'backups');
  try {
    ok(run(jj, ['git', 'init', repo], dir));
    ok(run(jj, ['config', 'set', '--repo', 'user.name', 'Guard Test'], repo));
    ok(run(jj, ['config', 'set', '--repo', 'user.email', 'guard@example.invalid'], repo));
    const env = { JJ: jj, MUNDUS_SNAPSHOT_DIR: backups };
    ok(run(workspaceGuard, [], repo, env));
    ok(run(guard, ['check'], repo, env));
    writeFileSync(join(repo, '.gitignore'), 'private/\n');
    writeFileSync(join(repo, 'file with\nnewline.txt'), 'candidate evidence\n');
    mkdirSync(join(repo, 'private'));
    writeFileSync(join(repo, 'private', 'evidence'), 'private local evidence\n');
    writeFileSync(join(dir, 'external'), 'do not change');
    symlinkSync(join(dir, 'external'), join(repo, 'external-link'));
    assert.equal(run(guard, ['check'], repo, env).status, 1);
    const snapshot = ok(run(guard, ['snapshot'], repo, env)).trim();
    assert.equal(statSync(snapshot).mode & 0o777, 0o700);
    const manifest = JSON.parse(readFileSync(join(snapshot, 'MANIFEST'), 'utf8'));
    assert.equal(manifest.format, 'jj-recovery/v1');
    assert.match(manifest.bookmark, /^recovery\//);
    assert.match(ok(run(jj, ['bookmark', 'list'], repo)), /recovery\//);
    const inspection = ok(run(guard, ['verify', snapshot], repo, env));
    assert.match(inspection, /private\/evidence/);
    assert.match(inspection, /file with\\nnewline.txt/);
    assert.doesNotMatch(inspection, /\.jj\//);
    assert.equal(readFileSync(join(dir, 'external'), 'utf8'), 'do not change');
    const rejected = run(guard, ['snapshot'], repo, { ...env, MUNDUS_SNAPSHOT_DIR: join(repo, 'backup') });
    assert.equal(rejected.status, 2);
    assert.match(rejected.stderr, /outside the workspace/);
    assert.equal(readdirSync(backups).length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('durability verify still reads old external snapshot manifests without jj', () => {
  const dir = mkdtempSync(join(tmpdir(), 'old-guard-'));
  try {
    writeFileSync(join(dir, 'MANIFEST'), 'worktree=historical\nhead=historical\n');
    writeFileSync(join(dir, 'tracked.patch'), 'historical evidence');
    const result = run(guard, ['verify', dir], dir, { JJ: '/missing-jj' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /worktree=historical/);
    assert.match(result.stdout, /tracked.patch: 19 bytes/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('workspace guard rejects a directory without jj workspace metadata', { skip: !available && 'jj not installed' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'not-jj-'));
  try { assert.notEqual(run(workspaceGuard, [], dir, { JJ: jj }).status, 0); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});
