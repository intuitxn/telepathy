import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createResidentIngress } from './resident-ingress.mjs';
import { dshToolchainFingerprint } from './task-host.mjs';

const digest = byte => byte.repeat(64);
const taskRef = digest('a');
const request = (request_id, task = 'Investigate a measurable claim', kind = 'research') => ({
  request_id, profile_id: 'lab', kind, task,
  acceptance: 'Report attributed evidence and uncertainty',
});

function profile() {
  const cliSha256 = digest('1');
  const sdkSha256 = digest('2');
  const llmSha256 = digest('3');
  return {
    id: 'lab', scope: 'lab', integration_owner: 'owner',
    initial_head: 'b'.repeat(40), policy_version: 'v1',
    pinned_versions: { evaluator_sha256: digest('4'), case_set_sha256: digest('5'),
      toolchain: dshToolchainFingerprint(cliSha256, sdkSha256, llmSha256) },
    limits: { max_tasks: 2, max_branches: 2, max_active_grants: 2,
      max_depth: 0, tokens: 10000, fuel: 10, integrations: 1, evaluations: 1 },
    target_tasks: 1,
    planner_budget: { tokens: 1000, fuel: 1, children: 0,
      integrations: 0, evaluations: 0 },
    worker_budget: { tokens: 1000, fuel: 2, children: 0,
      integrations: 0, evaluations: 1 },
    planner_workspace: '/host/planner', verifier_file: '/host/oracle.mjs',
    case_set_file: '/host/cases.json', max_retained_worker_workspaces: 8,
    dsh: { dshBin: '/host/dsh/bin.js', sdkModule: '/host/dsh/sdk.js',
      llmModule: '/host/dsh/llm.js', cliSha256, sdkSha256, llmSha256,
      trustedRoot: '/host/release', dshHome: '/host/dsh-home' },
  };
}

function settings(stateRoot, runner, auditUnknown, selected = profile()) {
  return { stateRoot, profiles: [selected], runner, auditUnknown,
    allowTestRunner: true };
}

async function fixture(work) {
  const stateRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'telepathy-ingress-test-')));
  try { await work(stateRoot); }
  finally { await rm(stateRoot, { recursive: true, force: true }); }
}

test('request ID and content dedupe, unsupported coding, and frozen profile fields', async () => fixture(async root => {
  let calls = 0;
  const ingress = await createResidentIngress(settings(root, async () => {
    calls++;
    return { task_ref: taskRef, progress: { task_ref: taskRef,
      status: 'terminal', planning_done: true, active_grants: 0,
      accepted_plans: 1, task_accepted: false } };
  }));
  try {
    const first = ingress.submit(request('one'));
    assert.equal(first.status, 'queued');
    assert.equal(ingress.submit(request('one')).program_id, first.program_id);
    assert.equal(ingress.submit(request('alias')).request_id, 'one');
    assert.equal(ingress.status('alias').program_id, first.program_id);
    assert.throws(() => ingress.submit(request('alias', 'Different question')),
      /request_id belongs to different work/);
    assert.throws(() => ingress.submit(request('one', 'Different question')),
      /request_id belongs to different work/);
    const coding = ingress.submit(request('code', 'Edit a program', 'implementation'));
    assert.equal(coding.status, 'unsupported');
    assert.equal(ingress.list().length, 2);
    const done = await ingress.runNext();
    assert.equal(done.status, 'reported');
    assert.equal(done.task_ref, taskRef);
    assert.equal(done.progress.task_accepted, false);
    assert.equal(calls, 1);
    assert.equal(await ingress.runNext(), null);
  } finally { ingress.close(); }
}));

test('thrown worker turn becomes unknown across restart and cannot repeat without an exact absence audit', async () => fixture(async root => {
  let calls = 0;
  let verdict = 'unknown';
  const runner = async () => { calls++; throw new Error('process lost after provider dispatch'); };
  const auditor = async input => ({ attempt_id: input.attempt_id,
    profile_sha256: input.profile_sha256, status: verdict,
    task_ref: input.task_ref, progress: null, receipt_sha256: digest('6') });
  let ingress = await createResidentIngress(settings(root, runner, auditor));
  ingress.submit(request('uncertain'));
  const uncertain = await ingress.runNext();
  assert.equal(uncertain.status, 'unknown');
  assert.equal(uncertain.audit_required, true);
  ingress.close();

  ingress = await createResidentIngress(settings(root, runner, auditor));
  try {
    assert.equal(await ingress.runNext(), null);
    assert.equal(calls, 1);
    assert.equal((await ingress.reconcile('uncertain')).status, 'unknown');
    assert.equal(await ingress.runNext(), null);
    verdict = 'absent';
    assert.equal((await ingress.reconcile('uncertain')).status, 'queued');
    assert.equal((await ingress.runNext()).status, 'unknown');
    assert.equal(calls, 2, 'only an explicit absence audit authorizes another call');
  } finally { ingress.close(); }
}));

test('completed audit binds the original attempt and cannot fabricate task acceptance', async () => fixture(async root => {
  let calls = 0;
  const runner = async () => { calls++; throw new Error('lost response'); };
  const auditor = async input => ({ attempt_id: input.attempt_id,
    profile_sha256: input.profile_sha256, status: 'completed',
    task_ref: taskRef, receipt_sha256: digest('7'),
    progress: { task_ref: taskRef, status: 'terminal',
      planning_done: true, active_grants: 0, accepted_plans: 1,
      task_accepted: false } });
  const ingress = await createResidentIngress(settings(root, runner, auditor));
  try {
    ingress.submit(request('audited'));
    assert.equal((await ingress.runNext()).status, 'unknown');
    const recovered = await ingress.reconcile('audited');
    assert.equal(recovered.status, 'reported');
    assert.equal(recovered.audit_receipt_sha256, digest('7'));
    assert.equal(await ingress.runNext(), null);
    assert.equal(calls, 1);
  } finally { ingress.close(); }
}));

test('changed profile cannot silently drive an existing queued request', async () => fixture(async root => {
  const runner = async () => { throw new Error('must not run'); };
  let ingress = await createResidentIngress(settings(root, runner));
  ingress.submit(request('pinned'));
  ingress.close();
  const changed = profile();
  changed.policy_version = 'v2';
  ingress = await createResidentIngress(settings(root, runner, null, changed));
  try {
    await assert.rejects(ingress.runNext(), /profile changed/);
    assert.equal(ingress.status('pinned').status, 'queued');
  } finally { ingress.close(); }
}));

test('unfunded or over-authorized profiles fail before queueing', async () => fixture(async root => {
  const runner = async () => { throw new Error('must not run'); };
  for (const [mutate, message] of [
    [value => { value.planner_budget.tokens = 0; }, /planner profile needs/],
    [value => { value.planner_budget.evaluations = 1; }, /planner profile needs/],
    [value => { value.worker_budget.fuel = 0; }, /research workers need/],
    [value => { value.worker_budget.tokens = 0; }, /research workers need/],
  ]) {
    const invalid = profile();
    mutate(invalid);
    await assert.rejects(createResidentIngress(settings(root, runner, null, invalid)), message);
  }
}));

test('paused program needs explicit resume; audit progress never retries itself', async () => fixture(async root => {
  let calls = 0;
  const ingress = await createResidentIngress(settings(root, async () => {
    calls++;
    return { task_ref: taskRef, progress: { task_ref: taskRef,
      status: calls === 1 ? 'delegation-capacity-held' : 'terminal',
      planning_done: true, active_grants: 0,
      task_accepted: false } };
  }));
  try {
    ingress.submit(request('paused'));
    assert.equal((await ingress.runNext()).status, 'paused');
    assert.equal(await ingress.runNext(), null);
    assert.equal(calls, 1);
    assert.equal(ingress.resume('paused').status, 'queued');
    assert.equal((await ingress.runNext()).status, 'reported');
    assert.equal(calls, 2);
  } finally { ingress.close(); }
}));

test('stale invocation becomes unknown before another queued request can run', async () => fixture(async root => {
  let calls = 0;
  const ingress = await createResidentIngress(settings(root, async () => {
    calls++;
    return { task_ref: taskRef, progress: { task_ref: taskRef,
      status: 'terminal', planning_done: true, active_grants: 0,
      task_accepted: false } };
  }));
  try {
    ingress.submit(request('lost', 'First question'));
    ingress.submit(request('next', 'Second question'));
    const db = new DatabaseSync(path.join(root, 'ingress.sqlite'));
    try {
      db.prepare("UPDATE requests SET status = 'invoking', attempt_id = 'lost-attempt' WHERE request_id = 'lost'").run();
    } finally { db.close(); }
    assert.equal((await ingress.runNext()).request_id, 'next');
    assert.equal(ingress.status('lost').status, 'unknown');
    assert.equal(ingress.status('lost').attempt_id, 'lost-attempt');
    assert.equal(calls, 1);
  } finally { ingress.close(); }
}));

test('two drivers in one process serialize without blocking a pending turn', async () => fixture(async root => {
  let active = 0;
  let peak = 0;
  const ingress = await createResidentIngress(settings(root, async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 20));
    active--;
    return { task_ref: taskRef, progress: { task_ref: taskRef,
      status: 'terminal', planning_done: true, active_grants: 0,
      task_accepted: false } };
  }));
  try {
    ingress.submit(request('a', 'Question A'));
    ingress.submit(request('b', 'Question B'));
    const outcomes = await Promise.all([ingress.runNext(), ingress.runNext()]);
    assert.equal(peak, 1);
    assert.deepEqual(outcomes.map(row => row.status), ['reported', 'reported']);
  } finally { ingress.close(); }
}));
