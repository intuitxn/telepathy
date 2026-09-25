import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createTaskControl } from './task-control.mjs';
import { createTaskProgram } from './task-program.mjs';

const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const evaluator = '1'.repeat(64);
const budget = { tokens: 1000, fuel: 2, children: 0, integrations: 0, evaluations: 0 };
const capacity = { eligible_independent: 4, funded_grants: 4, provider_slots: 4,
  workspace_slots: 4, verifier_backlog: 0, integration_backlog: 0,
  unknown_verdicts: 0, horizon_units: 1, worker_rate: 1,
  verifier_rate: 4, integration_rate: 4 };

function pairedEpisodes() {
  // This keyless fixture models independently settled outcomes. Its outcomes
  // are synthetic; production evidence must come from archived host receipts.
  return Array.from({ length: 4 }, (_, index) => {
    const taskSet = sha({ matched_set: index });
    const receipts = [1, 2, 4].map(width => ({
      width, verdict_source: 'independent', verdict_receipt_sha256: sha({ index, width }),
      task_set_sha256: taskSet, evaluator_sha256: evaluator, budget_units: 48,
      verified_gain: width === 1 ? 3 : 6, unsupported_claims: 0,
      regressions: 0, unsettled_verdicts: 0,
      worker_compute: width === 4 ? 40 : 32,
      verifier_compute: 6, integration_compute: 2, coordination_compute: 0,
    }));
    return { id: `paired-${index}`, task_set_sha256: taskSet,
      evaluator_sha256: evaluator, budget_units: 48, receipts };
  });
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'task-program-delegation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const controller = createTaskControl({ storeRoot: path.join(root, 'control'),
    allowUnsafeStoreRootForTest: true });
  const spec = { goal: 'Complete four bounded independent checks',
    acceptance: 'Pinned host evaluator accepts the result', scopes: ['research'],
    integration_owner: 'integrator', initial_head: 'a'.repeat(40),
    pinned_versions: { evaluator_sha256: evaluator,
      case_set_sha256: '2'.repeat(64), toolchain: 'keyless-test' },
    limits: { max_tasks: 4, max_branches: 4, max_active_grants: 4,
      max_depth: 0, tokens: 10_000, fuel: 100,
      integrations: 1, evaluations: 1 }, policy_version: 'paired-width-test-v1' };
  const calls = [];
  const options = { controller, spec, prompt: 'Make four independent checks',
    programId: 'paired-width', stateRoot: path.join(root, 'program'),
    allowUnsafeStateRootForTest: true, maxLiveWorkers: 4,
    planner: async () => ({ tasks: Array.from({ length: 4 }, (_, index) => ({
      id: `check-${index}`, kind: 'research', scope: 'research',
      deliverable: `Check ${index}`, acceptance: `Verify ${index}`,
      source_refs: [], oracle_sha256: evaluator, budget,
      depends_on: [], parent_plan_ref: null })),
      next_cursor: null, done: true }),
    grantForPlan: async ({ plan }) => ({ branch: `branch-${plan.id}`,
      owner: 'worker', budget, location: path.join(root, plan.id),
      parent_grant_ref: null }),
    worker: async ({ grant }) => { calls.push(grant.ref); },
  };
  return { controller, options, calls };
}

test('adaptive dispatch uses matched budget verdicts, then preserves the frozen task budget on restart', async t => {
  const { controller, options, calls } = await fixture(t);
  const inputs = [];
  const configured = { ...options, delegationEvidence: async input => {
    inputs.push(input);
    assert.equal(input.evaluator_sha256, evaluator);
    assert.equal(input.pending_evaluations.length, 0);
    return { capacity, episodes: pairedEpisodes(),
      independent_plan_refs: input.eligible_plans.map(plan => plan.ref) };
  } };
  const first = await createTaskProgram(configured).run({ maxSteps: 64 });
  assert.equal(first.status, 'waiting-workers');
  assert.equal(first.planned_count, 4);
  assert.equal(first.dispatched, 2);
  assert.equal(calls.length, 2);
  const snapshot = await controller.replay(first.task_ref);
  assert.equal(snapshot.grants.length, 2);
  assert.equal(snapshot.remaining.branches, 2);
  assert.equal(snapshot.remaining.tokens,
    options.spec.limits.tokens - 2 * budget.tokens -
    snapshot.events.filter(event => event.type === 'planned')
      .reduce((total, event) => total + event.result.charged.token_units, 0));
  assert.ok(inputs.some(input => input.active_grants.length === 1));
  const second = await createTaskProgram(configured).run();
  assert.equal(second.status, 'waiting-workers');
  assert.equal(second.dispatched, 0);
  assert.equal(calls.length, 2);
  assert.equal((await controller.replay(first.task_ref)).grants.length, 2);
});

test('capacity loss holds a granted but undispatched worker across a cold restart', async t => {
  const { controller, options, calls } = await fixture(t);
  let verifierBacklog = 0;
  const configured = { ...options, delegationEvidence: async input => ({
    capacity: { ...capacity, verifier_backlog: verifierBacklog },
    episodes: pairedEpisodes(),
    independent_plan_refs: input.eligible_plans.map(plan => plan.ref) }) };
  const prepared = await createTaskProgram(configured).run({ maxSteps: 13 });
  const before = await controller.replay(prepared.task_ref);
  assert.equal(before.grants.length, 1);
  assert.equal(calls.length, 0);

  verifierBacklog = 4;
  const held = await createTaskProgram(configured).run();
  assert.equal(held.status, 'delegation-capacity-held');
  assert.equal(calls.length, 0);
  assert.equal((await controller.replay(held.task_ref)).grants.length, 1);

  verifierBacklog = 0;
  const resumed = await createTaskProgram(configured).run();
  assert.equal(resumed.status, 'waiting-workers');
  assert.equal(calls.length, 2);
  assert.equal((await controller.replay(resumed.task_ref)).grants.length, 2);
});

test('a capacity drop cancels a prepared grant and rejects mismatched evaluator evidence', async t => {
  const { controller, options, calls } = await fixture(t);
  let unknownVerdicts = 0;
  let episodes = pairedEpisodes();
  const configured = { ...options, delegationEvidence: async input => ({
    capacity: { ...capacity, unknown_verdicts: unknownVerdicts }, episodes,
    independent_plan_refs: input.eligible_plans.map(plan => plan.ref) }) };
  const prepared = await createTaskProgram(configured).run({ maxSteps: 12 });
  assert.equal((await controller.replay(prepared.task_ref)).grants.length, 0);
  unknownVerdicts = 1;
  const held = await createTaskProgram(configured).run();
  assert.equal(held.status, 'delegation-capacity-held');
  assert.equal((await controller.replay(held.task_ref)).grants.length, 0);
  assert.equal(calls.length, 0);

  unknownVerdicts = 0;
  episodes = pairedEpisodes().map(episode => ({ ...episode,
    evaluator_sha256: '9'.repeat(64) }));
  await assert.rejects(createTaskProgram(configured).run(),
    /paired trial evaluator differs from the frozen task evaluator/);
  assert.equal((await controller.replay(held.task_ref)).grants.length, 0);

  episodes = pairedEpisodes();
  const resumed = await createTaskProgram(configured).run();
  assert.equal(resumed.dispatched, 2);
  assert.equal(calls.length, 2);
});

test('an unfunded second worker cannot bypass the paired evidence policy', async t => {
  const { options } = await fixture(t);
  assert.throws(() => createTaskProgram(options),
    /more than one live worker needs host-owned delegation evidence/);
  const underpaired = { ...options, delegationEvidence: async input => ({
    capacity, episodes: pairedEpisodes().slice(0, 3),
    independent_plan_refs: input.eligible_plans.map(plan => plan.ref) }) };
  const first = await createTaskProgram(underpaired).run();
  assert.equal(first.dispatched, 1);
});

test('only exact host-selected eligible plan refs may receive a grant', async t => {
  const selected = await fixture(t);
  const selectedProgram = { ...selected.options, delegationEvidence: async input => ({
    capacity, episodes: pairedEpisodes(),
    independent_plan_refs: input.eligible_plans
      .filter(plan => plan.id === 'check-2').map(plan => plan.ref) }) };
  const result = await createTaskProgram(selectedProgram).run();
  const snapshot = await selected.controller.replay(result.task_ref);
  assert.deepEqual(snapshot.grants.map(grant =>
    snapshot.plans.find(plan => plan.ref === grant.plan_ref).id), ['check-2']);
  assert.equal(selected.calls.length, 1);

  const forged = await fixture(t);
  const forgedProgram = { ...forged.options, delegationEvidence: async () => ({
    capacity, episodes: pairedEpisodes(), independent_plan_refs: ['9'.repeat(64)] }) };
  await assert.rejects(createTaskProgram(forgedProgram).run(),
    /independent plan ref is absent, ineligible, or repeated/);
  const opened = await forged.controller.open(forged.options.spec);
  assert.equal((await forged.controller.replay(opened.task_ref)).grants.length, 0);
  assert.equal(forged.calls.length, 0);
});
