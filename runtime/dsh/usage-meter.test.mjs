import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { apply, createTaskControlBinding, createUsageMeter, measuredTokens } from './usage-meter.mjs';

const task_ref = 'a'.repeat(64);
const grant_ref = 'b'.repeat(64);
const finish = { type: 'finish', reason: { kind: 'stop' } };
const usage = value => ({ type: 'usage', usage: value });
const chunks = (...values) => async function* () { yield* values; };
const options = sessionId => ({ sessionId, provider: 'deepseek-official', model: 'deepseek-flash' });
async function drain(stream) { const out = []; for await (const chunk of stream) out.push(chunk); return out; }

async function fixture(t, budget_tokens = 20) {
  const storeRoot = await mkdtemp(path.join(os.tmpdir(), 'telepathy-usage-meter-'));
  t.after(() => rm(storeRoot, { recursive: true, force: true }));
  const bindings = new Map();
  const bind = (session_id, grant = grant_ref, budget = budget_tokens) => bindings.set(session_id,
    { session_id, task_ref, grant_ref: grant, budget_tokens: budget });
  bind('session-a');
  const settings = { storeRoot, allowUnsafeStoreRootForTest: true,
    bindingForSession: async sessionId => bindings.get(sessionId) };
  return { meter: createUsageMeter(settings), settings, bindings, bind };
}

test('sums uncached input, output and cached input across calls and restarts', async t => {
  const { meter, settings } = await fixture(t, 20);
  const first = await drain(meter.wrap(options('session-a'), chunks(
    { type: 'text-delta', index: 0, text: 'hi' },
    usage({ inputTokens: 2, outputTokens: 3, cacheReadTokens: 4, cacheWriteTokens: 1,
      reasoningTokens: 1, totalTokens: 10 }), finish)));
  assert.equal(first.at(-1).type, 'finish');
  assert.equal((await meter.snapshotForSession('session-a')).used_tokens, 10);
  const restarted = createUsageMeter(settings);
  await drain(restarted.wrap(options('session-a'), chunks(usage({ inputTokens: 6, outputTokens: 4 }), finish)));
  assert.deepEqual(await restarted.snapshotForSession('session-a'), {
    task_ref, grant_ref, session_id: 'session-a', budget_tokens: 20,
    used_tokens: 20, remaining_tokens: 0, blocked: false, uncertain: false,
  });
  let dispatched = false;
  await assert.rejects(drain(restarted.wrap(options('session-a'), () => {
    dispatched = true; return chunks(usage({ inputTokens: 1, outputTokens: 1 }), finish)();
  })), /budget exhausted/);
  assert.equal(dispatched, false);
});

test('one grant is shared across bound sessions and serializes local calls', async t => {
  const { meter, bind, bindings } = await fixture(t, 20);
  bind('session-b');
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let started;
  const entered = new Promise(resolve => { started = resolve; });
  const pending = drain(meter.wrap(options('session-a'), async function* () {
    started();
    await gate;
    yield usage({ inputTokens: 2, outputTokens: 3 });
    yield finish;
  }));
  await entered;
  let dispatched = false;
  const queued = drain(meter.wrap(options('session-b'), () => {
    dispatched = true; return chunks(usage({ inputTokens: 1, outputTokens: 1 }), finish)();
  }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(dispatched, false);
  release();
  await Promise.all([pending, queued]);
  await drain(meter.wrap(options('session-b'), chunks(usage({ inputTokens: 1, outputTokens: 2 }), finish)));
  assert.equal((await meter.snapshotForSession('session-a')).used_tokens, 10);
  bindings.set('session-a', { session_id: 'session-a', task_ref, grant_ref: 'c'.repeat(64), budget_tokens: 20 });
  await assert.rejects(drain(meter.wrap(options('session-a'), chunks(usage({ inputTokens: 1, outputTokens: 1 }), finish))), /rebound/);
});

test('over-budget call is charged and its terminal finish is withheld', async t => {
  const { meter } = await fixture(t, 5);
  const seen = [];
  await assert.rejects((async () => {
    for await (const chunk of meter.wrap(options('session-a'), chunks(
      usage({ inputTokens: 4, outputTokens: 3 }), finish))) seen.push(chunk.type);
  })(), /budget exceeded/);
  assert.deepEqual(seen, []);
  const snapshot = await meter.snapshotForSession('session-a');
  assert.equal(snapshot.used_tokens, 7);
  assert.equal(snapshot.remaining_tokens, 0);
  await assert.rejects(drain(meter.wrap(options('session-a'), chunks(usage({ inputTokens: 1, outputTokens: 1 }), finish))), /budget exhausted/);
});

test('missing usage and malformed usage poison the grant across restarts', async t => {
  const { meter, settings } = await fixture(t);
  await assert.rejects(drain(meter.wrap(options('session-a'), chunks(finish))), /without finish and measured usage/);
  assert.equal((await createUsageMeter(settings).snapshotForSession('session-a')).uncertain, true);
  let dispatched = false;
  await assert.rejects(drain(createUsageMeter(settings).wrap(options('session-a'), () => {
    dispatched = true; return chunks(usage({ inputTokens: 1, outputTokens: 1 }), finish)();
  })), /in-flight or uncertain/);
  assert.equal(dispatched, false);
  const other = await fixture(t);
  await assert.rejects(drain(other.meter.wrap(options('session-a'), chunks(
    usage({ inputTokens: 1, outputTokens: -1 }), finish))), /outputTokens/);
  assert.equal((await other.meter.snapshotForSession('session-a')).uncertain, true);
});

test('host audit can conservatively charge and release an uncertain provider request', async t => {
  const { meter, settings } = await fixture(t, 20);
  await assert.rejects(drain(meter.wrap(options('session-a'), chunks(finish))), /without finish and measured usage/);
  const bad = createUsageMeter({ ...settings, auditUncertainUsage: async target => ({
    task_ref, grant_ref, request_id: `${target.request_id}-other`,
    status: 'bounded', upper_bound_tokens: 7, receipt_sha256: 'c'.repeat(64),
  }) });
  await assert.rejects(bad.reconcileUncertain('session-a'), /does not bind the exact provider request/);
  assert.equal((await bad.snapshotForSession('session-a')).uncertain, true);
  const restarted = createUsageMeter({ ...settings, auditUncertainUsage: async target => ({
    task_ref: target.task_ref, grant_ref: target.grant_ref, request_id: target.request_id,
    status: 'bounded', upper_bound_tokens: 7, receipt_sha256: 'c'.repeat(64),
  }) });
  const resolved = await restarted.reconcileUncertain('session-a');
  assert.equal(resolved.charged_tokens, 7);
  assert.equal((await restarted.snapshotForSession('session-a')).uncertain, false);
  await drain(restarted.wrap(options('session-a'), chunks(usage({ inputTokens: 2, outputTokens: 1 }), finish)));
  assert.equal((await createUsageMeter(settings).snapshotForSession('session-a')).used_tokens, 10);
  await assert.rejects(restarted.reconcileUncertain('session-a'), /no uncertain provider request/);
});

test('consumer cancellation after a buffered provider finish keeps the measured charge', async t => {
  const { meter } = await fixture(t);
  for await (const _chunk of meter.wrap(options('session-a'), chunks(
    { type: 'text-delta', index: 0, text: 'partial' }, usage({ inputTokens: 1, outputTokens: 1 }), finish))) break;
  const snapshot = await meter.snapshotForSession('session-a');
  assert.equal(snapshot.uncertain, false);
  assert.equal(snapshot.used_tokens, 2);
});

test('provider interruption before usage leaves an uncertain reservation', async t => {
  const { meter } = await fixture(t);
  await assert.rejects(drain(meter.wrap(options('session-a'), async function* () {
    yield { type: 'text-delta', index: 0, text: 'partial' };
    throw new Error('provider stream interrupted');
  })), /provider stream interrupted/);
  assert.equal((await meter.snapshotForSession('session-a')).uncertain, true);
});

test('unbound requests and changed grant budgets fail before adapter dispatch', async t => {
  const { meter, bindings } = await fixture(t);
  let called = false;
  const next = () => { called = true; return chunks(usage({ inputTokens: 1, outputTokens: 1 }), finish)(); };
  await assert.rejects(drain(meter.wrap({}, next)), /sessionId/);
  await assert.rejects(drain(meter.wrap(options('unknown'), next)), /binding is missing/);
  assert.equal(called, false);
  await drain(meter.wrap(options('session-a'), next));
  bindings.set('session-a', { session_id: 'session-a', task_ref, grant_ref, budget_tokens: 21 });
  called = false;
  await assert.rejects(drain(meter.wrap(options('session-a'), next)), /budget changed/);
  assert.equal(called, false);
});

test('validates provider totals and counts reasoning only once', () => {
  assert.equal(measuredTokens({ inputTokens: 3, outputTokens: 4, cacheReadTokens: 2,
    reasoningTokens: 2, totalTokens: 9 }), 9);
  assert.equal(measuredTokens({ inputTokens: 3, outputTokens: 4, totalTokens: 8 }), 8);
  assert.throws(() => measuredTokens({ inputTokens: 3, outputTokens: 4, totalTokens: 6 }), /understated/);
  assert.throws(() => measuredTokens({ inputTokens: 0, outputTokens: 0 }), /missing or understated/);
  assert.throws(() => measuredTokens({ inputTokens: 3, outputTokens: 4, reasoningTokens: 5 }), /reasoningTokens/);
});

test('Cordis plugin registers a global prepended stream wrapper', async t => {
  const { settings } = await fixture(t);
  const listeners = [];
  const services = new Map();
  apply({ get: key => services.get(key), provide: (key, value) => services.set(key, value),
    on: (...args) => listeners.push(args) }, settings);
  assert.equal(listeners.length, 1);
  assert.equal(listeners[0][0], 'llm/stream');
  assert.deepEqual(listeners[0][2], { global: true, prepend: true });
  const result = await drain(listeners[0][1](options('session-a'), chunks(
    usage({ inputTokens: 2, outputTokens: 2 }), finish)));
  assert.equal(result.at(-1).type, 'finish');
  assert.equal((await services.get('telepathyUsageMeter').snapshotForSession('session-a')).used_tokens, 4);
});

test('task-control binding accepts only a started live grant in the frozen task', async () => {
  let state = { task_ref, terminal: null, grants: [{ ref: grant_ref, session_id: 'session-a',
    status: 'active', budget: { tokens: 17 } }] };
  const bind = createTaskControlBinding({ replay: async () => state }, task_ref);
  assert.deepEqual(await bind('session-a'), {
    session_id: 'session-a', task_ref, grant_ref, budget_tokens: 17,
  });
  await assert.rejects(bind('another-session'), /no live task grant/);
  state = { ...state, grants: [{ ...state.grants[0], status: 'ready' }] };
  assert.equal((await bind('session-a')).grant_ref, grant_ref);
  state = { ...state, terminal: { reason: 'done' } };
  await assert.rejects(bind('session-a'), /terminal/);
});

test('explicit root grant binds the live root once before provider dispatch', async t => {
  const { settings } = await fixture(t);
  const ctx = { sessions: { get: id => ({ id }) } };
  let state = { task_ref, terminal: null, grants: [{ ref: grant_ref, status: 'active',
    budget: { tokens: 20 } }] };
  const calls = [];
  const controller = { replay: async () => state,
    bindRootSession: async (taskRef, request, actualCtx) => {
      calls.push({ taskRef, request, actualCtx });
      state = { ...state, grants: [{ ...state.grants[0], session_id: request.session_id }] };
    } };
  const binding = createTaskControlBinding(controller, task_ref, { rootGrantRef: grant_ref, ctx });
  const meter = createUsageMeter({ ...settings, bindingForSession: binding });
  await drain(meter.wrap(options('session-a'), chunks(usage({ inputTokens: 2, outputTokens: 1 }), finish)));
  await drain(meter.wrap(options('session-a'), chunks(usage({ inputTokens: 2, outputTokens: 1 }), finish)));
  assert.deepEqual(calls, [{ taskRef: task_ref, request: {
    id: 'root-bind:session-a', grant_ref, session_id: 'session-a',
  }, actualCtx: ctx }]);
  assert.equal((await meter.snapshotForSession('session-a')).used_tokens, 6);
});

test('root binding needs an explicit host grant and a task-control verifier', () => {
  assert.throws(() => createTaskControlBinding({ replay: async () => ({}) }, task_ref,
    { rootGrantRef: grant_ref, ctx: {} }), /bindRootSession/);
  assert.throws(() => createTaskControlBinding({ replay: async () => ({}) }, task_ref,
    { rootGrantRef: 'wrong', ctx: {} }), /rootGrantRef/);
});

test('Cordis plugin can derive child binding from task control service', async t => {
  const { settings } = await fixture(t);
  const services = new Map([['telepathyTaskControl', { replay: async () => ({ task_ref, terminal: null,
    grants: [{ ref: grant_ref, session_id: 'session-a', status: 'active', budget: { tokens: 20 } }] }) }]]);
  let listener;
  apply({ get: key => services.get(key), provide: (key, value) => services.set(key, value),
    on: (_name, callback) => { listener = callback; } }, { ...settings, bindingForSession: undefined, taskRef: task_ref });
  await drain(listener(options('session-a'), chunks(usage({ inputTokens: 1, outputTokens: 1 }), finish)));
  assert.equal((await services.get('telepathyUsageMeter').snapshotForSession('session-a')).used_tokens, 2);
});
