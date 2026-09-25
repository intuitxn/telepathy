import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createCheckedSynthesisRunner } from './synthesis-session.mjs';

const D = character => character.repeat(64);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

test('staged checked synthesis runner binds release files without installation or provider calls', async t => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'synthesis-release-test-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const release = path.join(root, 'a'.repeat(40));
  const moduleRoot = path.join(release, 'runtime/dsh');
  const workspace = path.join(root, 'workspace');
  const taskStateRoot = path.join(root, 'task-state');
  await mkdir(moduleRoot, { recursive: true, mode: 0o700 });
  await mkdir(workspace, { mode: 0o700 });
  await mkdir(taskStateRoot, { mode: 0o700 });
  const files = {};
  for (const name of ['synthesis-host.mjs', 'synthesis-session.mjs',
    'synthesis-contract.mjs']) {
    const relative = `runtime/dsh/${name}`;
    await copyFile(path.join(path.dirname(fileURLToPath(import.meta.url)), name),
      path.join(moduleRoot, name));
    files[relative] = sha(await readFile(path.join(moduleRoot, name)));
  }
  // This fixture isolates the release binding in synthesis-session; the
  // separate task-host tests exercise the real pinned DSH preflight.
  await writeFile(path.join(moduleRoot, 'task-host.mjs'), `
export async function verifyDsh(dsh) { return { trustedRoot: dsh.trustedRoot }; }
export async function sdkTurn(_checked, _workspace, _state, _task, _grant,
  dispatchId) { return { sessionId: dispatchId, finalResponse: '{}', events: [] }; }
`);
  await writeFile(path.join(release, 'release.json'), JSON.stringify({ files }));
  const { createCheckedSynthesisRunner: staged } = await import(
    pathToFileURL(path.join(moduleRoot, 'synthesis-session.mjs')).href);
  const taskRef = D('a');
  const runner = staged({ dsh: { trustedRoot: release }, taskStateRoot });
  const spec = { integration_owner: 'integrator', pinned_versions: { toolchain: 'fixture' } };
  assert.deepEqual(await runner.preflight({ task_ref: taskRef, spec, workspace,
    model_token_limit: 8 }), { toolchain: 'fixture', trusted_root: release });
  const dispatchId = 'synthesis-turn:fixture';
  const result = await runner.run({ task_ref: taskRef, workspace,
    model_token_limit: 8, dispatch_id: dispatchId, prompt: 'bounded proposal',
    intent_sha256: D('b'), grant: { ref: D('c'), location: workspace,
      owner: 'integrator', plan_ref: D('d'), status: 'active' },
    plan: { ref: D('d'), kind: 'synthesis' } });
  assert.equal(result.sessionId, dispatchId);
  await writeFile(path.join(moduleRoot, 'synthesis-host.mjs'), 'tampered host');
  await assert.rejects(staged({ dsh: { trustedRoot: release }, taskStateRoot })
    .preflight({ task_ref: taskRef, spec, workspace, model_token_limit: 8 }),
  /checked release lacks exact synthesis source/);
});

test('production synthesis runner requires a checked DSH configuration and preflight', async () => {
  assert.throws(() => createCheckedSynthesisRunner({ taskStateRoot: '/private/task-state' }),
    /pinned DSH settings/);
  assert.throws(() => createCheckedSynthesisRunner({ dsh: {}, taskStateRoot: 'relative' }),
    /absolute normalized path/);
  const runner = createCheckedSynthesisRunner({ dsh: {}, taskStateRoot: '/private/task-state' });
  await assert.rejects(runner.run({ task_ref: D('a'), grant: {}, plan: {},
    intent_sha256: D('b') }), /differs from checked task/);
  await assert.rejects(runner.preflight({ task_ref: D('a'),
    spec: {}, workspace: '/private/workspace', model_token_limit: 0 }),
  /invalid funded task binding/);
});
