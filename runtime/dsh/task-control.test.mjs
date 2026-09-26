import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { apply, createJjCombinedVerifier, createTaskControl, createTaskPlanTool } from './task-control.mjs';
import { createPinnedSynthesisVerifier } from './synthesis-contract.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` :
  value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key =>
    `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);
const D = value => value.repeat(64);
const spec = (limits = {}) => ({
  goal: 'Implement and independently verify a scoped algorithm',
  acceptance: 'Exact combined revision passes host checks and fresh cases',
  scopes: ['alpha', 'beta'], integration_owner: 'integrator', initial_head: A,
  pinned_versions: { evaluator_sha256: D('1'), case_set_sha256: D('2'), toolchain: 'bend-2.0.21' },
  limits: { max_tasks: 10_000, max_branches: 3, max_active_grants: 2, max_depth: 1, tokens: 200_000, fuel: 20_000,
    integrations: 2, evaluations: 2, ...limits },
  policy_version: 'task-policy-v1',
});
async function fixture(t, options = {}) {
  const storeRoot = await mkdtemp(path.join(os.tmpdir(), 'telepathy-task-control-'));
  t.after(() => rm(storeRoot, { recursive: true, force: true }));
  const controller = createTaskControl({ storeRoot, allowUnsafeStoreRootForTest: true,
    allowSyntheticCombinedVerifierForTest: Boolean(options.verifyCombined), ...options });
  const taskSpec = { ...spec(options.limits), initial_head: options.initialHead ?? A };
  if (options.synthesisOracleSha256) taskSpec.pinned_versions.synthesis_oracle_sha256 = options.synthesisOracleSha256;
  const opened = await controller.open(taskSpec);
  return { controller, opened, storeRoot };
}
const base = (head, event) => ({ task_commit: head, causal_event: event });
const budget = (overrides = {}) => ({ tokens: 40_000, fuel: 2_000, children: 0, integrations: 0, evaluations: 0, ...overrides });
async function grant(controller, opened, input) {
  const beforePlan = await controller.replay(opened.task_ref);
  const deliverable = input.deliverable ?? `Produce ${input.scope} candidate`;
  const plan = await controller.plan(opened.task_ref, {
    id: `plan-${input.id}`, kind: input.kind ?? 'algorithm', scope: input.scope,
    deliverable, acceptance: 'Independent exact-revision checks pass',
    source_refs: [], oracle_sha256: beforePlan.spec.pinned_versions.evaluator_sha256,
    budget: input.budget ?? budget(), depends_on: [], parent_plan_ref: null,
    expected_log_head: beforePlan.log_head,
  });
  const head = await controller.replay(opened.task_ref);
  const result = await controller.grant(opened.task_ref, {
    id: input.id, plan_ref: plan.plan_ref, branch: input.branch, owner: input.owner, scope: input.scope,
    deliverable,
    base_refs: base(head.task_head, head.log_head),
    budget: input.budget ?? budget(), location: input.location ?? `/tmp/telepathy-${input.branch}`,
    parent_grant_ref: input.parent_grant_ref ?? null,
  });
  return { ...result, owner: input.owner, scope: input.scope, plan_ref: plan.plan_ref,
    grant_base_event: head.log_head };
}
async function admit(controller, opened, grantResult, eventId, kind, payload, parents) {
  return controller.admit(opened.task_ref, {
    id: eventId, grant_ref: grantResult.grant_ref,
    actor: grantResult.owner, scope: grantResult.scope,
    base_commit: A, parents: parents ?? [grantResult.event_digest], kind, payload,
  });
}
function researchVerdict(input, overrides = {}) {
  const { spec: _spec, plan: _plan, grant: _grant, result: _result, ...binding } = input;
  return { ...binding, ok: true, receipt_sha256: D('f'), ...overrides };
}

async function settledSource(controller, opened, scope, suffix) {
  const artifactBytes = `artifact-${suffix}`;
  const evidenceBytes = JSON.stringify({ source: suffix });
  const g = await grant(controller, opened, { id: `source-${suffix}`, branch: `source-${suffix}`,
    owner: `researcher-${suffix}`, scope, kind: 'research', budget: budget({ evaluations: 1 }) });
  const result = await admit(controller, opened, g, `result-${suffix}`, 'result', {
    artifact_sha256: sha(artifactBytes), evidence_receipt_sha256: sha(evidenceBytes),
    source_refs: [] });
  const settled = await controller.settleResult(opened.task_ref, {
    id: `settle-${suffix}`, grant_ref: g.grant_ref, plan_ref: g.plan_ref,
    result_event: result.event_digest, expected_head: A });
  assert.equal(settled.status, 'accepted');
  return { grant: g, result, settled, artifactBytes, evidenceBytes };
}

async function researchFixture(t, options = {}) {
  const researchEvaluations = options.researchEvaluations ?? 2;
  const secondDeliverable = options.secondDependsOnFirst === false
    ? 'Analyze an independent source' : 'Analyze the accepted first result';
  const checked = await fixture(t, { ...options,
    limits: { max_tasks: 2, max_branches: 2, max_active_grants: 1,
      evaluations: 2, ...options.limits } });
  const { controller, opened } = checked;
  const first = await controller.plan(opened.task_ref, {
    id: 'research-first', kind: 'research', scope: 'alpha',
    deliverable: 'Produce first independently checked result', acceptance: 'Check the first result',
    source_refs: [], oracle_sha256: D('1'), budget: budget({ evaluations: researchEvaluations }),
    depends_on: [], parent_plan_ref: null, expected_log_head: opened.log_head,
  });
  const afterFirst = await controller.replay(opened.task_ref);
  const second = await controller.plan(opened.task_ref, {
    id: 'analysis-second', kind: 'analysis', scope: 'alpha',
    deliverable: secondDeliverable, acceptance: 'Check the analysis',
    source_refs: [], oracle_sha256: D('1'), budget: budget({ evaluations: 1 }),
    depends_on: options.secondDependsOnFirst === false ? [] : [first.plan_ref], parent_plan_ref: null,
    expected_log_head: afterFirst.log_head,
  });
  const beforeGrant = await controller.replay(opened.task_ref);
  const granted = await controller.grant(opened.task_ref, {
    id: 'research-grant', plan_ref: first.plan_ref, branch: 'research-branch', owner: 'researcher',
    scope: 'alpha', deliverable: 'Produce first independently checked result',
    base_refs: base(A, beforeGrant.log_head), budget: budget({ evaluations: researchEvaluations }),
    location: '/tmp/telepathy-research-branch', parent_grant_ref: null,
  });
  const g = { ...granted, owner: 'researcher', scope: 'alpha' };
  const result = await admit(controller, opened, g, 'research-result', 'result', {
    artifact_sha256: D('a'), evidence_receipt_sha256: D('b'), source_refs: [D('c')],
  });
  return { ...checked, first, second, g, result };
}

async function goalComparison(t, frozen = spec()) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'telepathy-goal-comparison-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const comparison = { schema: 1,
    policy: 'telepathy.fresh-clone-comparison/v1',
    fresh: { candidate_commit: C,
      task_set_sha256: frozen.pinned_versions.case_set_sha256 },
    evaluator_sha256: frozen.pinned_versions.evaluator_sha256,
    candidate_cases: [{ id: 'goal-case', quality: 1, supported: true,
      counterexample: false, unsupported_claims: 0 }],
    baseline: { quality: 0 }, candidate: { quality: 1,
      unsupported_claims: 0 }, regressions: [], counterexamples: [],
    verdict: 'supported' };
  const bytes = `${canonical(comparison)}\n`;
  const comparisonSha = sha(bytes);
  await mkdir(path.join(root, 'fresh-comparisons'));
  await writeFile(path.join(root, 'fresh-comparisons',
    `${comparisonSha}.json`), bytes);
  return { root, comparisonSha };
}

test('open is frozen and replayable; grants reserve finite budgets and reject stale bases', async t => {
  const { controller, opened, storeRoot } = await fixture(t);
  assert.equal((await controller.open(spec())).existing, true);
  const first = await grant(controller, opened, { id: 'grant-a', branch: 'branch-a', owner: 'integrator', scope: 'alpha',
    budget: budget({ integrations: 1, evaluations: 1, children: 1 }) });
  assert.match(first.grant_ref, /^[a-f0-9]{64}$/);
  const same = await controller.grant(opened.task_ref, {
    id: 'grant-a', plan_ref: first.plan_ref, branch: 'branch-a', owner: 'integrator', scope: 'alpha',
    deliverable: 'Produce alpha candidate', base_refs: base(A, first.grant_base_event),
    budget: budget({ integrations: 1, evaluations: 1, children: 1 }),
    location: '/tmp/telepathy-branch-a', parent_grant_ref: null,
  });
  assert.equal(same.existing, true);
  assert.equal(same.grant_ref, first.grant_ref);
  await assert.rejects(controller.grant(opened.task_ref, {
    id: 'grant-a', plan_ref: first.plan_ref, branch: 'changed', owner: 'integrator', scope: 'alpha', deliverable: 'changed',
    base_refs: base(A, opened.log_head), budget: budget(), location: '/tmp/changed', parent_grant_ref: null,
  }), /event ID reused/);
  await assert.rejects(controller.grant(opened.task_ref, {
    id: 'stale', plan_ref: first.plan_ref, branch: 'stale', owner: 'worker', scope: 'beta', deliverable: 'work',
    base_refs: base(A, opened.log_head), budget: budget(), location: '/tmp/stale', parent_grant_ref: null,
  }), /stale grant base refs/);
  const second = await grant(controller, opened, { id: 'grant-b', branch: 'branch-b', owner: 'worker', scope: 'beta' });
  assert.notEqual(first.grant_ref, second.grant_ref);
  const restarted = createTaskControl({ storeRoot, allowUnsafeStoreRootForTest: true });
  const snapshot = await restarted.replay(opened.task_ref);
  assert.equal(snapshot.grants.length, 2);
  assert.equal(snapshot.remaining.branches, 1);
  assert.equal(snapshot.grants.find(row => row.ref === first.grant_ref).left.children, 1);
});

test('algorithm calls spend durable worst-case fuel only for their bound session', async t => {
  const { controller, opened, storeRoot } = await fixture(t, {
    inspectWorkspace: async row => row.location,
  });
  const funded = await grant(controller, opened, { id: 'algorithm-grant', branch: 'algorithm',
    owner: 'integrator', scope: 'alpha', budget: budget({ fuel: 122 }) });
  const session = { id: 'root-algorithm-session', header: {
    origin: 'user', cwd: '/tmp/telepathy-algorithm',
  } };
  await controller.bindRootSession(opened.task_ref, { id: 'algorithm-root-bind',
    grant_ref: funded.grant_ref, session_id: session.id },
  { sessions: { get: id => id === session.id ? session : undefined } });
  const call = (call_id, tool, input_sha256 = D('a')) => ({ session_id: session.id,
    call_id, tool, input_sha256 });
  await assert.rejects(controller.reserveAlgorithmCall(opened.task_ref,
    { ...call('unbound', 'algorithm_run'), session_id: 'other-session' }), /no live bound grant/);
  await assert.rejects(controller.reserveAlgorithmCall(opened.task_ref,
    call('selection', 'algorithm_select')), /no funded compute schedule/);
  await assert.rejects(controller.reserveAlgorithmCall(opened.task_ref,
    call('scoring', 'algorithm_score')), /no funded compute schedule/);
  const run = await controller.reserveAlgorithmCall(opened.task_ref, call('run', 'algorithm_run'));
  assert.equal(run.charged.fuel, 60);
  await assert.rejects(controller.reserveAlgorithmCall(opened.task_ref,
    call('run', 'algorithm_run')), /already spent a compute reservation/);
  await assert.rejects(controller.reserveAlgorithmCall(opened.task_ref,
    call('run', 'algorithm_run', D('b'))), /event ID reused with different content/);
  const restarted = createTaskControl({ storeRoot, allowUnsafeStoreRootForTest: true,
    inspectWorkspace: async row => row.location });
  const state = await restarted.replay(opened.task_ref);
  assert.equal(state.grants.find(row => row.ref === funded.grant_ref).left.fuel, 62);
  const compile = await restarted.reserveAlgorithmCall(opened.task_ref,
    call('compile', 'algorithm_compile'));
  assert.deepEqual(compile.charged, { fuel: 1 });
  assert.equal(compile.max_wall_ms, 0);
  await restarted.reserveAlgorithmCall(opened.task_ref, call('execute', 'algorithm_execute'));
  await restarted.reserveAlgorithmCall(opened.task_ref, call('active', 'algorithm_active'));
  await assert.rejects(restarted.reserveAlgorithmCall(opened.task_ref,
    call('another-active', 'algorithm_active')), /exceeds remaining grant fuel/);
  assert.equal((await restarted.replay(opened.task_ref)).grants
    .find(row => row.ref === funded.grant_ref).left.fuel, 0);
});

test('concurrent algorithm reservations cannot overdraw one grant', async t => {
  const { controller, opened } = await fixture(t, { inspectWorkspace: async row => row.location });
  const funded = await grant(controller, opened, { id: 'single-run-grant', branch: 'single-run',
    owner: 'integrator', scope: 'alpha', budget: budget({ fuel: 60 }) });
  const session = { id: 'single-run-session', header: { origin: 'user', cwd: '/tmp/telepathy-single-run' } };
  await controller.bindRootSession(opened.task_ref, { id: 'single-run-bind',
    grant_ref: funded.grant_ref, session_id: session.id },
  { sessions: { get: id => id === session.id ? session : undefined } });
  const outcomes = await Promise.allSettled(['first', 'second'].map(call_id =>
    controller.reserveAlgorithmCall(opened.task_ref, { session_id: session.id,
      call_id, tool: 'algorithm_run', input_sha256: D('a') })));
  assert.deepEqual(outcomes.map(row => row.status).sort(), ['fulfilled', 'rejected']);
  assert.equal((await controller.replay(opened.task_ref)).grants
    .find(row => row.ref === funded.grant_ref).left.fuel, 0);
});

test('a bound research grant cannot invoke the algorithm tool catalog', async t => {
  const { controller, opened } = await fixture(t, { inspectWorkspace: async row => row.location });
  const funded = await grant(controller, opened, { id: 'research-only-grant', branch: 'research-only',
    owner: 'integrator', scope: 'alpha', kind: 'research', budget: budget({ fuel: 60 }) });
  const session = { id: 'research-only-session', header: { origin: 'user', cwd: '/tmp/telepathy-research-only' } };
  await controller.bindRootSession(opened.task_ref, { id: 'research-only-bind',
    grant_ref: funded.grant_ref, session_id: session.id },
  { sessions: { get: id => id === session.id ? session : undefined } });
  await assert.rejects(controller.reserveAlgorithmCall(opened.task_ref, { session_id: session.id,
    call_id: 'research-run', tool: 'algorithm_run', input_sha256: D('a') }),
  /eligible scoped algorithm grant/);
  assert.equal((await controller.replay(opened.task_ref)).grants
    .find(row => row.ref === funded.grant_ref).left.fuel, 60);
});

test('a ready candidate cannot keep spending native compute while awaiting verification', async t => {
  const { controller, opened } = await fixture(t, { inspectWorkspace: async row => row.location });
  const funded = await grant(controller, opened, { id: 'ready-algorithm-grant', branch: 'ready-algorithm',
    owner: 'integrator', scope: 'alpha', budget: budget({ fuel: 61 }) });
  const session = { id: 'ready-algorithm-session', header: { origin: 'user', cwd: '/tmp/telepathy-ready-algorithm' } };
  await controller.bindRootSession(opened.task_ref, { id: 'ready-algorithm-bind',
    grant_ref: funded.grant_ref, session_id: session.id },
  { sessions: { get: id => id === session.id ? session : undefined } });
  await admit(controller, opened, funded, 'ready-candidate', 'candidate', {
    commit: B, artifact_sha256: D('3'), observation_receipt_sha256: D('4'),
  });
  await assert.rejects(controller.reserveAlgorithmCall(opened.task_ref, { session_id: session.id,
    call_id: 'late-run', tool: 'algorithm_run', input_sha256: D('a') }),
  /no live bound grant/);
  assert.equal((await controller.replay(opened.task_ref)).grants
    .find(row => row.ref === funded.grant_ref).left.fuel, 60);
});

test('concurrent same-process plans serialize without blocking their own event loop', async t => {
  const { controller, opened } = await fixture(t);
  const proposal = id => ({ id, kind: 'research', scope: 'alpha', deliverable: id,
    acceptance: 'Pinned oracle accepts', source_refs: [], oracle_sha256: D('1'),
    budget: budget({ tokens: 100, fuel: 1 }), depends_on: [], parent_plan_ref: null,
    expected_log_head: opened.log_head });
  const started = performance.now();
  const outcomes = await Promise.allSettled([
    controller.plan(opened.task_ref, proposal('parallel-a')),
    controller.plan(opened.task_ref, proposal('parallel-b')),
  ]);
  assert.deepEqual(outcomes.map(row => row.status).sort(), ['fulfilled', 'rejected']);
  assert.ok(performance.now() - started < 5000, 'lock serialization should not spin for 10 seconds');
});

test('event capacity refuses publication before cold replay becomes impossible', async t => {
  const { controller, opened, storeRoot } = await fixture(t, { maxEventsForTest: 4 });
  const proposal = (id, expected_log_head) => ({ id, kind: 'research', scope: 'alpha',
    deliverable: id, acceptance: 'Pinned oracle accepts', source_refs: [], oracle_sha256: D('1'),
    budget: budget({ tokens: 100, fuel: 1 }), depends_on: [], parent_plan_ref: null, expected_log_head });
  for (let i = 0; i < 3; i++) {
    const snapshot = await controller.replay(opened.task_ref);
    await controller.plan(opened.task_ref, proposal(`capacity-${i}`, snapshot.log_head));
  }
  const before = await controller.replay(opened.task_ref);
  await assert.rejects(controller.plan(opened.task_ref, proposal('over-capacity', before.log_head)),
    /event chain exhausted before publication/);
  const restarted = createTaskControl({ storeRoot, allowUnsafeStoreRootForTest: true, maxEventsForTest: 4 });
  const after = await restarted.replay(opened.task_ref);
  assert.equal(after.log_head, before.log_head);
  assert.equal(after.events.length, 4);
});

test('production store excludes workspace and temp paths; active worker grants remain bounded', async t => {
  assert.throws(() => createTaskControl({ storeRoot: path.join(os.tmpdir(), 'unsafe-task-state') }), /outside the workspace and temporary directory/);
  const { controller, opened } = await fixture(t, { limits: { max_active_grants: 1 } });
  const first = await grant(controller, opened, { id: 'one', branch: 'one', owner: 'integrator', scope: 'alpha' });
  await assert.rejects(grant(controller, opened, { id: 'two', branch: 'two', owner: 'worker', scope: 'beta' }), /active grant cap reached/);
  await admit(controller, opened, first, 'ready-one', 'candidate', {
    commit: B, artifact_sha256: D('3'), observation_receipt_sha256: D('4'),
  });
  await assert.rejects(grant(controller, opened, { id: 'three', branch: 'three', owner: 'worker', scope: 'beta' }), /active grant cap reached/);
  const snapshot = await controller.replay(opened.task_ref);
  assert.equal(snapshot.plans.length, 3);
  assert.equal(snapshot.grants.length, 1);
  assert.ok(snapshot.remaining.tokens < snapshot.spec.limits.tokens - snapshot.grants[0].budget.tokens);
});

test('causal admission is idempotent, parent validated, scope isolated and bounded in view', async t => {
  const { controller, opened } = await fixture(t);
  const alpha = await grant(controller, opened, { id: 'ga', branch: 'a', owner: 'integrator', scope: 'alpha' });
  const beta = await grant(controller, opened, { id: 'gb', branch: 'b', owner: 'worker', scope: 'beta' });
  const a = await admit(controller, opened, { ...alpha, owner: 'integrator', scope: 'alpha' }, 'a-predict', 'prediction', { text: 'alpha' });
  const b = await admit(controller, opened, { ...beta, owner: 'worker', scope: 'beta' }, 'b-predict', 'prediction', { text: 'secret beta' });
  const duplicate = await admit(controller, opened, { ...alpha, owner: 'integrator', scope: 'alpha' }, 'a-predict', 'prediction', { text: 'alpha' });
  assert.equal(duplicate.existing, true);
  assert.equal(duplicate.event_digest, a.event_digest);
  await assert.rejects(admit(controller, opened, { ...alpha, owner: 'integrator', scope: 'alpha' }, 'a-predict', 'prediction', { text: 'different' }), /event ID reused/);
  await assert.rejects(controller.admit(opened.task_ref, {
    id: 'wrong-scope', grant_ref: alpha.grant_ref, actor: 'integrator', scope: 'beta', base_commit: A,
    parents: [a.event_digest], kind: 'prediction', payload: { text: 'leak' },
  }), /exceeds grant authority/);
  await assert.rejects(controller.admit(opened.task_ref, {
    id: 'cross-parent', grant_ref: alpha.grant_ref, actor: 'integrator', scope: 'alpha', base_commit: A,
    parents: [a.event_digest, b.event_digest], kind: 'prediction', payload: { text: 'leak' },
  }), /parent crosses scope/);
  await assert.rejects(controller.admit(opened.task_ref, {
    id: 'stale-parent', grant_ref: alpha.grant_ref, actor: 'integrator', scope: 'alpha', base_commit: A,
    parents: [alpha.event_digest], kind: 'prediction', payload: { text: 'old' },
  }), /omits branch causal head/);
  const cutView = await controller.view(opened.task_ref, 'integrator', a.event_digest, 4096);
  assert.deepEqual(cutView.context_refs.map(ref => ref.event_digest), [a.event_digest]);
  const alphaView = await controller.view(opened.task_ref, 'integrator', null, 4096);
  const betaView = await controller.view(opened.task_ref, 'worker', null, 4096);
  assert.deepEqual(alphaView.context_refs.map(ref => ref.scope), ['alpha']);
  assert.deepEqual(betaView.context_refs.map(ref => ref.scope), ['beta']);
  assert.equal((await controller.view(opened.task_ref, 'worker', null, 1)).truncated, true);
  await assert.rejects(controller.view(opened.task_ref, 'ungranted', null, 4096), /no grant/);
});

test('bounded view preserves verified evidence ahead of a long run of newer proposals', async t => {
  const { controller, opened } = await fixture(t, { verifyKnowledge: async ({ finding }) => ({
    verified: true, claim_sha256: finding.claim_sha256,
    evidence_receipt_sha256: finding.evidence_receipt_sha256, receipt_sha256: D('f'),
  }) });
  const owner = await grant(controller, opened, { id: 'view-evidence', branch: 'view-evidence',
    owner: 'integrator', scope: 'alpha' });
  let previous = await admit(controller, opened, owner, 'verified-first', 'finding', {
    claim_sha256: D('a'), evidence_receipt_sha256: D('b'), source_refs: [],
  });
  for (let i = 0; i < 70; i++) {
    previous = await admit(controller, opened, owner, `unverified-${i}`, 'prediction',
      { text: `proposal ${i}` }, [previous.event_digest]);
  }
  const view = await controller.view(opened.task_ref, 'integrator', null, 65_536);
  assert.equal(view.context_refs.length, 64);
  assert.equal(view.context_refs[0].kind, 'finding');
  assert.equal(view.context_refs[0].evidence_status, 'verified');
  assert.equal(view.context_refs[1].evidence_status, 'proposed');
  assert.equal(view.context_refs[1].event_digest, previous.event_digest);
  assert.equal(view.truncated, true);
  assert.equal(view.used <= 65_536, true);
});

test('the same verified claim in two scopes retains two attributed knowledge records', async t => {
  const { controller, opened } = await fixture(t, { verifyKnowledge: async ({ finding }) => ({
    verified: true, claim_sha256: finding.claim_sha256,
    evidence_receipt_sha256: finding.evidence_receipt_sha256, receipt_sha256: D('f'),
  }) });
  const alpha = await grant(controller, opened, { id: 'claim-alpha', branch: 'claim-alpha',
    owner: 'integrator', scope: 'alpha' });
  const beta = await grant(controller, opened, { id: 'claim-beta', branch: 'claim-beta',
    owner: 'worker', scope: 'beta' });
  await admit(controller, opened, alpha, 'claim-in-alpha', 'finding', {
    claim_sha256: D('c'), evidence_receipt_sha256: D('a'), source_refs: [],
  });
  await admit(controller, opened, beta, 'claim-in-beta', 'finding', {
    claim_sha256: D('c'), evidence_receipt_sha256: D('b'), source_refs: [],
  });
  const knowledge = (await controller.replay(opened.task_ref)).knowledge;
  assert.equal(knowledge.length, 2);
  assert.deepEqual(knowledge.map(row => row.scope).sort(), ['alpha', 'beta']);
  assert.deepEqual((await controller.view(opened.task_ref, 'worker', null, 4096)).context_refs.map(row => row.scope), ['beta']);
});

test('one live owner cannot combine scopes through separate grants', async t => {
  const { controller, opened } = await fixture(t);
  await grant(controller, opened, { id: 'owner-alpha', branch: 'owner-alpha', owner: 'same-worker', scope: 'alpha' });
  await assert.rejects(grant(controller, opened, { id: 'owner-beta', branch: 'owner-beta',
    owner: 'same-worker', scope: 'beta' }), /live grant in another scope/);
});

test('completed grants revoke view while the newest live assignment remains visible', async t => {
  const { controller, opened } = await fixture(t, { limits: {
    max_tasks: 70, max_branches: 70, max_active_grants: 1,
    tokens: 500_000, fuel: 200,
  } });
  for (let i = 0; i < 69; i++) {
    const g = await grant(controller, opened, { id: `grant-${i}`, branch: `branch-${i}`,
      owner: 'integrator', scope: 'alpha', budget: budget({ tokens: 1000, fuel: 1 }) });
    await admit(controller, opened, g, `done-${i}`, 'done', { reason: 'checked' });
  }
  await assert.rejects(controller.view(opened.task_ref, 'integrator', null, 65_536), /no grant/);
  const newest = await grant(controller, opened, { id: 'grant-69', branch: 'branch-69',
    owner: 'integrator', scope: 'alpha', budget: budget({ tokens: 1000, fuel: 1 }) });
  const view = await controller.view(opened.task_ref, 'integrator', null, 65_536);
  assert.equal(view.assignments.length, 1);
  assert.equal(view.assignments[0].plan_ref, newest.plan_ref);
  assert.equal(view.truncated, true);
});

test('checkpoint logs policy and integration work without scheduling model turns', async t => {
  const { controller, opened } = await fixture(t);
  const first = await controller.checkpoint(opened.task_ref, { id: 'cp-open', expected_log_head: opened.log_head });
  assert.equal(first.decision, 'inspect');
  assert.equal(first.policy_version, 'task-policy-v1');
  const alpha = await grant(controller, opened, { id: 'ga', branch: 'a', owner: 'integrator', scope: 'alpha',
    budget: budget({ integrations: 2, evaluations: 2 }) });
  const candidate = await admit(controller, opened, { ...alpha, owner: 'integrator', scope: 'alpha' }, 'candidate', 'candidate', {
    commit: B, artifact_sha256: D('3'), observation_receipt_sha256: D('4'),
  });
  const cp = await controller.checkpoint(opened.task_ref, {
    id: 'cp-ready', expected_log_head: candidate.log_head,
  });
  assert.equal(cp.decision, 'integrate');
  assert.equal(cp.inputs.pending_candidates, 1);
  await assert.rejects(controller.checkpoint(opened.task_ref, {
    id: 'cp-stale', expected_log_head: candidate.log_head,
  }), /stale checkpoint causal cut/);
});

test('settlement requires injected independent verifier and exact jj gate; restart replays CAS head', async t => {
  let calls = 0;
  let corruptGate = true;
  const hostVerifier = async ({ spec: frozen, expected_head, candidates }) => {
    calls++;
    const argv = ['jj', '--ignore-working-copy', 'run', '--ignore-changes', '--clean', '--root', '-r', C,
      '--', 'node', 'scripts/check.mjs', '--require-dsh'];
    if (corruptGate) argv[3] = '--allow-changes';
    return { ok: true, combined_commit: C, checked_commit: C, base_commit: expected_head,
      candidate_events: candidates.map(row => row.event_digest),
      evaluator_sha256: frozen.pinned_versions.evaluator_sha256,
      case_set_sha256: frozen.pinned_versions.case_set_sha256,
      toolchain: frozen.pinned_versions.toolchain, receipt_sha256: D('5'),
      ancestry_ok: true, conflicts_resolved: true, task_accepted: true,
      gate: { revision: C, argv, exit_code: 0, receipt_sha256: D('6') },
    };
  };
  const { controller, opened, storeRoot } = await fixture(t, { verifyCombined: hostVerifier });
  const alpha = await grant(controller, opened, { id: 'ga', branch: 'a', owner: 'integrator', scope: 'alpha',
    budget: budget({ integrations: 2, evaluations: 2 }) });
  const beta = await grant(controller, opened, { id: 'gb', branch: 'b', owner: 'worker', scope: 'beta' });
  const ca = await admit(controller, opened, { ...alpha, owner: 'integrator', scope: 'alpha' }, 'ca', 'candidate', {
    commit: B, artifact_sha256: D('3'), observation_receipt_sha256: D('4'),
  });
  const cb = await admit(controller, opened, { ...beta, owner: 'worker', scope: 'beta' }, 'cb', 'candidate', {
    commit: B, artifact_sha256: D('7'), observation_receipt_sha256: D('8'),
  });
  const request = { id: 'settle-two', integration_grant_ref: alpha.grant_ref,
    expected_head: A, candidate_events: [ca.event_digest, cb.event_digest] };
  await assert.rejects(controller.settle(opened.task_ref, { ...request, independent_verdict: { ok: true } }), /unknown field/);
  const withoutVerifier = createTaskControl({ storeRoot, allowUnsafeStoreRootForTest: true });
  await assert.rejects(withoutVerifier.settle(opened.task_ref, request), /verifier is not installed/);
  const failed = await controller.settle(opened.task_ref, request);
  assert.equal(failed.status, 'rejected');
  assert.equal(failed.reason, 'invalid-independent-verdict');
  assert.equal((await controller.replay(opened.task_ref)).task_head, A);
  corruptGate = false;
  const accepted = await controller.settle(opened.task_ref, { ...request, id: 'settle-two-retry' });
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.accepted_head, C);
  assert.equal(accepted.task_accepted, true);
  assert.equal(calls, 2);
  assert.equal((await controller.settle(opened.task_ref, { ...request, id: 'settle-two-retry' })).existing, true);
  assert.equal(calls, 2);
  await assert.rejects(controller.settle(opened.task_ref, { ...request, id: 'stale' }), /stale task head/);
  const restarted = createTaskControl({ storeRoot, allowUnsafeStoreRootForTest: true });
  const snapshot = await restarted.replay(opened.task_ref);
  assert.equal(snapshot.task_head, C);
  assert.equal(snapshot.terminal.reason, 'verified-acceptance');
  const stop = await restarted.checkpoint(opened.task_ref, { id: 'cp-terminal', expected_log_head: snapshot.log_head });
  assert.equal(stop.decision, 'stop');
  assert.equal(stop.reason, 'verified-acceptance');
  assert.equal((await restarted.replay(opened.task_ref)).events.at(-1).type, 'checkpointed');
});

test('slow independent verification cannot advance a stale head and records its rejected effect', async t => {
  let enterFirst;
  const firstStarted = new Promise(resolve => { enterFirst = resolve; });
  let releaseFirst;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  let calls = 0;
  const hostVerifier = async ({ spec: frozen, expected_head, candidates }) => {
    if (++calls === 1) { enterFirst(); await firstGate; }
    return { ok: true, combined_commit: C, checked_commit: C, base_commit: expected_head,
      candidate_events: candidates.map(row => row.event_digest),
      evaluator_sha256: frozen.pinned_versions.evaluator_sha256,
      case_set_sha256: frozen.pinned_versions.case_set_sha256,
      toolchain: frozen.pinned_versions.toolchain, receipt_sha256: D('5'),
      ancestry_ok: true, conflicts_resolved: true, task_accepted: false,
      gate: { revision: C, argv: ['jj', '--ignore-working-copy', 'run', '--ignore-changes', '--clean', '--root', '-r', C,
        '--', 'node', 'scripts/check.mjs', '--require-dsh'], exit_code: 0, receipt_sha256: D('6') },
    };
  };
  const { controller, opened } = await fixture(t, { verifyCombined: hostVerifier });
  const g = await grant(controller, opened, { id: 'ga', branch: 'a', owner: 'integrator', scope: 'alpha',
    budget: budget({ integrations: 2, evaluations: 2 }) });
  const candidate = await admit(controller, opened, g, 'candidate-race', 'candidate', {
    commit: B, artifact_sha256: D('3'), observation_receipt_sha256: D('4'),
  });
  const slow = controller.settle(opened.task_ref, { id: 'slow', integration_grant_ref: g.grant_ref,
    expected_head: A, candidate_events: [candidate.event_digest] });
  await firstStarted;
  const fast = await controller.settle(opened.task_ref, { id: 'fast', integration_grant_ref: g.grant_ref,
    expected_head: A, candidate_events: [candidate.event_digest] });
  assert.equal(fast.status, 'accepted');
  releaseFirst();
  const stale = await slow;
  assert.equal(stale.status, 'rejected');
  assert.equal(stale.reason, 'stale-head-after-verification');
  const snapshot = await controller.replay(opened.task_ref);
  assert.equal(snapshot.task_head, C);
  assert.equal(snapshot.events.filter(event => event.type === 'settled').length, 2);
});

test('one evaluation reservation prevents concurrent overspend and abandoned work cannot be adopted', async t => {
  let started;
  const entered = new Promise(resolve => { started = resolve; });
  let finish;
  const held = new Promise(resolve => { finish = resolve; });
  const { controller, opened } = await fixture(t, { limits: { evaluations: 1 },
    verifyCombined: async ({ spec: frozen, expected_head, candidates }) => {
      started(); await held;
      return { ok: true, combined_commit: C, checked_commit: C, base_commit: expected_head,
        candidate_events: candidates.map(row => row.event_digest),
        evaluator_sha256: frozen.pinned_versions.evaluator_sha256,
        case_set_sha256: frozen.pinned_versions.case_set_sha256,
        toolchain: frozen.pinned_versions.toolchain, receipt_sha256: D('5'),
        ancestry_ok: true, conflicts_resolved: true, task_accepted: true,
        gate: { revision: C, argv: ['jj', '--ignore-working-copy', 'run', '--ignore-changes', '--clean', '--root', '-r', C,
          '--', 'node', 'scripts/check.mjs', '--require-dsh'], exit_code: 0, receipt_sha256: D('6') } };
    },
    auditEvaluationAbandonment: async ({ settlement_id, intent_digest }) => ({
      status: 'abandoned', settlement_id, intent_digest, receipt_sha256: D('a'),
    }) });
  const g = await grant(controller, opened, { id: 'one-eval', branch: 'one-eval', owner: 'integrator', scope: 'alpha',
    budget: budget({ integrations: 2, evaluations: 1 }) });
  const candidate = await admit(controller, opened, g, 'one-candidate', 'candidate', {
    commit: B, artifact_sha256: D('3'), observation_receipt_sha256: D('4'),
  });
  const first = controller.settle(opened.task_ref, { id: 'first-eval', integration_grant_ref: g.grant_ref,
    expected_head: A, candidate_events: [candidate.event_digest] });
  await entered;
  assert.deepEqual((await controller.replay(opened.task_ref)).pending_evaluations, ['first-eval']);
  await assert.rejects(controller.settle(opened.task_ref, { id: 'second-eval', integration_grant_ref: g.grant_ref,
    expected_head: A, candidate_events: [candidate.event_digest] }), /grant is missing or exhausted/);
  const abandoned = await controller.abandonPendingEvaluation(opened.task_ref, 'first-eval');
  assert.equal(abandoned.status, 'abandoned');
  finish();
  const stale = await first;
  assert.equal(stale.status, 'rejected');
  const latest = await controller.replay(opened.task_ref);
  assert.equal(latest.task_head, A);
  const stopped = await controller.checkpoint(opened.task_ref, { id: 'exhausted-eval', expected_log_head: latest.log_head });
  assert.equal(stopped.decision, 'stop');
  assert.equal(stopped.reason, 'integration-or-evaluation-budget-exhausted');
});

test('failed integration owner cannot spend a reserved evaluation or advance task head', async t => {
  let called = false;
  const { controller, opened } = await fixture(t, { verifyCombined: async () => { called = true; return {}; } });
  const integrator = await grant(controller, opened, { id: 'revoked-owner', branch: 'revoked-owner',
    owner: 'integrator', scope: 'alpha', budget: budget({ integrations: 1, evaluations: 1 }) });
  const worker = await grant(controller, opened, { id: 'candidate-worker', branch: 'candidate-worker',
    owner: 'worker', scope: 'beta' });
  const candidate = await admit(controller, opened, worker, 'candidate-after-revocation', 'candidate', {
    commit: B, artifact_sha256: D('3'), observation_receipt_sha256: D('4'),
  });
  await admit(controller, opened, integrator, 'owner-failed', 'failed', { reason: 'worker failed' });
  await assert.rejects(controller.settle(opened.task_ref, { id: 'invalid-settlement',
    integration_grant_ref: integrator.grant_ref, expected_head: A,
    candidate_events: [candidate.event_digest] }), /grant is missing or exhausted/);
  assert.equal(called, false);
  const state = await controller.replay(opened.task_ref);
  assert.equal(state.task_head, A);
  assert.equal(state.pending_evaluations.length, 0);
  const cp = await controller.checkpoint(opened.task_ref, { id: 'revoked-checkpoint', expected_log_head: state.log_head });
  assert.equal(cp.decision, 'stop');
});

test('slow knowledge verification does not hold the task writer lock', async t => {
  let started;
  const entered = new Promise(resolve => { started = resolve; });
  let finish;
  const held = new Promise(resolve => { finish = resolve; });
  const { controller, opened } = await fixture(t, { verifyKnowledge: async ({ finding }) => {
    started(); await held;
    return { verified: true, claim_sha256: finding.claim_sha256,
      evidence_receipt_sha256: finding.evidence_receipt_sha256, receipt_sha256: D('c') };
  } });
  const alpha = await grant(controller, opened, { id: 'slow-knowledge', branch: 'slow-knowledge',
    owner: 'integrator', scope: 'alpha' });
  const beta = await grant(controller, opened, { id: 'parallel-admit', branch: 'parallel-admit',
    owner: 'worker', scope: 'beta' });
  const pending = admit(controller, opened, alpha, 'finding-slow', 'finding', {
    claim_sha256: D('a'), evidence_receipt_sha256: D('b'), source_refs: [],
  });
  await entered;
  try {
    const completed = await Promise.race([
      admit(controller, opened, beta, 'parallel-observation', 'prediction', { text: 'independent' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('knowledge verifier held writer lock')), 1000)),
    ]);
    assert.equal(completed.status, 'admitted');
  } finally { finish(); }
  assert.equal((await pending).status, 'admitted');
});

test('tampered content-addressed event refuses cold replay', async t => {
  const { controller, opened, storeRoot } = await fixture(t);
  const snapshot = await controller.replay(opened.task_ref);
  const file = path.join(storeRoot, opened.task_ref, 'events', `${snapshot.log_head}.json`);
  const value = await readFile(file, 'utf8');
  await writeFile(file, value.replace('opened', 'tamper'));
  await assert.rejects(createTaskControl({ storeRoot, allowUnsafeStoreRootForTest: true }).replay(opened.task_ref), /digest mismatch/);
});

test('Cordis mount provides a service, never a second agent loop or model tool', () => {
  const provided = [];
  apply({ provide: (key, value) => provided.push([key, value]), get: () => undefined },
    { storeRoot: '/tmp/telepathy-task-service-test', allowUnsafeStoreRootForTest: true });
  assert.equal(provided.length, 1);
  assert.equal(provided[0][0], 'telepathyTaskControl');
  assert.equal(typeof provided[0][1].checkpoint, 'function');
  assert.throws(() => apply({ provide: () => {}, get: () => undefined }, {
    storeRoot: '/tmp/telepathy-task-service-test', allowUnsafeStoreRootForTest: true,
    allowSyntheticCombinedVerifierForTest: true,
    verifyCombined: async () => ({ ok: true }) }),
  /production source settlement requires the checked jj verifier adapter/);
});

test('model task_plan tool proposes only within host-bound scope and never grants a worker', async t => {
  const { controller, opened } = await fixture(t);
  const tool = createTaskPlanTool(controller, { bindingForSession: async session => session === 'root-session'
    ? { task_ref: opened.task_ref, allowed_scopes: ['alpha'] } : null });
  const proposal = { id: 'proposed-a', kind: 'research', scope: 'alpha', deliverable: 'Find source A',
    acceptance: 'Pinned oracle accepts source A', source_refs: [D('a')], oracle_sha256: D('1'),
    budget: budget({ tokens: 500, fuel: 2 }), depends_on: [], parent_plan_ref: null,
    expected_log_head: opened.log_head };
  const made = await tool.execute(proposal, { agent: { session: { id: 'root-session' } } });
  assert.match(made.plan_ref, /^[a-f0-9]{64}$/);
  assert.equal((await controller.replay(opened.task_ref)).grants.length, 0);
  await assert.rejects(tool.execute({ ...proposal, id: 'proposed-b', scope: 'beta', expected_log_head: made.log_head },
    { agent: { session: { id: 'root-session' } } }), /scope is not bound/);
  await assert.rejects(tool.execute({ ...proposal, id: 'proposed-c', expected_log_head: made.log_head },
    { agent: { session: { id: 'other-session' } } }), /scope is not bound/);
});

test('root model session binds one funded integration grant before its first turn', async t => {
  const { controller, opened } = await fixture(t, { inspectWorkspace: async grant => grant.location });
  const g = await grant(controller, opened, { id: 'root-grant', branch: 'root-grant',
    owner: 'integrator', scope: 'alpha' });
  const rootSession = { id: 'root-model-session', header: { origin: 'user', cwd: '/tmp/telepathy-root-grant' } };
  const ctx = { sessions: { get: sessionId => sessionId === rootSession.id ? rootSession : null } };
  const request = { id: 'bind-root', grant_ref: g.grant_ref, session_id: rootSession.id };
  await assert.rejects(controller.bindRootSession(opened.task_ref, request,
    { sessions: { get: () => ({ ...rootSession, header: { ...rootSession.header, cwd: '/tmp/wider' } }) } }),
  /cwd differs/);
  const bound = await controller.bindRootSession(opened.task_ref, request, ctx);
  assert.equal(bound.status, 'bound');
  assert.equal((await controller.bindRootSession(opened.task_ref, request, ctx)).existing, true);
  assert.equal((await controller.replay(opened.task_ref)).grants[0].session_id, rootSession.id);
  await assert.rejects(controller.bindRootSession(opened.task_ref,
    { id: 'bind-other', grant_ref: g.grant_ref, session_id: 'other-session' },
    { sessions: { get: () => ({ id: 'other-session', header: { origin: 'subagent' } }) } }),
  /live root DSH session/);
});

test('knowledge remains unadmitted until host verifies its exact evidence receipt', async t => {
  const verifyKnowledge = async ({ finding }) => ({ verified: finding.evidence_receipt_sha256 === D('b'),
    claim_sha256: finding.claim_sha256, evidence_receipt_sha256: finding.evidence_receipt_sha256,
    receipt_sha256: D('c') });
  const { controller, opened, storeRoot } = await fixture(t, { verifyKnowledge });
  const g = await grant(controller, opened, { id: 'ga', branch: 'knowledge', owner: 'integrator', scope: 'alpha' });
  await assert.rejects(admit(controller, opened, g, 'bad-finding', 'finding', {
    claim_sha256: D('a'), evidence_receipt_sha256: D('d'), source_refs: [D('e')],
  }), /not independently verified/);
  const accepted = await admit(controller, opened, g, 'good-finding', 'finding', {
    claim_sha256: D('a'), evidence_receipt_sha256: D('b'), source_refs: [D('e')],
  });
  assert.equal(accepted.verifier_receipt_sha256, D('c'));
  const restart = createTaskControl({ storeRoot, allowUnsafeStoreRootForTest: true });
  assert.equal((await restart.replay(opened.task_ref)).knowledge[0].evidence_receipt_sha256, D('b'));
});

test('independent research result acceptance unlocks a dependent analysis plan without changing the source head', async t => {
  const { controller, opened, storeRoot, first, second, g, result } = await researchFixture(t, {
    limits: { max_active_grants: 2, evaluations: 3 },
    verifyResult: async input => {
      assert.equal(input.plan.ref, first.plan_ref);
      assert.equal(input.grant.ref, g.grant_ref);
      assert.equal(input.result.event_digest, result.event_digest);
      assert.equal(input.result.artifact_sha256, D('a'));
      return researchVerdict(input);
    },
  });
  const before = await controller.replay(opened.task_ref);
  assert.equal(before.plans.find(row => row.ref === first.plan_ref).status, 'ready');
  assert.equal(before.plans.find(row => row.ref === second.plan_ref).status, 'planned');
  await assert.rejects(controller.grant(opened.task_ref, {
    id: 'too-early', plan_ref: second.plan_ref, branch: 'too-early', owner: 'analyst',
    scope: 'alpha', deliverable: 'Analyze the accepted first result',
    base_refs: base(A, before.log_head), budget: budget({ evaluations: 1 }),
    location: '/tmp/telepathy-too-early', parent_grant_ref: null,
  }), /logical task dependencies are not accepted/);
  const checkpoint = await controller.checkpoint(opened.task_ref, {
    id: 'research-ready-checkpoint', expected_log_head: before.log_head,
  });
  assert.equal(checkpoint.decision, 'evaluate');
  assert.equal(checkpoint.inputs.pending_results, 1);
  const accepted = await controller.settleResult(opened.task_ref, {
    id: 'research-accept', grant_ref: g.grant_ref, plan_ref: first.plan_ref,
    result_event: result.event_digest, expected_head: A,
  });
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.task_accepted, false);
  assert.equal(accepted.task_head, A);
  const replayed = createTaskControl({ storeRoot, allowUnsafeStoreRootForTest: true });
  const after = await replayed.replay(opened.task_ref);
  assert.equal(after.task_head, A);
  assert.equal(after.terminal, null);
  assert.equal(after.plans.find(row => row.ref === first.plan_ref).status, 'accepted');
  assert.equal(after.results.find(row => row.event_digest === result.event_digest).status, 'accepted');
  assert.equal(after.pending_evaluations.length, 0);
  assert.ok(after.events.some(row => row.type === 'result_evaluation_started'));
  assert.ok(after.events.some(row => row.type === 'result_settled'));
  const next = await replayed.grant(opened.task_ref, {
    id: 'analysis-grant', plan_ref: second.plan_ref, branch: 'analysis-branch', owner: 'analyst',
    scope: 'alpha', deliverable: 'Analyze the accepted first result',
    base_refs: base(A, after.log_head), budget: budget({ evaluations: 1 }),
    location: '/tmp/telepathy-analysis-branch', parent_grant_ref: null,
  });
  assert.match(next.grant_ref, /^[a-f0-9]{64}$/);
});

test('synthesis integrates only accepted cross-scope results at a frozen cut with a pinned oracle', async t => {
  const oracleRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'telepathy-synthesis-oracle-')));
  t.after(() => rm(oracleRoot, { recursive: true, force: true }));
  const oraclePath = path.join(oracleRoot, 'oracle.mjs');
  const artifactRoot = path.join(oracleRoot, 'archive');
  await mkdir(path.join(artifactRoot, 'artifacts'), { recursive: true });
  await mkdir(path.join(artifactRoot, 'evidence'));
  const oracleBytes = `import { createHash } from 'node:crypto';
  import { readFile } from 'node:fs/promises';
  import path from 'node:path';
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  async function checked(root, folder, digest, extension) {
    const bytes = await readFile(path.join(root, folder, digest + extension));
    if (hash(bytes) !== digest) throw Error('archive digest changed');
  }
  export async function verifySynthesis(input) {
    if (new Set(input.citations.map(row => row.scope)).size < 2) throw Error('distinct scopes required');
    const { spec, plan, grant, result, citations, artifactRoot, ...binding } = input;
    if (result.source_cut !== plan.expected_log_head ||
        JSON.stringify(result.source_refs) !== JSON.stringify(plan.source_refs))
      throw Error('sources changed');
    for (const row of citations) {
      await checked(artifactRoot, 'artifacts', row.artifact_sha256, '.txt');
      await checked(artifactRoot, 'evidence', row.evidence_receipt_sha256, '.json');
    }
    await checked(artifactRoot, 'artifacts', input.artifact_sha256, '.txt');
    await checked(artifactRoot, 'evidence', input.evidence_receipt_sha256, '.json');
    return { ...binding, ok: true, receipt_sha256: '${D('f')}' };
  }`;
  await writeFile(oraclePath, oracleBytes);
  const oracleSha = sha(oracleBytes);
  const verifySynthesis = createPinnedSynthesisVerifier({ oraclePath, trustedRoot: oracleRoot,
    workspaceRoot: process.cwd(), artifactRoot, allowUnsafeOraclePathForTest: true });
  const { controller, opened, storeRoot } = await fixture(t, {
    limits: { max_branches: 4, max_active_grants: 2, evaluations: 3 },
    synthesisOracleSha256: oracleSha, verifyResult: researchVerdict, verifySynthesis,
  });
  const alpha = await settledSource(controller, opened, 'alpha', 'alpha');
  const beta = await settledSource(controller, opened, 'beta', 'beta');
  for (const source of [alpha, beta]) {
    await writeFile(path.join(artifactRoot, 'artifacts', `${sha(source.artifactBytes)}.txt`), source.artifactBytes);
    await writeFile(path.join(artifactRoot, 'evidence', `${sha(source.evidenceBytes)}.json`), source.evidenceBytes);
  }
  await grant(controller, opened, { id: 'beta-observer', branch: 'beta-observer',
    owner: 'beta-worker', scope: 'beta', kind: 'analysis', budget: budget({ evaluations: 0 }) });
  const before = await controller.replay(opened.task_ref);
  const sourceRefs = [alpha.result.event_digest, beta.result.event_digest];
  await assert.rejects(controller.plan(opened.task_ref, {
    id: 'unknown-synthesis', kind: 'synthesis', scope: 'alpha', deliverable: 'Join two fields',
    acceptance: 'Independent synthesis oracle accepts', source_refs: [sourceRefs[0], D('9')],
    oracle_sha256: oracleSha, budget: budget({ evaluations: 1 }), depends_on: [],
    parent_plan_ref: null, expected_log_head: before.log_head,
  }), /not an accepted result/);
  await assert.rejects(controller.plan(opened.task_ref, {
    id: 'wrong-oracle-synthesis', kind: 'synthesis', scope: 'alpha', deliverable: 'Join two fields',
    acceptance: 'Independent synthesis oracle accepts', source_refs: sourceRefs,
    oracle_sha256: D('1'), budget: budget({ evaluations: 1 }), depends_on: [],
    parent_plan_ref: null, expected_log_head: before.log_head,
  }), /oracle differs from frozen evaluator/);
  const planned = await controller.plan(opened.task_ref, {
    id: 'cross-field', kind: 'synthesis', scope: 'alpha', deliverable: 'Join two fields',
    acceptance: 'Independent synthesis oracle accepts', source_refs: sourceRefs,
    oracle_sha256: oracleSha, budget: budget({ evaluations: 1 }), depends_on: [],
    parent_plan_ref: null, expected_log_head: before.log_head,
  });
  const afterPlan = await controller.replay(opened.task_ref);
  const grantRequest = { id: 'synthesis-grant', plan_ref: planned.plan_ref, branch: 'synthesis',
    owner: 'integrator', scope: 'alpha', deliverable: 'Join two fields',
    base_refs: base(A, afterPlan.log_head), budget: budget({ evaluations: 1 }),
    location: '/tmp/telepathy-synthesis', parent_grant_ref: null };
  await assert.rejects(controller.grant(opened.task_ref, { ...grantRequest, owner: 'analyst' }),
    /frozen root integration owner/);
  const g = await controller.grant(opened.task_ref, grantRequest);
  const view = await controller.view(opened.task_ref, 'integrator', null, 16_384);
  const assignment = view.assignments.find(row => row.plan_ref === planned.plan_ref);
  assert.equal(assignment.source_cut, before.log_head);
  assert.deepEqual(assignment.citations.map(row => row.scope), ['alpha', 'beta']);
  assert.ok(assignment.citations.every(row => row.settlement_event_digest && row.verifier_receipt_sha256));
  assert.ok(view.context_refs.every(row => row.scope === 'alpha'));
  const betaView = await controller.view(opened.task_ref, 'beta-worker', null, 16_384);
  assert.ok(betaView.assignments.every(row => row.kind !== 'synthesis' && row.citations === undefined));
  assert.ok(betaView.context_refs.every(row => row.scope === 'beta'));
  const synthesisArtifact = 'synthesis-artifact';
  const synthesisEvidence = JSON.stringify({ model: 'synthesis-evidence' });
  await writeFile(path.join(artifactRoot, 'artifacts', `${sha(synthesisArtifact)}.txt`), synthesisArtifact);
  await writeFile(path.join(artifactRoot, 'evidence', `${sha(synthesisEvidence)}.json`), synthesisEvidence);
  const payload = { artifact_sha256: sha(synthesisArtifact),
    evidence_receipt_sha256: sha(synthesisEvidence), source_refs: sourceRefs,
    source_cut: before.log_head };
  await assert.rejects(controller.admit(opened.task_ref, {
    id: 'wrong-source-cut', grant_ref: g.grant_ref, actor: 'integrator', scope: 'alpha',
    base_commit: A, parents: [g.event_digest], kind: 'result',
    payload: { ...payload, source_cut: afterPlan.log_head },
  }), /differs from its frozen sources/);
  const result = await controller.admit(opened.task_ref, {
    id: 'synthesis-result', grant_ref: g.grant_ref, actor: 'integrator', scope: 'alpha',
    base_commit: A, parents: [g.event_digest], kind: 'result', payload,
  });
  const accepted = await controller.settleResult(opened.task_ref, {
    id: 'synthesis-settlement', grant_ref: g.grant_ref, plan_ref: planned.plan_ref,
    result_event: result.event_digest, expected_head: A,
  });
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.task_accepted, false);
  const restarted = createTaskControl({ storeRoot, allowUnsafeStoreRootForTest: true });
  const replayed = await restarted.replay(opened.task_ref);
  assert.equal(replayed.task_head, A);
  assert.equal(replayed.plans.find(row => row.ref === planned.plan_ref).status, 'accepted');
  assert.equal(replayed.results.find(row => row.event_digest === result.event_digest).status, 'accepted');
  assert.deepEqual(replayed.plans.find(row => row.ref === planned.plan_ref).citations,
    assignment.citations);
});

test('synthesis cannot use unaccepted or one-scope results and preserves normal scope rules', async t => {
  const { controller, opened } = await fixture(t, { synthesisOracleSha256: D('e'),
    limits: { max_branches: 4, evaluations: 4 },
    verifyResult: input => input.result.artifact_sha256 === D('a')
      ? researchVerdict(input, { ok: false, reason: 'rejected-source' }) : researchVerdict(input),
    verifySynthesis: researchVerdict, allowSyntheticSynthesisVerifierForTest: true });
  const alpha = await settledSource(controller, opened, 'alpha', 'one');
  const second = await settledSource(controller, opened, 'alpha', 'two');
  const betaGrant = await grant(controller, opened, { id: 'source-unsettled', branch: 'source-unsettled',
    owner: 'researcher-unsettled', scope: 'beta', kind: 'research', budget: budget({ evaluations: 1 }) });
  const proposed = await admit(controller, opened, betaGrant, 'unsettled', 'result', {
    artifact_sha256: D('a'), evidence_receipt_sha256: D('b'), source_refs: [] });
  const current = await controller.replay(opened.task_ref);
  const request = { id: 'synthesis-invalid', kind: 'synthesis', scope: 'alpha',
    deliverable: 'Join fields', acceptance: 'Independent synthesis oracle accepts',
    source_refs: [alpha.result.event_digest, second.result.event_digest],
    oracle_sha256: D('e'), budget: budget({ evaluations: 1 }), depends_on: [],
    parent_plan_ref: null, expected_log_head: current.log_head };
  await assert.rejects(controller.plan(opened.task_ref, request), /distinct scopes/);
  await assert.rejects(controller.plan(opened.task_ref, { ...request,
    source_refs: [alpha.result.event_digest, proposed.event_digest] }), /not an accepted result/);
  await assert.rejects(controller.plan(opened.task_ref, { ...request,
    source_refs: [alpha.result.event_digest, alpha.settled.event_digest] }), /not an accepted result/);
  await assert.rejects(controller.plan(opened.task_ref, { ...request, kind: 'analysis',
    source_refs: [], depends_on: [betaGrant.plan_ref], oracle_sha256: D('1') }),
  /dependency is absent or outside scope/);
  const rejected = await controller.settleResult(opened.task_ref, {
    id: 'late-beta-settlement', grant_ref: betaGrant.grant_ref, plan_ref: betaGrant.plan_ref,
    result_event: proposed.event_digest, expected_head: A });
  assert.equal(rejected.status, 'rejected');
  const afterRejected = await controller.replay(opened.task_ref);
  await assert.rejects(controller.plan(opened.task_ref, { ...request,
    source_refs: [alpha.result.event_digest, proposed.event_digest],
    expected_log_head: afterRejected.log_head }), /not an accepted result/);
  const beforeLateAcceptance = afterRejected.log_head;
  const lateBeta = await settledSource(controller, opened, 'beta', 'late-beta');
  assert.equal(lateBeta.settled.status, 'accepted');
  await assert.rejects(controller.plan(opened.task_ref, { ...request,
    source_refs: [alpha.result.event_digest, lateBeta.result.event_digest],
    expected_log_head: beforeLateAcceptance }), /stale logical task causal cut/);
});

test('synthesis oracle is a pinned host file; mutation and unbranded callbacks fail closed', async t => {
  const storeRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'telepathy-synthesis-store-')));
  const oracleRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'telepathy-synthesis-pin-')));
  t.after(() => rm(storeRoot, { recursive: true, force: true }));
  t.after(() => rm(oracleRoot, { recursive: true, force: true }));
  assert.throws(() => createTaskControl({ storeRoot, allowUnsafeStoreRootForTest: true,
    verifySynthesis: async () => ({ ok: true }) }), /host-pinned oracle adapter/);
  assert.throws(() => createTaskControl({
    storeRoot: path.join(os.homedir(), '.local', 'state', 'telepathy-synthesis-test-only'),
    verifySynthesis: async () => ({ ok: true }),
    allowSyntheticSynthesisVerifierForTest: true }), /temporary test store/);
  const oraclePath = path.join(oracleRoot, 'oracle.mjs');
  const source = `export function verifySynthesis(input) { return { oracle: input.synthesis_oracle_sha256 }; }`;
  await writeFile(oraclePath, source);
  const verifySynthesis = createPinnedSynthesisVerifier({ oraclePath, trustedRoot: oracleRoot,
    workspaceRoot: process.cwd(), artifactRoot: oracleRoot, allowUnsafeOraclePathForTest: true });
  assert.throws(() => createTaskControl({
    storeRoot: path.join(os.homedir(), '.local', 'state', 'telepathy-synthesis-production'),
    verifySynthesis,
  }), /production synthesis requires a host-pinned oracle adapter/);
  assert.deepEqual(await verifySynthesis({ synthesis_oracle_sha256: sha(source) }), { oracle: sha(source) });
  await writeFile(oraclePath, `${source}\n// changed`);
  await assert.rejects(verifySynthesis({ synthesis_oracle_sha256: sha(source) }), /oracle bytes differ/);
  await writeFile(oraclePath, `//${'x'.repeat(1024 * 1024)}`);
  await assert.rejects(verifySynthesis({ synthesis_oracle_sha256: sha(source) }), /exceeds 1 MiB/);
});

test('a synthesis oracle verdict for different citations cannot accept a result', async t => {
  const { controller, opened } = await fixture(t, {
    limits: { max_branches: 3, evaluations: 3 }, synthesisOracleSha256: D('e'),
    verifyResult: researchVerdict, allowSyntheticSynthesisVerifierForTest: true,
    verifySynthesis: async input => {
      const { spec: _spec, plan: _plan, grant: _grant, result: _result,
        citations: _citations, ...binding } = input;
      return { ...binding, citations_sha256: D('0'), ok: true, receipt_sha256: D('f') };
    },
  });
  const alpha = await settledSource(controller, opened, 'alpha', 'bad-verdict-alpha');
  const beta = await settledSource(controller, opened, 'beta', 'bad-verdict-beta');
  const before = await controller.replay(opened.task_ref);
  const sourceRefs = [alpha.result.event_digest, beta.result.event_digest];
  const planned = await controller.plan(opened.task_ref, {
    id: 'bad-verdict-plan', kind: 'synthesis', scope: 'alpha', deliverable: 'Check sources',
    acceptance: 'Pinned oracle accepts', source_refs: sourceRefs, oracle_sha256: D('e'),
    budget: budget({ evaluations: 1 }), depends_on: [], parent_plan_ref: null,
    expected_log_head: before.log_head,
  });
  const afterPlan = await controller.replay(opened.task_ref);
  const g = await controller.grant(opened.task_ref, {
    id: 'bad-verdict-grant', plan_ref: planned.plan_ref, branch: 'bad-verdict', owner: 'integrator',
    scope: 'alpha', deliverable: 'Check sources', base_refs: base(A, afterPlan.log_head),
    budget: budget({ evaluations: 1 }), location: '/tmp/telepathy-bad-verdict', parent_grant_ref: null,
  });
  const result = await controller.admit(opened.task_ref, {
    id: 'bad-verdict-result', grant_ref: g.grant_ref, actor: 'integrator', scope: 'alpha',
    base_commit: A, parents: [g.event_digest], kind: 'result', payload: {
      artifact_sha256: D('a'), evidence_receipt_sha256: D('b'), source_refs: sourceRefs,
      source_cut: before.log_head,
    },
  });
  const settled = await controller.settleResult(opened.task_ref, {
    id: 'bad-verdict-settlement', grant_ref: g.grant_ref, plan_ref: planned.plan_ref,
    result_event: result.event_digest, expected_head: A,
  });
  assert.equal(settled.status, 'rejected');
  assert.equal(settled.reason, 'invalid-independent-result-verdict');
  const after = await controller.replay(opened.task_ref);
  assert.equal(after.plans.find(row => row.ref === planned.plan_ref).status, 'failed');
  assert.equal(after.results.find(row => row.event_digest === result.event_digest).status, 'rejected');
});

test('rejected and malformed research verdicts spend evaluation slots but never accept a plan', async t => {
  let calls = 0;
  const { controller, opened, first, g, result } = await researchFixture(t, {
    verifyResult: async input => {
      calls++;
      return calls === 1 ? researchVerdict(input, { ok: false, reason: 'evidence-inconclusive' })
        : researchVerdict(input, { artifact_sha256: D('d') });
    },
  });
  const request = { id: 'research-reject', grant_ref: g.grant_ref, plan_ref: first.plan_ref,
    result_event: result.event_digest, expected_head: A };
  const rejected = await controller.settleResult(opened.task_ref, request);
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.reason, 'evidence-inconclusive');
  assert.equal((await controller.settleResult(opened.task_ref, request)).existing, true);
  assert.equal(calls, 1);
  const malformed = await controller.settleResult(opened.task_ref, { ...request, id: 'research-malformed' });
  assert.equal(malformed.status, 'rejected');
  assert.equal(malformed.reason, 'invalid-independent-result-verdict');
  const after = await controller.replay(opened.task_ref);
  assert.equal(after.plans.find(row => row.ref === first.plan_ref).status, 'failed');
  assert.equal(after.grants.find(row => row.ref === g.grant_ref).status, 'failed');
  assert.equal(after.results.find(row => row.event_digest === result.event_digest).status, 'rejected');
  assert.equal(after.grants.find(row => row.ref === g.grant_ref).left.evaluations, 0);
  assert.equal(after.terminal, null);
});

test('exhausted rejected research result releases the only slot for an independent plan', async t => {
  const { controller, opened, storeRoot, first, second, g, result } = await researchFixture(t, {
    researchEvaluations: 1, secondDependsOnFirst: false,
    limits: { max_active_grants: 1, evaluations: 2 },
    verifyResult: async input => researchVerdict(input, { ok: false, reason: 'evidence-rejected' }),
  });
  const rejected = await controller.settleResult(opened.task_ref, {
    id: 'research-one-shot', grant_ref: g.grant_ref, plan_ref: first.plan_ref,
    result_event: result.event_digest, expected_head: A,
  });
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.receipt_sha256, D('f'));
  assert.equal(rejected.reason, 'evidence-rejected');
  const cold = createTaskControl({ storeRoot, allowUnsafeStoreRootForTest: true });
  const after = await cold.replay(opened.task_ref);
  assert.equal(after.plans.find(row => row.ref === first.plan_ref).status, 'failed');
  assert.equal(after.grants.find(row => row.ref === g.grant_ref).status, 'failed');
  assert.equal(after.results.find(row => row.event_digest === result.event_digest).status, 'rejected');
  assert.equal(after.plans.find(row => row.ref === second.plan_ref).status, 'planned');
  assert.equal(after.terminal, null);
  const checkpoint = await cold.checkpoint(opened.task_ref, {
    id: 'after-rejected-result', expected_log_head: after.log_head,
  });
  assert.equal(checkpoint.decision, 'delegate');
  assert.equal(checkpoint.inputs.occupied_worker_slots, 0);
  assert.equal(checkpoint.inputs.pending_results, 0);
  const beforeGrant = await cold.replay(opened.task_ref);
  const next = await cold.grant(opened.task_ref, {
    id: 'independent-analysis-grant', plan_ref: second.plan_ref,
    branch: 'independent-analysis-branch', owner: 'analyst', scope: 'alpha',
    deliverable: 'Analyze an independent source',
    base_refs: base(A, beforeGrant.log_head), budget: budget({ evaluations: 1 }),
    location: '/tmp/telepathy-independent-analysis', parent_grant_ref: null,
  });
  assert.match(next.grant_ref, /^[a-f0-9]{64}$/);
});

test('a failed research prerequisite is reported as blocked rather than delegable', async t => {
  const { controller, opened, storeRoot, first, second, g, result } = await researchFixture(t, {
    researchEvaluations: 1,
    limits: { max_active_grants: 1, evaluations: 2 },
    verifyResult: async input => researchVerdict(input, { ok: false, reason: 'evidence-rejected' }),
  });
  await controller.settleResult(opened.task_ref, {
    id: 'failed-prerequisite', grant_ref: g.grant_ref, plan_ref: first.plan_ref,
    result_event: result.event_digest, expected_head: A,
  });
  const cold = createTaskControl({ storeRoot, allowUnsafeStoreRootForTest: true });
  const after = await cold.replay(opened.task_ref);
  assert.equal(after.plans.find(row => row.ref === first.plan_ref).status, 'failed');
  assert.equal(after.plans.find(row => row.ref === second.plan_ref).status, 'planned');
  const checkpoint = await cold.checkpoint(opened.task_ref, {
    id: 'after-failed-prerequisite', expected_log_head: after.log_head,
  });
  assert.equal(checkpoint.decision, 'inspect');
  assert.equal(checkpoint.reason, 'blocked-dependencies');
  assert.equal(checkpoint.inputs.occupied_worker_slots, 0);
  assert.equal((await cold.replay(opened.task_ref)).terminal, null);
});

test('a result with no evaluation grant releases its worker slot on admission', async t => {
  const { opened, storeRoot, first, second, g, result } = await researchFixture(t, {
    researchEvaluations: 0, secondDependsOnFirst: false,
    limits: { max_active_grants: 1, evaluations: 1 },
  });
  const cold = createTaskControl({ storeRoot, allowUnsafeStoreRootForTest: true });
  const after = await cold.replay(opened.task_ref);
  assert.equal(after.plans.find(row => row.ref === first.plan_ref).status, 'failed');
  assert.equal(after.grants.find(row => row.ref === g.grant_ref).status, 'failed');
  assert.equal(after.results.find(row => row.event_digest === result.event_digest).status, 'rejected');
  const checkpoint = await cold.checkpoint(opened.task_ref, {
    id: 'after-unfunded-result', expected_log_head: after.log_head,
  });
  assert.equal(checkpoint.decision, 'delegate');
  assert.equal(checkpoint.inputs.occupied_worker_slots, 0);
  const latest = await cold.replay(opened.task_ref);
  const granted = await cold.grant(opened.task_ref, {
    id: 'after-unfunded-grant', plan_ref: second.plan_ref,
    branch: 'after-unfunded-branch', owner: 'analyst', scope: 'alpha',
    deliverable: 'Analyze an independent source', base_refs: base(A, latest.log_head),
    budget: budget({ evaluations: 1 }), location: '/tmp/telepathy-after-unfunded',
    parent_grant_ref: null,
  });
  assert.match(granted.grant_ref, /^[a-f0-9]{64}$/);
});

test('an unrelated checkpoint does not invalidate a verified research result', async t => {
  let begin;
  const entered = new Promise(resolve => { begin = resolve; });
  let finish;
  const held = new Promise(resolve => { finish = resolve; });
  const { controller, opened, first, g, result } = await researchFixture(t, {
    verifyResult: async input => { begin(); await held; return researchVerdict(input); },
  });
  const pending = controller.settleResult(opened.task_ref, { id: 'research-stale',
    grant_ref: g.grant_ref, plan_ref: first.plan_ref, result_event: result.event_digest,
    expected_head: A });
  await entered;
  const during = await controller.replay(opened.task_ref);
  await controller.checkpoint(opened.task_ref, { id: 'intervening-checkpoint', expected_log_head: during.log_head });
  finish();
  const accepted = await pending;
  assert.equal(accepted.status, 'accepted');
  const after = await controller.replay(opened.task_ref);
  assert.equal(after.plans.find(row => row.ref === first.plan_ref).status, 'accepted');
  assert.equal(after.pending_evaluations.length, 0);
});

test('independent concurrent research verifications can both settle', async t => {
  let enteredCount = 0;
  let allEntered;
  const entered = new Promise(resolve => { allEntered = resolve; });
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const { controller, opened } = await fixture(t, {
    limits: { max_tasks: 2, max_branches: 2, max_active_grants: 2, evaluations: 2 },
    verifyResult: async input => {
      if (++enteredCount === 2) allEntered();
      await held;
      return researchVerdict(input);
    },
  });
  const ready = [];
  for (const suffix of ['a', 'b']) {
    const beforePlan = await controller.replay(opened.task_ref);
    const planned = await controller.plan(opened.task_ref, {
      id: `research-${suffix}`, kind: 'research', scope: 'alpha',
      deliverable: `Verify result ${suffix}`, acceptance: 'Independent result check',
      source_refs: [], oracle_sha256: D('1'), budget: budget({ evaluations: 1 }),
      depends_on: [], parent_plan_ref: null, expected_log_head: beforePlan.log_head,
    });
    const beforeGrant = await controller.replay(opened.task_ref);
    const granted = await controller.grant(opened.task_ref, {
      id: `grant-${suffix}`, plan_ref: planned.plan_ref, branch: `branch-${suffix}`,
      owner: `researcher-${suffix}`, scope: 'alpha', deliverable: `Verify result ${suffix}`,
      base_refs: base(A, beforeGrant.log_head), budget: budget({ evaluations: 1 }),
      location: `/tmp/telepathy-research-${suffix}`, parent_grant_ref: null,
    });
    const result = await admit(controller, opened, {
      ...granted, owner: `researcher-${suffix}`, scope: 'alpha',
    }, `result-${suffix}`, 'result', {
      artifact_sha256: D(suffix === 'a' ? 'a' : 'b'),
      evidence_receipt_sha256: D('c'), source_refs: [],
    });
    ready.push({ plan_ref: planned.plan_ref, grant_ref: granted.grant_ref,
      result_event: result.event_digest });
  }
  const settlements = ready.map((row, index) => controller.settleResult(opened.task_ref, {
    id: `settle-${index}`, ...row, expected_head: A,
  }));
  await entered;
  release();
  const results = await Promise.all(settlements);
  assert.deepEqual(results.map(row => row.status), ['accepted', 'accepted']);
  const after = await controller.replay(opened.task_ref);
  assert.deepEqual(after.plans.map(row => row.status), ['accepted', 'accepted']);
  assert.deepEqual(after.results.map(row => row.status), ['accepted', 'accepted']);
  assert.equal(after.pending_evaluations.length, 0);
  assert.equal(after.task_head, A);
});

test('a source head change still invalidates a pending research verdict', async t => {
  let entered;
  const verifying = new Promise(resolve => { entered = resolve; });
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const { controller, opened, first, g, result } = await researchFixture(t, {
    limits: { max_tasks: 4, max_branches: 3, max_active_grants: 2,
      integrations: 2, evaluations: 4 },
    verifyResult: async input => { entered(); await held; return researchVerdict(input); },
    verifyCombined: async ({ spec: frozen, expected_head, candidates }) => ({
      ok: true, combined_commit: C, checked_commit: C, base_commit: expected_head,
      candidate_events: candidates.map(row => row.event_digest),
      evaluator_sha256: frozen.pinned_versions.evaluator_sha256,
      case_set_sha256: frozen.pinned_versions.case_set_sha256,
      toolchain: frozen.pinned_versions.toolchain, receipt_sha256: D('5'),
      ancestry_ok: true, conflicts_resolved: true, task_accepted: false,
      gate: { revision: C, argv: ['jj', '--ignore-working-copy', 'run', '--ignore-changes',
        '--clean', '--root', '-r', C, '--', 'node', 'scripts/check.mjs', '--require-dsh'],
      exit_code: 0, receipt_sha256: D('6') },
    }),
  });
  const integrator = await grant(controller, opened, {
    id: 'source-grant', branch: 'source-branch', owner: 'integrator', scope: 'alpha',
    budget: budget({ integrations: 1, evaluations: 1 }),
  });
  const candidate = await admit(controller, opened, integrator,
    'source-candidate', 'candidate', {
      commit: B, artifact_sha256: D('3'), observation_receipt_sha256: D('4'),
    });
  const pending = controller.settleResult(opened.task_ref, {
    id: 'research-before-source', grant_ref: g.grant_ref, plan_ref: first.plan_ref,
    result_event: result.event_digest, expected_head: A,
  });
  await verifying;
  const source = await controller.settle(opened.task_ref, {
    id: 'source-settlement', integration_grant_ref: integrator.grant_ref,
    expected_head: A, candidate_events: [candidate.event_digest],
  });
  assert.equal(source.status, 'accepted');
  release();
  const stale = await pending;
  assert.equal(stale.status, 'rejected');
  assert.equal(stale.reason, 'stale-result-after-verification');
  const after = await controller.replay(opened.task_ref);
  assert.equal(after.task_head, C);
  assert.equal(after.plans.find(row => row.ref === first.plan_ref).status, 'ready');
  const staleDecision = await controller.checkpoint(opened.task_ref, {
    id: 'stale-research-checkpoint', expected_log_head: after.log_head,
  });
  assert.equal(staleDecision.reason, 'result-base-stale');
  const nextIntegrator = await grant(controller, opened, {
    id: 'new-source-grant', branch: 'new-source-branch', owner: 'integrator', scope: 'alpha',
    budget: budget({ integrations: 1, evaluations: 1 }),
  });
  await controller.admit(opened.task_ref, {
    id: 'new-source-candidate', grant_ref: nextIntegrator.grant_ref,
    actor: 'integrator', scope: 'alpha', base_commit: C,
    parents: [nextIntegrator.event_digest], kind: 'candidate',
    payload: { commit: B, artifact_sha256: D('7'), observation_receipt_sha256: D('8') },
  });
  const beforeCheckpoint = await controller.replay(opened.task_ref);
  const decision = await controller.checkpoint(opened.task_ref, {
    id: 'fresh-source-checkpoint', expected_log_head: beforeCheckpoint.log_head,
  });
  assert.equal(decision.decision, 'integrate');
});

test('an unfundable research result does not hide a fundable candidate', async t => {
  const { controller, opened } = await fixture(t, {
    limits: { max_tasks: 2, max_branches: 2, max_active_grants: 2,
      integrations: 1, evaluations: 2 },
    verifyResult: async input => researchVerdict(input, { ok: false, reason: 'inconclusive' }),
  });
  const integrator = await grant(controller, opened, {
    id: 'candidate-grant', branch: 'candidate-branch', owner: 'integrator', scope: 'alpha',
    budget: budget({ integrations: 1, evaluations: 1 }),
  });
  const beforePlan = await controller.replay(opened.task_ref);
  const planned = await controller.plan(opened.task_ref, {
    id: 'research-plan', kind: 'research', scope: 'alpha',
    deliverable: 'Check a research result', acceptance: 'Independent result check',
    source_refs: [], oracle_sha256: D('1'), budget: budget({ evaluations: 1 }),
    depends_on: [], parent_plan_ref: null, expected_log_head: beforePlan.log_head,
  });
  const beforeGrant = await controller.replay(opened.task_ref);
  const researcher = await controller.grant(opened.task_ref, {
    id: 'research-grant', plan_ref: planned.plan_ref, branch: 'research-branch',
    owner: 'researcher', scope: 'alpha', deliverable: 'Check a research result',
    base_refs: base(A, beforeGrant.log_head), budget: budget({ evaluations: 1 }),
    location: '/tmp/telepathy-research-candidate', parent_grant_ref: null,
  });
  await admit(controller, opened, integrator, 'ready-candidate', 'candidate', {
    commit: B, artifact_sha256: D('3'), observation_receipt_sha256: D('4'),
  });
  const result = await admit(controller, opened, {
    ...researcher, owner: 'researcher', scope: 'alpha',
  }, 'ready-result', 'result', {
    artifact_sha256: D('5'), evidence_receipt_sha256: D('6'), source_refs: [],
  });
  const rejected = await controller.settleResult(opened.task_ref, {
    id: 'research-rejected', grant_ref: researcher.grant_ref,
    plan_ref: planned.plan_ref, result_event: result.event_digest, expected_head: A,
  });
  assert.equal(rejected.status, 'rejected');
  const beforeCheckpoint = await controller.replay(opened.task_ref);
  const decision = await controller.checkpoint(opened.task_ref, {
    id: 'mixed-work-checkpoint', expected_log_head: beforeCheckpoint.log_head,
  });
  assert.equal(decision.inputs.pending_results, 0);
  assert.equal(decision.inputs.pending_candidates, 1);
  assert.equal(decision.decision, 'integrate');
});

test('cold replay exposes a pending research evaluation for exact host audit', async t => {
  let begin;
  const entered = new Promise(resolve => { begin = resolve; });
  let finish;
  const held = new Promise(resolve => { finish = resolve; });
  const { controller, opened, storeRoot, first, g, result } = await researchFixture(t, {
    verifyResult: async input => { begin(); await held; return researchVerdict(input); },
  });
  const pending = controller.settleResult(opened.task_ref, { id: 'research-interrupted',
    grant_ref: g.grant_ref, plan_ref: first.plan_ref, result_event: result.event_digest,
    expected_head: A });
  await entered;
  const restarted = createTaskControl({ storeRoot, allowUnsafeStoreRootForTest: true,
    auditEvaluationAbandonment: async target => ({ status: 'abandoned',
      settlement_id: target.settlement_id, intent_digest: target.intent_digest,
      receipt_sha256: D('e') }) });
  const during = await restarted.replay(opened.task_ref);
  assert.deepEqual(during.pending_evaluations, ['!result:research-interrupted']);
  assert.equal(during.grants.find(row => row.ref === g.grant_ref).left.evaluations, 1);
  const abandoned = await restarted.abandonPendingEvaluation(opened.task_ref, '!result:research-interrupted');
  assert.equal(abandoned.status, 'abandoned');
  finish();
  const stale = await pending;
  assert.equal(stale.status, 'rejected');
  assert.equal(stale.reason, 'stale-result-after-verification');
  const after = await restarted.replay(opened.task_ref);
  assert.equal(after.pending_evaluations.length, 0);
  assert.equal(after.plans.find(row => row.ref === first.plan_ref).status, 'ready');
});

test('audited abandonment of the last result evaluation releases the slot and rejects a late verdict', async t => {
  let begin;
  const entered = new Promise(resolve => { begin = resolve; });
  let finish;
  const held = new Promise(resolve => { finish = resolve; });
  const { controller, opened, storeRoot, first, second, g, result } = await researchFixture(t, {
    researchEvaluations: 1, secondDependsOnFirst: false,
    limits: { max_active_grants: 1, evaluations: 2 },
    verifyResult: async input => { begin(); await held; return researchVerdict(input); },
  });
  const pending = controller.settleResult(opened.task_ref, {
    id: 'research-last-evaluation', grant_ref: g.grant_ref, plan_ref: first.plan_ref,
    result_event: result.event_digest, expected_head: A,
  });
  await entered;
  const restarted = createTaskControl({ storeRoot, allowUnsafeStoreRootForTest: true,
    auditEvaluationAbandonment: async target => ({ status: 'abandoned',
      settlement_id: target.settlement_id, intent_digest: target.intent_digest,
      receipt_sha256: D('e') }) });
  const during = await restarted.replay(opened.task_ref);
  assert.deepEqual(during.pending_evaluations, ['!result:research-last-evaluation']);
  assert.equal(during.grants.find(row => row.ref === g.grant_ref).status, 'ready');
  const abandoned = await restarted.abandonPendingEvaluation(opened.task_ref, '!result:research-last-evaluation');
  assert.equal(abandoned.audit_receipt_sha256, D('e'));
  const after = await restarted.replay(opened.task_ref);
  assert.equal(after.pending_evaluations.length, 0);
  assert.equal(after.plans.find(row => row.ref === first.plan_ref).status, 'failed');
  assert.equal(after.grants.find(row => row.ref === g.grant_ref).status, 'failed');
  assert.equal(after.results.find(row => row.event_digest === result.event_digest).status, 'rejected');
  const checkpoint = await restarted.checkpoint(opened.task_ref, {
    id: 'after-result-audit', expected_log_head: after.log_head,
  });
  assert.equal(checkpoint.decision, 'delegate');
  assert.equal(after.plans.find(row => row.ref === second.plan_ref).status, 'planned');
  finish();
  const late = await pending;
  assert.equal(late.status, 'rejected');
  assert.equal(late.reason, 'stale-result-after-verification');
  assert.equal((await restarted.replay(opened.task_ref)).plans.find(row => row.ref === first.plan_ref).status, 'failed');
});

test('a pending result evaluation can still accept after another attempt is audited away', async t => {
  let enteredCount = 0;
  let bothEntered;
  const entered = new Promise(resolve => { bothEntered = resolve; });
  let finish;
  const held = new Promise(resolve => { finish = resolve; });
  const { controller, opened, first, g, result } = await researchFixture(t, {
    verifyResult: async input => {
      if (++enteredCount === 2) bothEntered();
      await held;
      return researchVerdict(input);
    },
    auditEvaluationAbandonment: async target => ({ status: 'abandoned',
      settlement_id: target.settlement_id, intent_digest: target.intent_digest,
      receipt_sha256: D('e') }),
  });
  const firstAttempt = controller.settleResult(opened.task_ref, {
    id: 'attempt-one', grant_ref: g.grant_ref, plan_ref: first.plan_ref,
    result_event: result.event_digest, expected_head: A,
  });
  const secondAttempt = controller.settleResult(opened.task_ref, {
    id: 'attempt-two', grant_ref: g.grant_ref, plan_ref: first.plan_ref,
    result_event: result.event_digest, expected_head: A,
  });
  await entered;
  const during = await controller.replay(opened.task_ref);
  assert.equal(during.grants.find(row => row.ref === g.grant_ref).left.evaluations, 0);
  await controller.abandonPendingEvaluation(opened.task_ref, '!result:attempt-one');
  const afterAudit = await controller.replay(opened.task_ref);
  assert.deepEqual(afterAudit.pending_evaluations, ['!result:attempt-two']);
  assert.equal(afterAudit.grants.find(row => row.ref === g.grant_ref).status, 'ready');
  assert.equal(afterAudit.results.find(row => row.event_digest === result.event_digest).status, 'ready');
  finish();
  assert.equal((await firstAttempt).status, 'rejected');
  assert.equal((await secondAttempt).status, 'accepted');
  const after = await controller.replay(opened.task_ref);
  assert.equal(after.plans.find(row => row.ref === first.plan_ref).status, 'accepted');
  assert.equal(after.results.find(row => row.event_digest === result.event_digest).status, 'accepted');
});

test('DSH child adapter verifies isolated jj base, logs intent, and calls ctx.agents.create outside task lock', async t => {
  const rootCwd = await mkdtemp(path.join(os.tmpdir(), 'telepathy-root-jj-'));
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'telepathy-child-jj-'));
  t.after(() => rm(rootCwd, { recursive: true, force: true }));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  execFileSync('jj', ['git', 'init', '--no-colocate', rootCwd], { encoding: 'utf8' });
  execFileSync('jj', ['git', 'init', '--no-colocate', cwd], { encoding: 'utf8' });
  const initialHead = execFileSync('jj', ['--ignore-working-copy', 'log', '-r', '@-', '--no-graph', '-T', 'commit_id'],
    { cwd, encoding: 'utf8' }).trim();
  const { controller, opened } = await fixture(t, { initialHead, setupChild: () => async () => {} });
  const parent = await grant(controller, opened, { id: 'parent-grant', branch: 'parent',
    owner: 'integrator', scope: 'alpha', location: rootCwd, budget: budget({ children: 1 }) });
  const parentSession = { id: 'parent-session', header: { origin: 'user',
    cwd: await import('node:fs/promises').then(fs => fs.realpath(rootCwd)) } };
  const parentAgent = { session: parentSession };
  const calls = [];
  const boundChildren = [];
  const ctx = { get: key => key === 'telepathyToolBoundary'
    ? { bindChildWorkspace: (agent, granted) => boundChildren.push({ agent, granted }) } : null,
  sessions: { get: id => id === parentSession.id ? parentSession : null },
  agents: { create: async options => {
    const agent = { session: { id: options.sessionId, header: options.meta } };
    await options.setup({}, agent);
    calls.push(options);
    return { agent, dispose: async () => {} };
  } } };
  await controller.bindRootSession(opened.task_ref, { id: 'bind-parent', grant_ref: parent.grant_ref,
    session_id: parentSession.id }, ctx);
  const before = await controller.replay(opened.task_ref);
  const plan = await controller.plan(opened.task_ref, { id: 'child-plan', kind: 'implementation', scope: 'alpha',
    deliverable: 'Implement branch in isolated jj workspace', acceptance: 'Independent evaluator accepts combined revision',
    source_refs: [], oracle_sha256: D('1'), budget: budget(), depends_on: [], parent_plan_ref: null,
    expected_log_head: before.log_head });
  const after = await controller.replay(opened.task_ref);
  const g = await controller.grant(opened.task_ref, { id: 'child-grant', plan_ref: plan.plan_ref,
    branch: 'isolated', owner: 'child-worker', scope: 'alpha',
    deliverable: 'Implement branch in isolated jj workspace', base_refs: base(initialHead, after.log_head),
    budget: budget(), location: cwd, parent_grant_ref: parent.grant_ref });
  await assert.rejects(controller.startChild(opened.task_ref, { id: 'unowned-child', grant_ref: g.grant_ref,
    session_id: 'unowned-session', parent_session: 'parent-session' }, ctx), /matching live DSH parent/);
  assert.equal(calls.length, 0);
  const start = await controller.startChild(opened.task_ref, { id: 'start-isolated', grant_ref: g.grant_ref,
    session_id: 'child-session', parent_session: 'parent-session' }, ctx, { parentAgent });
  assert.equal(start.status, 'started');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].meta.cwd, await import('node:fs/promises').then(fs => fs.realpath(cwd)));
  assert.equal(calls[0].meta.parentSession, 'parent-session');
  assert.equal(calls[0].parentAgent, parentAgent);
  assert.equal(calls[0].meta.delegationDepth, 1);
  assert.equal(calls[0].agentOptions.provider, 'deepseek-official');
  assert.equal(calls[0].agentOptions.model, 'deepseek-flash');
  assert.equal(boundChildren.length, 1);
  assert.equal(boundChildren[0].granted.ref, g.grant_ref);
  assert.equal(boundChildren[0].agent.session.id, 'child-session');
  assert.equal((await controller.replay(opened.task_ref)).grants.find(row => row.ref === g.grant_ref).session_id, 'child-session');
  assert.equal((await controller.startChild(opened.task_ref, { id: 'start-isolated', grant_ref: g.grant_ref,
    session_id: 'child-session', parent_session: 'parent-session' }, ctx, { parentAgent })).status, 'already-started');
  assert.equal(calls.length, 1);
});

test('host audit closes an interrupted child intent and disposes a late handle', async t => {
  let entered;
  const creating = new Promise(resolve => { entered = resolve; });
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let disposed = false;
  const { controller, opened } = await fixture(t, {
    inspectWorkspace: async grant => grant.location, setupChild: () => async () => {},
    auditChildAbsence: async ({ session_id, intent_digest }) => ({ status: 'absent',
      session_id, intent_digest, receipt_sha256: D('a') }),
  });
  const parent = await grant(controller, opened, { id: 'pending-parent', branch: 'pending-parent',
    owner: 'integrator', scope: 'alpha', location: '/tmp/parent-host-test',
    budget: budget({ children: 1 }) });
  const g = await grant(controller, opened, { id: 'pending-child', branch: 'pending-child',
    owner: 'child-worker', scope: 'alpha', location: '/tmp/isolated-child-test',
    parent_grant_ref: parent.grant_ref });
  const parentSession = { id: 'live-parent', header: { origin: 'user', cwd: '/tmp/parent-host-test' } };
  const parentAgent = { session: parentSession };
  const ctx = { get: key => key === 'telepathyToolBoundary' ? { bindChildWorkspace: () => {} } : null,
    sessions: { get: id => id === parentSession.id ? parentSession : null },
    agents: { create: async () => { entered(); await held; return { dispose: async () => { disposed = true; } }; } } };
  await controller.bindRootSession(opened.task_ref, { id: 'bind-pending-parent', grant_ref: parent.grant_ref,
    session_id: parentSession.id }, ctx);
  const start = controller.startChild(opened.task_ref, { id: 'pending-start', grant_ref: g.grant_ref,
    session_id: 'late-child', parent_session: 'live-parent' }, ctx, { parentAgent });
  await creating;
  const abandoned = await controller.abandonPendingChild(opened.task_ref, g.grant_ref);
  assert.equal(abandoned.status, 'failed');
  release();
  await assert.rejects(start, /child intent changed before publication/);
  assert.equal(disposed, true);
  const latest = await controller.replay(opened.task_ref);
  assert.equal(latest.grants.find(row => row.ref === g.grant_ref).status, 'failed');
  assert.equal(latest.grants.find(row => row.ref === g.grant_ref).pending_session_id, undefined);
});

test('combined verifier adapter requires root gate and separate pinned host evaluator', async t => {
  let independentCalls = 0;
  const frozen = spec();
  const comparison = await goalComparison(t, frozen);
  const goal_context = { causal_cut: D('b'), accepted_results: [],
    other_pending_evaluations: 0 };
  const verifier = createJjCombinedVerifier({ repoRoot: process.cwd(),
    freshComparisonRoot: comparison.root,
    allowMockGateRunnerForTest: true,
    reconcile: async input => ({ commit: C, base_commit: input.expected_head,
      candidate_events: input.candidates.map(row => row.event_digest), ancestry_ok: true, conflicts_resolved: true }),
    gateRunner: async revision => ({ commit_id: revision, ok: true, gate: 'node scripts/check.mjs --require-dsh' }),
    evaluateIndependent: async ({ combined_commit, goal_binding }) => { independentCalls++;
      const goal_evidence = { schema: 'telepathy.goal-evaluation/v1',
        binding: goal_binding,
        fresh_clone_receipt_sha256: comparison.comparisonSha,
        case_count: 1, passed_count: 1, hard_constraints_passed: true,
        unsupported_claims: 0, counterexamples: 0 };
      return { ok: combined_commit === C, task_accepted: true,
        receipt_sha256: D('8'), goal_evidence,
        evaluator_sha256: frozen.pinned_versions.evaluator_sha256,
        case_set_sha256: frozen.pinned_versions.case_set_sha256,
        toolchain: frozen.pinned_versions.toolchain }; },
  });
  const checked = await verifier({ task_ref: D('0'), spec: frozen, expected_head: A,
    candidates: [{ event_digest: D('a') }], integration_grant: {}, goal_context });
  assert.equal(checked.ok, true);
  assert.equal(checked.checked_commit, C);
  assert.equal(checked.gate.revision, C);
  assert.equal(checked.receipt_sha256, D('8'));
  assert.equal(checked.goal_evidence_sha256, sha(canonical(checked.goal_evidence)));
  assert.equal(independentCalls, 1);
  const failGate = createJjCombinedVerifier({ repoRoot: process.cwd(),
    allowMockGateRunnerForTest: true,
    reconcile: async input => ({ commit: C, base_commit: input.expected_head,
      candidate_events: input.candidates.map(row => row.event_digest), ancestry_ok: true, conflicts_resolved: true }),
    gateRunner: async () => { throw new Error('check failed'); },
    evaluateIndependent: async () => { throw new Error('must not run'); },
  });
  const rejected = await failGate({ task_ref: D('0'), spec: frozen, expected_head: A,
    candidates: [{ event_digest: D('a') }], integration_grant: {}, goal_context });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, 'exact-revision-gate-failed');
});

test('whole-goal evidence rejects changed bindings, failed cases, and unresolved evaluations', async t => {
  const frozen = spec();
  const comparison = await goalComparison(t, frozen);
  let alter = evidence => evidence;
  const verifier = createJjCombinedVerifier({ repoRoot: process.cwd(),
    freshComparisonRoot: comparison.root,
    allowMockGateRunnerForTest: true,
    reconcile: async input => ({ commit: C, base_commit: input.expected_head,
      candidate_events: input.candidates.map(row => row.event_digest),
      ancestry_ok: true, conflicts_resolved: true }),
    gateRunner: async revision => ({ commit_id: revision, ok: true,
      gate: 'node scripts/check.mjs --require-dsh' }),
    evaluateIndependent: async ({ goal_binding }) => {
      const goal_evidence = alter({ schema: 'telepathy.goal-evaluation/v1',
        binding: goal_binding,
        fresh_clone_receipt_sha256: comparison.comparisonSha,
        case_count: 1, passed_count: 1, hard_constraints_passed: true,
        unsupported_claims: 0, counterexamples: 0 });
      return { ok: true, task_accepted: true, goal_evidence,
        receipt_sha256: D('8'),
        evaluator_sha256: frozen.pinned_versions.evaluator_sha256,
        case_set_sha256: frozen.pinned_versions.case_set_sha256,
        toolchain: frozen.pinned_versions.toolchain };
    } });
  const input = { task_ref: D('0'), spec: frozen, expected_head: A,
    candidates: [{ event_digest: D('a') }], integration_grant: {},
    goal_context: { causal_cut: D('b'), accepted_results: [],
      other_pending_evaluations: 0 } };
  for (const [change, reason] of [
    [evidence => ({ ...evidence, binding: { ...evidence.binding,
      combined_commit: B } }), /differs from frozen task/],
    [evidence => ({ ...evidence, passed_count: 0 }), /does not support/],
    [evidence => ({ ...evidence, unsupported_claims: 1 }), /does not support/],
    [evidence => ({ ...evidence, hard_constraints_passed: false }), /does not support/],
  ]) {
    alter = change;
    await assert.rejects(verifier(input), reason);
  }
  alter = evidence => evidence;
  await assert.rejects(verifier({ ...input, goal_context: {
    ...input.goal_context, other_pending_evaluations: 1 } }),
  /unresolved evaluations/);
  alter = evidence => ({ ...evidence, fresh_clone_receipt_sha256: D('f') });
  await assert.rejects(verifier(input), /fresh comparison receipt is unavailable/);
});

test('settlement binds accepted source receipts to the frozen goal and causal cut', async t => {
  let seen;
  const comparison = await goalComparison(t);
  const verifier = createJjCombinedVerifier({ repoRoot: process.cwd(),
    freshComparisonRoot: comparison.root,
    allowMockGateRunnerForTest: true,
    reconcile: async input => ({ commit: C, base_commit: input.expected_head,
      candidate_events: input.candidates.map(row => row.event_digest),
      ancestry_ok: true, conflicts_resolved: true }),
    gateRunner: async revision => ({ commit_id: revision, ok: true,
      gate: 'node scripts/check.mjs --require-dsh' }),
    evaluateIndependent: async ({ goal_binding, goal_context, spec: frozen }) => {
      seen = { goal_binding, goal_context };
      const goal_evidence = { schema: 'telepathy.goal-evaluation/v1',
        binding: goal_binding,
        fresh_clone_receipt_sha256: comparison.comparisonSha,
        case_count: 1, passed_count: 1, hard_constraints_passed: true,
        unsupported_claims: 0, counterexamples: 0 };
      return { ok: true, task_accepted: true, goal_evidence,
        receipt_sha256: D('8'),
        evaluator_sha256: frozen.pinned_versions.evaluator_sha256,
        case_set_sha256: frozen.pinned_versions.case_set_sha256,
        toolchain: frozen.pinned_versions.toolchain };
    } });
  const { controller, opened } = await fixture(t, { verifyCombined: verifier,
    verifyResult: async input => researchVerdict(input) });
  const source = await settledSource(controller, opened, 'alpha', 'goal-source');
  const integrator = await grant(controller, opened, { id: 'goal-integration',
    branch: 'goal-integration', owner: 'integrator', scope: 'beta',
    budget: budget({ integrations: 1, evaluations: 1 }) });
  const candidate = await admit(controller, opened, integrator, 'goal-candidate',
    'candidate', { commit: B, artifact_sha256: D('3'),
      observation_receipt_sha256: D('4') });
  const settlement = await controller.settle(opened.task_ref, {
    id: 'goal-settlement', integration_grant_ref: integrator.grant_ref,
    expected_head: A, candidate_events: [candidate.event_digest] });
  assert.equal(settlement.task_accepted, true);
  assert.equal(settlement.receipt_sha256, D('8'));
  assert.equal(settlement.goal_receipt_sha256,
    (await controller.replay(opened.task_ref)).terminal.goal_receipt_sha256);
  assert.equal((await controller.replay(opened.task_ref)).terminal.reason,
    'verified-acceptance');
  assert.equal(seen.goal_binding.task_ref, opened.task_ref);
  assert.equal(seen.goal_binding.goal_sha256, sha(spec().goal));
  assert.equal(seen.goal_binding.accepted_result_count, 1);
  assert.equal(seen.goal_binding.accepted_results_sha256,
    sha(canonical(seen.goal_context.accepted_results)));
  assert.equal(seen.goal_context.accepted_results[0].event_digest,
    source.result.event_digest);
  assert.equal(seen.goal_context.accepted_results[0].verifier_receipt_sha256,
    source.settled.receipt_sha256);
  assert.equal(seen.goal_context.other_pending_evaluations, 0);
  assert.match(seen.goal_binding.causal_cut, /^[a-f0-9]{64}$/);
});

test('whole-goal acceptance rejects a task-log change during independent evaluation', async t => {
  let controller;
  const comparison = await goalComparison(t);
  const verifier = createJjCombinedVerifier({ repoRoot: process.cwd(),
    freshComparisonRoot: comparison.root,
    allowMockGateRunnerForTest: true,
    reconcile: async input => ({ commit: C, base_commit: input.expected_head,
      candidate_events: input.candidates.map(row => row.event_digest),
      ancestry_ok: true, conflicts_resolved: true }),
    gateRunner: async revision => ({ commit_id: revision, ok: true,
      gate: 'node scripts/check.mjs --require-dsh' }),
    evaluateIndependent: async ({ goal_binding, spec: frozen }) => {
      const current = await controller.replay(goal_binding.task_ref);
      await controller.plan(goal_binding.task_ref, { id: 'concurrent-goal-plan',
        kind: 'analysis', scope: 'alpha', deliverable: 'Inspect newly found evidence',
        acceptance: 'Independent check', source_refs: [], oracle_sha256: D('1'),
        budget: budget(), depends_on: [], parent_plan_ref: null,
        expected_log_head: current.log_head });
      const goal_evidence = { schema: 'telepathy.goal-evaluation/v1',
        binding: goal_binding,
        fresh_clone_receipt_sha256: comparison.comparisonSha,
        case_count: 1, passed_count: 1, hard_constraints_passed: true,
        unsupported_claims: 0, counterexamples: 0 };
      return { ok: true, task_accepted: true, goal_evidence,
        receipt_sha256: sha(canonical(goal_evidence)),
        evaluator_sha256: frozen.pinned_versions.evaluator_sha256,
        case_set_sha256: frozen.pinned_versions.case_set_sha256,
        toolchain: frozen.pinned_versions.toolchain };
    } });
  const checked = await fixture(t, { verifyCombined: verifier });
  controller = checked.controller;
  const integration = await grant(controller, checked.opened, {
    id: 'raced-goal-integration', branch: 'raced-goal-integration',
    owner: 'integrator', scope: 'alpha',
    budget: budget({ integrations: 1, evaluations: 1 }) });
  const candidate = await admit(controller, checked.opened, integration,
    'raced-goal-candidate', 'candidate', { commit: B,
      artifact_sha256: D('3'), observation_receipt_sha256: D('4') });
  const result = await controller.settle(checked.opened.task_ref, {
    id: 'raced-goal-settlement', integration_grant_ref: integration.grant_ref,
    expected_head: A, candidate_events: [candidate.event_digest] });
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'stale-head-after-verification');
  assert.equal(result.task_accepted, false);
  const current = await controller.replay(checked.opened.task_ref);
  assert.equal(current.task_head, A);
  assert.equal(current.terminal, null);
});

test('production source settlement rejects unbranded and implicit mock gate verifiers', () => {
  // A jj-run --clean check can put HOME under the temporary tree, so choose a
  // path that remains outside it without creating any state there.
  const production = { storeRoot: path.join(path.parse(process.cwd()).root,
    'telepathy-task-control-adapter-contract'), workspaceRoot: process.cwd() };
  const forged = Object.assign(async () => ({ ok: true }), {
    checked_jj_gate: true, gate: 'node scripts/check.mjs --require-dsh' });
  assert.throws(() => createTaskControl({ ...production, verifyCombined: forged }),
    /production source settlement requires the checked jj verifier adapter/);
  const adapterSettings = { repoRoot: process.cwd(),
    reconcile: async () => { throw new Error('not called'); },
    evaluateIndependent: async () => { throw new Error('not called'); } };
  assert.throws(() => createJjCombinedVerifier({ ...adapterSettings,
    gateRunner: async () => ({ ok: true }) }),
  /injected jj gate runner requires an explicit test-only setting/);
  const mockAdapter = createJjCombinedVerifier({ ...adapterSettings,
    allowMockGateRunnerForTest: true, gateRunner: async () => ({ ok: true }) });
  assert.throws(() => createTaskControl({ ...production, verifyCombined: mockAdapter }),
    /production source settlement requires the checked jj verifier adapter/);
  assert.throws(() => createTaskControl({ storeRoot: path.join(os.tmpdir(),
    'telepathy-temporary-unbranded-verifier'), allowUnsafeStoreRootForTest: true,
    verifyCombined: mockAdapter }),
  /production source settlement requires the checked jj verifier adapter/);
  assert.throws(() => createTaskControl({ ...production,
    allowUnsafeStoreRootForTest: true, verifyCombined: mockAdapter }),
  /test-only unsafe task store must remain under the temporary root/);
  const previousTmpdir = process.env.TMPDIR;
  try {
    process.env.TMPDIR = path.parse(process.cwd()).root;
    assert.throws(() => createTaskControl({ ...production,
      allowUnsafeStoreRootForTest: true, verifyCombined: mockAdapter }),
    /test-only unsafe task store must remain under the temporary root/);
  } finally {
    if (previousTmpdir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previousTmpdir;
  }
  assert.throws(() => createTaskControl({ ...production,
    allowSyntheticCombinedVerifierForTest: true, verifyCombined: mockAdapter }),
  /synthetic combined verifier requires a temporary test store/);
  assert.throws(() => createJjCombinedVerifier(adapterSettings),
    /trustedReleaseRoot is required for the production jj gate/);
  assert.throws(() => createJjCombinedVerifier({ ...adapterSettings,
    trustedReleaseRoot: '/checked-release', env: { PATH: '/tmp/fake-jj' } }),
  /caller-supplied jj gate environment is forbidden/);
  const adapter = createJjCombinedVerifier({ ...adapterSettings,
    trustedReleaseRoot: '/checked-release' });
  assert.doesNotThrow(() => createTaskControl({ ...production, verifyCombined: adapter }));
});

test('production gate adapter fails closed when the checked release is absent', async () => {
  let independentCalls = 0;
  const verifier = createJjCombinedVerifier({ repoRoot: process.cwd(),
    trustedReleaseRoot: '/nonexistent-telepathy-checked-release',
    reconcile: async input => ({ commit: C, base_commit: input.expected_head,
      candidate_events: input.candidates.map(row => row.event_digest),
      ancestry_ok: true, conflicts_resolved: true }),
    evaluateIndependent: async () => { independentCalls++; throw new Error('must not run'); } });
  const result = await verifier({ task_ref: D('0'), spec: spec(), expected_head: A,
    candidates: [{ event_digest: D('a') }], integration_grant: {},
    goal_context: { causal_cut: D('b'), accepted_results: [],
      other_pending_evaluations: 0 } });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'exact-revision-gate-failed');
  assert.equal(independentCalls, 0);
});

test('opt-in 10,000 logical task DAG with one active DSH grant', { skip: process.env.TELEPATHY_STRESS_10K !== '1' }, async t => {
  const { controller, opened, storeRoot } = await fixture(t, { limits: {
    max_tasks: 10_000, max_branches: 2, max_active_grants: 1,
    max_depth: 0, tokens: 20_000_000, fuel: 20_000,
    integrations: 1, evaluations: 1,
  } });
  let causalCut = opened.log_head;
  let firstPlan = null;
  let previousPlan = null;
  const start = performance.now();
  for (let i = 0; i < 10_000; i++) {
    const planned = await controller.plan(opened.task_ref, {
      id: `logical-${i}`, kind: 'research', scope: 'alpha', deliverable: `Resolve question ${i}`,
      acceptance: `Independent oracle confirms question ${i}`,
      source_refs: [], oracle_sha256: D('1'), budget: budget({ tokens: 100, fuel: 1 }),
      depends_on: previousPlan ? [previousPlan] : [], parent_plan_ref: null,
      expected_log_head: causalCut,
    });
    if (i === 0) firstPlan = planned.plan_ref;
    previousPlan = planned.plan_ref;
    causalCut = planned.log_head;
  }
  const writeMs = Math.round(performance.now() - start);
  const restart = createTaskControl({ storeRoot, allowUnsafeStoreRootForTest: true });
  const replayStart = performance.now();
  const snapshot = await restart.replay(opened.task_ref);
  const replayMs = Math.round(performance.now() - replayStart);
  assert.equal(snapshot.plans.length, 10_000);
  assert.equal(snapshot.remaining.tasks, 0);
  const beforeGrant = await restart.checkpoint(opened.task_ref, { id: 'stress-checkpoint', expected_log_head: causalCut });
  assert.equal(beforeGrant.decision, 'delegate');
  const current = await restart.replay(opened.task_ref);
  const g = await restart.grant(opened.task_ref, {
    id: 'stress-grant', plan_ref: firstPlan, branch: 'stress', owner: 'integrator', scope: 'alpha',
    deliverable: 'Resolve question 0', base_refs: base(A, current.log_head),
    budget: budget({ tokens: 100, fuel: 1 }), location: '/tmp/telepathy-stress', parent_grant_ref: null,
  });
  const viewStart = performance.now();
  const view = await restart.view(opened.task_ref, 'integrator', null, 4096);
  const viewMs = Math.round(performance.now() - viewStart);
  assert.equal(snapshot.events.length, 10_001);
  assert.equal(view.assignments.length, 1);
  assert.equal(view.assignments[0].plan_ref, firstPlan);
  assert.equal(view.used <= 4096, true);
  assert.equal((await restart.replay(opened.task_ref)).grants.length, 1);
  assert.match(g.grant_ref, /^[a-f0-9]{64}$/);
  t.diagnostic(JSON.stringify({ logical_tasks: 10_000, write_ms: writeMs, cold_replay_ms: replayMs,
    bounded_view_ms: viewMs, active_grants: 1, worker_sessions_spawned: 0 }));
});
