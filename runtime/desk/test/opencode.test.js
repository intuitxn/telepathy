import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { store, newJob, get } from '../src/core.js';
import { runJob } from '../src/jobs.js';
import { checked } from '../src/process.js';

test('native OpenCode CLI runs in isolated worktrees using normal configuration', async t => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'intuitxn-native-opencode-')));
  const repository = join(dir, 'repository'); mkdirSync(repository);
  const fake = join(dir, 'fake-opencode.cjs');
  const vars = ['INTUITXN_HOME', 'OPENCODE_BIN', 'OPENCODE_CONFIG', 'OPENCODE_CONFIG_CONTENT', 'XDG_CONFIG_HOME', 'BUZZ_PRIVATE_KEY', 'BUZZ_AUTH_TAG', 'INTUITXN_TEST_OPENCODE_EXIT'];
  const prior = new Map(vars.map(key => [key, process.env[key]]));
  let db;
  t.after(() => {
    db?.close();
    for (const [key, value] of prior) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    rmSync(dir, { recursive: true, force: true });
  });
  process.env.INTUITXN_HOME = join(dir, 'state');
  process.env.OPENCODE_BIN = fake;
  process.env.OPENCODE_CONFIG = join(dir, 'normal-config.json');
  process.env.OPENCODE_CONFIG_CONTENT = '{"theme":"normal-user-choice"}';
  process.env.XDG_CONFIG_HOME = join(dir, 'normal-xdg');
  process.env.BUZZ_PRIVATE_KEY = 'fake-test-private-key';
  process.env.BUZZ_AUTH_TAG = 'fake-test-auth-tag';
  process.env.INTUITXN_TEST_OPENCODE_EXIT = '0';
  writeFileSync(fake, `#!/usr/bin/env node
const fs = require('node:fs');
const snapshot = {
  argv: process.argv.slice(2), cwd: process.cwd(),
  config: process.env.OPENCODE_CONFIG,
  configContent: process.env.OPENCODE_CONFIG_CONTENT,
  xdg: process.env.XDG_CONFIG_HOME,
  hasBuzzPrivateKey: Object.hasOwn(process.env, 'BUZZ_PRIVATE_KEY'),
  hasBuzzAuthTag: Object.hasOwn(process.env, 'BUZZ_AUTH_TAG')
};
fs.writeFileSync('native-invocation.json', JSON.stringify(snapshot));
if (process.env.INTUITXN_TEST_OPENCODE_EXIT !== '0') {
  process.stderr.write('synthetic native CLI failure');
  process.exit(Number(process.env.INTUITXN_TEST_OPENCODE_EXIT));
}
fs.writeFileSync('app.txt', 'candidate from native CLI\\n');
process.stdout.write('Native candidate ready; fixture check passed.\\n');
`);
  chmodSync(fake, 0o700);
  writeFileSync(process.env.OPENCODE_CONFIG, '{}\n');
  await checked('git', ['init', repository]);
  writeFileSync(join(repository, 'app.txt'), 'original\n');
  await checked('git', ['add', 'app.txt'], { cwd: repository });
  await checked('git', ['-c', 'user.name=Intuitxn Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture'], { cwd: repository });
  db = store();
  const cfg = { repositories: [repository], timeoutSeconds: 5 };

  for (const model of [undefined, 'provider/model-fixture']) {
    await t.test(model ? 'explicit optional model uses native -m' : 'default model is left to native OpenCode', async () => {
      const job = newJob(db, { runtime: 'opencode', repository, owner: 'test', request: 'Change app without touching original', acceptance: 'Fixture check passes' });
      const result = await runJob(db, job.id, { ...cfg, ...(model ? { model } : {}) });
      assert.equal(result.state, 'needs_review');
      assert.equal(result.submission, 'opencode-run');
      assert.equal(result.model, model || null);
      const invocation = JSON.parse(readFileSync(join(result.worktree, 'native-invocation.json'), 'utf8'));
      const prompt = readFileSync(join(result.folder, 'brief.md'), 'utf8');
      assert.deepEqual(invocation.argv, ['run', ...(model ? ['-m', model] : []), prompt]);
      assert.equal(realpathSync(invocation.cwd), realpathSync(result.worktree));
      assert.notEqual(realpathSync(invocation.cwd), repository);
      assert.equal(invocation.config, process.env.OPENCODE_CONFIG);
      assert.equal(invocation.configContent, process.env.OPENCODE_CONFIG_CONTENT);
      assert.equal(invocation.xdg, process.env.XDG_CONFIG_HOME);
      assert.equal(invocation.hasBuzzPrivateKey, false);
      assert.equal(invocation.hasBuzzAuthTag, false);
      assert.equal(readFileSync(result.result, 'utf8'), 'Native candidate ready; fixture check passed.');
      assert.match(readFileSync(join(result.folder, 'changes.patch'), 'utf8'), /candidate from native CLI/);
      assert.equal(readFileSync(join(repository, 'app.txt'), 'utf8'), 'original\n');
      assert.equal(existsSync(join(repository, 'native-invocation.json')), false);
    });
  }
  await t.test('nonzero native CLI exit retains needs_attention instead of review', async () => {
    process.env.INTUITXN_TEST_OPENCODE_EXIT = '7';
    const job = newJob(db, { runtime: 'opencode', repository, owner: 'test', request: 'Synthetic failing task', acceptance: 'Must succeed' });
    await assert.rejects(runJob(db, job.id, cfg), /opencode exited 7/);
    const stopped = get(db, 'jobs', job.id);
    assert.equal(stopped.state, 'needs_attention');
    assert.equal(stopped.submission, 'opencode-run');
    assert.match(stopped.error, /opencode exited 7/);
    assert.ok(stopped.stopped);
    assert.equal(readFileSync(join(stopped.folder, 'stderr.log'), 'utf8'), 'synthetic native CLI failure');
    assert.equal(existsSync(join(stopped.folder, 'result.md')), false);
    assert.equal(readFileSync(join(repository, 'app.txt'), 'utf8'), 'original\n');
  });
});
