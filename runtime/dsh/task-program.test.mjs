import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createTaskControl } from './task-control.mjs';
import { createTaskProgram, logicalPlanRef, plannerPageDigest } from './task-program.mjs';

const H = char => char.repeat(64);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const HEAD = 'a'.repeat(40);
const budget = (extra = {}) => ({ tokens: 1000, fuel: 2, children: 0,
  integrations: 0, evaluations: 0, ...extra });
const spec = (limits = {}) => ({
  goal: 'Resolve bounded research tasks', acceptance: 'Pinned host evaluator accepts the result',
  scopes: ['research'], integration_owner: 'integrator', initial_head: HEAD,
  pinned_versions: { evaluator_sha256: H('1'), case_set_sha256: H('2'), toolchain: 'test-toolchain' },
  limits: { max_tasks: 256, max_branches: 2, max_active_grants: 1, max_depth: 0,
    tokens: 300_000, fuel: 1000, integrations: 1, evaluations: 1, ...limits },
  policy_version: 'test-policy',
});
const task = (id, depends_on = []) => ({ id, kind: 'research', scope: 'research',
  deliverable: `Answer ${id}`, acceptance: `Verify ${id} independently`, source_refs: [],
  oracle_sha256: H('1'), budget: budget(), depends_on, parent_plan_ref: null });

async function fixture(t, limits = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'task-program-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const controller = createTaskControl({ storeRoot: path.join(root, 'control'), allowUnsafeStoreRootForTest: true });
  const options = { controller, spec: spec(limits), prompt: 'Plan the research work', programId: 'research-v1',
    stateRoot: path.join(root, 'program'), allowUnsafeStateRootForTest: true,
    maxLiveWorkers: 1,
    grantForPlan: async ({ plan }) => ({ branch: `branch-${plan.id}`, owner: 'worker',
      budget: budget(), location: path.join(root, `workspace-${plan.id}`), parent_grant_ref: null }),
    worker: async () => ({ status: 'started' }),
  };
  return { root, controller, options };
}

test('pages 128 logical tasks but dispatches only one live grant, then resumes from checkpoint', async t => {
  const { controller, options } = await fixture(t);
  const dispatched = [];
  const configured = { ...options, planner: async ({ cursor, planRef }) => {
    const start = cursor ?? 0;
    const tasks = Array.from({ length: Math.min(16, 128 - start) }, (_, offset) => {
      const index = start + offset;
      return task(`logical-${index}`, index ? [planRef(`logical-${index - 1}`)] : []);
    });
    return { tasks, next_cursor: start + tasks.length, done: start + tasks.length === 128 };
  }, worker: async ({ grant }) => { dispatched.push(grant.ref); return { status: 'started' }; } };
  const program = createTaskProgram(configured);
  let result;
  for (let i = 0; i < 5; i++) {
    result = await program.run({ maxSteps: 64 });
    if (result.planning_done) break;
  }
  assert.equal(result.planning_done, true);
  const snapshot = await controller.replay(result.task_ref);
  assert.equal(snapshot.plans.length, 128);
  assert.equal(snapshot.grants.length, 1);
  assert.equal(snapshot.grants[0].status, 'active');
  assert.equal(dispatched.length, 1);
  assert.equal(logicalPlanRef(result.task_ref, 'logical-127'), snapshot.plans[127].ref);

  const restarted = createTaskProgram(configured);
  const again = await restarted.run();
  assert.equal(again.status, 'waiting-workers');
  assert.equal(dispatched.length, 1);
  assert.equal((await controller.replay(result.task_ref)).grants.length, 1);
  assert.equal((await controller.replay(result.task_ref)).terminal, null);
});

test('feedback planning keeps a 64-task page durable while one worker is live', async t => {
  const { controller, options } = await fixture(t, { max_tasks: 64 });
  let plannerCalls = 0;
  const configured = { ...options, feedbackPlanning: true,
    planner: async () => {
      plannerCalls++;
      return { tasks: Array.from({ length: 64 }, (_, index) => task(`page-${index}`)),
        next_cursor: 1, done: false };
    } };
  const progress = await createTaskProgram(configured).run({ maxSteps: 1024 });
  assert.equal(progress.status, 'waiting-workers');
  assert.equal(progress.planned_count, 64);
  assert.equal(plannerCalls, 1);
  assert.equal((await controller.replay(progress.task_ref)).grants.length, 1);
  const resumed = await createTaskProgram(configured).run();
  assert.equal(resumed.status, 'waiting-workers');
  assert.equal(plannerCalls, 1, 'a waiting feedback barrier does not call the planner again');
});

test('explicit legacy preplanning reopens the same checkpoint signature', async t => {
  const { options } = await fixture(t, { max_tasks: 1 });
  const configured = { ...options,
    planner: async () => ({ tasks: [task('legacy')], next_cursor: null, done: true }) };
  await createTaskProgram(configured).run({ maxSteps: 1 });
  const resumed = await createTaskProgram({ ...configured, feedbackPlanning: false }).run();
  assert.equal(resumed.planning_done, true);
  assert.equal(resumed.planned_count, 1);
});

test('a worker-declared failure cannot become independently settled planner feedback', async t => {
  const { options } = await fixture(t, { max_tasks: 2 });
  let plannerCalls = 0;
  const configured = { ...options, feedbackPlanning: true,
    planner: async () => {
      plannerCalls++;
      return { tasks: [task('first')], next_cursor: 1, done: false };
    },
    worker: async ({ task_ref, grant, controller }) => {
      await controller.admit(task_ref, { id: 'worker-declared-failure',
        grant_ref: grant.ref, actor: grant.owner, scope: grant.scope,
        base_commit: grant.base_refs.task_commit, parents: [grant.last_event],
        kind: 'failed', payload: { reason: 'unverified worker statement' } });
    } };
  const progress = await createTaskProgram(configured).run();
  assert.equal(progress.status, 'feedback-verdict-required');
  assert.equal(plannerCalls, 1);
  const resumed = await createTaskProgram(configured).run();
  assert.equal(resumed.status, 'feedback-verdict-required');
  assert.equal(plannerCalls, 1);
});

test('grant result lost after durable commit is retried with the same id and only one worker call', async t => {
  const { controller, options } = await fixture(t, { max_tasks: 1 });
  let calls = 0;
  let lost = true;
  const proxy = { ...controller, grant: async (...args) => {
    const result = await controller.grant(...args);
    if (lost) { lost = false; throw new Error('simulated lost grant reply'); }
    return result;
  } };
  const configured = { ...options, controller: proxy,
    planner: async () => ({ tasks: [task('only')], next_cursor: null, done: true }),
    worker: async () => { calls++; } };
  const program = createTaskProgram(configured);
  await assert.rejects(program.run(), /simulated lost grant reply/);
  const recovered = await createTaskProgram(configured).run();
  const snapshot = await controller.replay(recovered.task_ref);
  assert.equal(snapshot.plans.length, 1);
  assert.equal(snapshot.grants.length, 1);
  assert.equal(calls, 1);
});

test('uncommitted grant intent refreshes its causal cut after another host event', async t => {
  const { controller, options } = await fixture(t, { max_tasks: 1 });
  let calls = 0;
  const program = createTaskProgram({ ...options,
    planner: async () => ({ tasks: [task('only')], next_cursor: null, done: true }),
    worker: async () => { calls++; } });
  const pending = await program.run({ maxSteps: 5 });
  assert.equal((await controller.replay(pending.task_ref)).grants.length, 0);
  const before = await controller.replay(pending.task_ref);
  await controller.checkpoint(pending.task_ref, { id: 'external-checkpoint', expected_log_head: before.log_head });
  const resumed = await program.run();
  assert.equal((await controller.replay(resumed.task_ref)).grants.length, 1);
  assert.equal(calls, 1);
});

test('uncertain worker invocation pauses until exact durable dispatch audit', async t => {
  const { controller, options } = await fixture(t, { max_tasks: 1 });
  let calls = 0;
  const configured = { ...options,
    planner: async () => ({ tasks: [task('only')], next_cursor: null, done: true }),
    worker: async () => { calls++; throw new Error('lost worker reply'); } };
  await assert.rejects(createTaskProgram(configured).run(), /lost worker reply/);
  const uncertain = await createTaskProgram(configured).run();
  assert.equal(uncertain.status, 'dispatch-audit-required');
  assert.equal(calls, 1);
  const resumed = await createTaskProgram({ ...configured,
    reconcileDispatch: async ({ grant, intent }) => ({ status: 'started', grant_ref: grant.ref,
      dispatch_id: intent.dispatch_id,
      receipt_sha256: H('9') }) }).run();
  assert.equal(resumed.status, 'waiting-workers');
  assert.equal(calls, 1);
  assert.equal((await controller.replay(resumed.task_ref)).grants.length, 1);
});

test('concurrent drivers cannot audit or invoke a live worker twice', async t => {
  const { controller, options } = await fixture(t, { max_tasks: 1 });
  let enterWorker;
  let releaseWorker;
  const entered = new Promise(resolve => { enterWorker = resolve; });
  const hold = new Promise(resolve => { releaseWorker = resolve; });
  let calls = 0;
  const program = createTaskProgram({ ...options,
    planner: async () => ({ tasks: [task('only')], next_cursor: null, done: true }),
    worker: async () => { calls++; enterWorker(); await hold; } });
  const first = program.run();
  await entered;
  const second = program.run();
  releaseWorker();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.task_ref, b.task_ref);
  assert.equal(calls, 1);
  assert.equal((await controller.replay(a.task_ref)).grants.length, 1);
});

test('audited absent dispatch retries with a new durable attempt id', async t => {
  const { options } = await fixture(t, { max_tasks: 1 });
  const attempts = [];
  const configured = { ...options,
    planner: async () => ({ tasks: [task('only')], next_cursor: null, done: true }),
    worker: async ({ dispatch_id }) => {
      attempts.push(dispatch_id);
      if (attempts.length === 1) throw new Error('crash after dispatch');
    } };
  await assert.rejects(createTaskProgram(configured).run(), /crash after dispatch/);
  await createTaskProgram({ ...configured,
    reconcileDispatch: async ({ grant, intent }) => ({ status: 'absent',
      grant_ref: grant.ref, dispatch_id: intent.dispatch_id, receipt_sha256: H('8') }) }).run();
  assert.equal(attempts.length, 2);
  assert.notEqual(attempts[0], attempts[1]);
});

test('planner cannot exceed frozen task bound and a worker return is not acceptance', async t => {
  const { controller, options } = await fixture(t, { max_tasks: 1 });
  const over = createTaskProgram({ ...options,
    planner: async () => ({ tasks: [task('one'), task('two')], next_cursor: null, done: true }) });
  await assert.rejects(over.run(), /exceeds the frozen logical task limit/);
  const opened = await controller.open(options.spec);
  assert.equal((await controller.replay(opened.task_ref)).plans.length, 0);
  assert.equal((await over.run()).status, 'planner-audit-required');
  const { controller: nextController, options: nextOptions } = await fixture(t, { max_tasks: 1 });
  const valid = createTaskProgram({ ...nextOptions,
    planner: async () => ({ tasks: [task('one')], next_cursor: null, done: true }) });
  const result = await valid.run();
  const snapshot = await nextController.replay(result.task_ref);
  assert.equal(snapshot.plans[0].status, 'granted');
  assert.equal(snapshot.terminal, null);
});

test('a later invalid page member never leaves an earlier logical task admitted', async t => {
  const cases = [
    { label: 'unsupported kind', second: () => ({ ...task('two'), kind: 'unknown' }),
      pattern: /kind is unsupported/, limits: {} },
    { label: 'negative task budget', second: () => ({ ...task('two'), budget: budget({ fuel: -1 }) }),
      pattern: /budget fuel must be in/, limits: {} },
    { label: 'absent dependency', second: () => task('two', [H('9')]),
      pattern: /dependency is absent/, limits: {} },
    { label: 'cumulative planning fuel', second: () => task('two'),
      pattern: /remaining planning fuel or tokens/, limits: { fuel: 1 } },
  ];
  for (const item of cases) await t.test(item.label, async t => {
    const { controller, options } = await fixture(t, item.limits);
    const page = { tasks: [task('one'), item.second()], next_cursor: null, done: true };
    let plannerCalls = 0;
    const configured = { ...options, planner: async () => { plannerCalls++; return page; } };
    await assert.rejects(createTaskProgram(configured).run(), item.pattern);
    const opened = await controller.open(options.spec);
    assert.equal((await controller.replay(opened.task_ref)).plans.length, 0);
    assert.equal((await createTaskProgram(configured).run()).status, 'planner-audit-required');
    assert.equal(plannerCalls, 1);
    const audited = await createTaskProgram({ ...configured,
      reconcilePlanner: async ({ task_ref, intent }) => ({ status: 'completed', task_ref,
        attempt_id: intent.attempt_id, input_sha256: intent.input_sha256,
        page, page_sha256: plannerPageDigest(page), receipt_sha256: H('7') }) }).run();
    assert.equal(audited.status, 'planner-page-invalid');
    assert.equal(audited.rejected_page.page_sha256, plannerPageDigest(page));
    assert.match(audited.rejected_page.reason, item.pattern);
    assert.equal((await controller.replay(opened.task_ref)).plans.length, 0);
    assert.equal((await createTaskProgram(configured).run()).status, 'planner-page-invalid');
    assert.equal(plannerCalls, 1);
  });
});

test('same-page parents and dependencies pass page validation before admission', async t => {
  const { controller, options } = await fixture(t, { max_tasks: 2 });
  const result = await createTaskProgram({ ...options,
    planner: async ({ planRef }) => ({ tasks: [task('one'),
      { ...task('two', [planRef('one')]), parent_plan_ref: planRef('one') }],
    next_cursor: null, done: true }) }).run();
  const snapshot = await controller.replay(result.task_ref);
  assert.equal(result.planning_done, true);
  assert.equal(snapshot.plans.length, 2);
  assert.equal(snapshot.plans[1].parent_plan_ref, snapshot.plans[0].ref);
});

test('replanning a confirmed invalid page needs its exact digest and has a finite attempt cap', async t => {
  const { controller, options } = await fixture(t, { max_tasks: 1 });
  const invalid = { tasks: [{ ...task('wrong'), kind: 'unknown' }], next_cursor: null, done: true };
  const invalidDigest = plannerPageDigest(invalid);
  let plannerCalls = 0;
  const configured = { ...options, planner: async () => {
    plannerCalls++;
    return invalid;
  } };
  const audited = { ...configured, reconcilePlanner: async ({ task_ref, intent }) => ({
    status: 'completed', task_ref, attempt_id: intent.attempt_id,
    input_sha256: intent.input_sha256, page: invalid,
    page_sha256: invalidDigest, receipt_sha256: H('7'),
  }) };
  let rejected;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt === 0) await assert.rejects(createTaskProgram(configured).run(), /kind is unsupported/);
    else await assert.rejects(createTaskProgram(configured).run({ replanPageDigest: invalidDigest }),
      /kind is unsupported/);
    rejected = await createTaskProgram(audited).run();
    assert.equal(rejected.status, 'planner-page-invalid');
    assert.equal(rejected.replans_remaining, 3 - attempt);
  }
  await assert.rejects(createTaskProgram(configured).run({ replanPageDigest: invalidDigest }),
    /replan limit is exhausted/);
  assert.equal(plannerCalls, 4);
  assert.equal((await controller.replay(rejected.task_ref)).plans.length, 0);
});

test('an exact host replan decision can replace a rejected page without repeating the old model attempt', async t => {
  const { controller, options } = await fixture(t, { max_tasks: 1 });
  const invalid = { tasks: [{ ...task('wrong'), kind: 'unknown' }], next_cursor: null, done: true };
  const invalidDigest = plannerPageDigest(invalid);
  let calls = 0;
  const configured = { ...options, planner: async () => {
    calls++;
    return calls === 1 ? invalid : { tasks: [task('fixed')], next_cursor: null, done: true };
  } };
  await assert.rejects(createTaskProgram(configured).run(), /kind is unsupported/);
  const reviewed = await createTaskProgram({ ...configured,
    reconcilePlanner: async ({ task_ref, intent }) => ({ status: 'completed', task_ref,
      attempt_id: intent.attempt_id, input_sha256: intent.input_sha256,
      page: invalid, page_sha256: invalidDigest, receipt_sha256: H('7') }) }).run();
  assert.equal(reviewed.status, 'planner-page-invalid');
  await assert.rejects(createTaskProgram(configured).run({ replanPageDigest: H('8') }),
    /does not bind the rejected page/);
  assert.equal(calls, 1);
  const repaired = await createTaskProgram(configured).run({ replanPageDigest: invalidDigest });
  assert.equal(repaired.planning_done, true);
  assert.equal(calls, 2);
  assert.deepEqual((await controller.replay(repaired.task_ref)).plans.map(plan => plan.id), ['fixed']);
});

test('trusted invalid audit repairs malformed and oversized raw planner replies without repeating an attempt', async t => {
  const cases = [
    { label: 'unknown top-level field', raw: JSON.stringify({ tasks: [task('unusable')],
      next_cursor: null, done: true, extra: 'not-a-page' }),
    pattern: /planner page has unknown field extra/ },
    { label: 'oversized response', raw: JSON.stringify({ tasks: [task('unusable')],
      next_cursor: 'x'.repeat(1024 * 1024), done: true }),
    pattern: /planner page exceeds 1048576 bytes/ },
  ];
  for (const item of cases) await t.test(item.label, async t => {
    const { controller, options } = await fixture(t, { max_tasks: 1 });
    const rawDigest = sha256(item.raw);
    let plannerCalls = 0;
    const configured = { ...options, planner: async () => {
      plannerCalls++;
      return plannerCalls === 1 ? JSON.parse(item.raw) :
        { tasks: [task('replanned')], next_cursor: null, done: true };
    } };
    await assert.rejects(createTaskProgram(configured).run(), item.pattern);
    const waiting = await createTaskProgram(configured).run();
    assert.equal(waiting.status, 'planner-audit-required');
    assert.equal(plannerCalls, 1);
    assert.equal((await controller.replay(waiting.task_ref)).plans.length, 0);

    const audited = await createTaskProgram({ ...configured,
      reconcilePlanner: async ({ task_ref, intent }) => ({ status: 'invalid', task_ref,
        attempt_id: intent.attempt_id, input_sha256: intent.input_sha256,
        receipt_sha256: H('7'), response_sha256: rawDigest,
        reason: `host confirmed ${item.label}` }) }).run();
    assert.equal(audited.status, 'planner-page-invalid');
    assert.equal(audited.rejected_page.page_sha256, rawDigest);
    assert.equal(audited.rejected_page.response_sha256, rawDigest);
    assert.equal(audited.rejected_page.reason, `host confirmed ${item.label}`);
    assert.equal((await createTaskProgram(configured).run()).status, 'planner-page-invalid');
    assert.equal(plannerCalls, 1);
    await assert.rejects(createTaskProgram(configured).run({ replanPageDigest: H('8') }),
      /does not bind the rejected page/);
    const repaired = await createTaskProgram(configured).run({ replanPageDigest: rawDigest });
    assert.equal(repaired.planning_done, true);
    assert.equal(plannerCalls, 2);
    assert.deepEqual((await controller.replay(repaired.task_ref)).plans.map(plan => plan.id),
      ['replanned']);
  });
});

test('unexpected controller rejection quarantines a partially admitted page for explicit repair', async t => {
  const { controller, options } = await fixture(t, { max_tasks: 2 });
  let planCalls = 0;
  const proxy = { ...controller, plan: async (taskRef, request) => {
    planCalls++;
    if (request.id === 'two') throw new Error('task control: synthetic host validation failure');
    return controller.plan(taskRef, request);
  } };
  const configured = { ...options, controller: proxy,
    planner: async () => ({ tasks: [task('one'), task('two')], next_cursor: null, done: true }) };
  const stopped = await createTaskProgram(configured).run();
  assert.equal(stopped.status, 'planner-page-repair-required');
  assert.equal(stopped.quarantined_page.failed_task_id, 'two');
  assert.equal(stopped.quarantined_page.index, 1);
  assert.deepEqual((await controller.replay(stopped.task_ref)).plans.map(plan => plan.id), ['one']);
  const again = await createTaskProgram(configured).run();
  assert.equal(again.status, 'planner-page-repair-required');
  assert.deepEqual(again.quarantined_page, stopped.quarantined_page);
  assert.equal(planCalls, 2);
});

test('planner crash is journaled and unknown audit never repeats the invocation', async t => {
  const { options } = await fixture(t, { max_tasks: 1 });
  const attempts = [];
  const configured = { ...options, planner: async input => {
    attempts.push(input);
    throw new Error('planner reply lost after model dispatch');
  } };
  await assert.rejects(createTaskProgram(configured).run(), /planner reply lost/);
  assert.equal(attempts.length, 1);
  assert.equal(typeof attempts[0].attempt_id, 'string');
  assert.match(attempts[0].input_sha256, /^[a-f0-9]{64}$/);

  const noAudit = await createTaskProgram(configured).run();
  assert.equal(noAudit.status, 'planner-audit-required');
  assert.equal(attempts.length, 1);

  let audits = 0;
  const unknown = await createTaskProgram({ ...configured, reconcilePlanner: async ({ task_ref, intent }) => {
    audits++;
    assert.equal(intent.phase, 'planner-invoking');
    assert.equal(intent.attempt_id, attempts[0].attempt_id);
    assert.equal(intent.input.task_ref, task_ref);
    assert.equal(intent.input_sha256, attempts[0].input_sha256);
    return { status: 'unknown', task_ref, attempt_id: intent.attempt_id,
      input_sha256: intent.input_sha256 };
  } }).run();
  assert.equal(unknown.status, 'planner-audit-required');
  assert.equal(audits, 1);
  assert.equal(attempts.length, 1);
});

test('a prepared planner intent survives restart without requiring an audit', async t => {
  const { options } = await fixture(t, { max_tasks: 1 });
  let calls = 0;
  const configured = { ...options, planner: async () => {
    calls++;
    return { tasks: [task('one')], next_cursor: null, done: true };
  } };
  const prepared = await createTaskProgram(configured).run({ maxSteps: 1 });
  assert.equal(prepared.planning_done, false);
  assert.equal(calls, 0);
  const resumed = await createTaskProgram(configured).run();
  assert.equal(resumed.planning_done, true);
  assert.equal(calls, 1);
});

test('completed planner audit installs its exact bounded page without another model call', async t => {
  const { controller, options } = await fixture(t, { max_tasks: 1 });
  let calls = 0;
  const page = { tasks: [task('recovered')], next_cursor: null, done: true };
  const configured = { ...options, planner: async () => { calls++; throw new Error('lost planner reply'); } };
  await assert.rejects(createTaskProgram(configured).run(), /lost planner reply/);
  const recovered = await createTaskProgram({ ...configured, reconcilePlanner: async ({ task_ref, intent }) => ({
    status: 'completed', task_ref, attempt_id: intent.attempt_id,
    input_sha256: intent.input_sha256, page, page_sha256: plannerPageDigest(page),
    receipt_sha256: H('7'),
  }) }).run();
  assert.equal(recovered.planning_done, true);
  assert.equal(calls, 1);
  assert.equal((await controller.replay(recovered.task_ref)).plans[0].id, 'recovered');
});

test('absent planner audit permits only a fresh exact attempt', async t => {
  const { controller, options } = await fixture(t, { max_tasks: 1 });
  const attempts = [];
  const configured = { ...options, planner: async input => {
    attempts.push(input);
    if (attempts.length === 1) throw new Error('planner start outcome unknown');
    return { tasks: [task('retried')], next_cursor: null, done: true };
  } };
  await assert.rejects(createTaskProgram(configured).run(), /planner start outcome unknown/);
  const resumed = await createTaskProgram({ ...configured, reconcilePlanner: async ({ task_ref, intent }) => ({
    status: 'absent', task_ref, attempt_id: intent.attempt_id,
    input_sha256: intent.input_sha256, receipt_sha256: H('8'),
  }) }).run();
  assert.equal(resumed.planning_done, true);
  assert.equal(attempts.length, 2);
  assert.notEqual(attempts[0].attempt_id, attempts[1].attempt_id);
  assert.equal(attempts[0].input_sha256, attempts[1].input_sha256);
  assert.equal((await controller.replay(resumed.task_ref)).plans[0].id, 'retried');
});

test('planner audit rejects mismatched attempt, receipt, page digest and oversized page', async t => {
  const cases = [
    { label: 'attempt', audit: ({ task_ref, intent }) => ({ status: 'absent', task_ref,
      attempt_id: 'someone-else', input_sha256: intent.input_sha256, receipt_sha256: H('8') }),
      pattern: /does not bind the exact attempt/ },
    { label: 'receipt', audit: ({ task_ref, intent }) => ({ status: 'absent', task_ref,
      attempt_id: intent.attempt_id, input_sha256: intent.input_sha256, receipt_sha256: 'bad' }),
      pattern: /planner audit receipt must be SHA-256/ },
    { label: 'digest', audit: ({ task_ref, intent }) => ({ status: 'completed', task_ref,
      attempt_id: intent.attempt_id, input_sha256: intent.input_sha256,
      page: { tasks: [task('x')], next_cursor: null, done: true }, page_sha256: H('9'),
      receipt_sha256: H('8') }), pattern: /planner audit page digest mismatch/ },
    { label: 'size', audit: ({ task_ref, intent }) => ({ status: 'completed', task_ref,
      attempt_id: intent.attempt_id, input_sha256: intent.input_sha256,
      page: { tasks: [], next_cursor: 'x'.repeat(1024 * 1024), done: true }, page_sha256: H('9'),
      receipt_sha256: H('8') }), pattern: /planner audit page exceeds/ },
    { label: 'invalid digest', audit: ({ task_ref, intent }) => ({ status: 'invalid', task_ref,
      attempt_id: intent.attempt_id, input_sha256: intent.input_sha256,
      response_sha256: 'bad', reason: 'malformed response', receipt_sha256: H('8') }),
      pattern: /raw response digest must be SHA-256/ },
    { label: 'invalid attempt', audit: ({ task_ref, intent }) => ({ status: 'invalid', task_ref,
      attempt_id: 'different-attempt', input_sha256: intent.input_sha256,
      response_sha256: H('9'), reason: 'malformed response', receipt_sha256: H('8') }),
      pattern: /does not bind the exact attempt and input/ },
    { label: 'invalid reason', audit: ({ task_ref, intent }) => ({ status: 'invalid', task_ref,
      attempt_id: intent.attempt_id, input_sha256: intent.input_sha256,
      response_sha256: H('9'), reason: 'x'.repeat(513), receipt_sha256: H('8') }),
      pattern: /invalid reason must be a nonempty bounded string/ },
    { label: 'invalid with page', audit: ({ task_ref, intent }) => ({ status: 'invalid', task_ref,
      attempt_id: intent.attempt_id, input_sha256: intent.input_sha256,
      response_sha256: H('9'), reason: 'malformed response', page: {}, receipt_sha256: H('8') }),
      pattern: /invalid planner audit cannot carry a page/ },
  ];
  for (const item of cases) {
    await t.test(item.label, async t => {
      const { options } = await fixture(t, { max_tasks: 1 });
      const configured = { ...options, planner: async () => { throw new Error('lost planner reply'); } };
      await assert.rejects(createTaskProgram(configured).run(), /lost planner reply/);
      await assert.rejects(createTaskProgram({ ...configured, reconcilePlanner: async input => item.audit(input) }).run(),
        item.pattern);
      assert.equal((await createTaskProgram(configured).run()).status, 'planner-audit-required');
    });
  }
});

test('opt-in 10,000 logical plans retain a one-worker live bound',
  { skip: process.env.TELEPATHY_PROGRAM_STRESS_10K !== '1' }, async t => {
    const { controller, options } = await fixture(t, {
      max_tasks: 10_000, max_branches: 2, tokens: 20_000_000, fuel: 20_000,
    });
    let workerCalls = 0;
    const program = createTaskProgram({ ...options,
      planner: async ({ cursor, planRef }) => {
        const start = cursor ?? 0;
        const count = Math.min(64, 10_000 - start);
        return { tasks: Array.from({ length: count }, (_, offset) => {
          const index = start + offset;
          return task(`logical-${index}`, index ? [planRef(`logical-${index - 1}`)] : []);
        }), next_cursor: start + count, done: start + count === 10_000 };
      },
      worker: async () => { workerCalls++; },
    });
    let result;
    for (let i = 0; i < 32; i++) {
      result = await program.run({ maxSteps: 1024 });
      if (result.planning_done) break;
    }
    assert.equal(result.planning_done, true);
    const snapshot = await controller.replay(result.task_ref);
    assert.equal(snapshot.plans.length, 10_000);
    assert.equal(snapshot.grants.length, 1);
    assert.equal(workerCalls, 1);
  });
