import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const oldCommit = 'a'.repeat(40);
const candidateCommit = 'b'.repeat(40);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceGate = fs.readFileSync(path.join(sourceRoot, 'scripts/jj-gate.mjs'), 'utf8');
const sourceInstaller = fs.readFileSync(path.join(sourceRoot, 'scripts/install-dsh-release.mjs'), 'utf8');
const trustInputBlock = sourceGate.match(/const trustInputs = \[([\s\S]*?)\n\];/);
assert.ok(trustInputBlock, 'gate must declare trust inputs');
const trustInputs = [...trustInputBlock[1].matchAll(/^  '([^']+)',?$/gm)].map(match => match[1]);

function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'telepathy-release-gate-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const workspace = path.join(base, 'workspace');
  const store = path.join(base, 'store');
  const redirectedStore = path.join(base, 'redirected-store');
  const release = path.join(base, oldCommit);
  const bin = path.join(base, 'bin');
  for (const dir of [workspace, store, redirectedStore, release, bin, path.join(workspace, '.jj'),
    path.join(release, 'scripts')]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(workspace, '.jj', 'repo'), '../../store');
  fs.writeFileSync(path.join(release, 'scripts/jj-gate.mjs'), sourceGate);
  fs.writeFileSync(path.join(release, 'scripts/install-dsh-release.mjs'), sourceInstaller);
  const files = Object.fromEntries(trustInputs.map(relative => [
    relative, sha256(fs.readFileSync(path.join(sourceRoot, relative))),
  ]));
  const marker = path.join(base, 'candidate-executed');
  const fakeJj = `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
if (args.includes('log')) { process.stdout.write(process.env.TEST_CANDIDATE_COMMIT); process.exit(0); }
if (args.includes('file') && args.includes('show')) {
  const relative = args.at(-1);
  const override = path.join(process.env.TEST_OVERRIDES, relative);
  const selected = fs.existsSync(override) ? override : path.join(process.env.TEST_SOURCE_ROOT, relative);
  fs.writeFileSync(1, fs.readFileSync(selected));
  process.exit(0);
}
if (args.includes('config') && args.includes('get')) {
  const key = args.at(-1);
  process.stdout.write(key === 'aliases.telepathy-gate' ? process.env.TEST_GATE_ALIAS : process.env.TEST_INSTALL_ALIAS);
  process.exit(0);
}
if (args.includes('run') || args.includes('telepathy-gate')) {
  fs.writeFileSync(process.env.TEST_EXECUTED_MARKER, args.join(' '));
  process.stdout.write(process.env.TEST_GATE_RECEIPT || 'check: PASS (1 passed, 0 failed, 0 skipped)');
  process.exit(0);
}
process.stderr.write('unexpected fake jj invocation: ' + args.join(' '));
process.exit(1);
`;
  fs.writeFileSync(path.join(bin, 'jj'), fakeJj, { mode: 0o755 });
  fs.writeFileSync(path.join(release, 'release.json'), JSON.stringify({
    schema: 'telepathy.dsh-release/v1', commit_id: oldCommit,
    jj_repo_store: fs.realpathSync(store),
    jj_bin_path: fs.realpathSync(path.join(bin, 'jj')),
    jj_sha256: sha256(fs.readFileSync(path.join(bin, 'jj'))),
    node_exec_path: process.execPath, trust_inputs: trustInputs, files,
  }));
  const overrides = path.join(base, 'overrides');
  fs.mkdirSync(overrides);
  const gateAlias = JSON.stringify(['util', 'exec', '--', process.execPath,
    path.join(fs.realpathSync(release), 'scripts/jj-gate.mjs')]);
  const installAlias = JSON.stringify(['util', 'exec', '--', process.execPath,
    path.join(fs.realpathSync(release), 'scripts/install-dsh-release.mjs')]);
  const env = {
    ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    JJ_WORKSPACE_ROOT: workspace, TEST_CANDIDATE_COMMIT: candidateCommit,
    TEST_SOURCE_ROOT: sourceRoot, TEST_OVERRIDES: overrides,
    TEST_EXECUTED_MARKER: marker, TEST_GATE_ALIAS: gateAlias,
    TEST_INSTALL_ALIAS: installAlias,
  };
  const run = (script, extraEnv = {}) => spawnSync(process.execPath,
    [path.join(release, `scripts/${script}`), candidateCommit],
    { cwd: workspace, env: { ...env, ...extraEnv }, encoding: 'utf8' });
  return { workspace, store, redirectedStore, release, marker, overrides, gateAlias, installAlias, run };
}

for (const changed of ['scripts/check.mjs', 'runtime/dsh/task-control.test.mjs',
  'benchmarks/core/kernel-cases.json']) {
  test(`checked gate rejects changed ${changed} before executing candidate code`, t => {
    const f = fixture(t);
    const target = path.join(f.overrides, changed);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `changed ${changed}`);
    const result = f.run('jj-gate.mjs');
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, new RegExp(`${changed.replaceAll('.', '\\.')} changed`));
    assert.equal(fs.existsSync(f.marker), false);
  });
}

test('checked gate rejects a redirected workspace jj store', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.workspace, '.jj', 'repo'), '../../redirected-store');
  const result = f.run('jj-gate.mjs');
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /previous checked release is invalid/);
  assert.equal(fs.existsSync(f.marker), false);
});

test('checked gate rejects a test-only native sandbox override before executing candidate code', t => {
  const f = fixture(t);
  const result = f.run('jj-gate.mjs', { TELEPATHY_DSH_TEST_TRUSTED_NATIVE_SHA256: 'a'.repeat(64) });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /test-only override TELEPATHY_DSH_TEST_TRUSTED_NATIVE_SHA256 is forbidden/);
  assert.equal(fs.existsSync(f.marker), false);
});

test('normal installer rejects effective jj alias redirection before calling gate', t => {
  const f = fixture(t);
  const wrongGate = JSON.stringify(['util', 'exec', '--', process.execPath, '/tmp/other-gate.mjs']);
  const result = f.run('install-dsh-release.mjs', { TEST_GATE_ALIAS: wrongGate });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /effective jj gate or installer alias differs/);
  assert.equal(fs.existsSync(f.marker), false);
});

test('normal installer rejects a redirected workspace jj store before calling gate', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.workspace, '.jj', 'repo'), '../../redirected-store');
  const result = f.run('install-dsh-release.mjs');
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /previous release manifest, jj store/);
  assert.equal(fs.existsSync(f.marker), false);
});

test('normal installer independently rejects a changed checker even after a claimed passing gate', t => {
  const f = fixture(t);
  const changed = 'scripts/check.mjs';
  fs.mkdirSync(path.dirname(path.join(f.overrides, changed)), { recursive: true });
  fs.writeFileSync(path.join(f.overrides, changed), 'weakened check');
  const candidateTrust = Object.fromEntries(trustInputs.map(relative => {
    const override = path.join(f.overrides, relative);
    return [relative, sha256(fs.readFileSync(fs.existsSync(override)
      ? override : path.join(sourceRoot, relative)))];
  }));
  const releases = fs.mkdtempSync(path.join(os.homedir(), '.telepathy-release-test-'));
  t.after(() => fs.rmSync(releases, { recursive: true, force: true }));
  const receipt = {
    ok: true, commit_id: candidateCommit, trusted_release_commit_id: oldCommit,
    jj_repo_store: fs.realpathSync(f.store),
    jj_bin_path: fs.realpathSync(path.join(path.dirname(f.release), 'bin', 'jj')),
    jj_sha256: sha256(fs.readFileSync(path.join(path.dirname(f.release), 'bin', 'jj'))),
    node_exec_path: process.execPath,
    trust_inputs_sha256: sha256(JSON.stringify(candidateTrust)),
  };
  const result = f.run('install-dsh-release.mjs', {
    TELEPATHY_DSH_RELEASES: releases, TEST_GATE_RECEIPT: JSON.stringify(receipt),
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /scripts\/check\.mjs changed: control-plane promotion needs separate human review/);
  assert.equal(fs.existsSync(path.join(releases, candidateCommit)), false);
});
