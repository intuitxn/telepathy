import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

const exec = promisify(execFile);
const mundus = fileURLToPath(new URL('../../mundus', import.meta.url));
const run = async (...args) => (await exec(mundus, args, {
  env: { ...process.env, BEND_NO_TELEMETRY: '1' },
  timeout: 120000,
  maxBuffer: 4 * 1024 * 1024,
})).stdout;

const head = root => fs.readFile(path.join(root, 'head'), 'utf8');
const absent = file => assert.rejects(fs.stat(file), { code: 'ENOENT' });

test('Mundus preserves real worker ownership, fresh-process recall and correction in immutable snapshots', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mundus lifecycle '));
  const root = path.join(dir, 'state with spaces');
  const sentinel = path.join(dir, 'must not execute');
  const task = `Find maximum of [3,9,2]; preserve "quotes", $HOME, $(touch '${sentinel}'), and \`touch '${sentinel}'\` literally`;
  const snapshots = new Map();
  const mutate = async (command, ...args) => {
    const result = await run(command, root, ...args);
    const step = (await head(root)).trim();
    assert.match(step, /^step\.[A-Za-z0-9_-]+$/);
    assert.equal(snapshots.has(step), false, 'each transition must advance to a fresh snapshot');
    const state = path.join(root, 'snapshots', step, 'state');
    snapshots.set(step, await fs.readFile(state));
    await absent(path.join(root, '.writer-lock'));
    return result;
  };
  const rejected = async (command, ...args) => {
    const before = await head(root);
    await assert.rejects(run(command, root, ...args), error => {
      assert.match(error.stdout + error.stderr, /lorenz_invalid/);
      return true;
    });
    assert.equal(await head(root), before, 'rejected transition must preserve the current head');
    await absent(path.join(root, '.writer-lock'));
  };
  try {
    await mutate('init');
    await mutate('capture', task);
    const captured = await run('history', root);
    assert.ok(captured.includes(task), 'capture must preserve shell syntax as task data');
    assert.match(captured, /codex/);
    assert.match(captured, /local:mundus/);
    await absent(sentinel);

    await mutate('work', '1', 'coordinator', 'operator', 'Independent maximum is 9');
    await mutate('worker', 'coordinator', 'worker-a', 'codex');
    await mutate('worker', 'coordinator', 'worker-b', 'opencode');
    await rejected('return', '2', '3', 'worker-a', '9', 'checked without claim');
    await mutate('claim', '2', '3', 'coordinator');
    await rejected('claim', '2', '4', 'coordinator');
    await rejected('return', '2', '4', 'worker-b', '9', 'wrong worker');
    const packet = await run('packet', root, '2');
    assert.match(packet, /Claim ID: 5\nWorker ID: 3/);
    assert.ok(packet.includes(task));
    assert.match(packet, /Independent maximum is 9/);

    await mutate('return', '2', '3', 'worker-a', '9', 'Independent Math.max(3,9,2) is 9');
    assert.equal((await run('memory', root)).trim(), '', 'a returned result is not automatically retained memory');
    await rejected('learn', '2', '0', 'coordinator', 'work intent is not a result');
    await mutate('learn', '6', '0', 'coordinator', 'Maximum can occur in the middle');
    await mutate('remember', '1', '7', 'coordinator', 'Dependent planning assumption');

    // Every invocation starts a new process; this task must recover prior retained state.
    await mutate('capture', 'Use the previously checked maximum finding', 'operator', 'test:fresh-task');
    await mutate('work', '9', 'coordinator', 'operator', 'Retrieve retained evidence before reuse');
    await mutate('claim', '10', '3', 'coordinator');
    const freshPacket = await run('packet', root, '10');
    assert.match(freshPacket, /Maximum can occur in the middle/);
    assert.match(freshPacket, /Dependent planning assumption/);
    assert.match(await run('explain', root, '7'), /Maximum can occur in the middle/);

    await mutate('correct', '7', '0', 'reviewer', 'Limit the finding to its tested input', 'For [3,9,2], maximum is 9');
    const history = await run('history', root);
    assert.match(history, /id=7 kind=8 status=superseded/);
    assert.match(history, /id=8 kind=2 status=needs-review/);
    assert.match(history, /id=6 kind=7 status=reported/);
    const memory = await run('memory', root);
    assert.match(memory, /For \[3,9,2\], maximum is 9/);
    assert.doesNotMatch(memory, /Maximum can occur in the middle|Dependent planning assumption/);
    const correctedPacket = await run('packet', root, '10');
    assert.match(correctedPacket, /For \[3,9,2\], maximum is 9/);
    assert.doesNotMatch(correctedPacket, /Maximum can occur in the middle|Dependent planning assumption/);
    await run('status', root);

    for (const [step, bytes] of snapshots) {
      assert.deepEqual(await fs.readFile(path.join(root, 'snapshots', step, 'state')), bytes,
        'later work and corrections must not rewrite prior evidence');
    }
    await absent(sentinel);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('Mundus refuses competing writers and missing-root reads without changing state', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mundus boundaries '));
  const root = path.join(dir, 'state');
  const missing = path.join(dir, 'missing state');
  try {
    for (const args of [['history'], ['memory'], ['status'], ['packet', '2'], ['explain', '1']]) {
      await assert.rejects(run(args[0], missing, ...args.slice(1)));
      await absent(missing);
    }
    await run('init', root);
    const before = await head(root);
    await assert.rejects(run('init', root), 'initializing an existing root must not reset it');
    assert.equal(await head(root), before);
    const snapshotNames = await fs.readdir(path.join(root, 'snapshots'));
    const lock = path.join(root, '.writer-lock');
    await fs.mkdir(lock);
    await fs.writeFile(path.join(lock, 'owner'), 'another live writer');
    await assert.rejects(run('capture', root, 'must not be captured while locked'));
    assert.equal(await head(root), before);
    assert.deepEqual(await fs.readdir(path.join(root, 'snapshots')), snapshotNames);
    assert.equal(await fs.readFile(path.join(lock, 'owner'), 'utf8'), 'another live writer',
      'a rejected writer must not remove another writer\'s lock');
    await fs.rm(lock, { recursive: true });
    await run('capture', root, 'capture after the owner releases its lock');
    assert.notEqual(await head(root), before);
    await absent(lock);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
