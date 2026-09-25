import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createArchivedDelegationEvidence } from './delegation-evidence.mjs';
import { recommendWidth } from './delegation-governor.mjs';
import { createTaskControl } from './task-control.mjs';
import { createTaskProgram } from './task-program.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const EVALUATOR = '1'.repeat(64);
const CASES = '2'.repeat(64);
const BUDGET = 48;

async function archived(root, subdir, value) {
  const bytes = `${JSON.stringify(value, function (key, inner) {
    if (!inner || typeof inner !== 'object' || Array.isArray(inner)) return inner;
    return Object.fromEntries(Object.entries(inner).sort(([a], [b]) => a.localeCompare(b)));
  })}\n`;
  const digest = sha(bytes);
  await writeFile(path.join(root, subdir, `${digest}.json`), bytes, { mode: 0o600 });
  return digest;
}

async function fixture(t, episodeCount = 4) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'delegation-evidence-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const dir of ['trials', 'verdicts', 'compute'])
    await mkdir(path.join(root, dir), { mode: 0o700 });
  const taskRef = sha('current task');
  const cut = sha('current causal cut');
  const source = new Map();
  const meterDigests = new Set();
  const episodes = [];
  for (let index = 0; index < episodeCount; index++) {
    const id = `episode-${index}`;
    const taskSet = sha(`frozen task set ${index}`);
    const refs = [];
    for (const width of [1, 2]) {
      const sourceTask = sha(`source task ${index}:${width}`);
      const settlement = sha(`settlement ${index}:${width}`);
      const verdict = { schema: 1, source: 'independent-verifier',
        trial_id: id, width, task_set_sha256: taskSet,
        evaluator_sha256: EVALUATOR, case_set_sha256: CASES,
        budget_units: BUDGET, source_task_ref: sourceTask,
        verified_gain: width === 1 ? 3 : 6,
        unsupported_claims: 0, regressions: 0, unsettled_verdicts: 0 };
      const verdictSha = await archived(root, 'verdicts', verdict);
      const meterSha = sha(`real meter ${index}:${width}`);
      meterDigests.add(meterSha);
      const compute = { schema: 1, source: 'host-meter', trial_id: id, width,
        task_set_sha256: taskSet, evaluator_sha256: EVALUATOR,
        case_set_sha256: CASES, budget_units: BUDGET,
        source_task_ref: sourceTask, source_settlement_event: settlement,
        worker_compute: width === 1 ? 30 : 32,
        verifier_compute: 6, integration_compute: 2, coordination_compute: 0,
        meter_receipt_sha256: meterSha };
      const computeSha = await archived(root, 'compute', compute);
      refs.push({ width, verdict_sha256: verdictSha,
        compute_sha256: computeSha, source_settlement_event: settlement });
      source.set(sourceTask, { task_ref: sourceTask,
        spec: { policy_version: `delegation-trial:${taskSet}:${width}:${BUDGET}`,
          pinned_versions: { evaluator_sha256: EVALUATOR,
          case_set_sha256: CASES, toolchain: 'keyless-test' } },
        events: [{ type: 'result_settled', digest: settlement,
          result: { status: 'accepted', receipt_sha256: verdictSha } }] });
    }
    episodes.push({ id, task_set_sha256: taskSet, receipts: refs });
  }
  const manifest = { schema: 1, task_family_sha256: sha('family'),
    evaluator_sha256: EVALUATOR, case_set_sha256: CASES,
    toolchain: 'keyless-test', budget_units: BUDGET, episodes };
  const manifestSha = await archived(root, 'trials', manifest);
  let capacity = { task_ref: taskRef, causal_cut: cut,
    observed_at_ms: 100_000, window_ms: 3_600_000,
    worker_completed: 1, verifier_completed: 4, integration_completed: 4,
    provider_slots: 4, workspace_slots: 4,
    verifier_backlog: 0, integration_backlog: 0, unknown_verdicts: 0 };
  const plans = Array.from({ length: 4 }, (_, i) => ({ ref: sha(`plan-${i}`),
    id: `plan-${i}`, kind: 'research', status: 'planned', depends_on: [],
    budget: { tokens: 100, fuel: 2, children: 0,
      integrations: 0, evaluations: 0 } }));
  const input = { task_ref: taskRef, causal_cut: cut,
    evaluator_sha256: EVALUATOR, case_set_sha256: CASES,
    active_grants: [], eligible_plans: plans, eligible_total: 4,
    pending_evaluations: [], remaining: { tasks: 0, branches: 4,
      tokens: 1000, fuel: 100, integrations: 1, evaluations: 1 } };
  const current = { task_ref: taskRef, log_head: cut,
    spec: { policy_version: `delegation:${manifestSha}`,
      pinned_versions: { evaluator_sha256: EVALUATOR,
        case_set_sha256: CASES, toolchain: 'keyless-test' } },
    terminal: null, grants: [], plans,
    pending_evaluations: [], remaining: input.remaining };
  const replayed = new Map([...source, [taskRef, current]]);
  const settings = { archiveRoot: root, manifestSha256: manifestSha,
    taskFamilySha256: sha('family'),
    controller: { replay: async ref => replayed.get(ref) },
    confirmCompute: async receipt => meterDigests.has(receipt.meter_receipt_sha256),
    observeCapacity: async () => capacity,
    independentPlans: async ({ eligible_plans }) => eligible_plans.map(plan => plan.ref),
    allowUnsafeArchiveForTest: true, now: () => 100_001 };
  return { root, input, manifest, manifestSha, settings, source, current,
    getCapacity: () => capacity, setCapacity: value => { capacity = value; } };
}

test('host archive authenticates four paired episodes and survives a cold adapter restart', async t => {
  const f = await fixture(t);
  const first = await createArchivedDelegationEvidence(f.settings)(f.input);
  assert.equal(first.episodes.length, 4);
  assert.equal(first.independent_plan_refs.length, 4);
  assert.equal(first.capacity.worker_rate, 1);
  assert.equal(recommendWidth(first).width, 2);
  assert.deepEqual(await createArchivedDelegationEvidence(f.settings)(f.input), first);
});

test('a pinned manifest with no completed real pairs leaves width at one', async t => {
  const f = await fixture(t, 0);
  f.setCapacity({ ...f.getCapacity(), worker_completed: 0,
    verifier_completed: 0, integration_completed: 0 });
  const evidence = await createArchivedDelegationEvidence(f.settings)(f.input);
  assert.deepEqual(evidence.episodes, []);
  assert.equal(evidence.capacity.worker_rate, 0);
  assert.equal(recommendWidth(evidence).width, 1);
});

test('source task must contain the exact accepted independent verdict receipt', async t => {
  const f = await fixture(t);
  const ref = f.manifest.episodes[0].receipts[0];
  const verdict = JSON.parse(await readFile(path.join(f.root, 'verdicts',
    `${ref.verdict_sha256}.json`), 'utf8'));
  f.source.get(verdict.source_task_ref).events[0].result.status = 'rejected';
  await assert.rejects(createArchivedDelegationEvidence(f.settings)(f.input),
    /independent verdict is absent/);
});

test('unconfirmed compute or tampered content-addressed archive cannot widen', async t => {
  const f = await fixture(t);
  await assert.rejects(createArchivedDelegationEvidence({ ...f.settings,
    confirmCompute: async () => false })(f.input), /meter did not authenticate/);
  const file = path.join(f.root, 'compute',
    `${f.manifest.episodes[0].receipts[0].compute_sha256}.json`);
  await writeFile(file, '{}\n');
  await assert.rejects(createArchivedDelegationEvidence(f.settings)(f.input),
    /differs from pinned digest/);
});

test('matched evaluator, case set, budget, source settlement and unique receipts are required', async t => {
  const f = await fixture(t);
  await assert.rejects(createArchivedDelegationEvidence({ ...f.settings,
    taskFamilySha256: sha('wrong family') })(f.input), /frozen task family/);
  const wrong = { ...f.input, evaluator_sha256: '9'.repeat(64) };
  await assert.rejects(createArchivedDelegationEvidence(f.settings)(wrong),
    /task snapshot or frozen trial policy differs/);
  f.manifest.episodes[1].receipts[0].verdict_sha256 =
    f.manifest.episodes[0].receipts[0].verdict_sha256;
  const nextManifest = await archived(f.root, 'trials', f.manifest);
  f.current.spec.policy_version = `delegation:${nextManifest}`;
  await assert.rejects(createArchivedDelegationEvidence({ ...f.settings,
    manifestSha256: nextManifest })(f.input), /trial receipt is reused/);
});

test('source task freezes the exact task set, width, and budget before settlement', async t => {
  const f = await fixture(t);
  const ref = f.manifest.episodes[0].receipts[0];
  const verdict = JSON.parse(await readFile(path.join(f.root, 'verdicts',
    `${ref.verdict_sha256}.json`), 'utf8'));
  f.source.get(verdict.source_task_ref).spec.policy_version =
    `delegation-trial:${sha('different task set')}:1:${BUDGET}`;
  await assert.rejects(createArchivedDelegationEvidence(f.settings)(f.input),
    /different pinned inputs/);
  f.source.get(verdict.source_task_ref).spec.policy_version =
    `delegation-trial:${f.manifest.episodes[0].task_set_sha256}:1:${BUDGET}`;
  f.manifest.budget_units = BUDGET - 1;
  const nextManifest = await archived(f.root, 'trials', f.manifest);
  f.current.spec.policy_version = `delegation:${nextManifest}`;
  await assert.rejects(createArchivedDelegationEvidence({ ...f.settings,
    manifestSha256: nextManifest })(f.input), /differs from frozen paired trial/);
});

test('capacity is current at the exact causal cut; backlog and uncertainty hold width', async t => {
  const f = await fixture(t);
  f.setCapacity({ ...f.getCapacity(), observed_at_ms: 1 });
  await assert.rejects(createArchivedDelegationEvidence(f.settings)(f.input),
    /capacity observation is stale/);
  f.setCapacity({ ...f.getCapacity(), observed_at_ms: 100_000,
    verifier_backlog: 3 });
  const backlog = await createArchivedDelegationEvidence(f.settings)(f.input);
  assert.equal(recommendWidth(backlog).width, 1);
  f.setCapacity({ ...f.getCapacity(), unknown_verdicts: 1 });
  const uncertain = await createArchivedDelegationEvidence(f.settings)(f.input);
  assert.equal(recommendWidth(uncertain).width, 0);
  f.setCapacity({ ...f.getCapacity(), unknown_verdicts: 0,
    causal_cut: sha('a different causal cut') });
  await assert.rejects(createArchivedDelegationEvidence(f.settings)(f.input),
    /different task or causal cut/);
});

test('missing measurements and unapproved independent plan refs fail closed', async t => {
  const f = await fixture(t);
  await assert.rejects(createArchivedDelegationEvidence({ ...f.settings,
    observeCapacity: async () => ({ ...f.getCapacity(), worker_completed: undefined }) })(f.input),
  /measured worker completions/);
  await assert.rejects(createArchivedDelegationEvidence({ ...f.settings,
    independentPlans: async () => [sha('ineligible plan')] })(f.input),
  /ineligible or duplicate plan/);
});

test('selected independent plans are bounded by exact remaining grant budgets', async t => {
  const f = await fixture(t);
  const input = { ...f.input, remaining: { ...f.input.remaining,
    branches: 4, tokens: 150 } };
  f.current.remaining = input.remaining;
  const evidence = await createArchivedDelegationEvidence(f.settings)(input);
  assert.deepEqual(evidence.independent_plan_refs, [input.eligible_plans[0].ref]);
  assert.equal(evidence.capacity.funded_grants, 1);
  assert.equal(recommendWidth(evidence).width, 1);
  const byEvaluation = { ...f.input,
    eligible_plans: f.input.eligible_plans.map(plan => ({ ...plan,
      budget: { ...plan.budget, evaluations: 1 } })),
    remaining: { ...f.input.remaining, evaluations: 2 } };
  f.current.plans = byEvaluation.eligible_plans;
  f.current.remaining = byEvaluation.remaining;
  const checked = await createArchivedDelegationEvidence(f.settings)(byEvaluation);
  assert.equal(checked.independent_plan_refs.length, 2);
  assert.equal(checked.capacity.funded_grants, 2);
});

test('request budgets and visible plans must equal the exact replayed causal state', async t => {
  const f = await fixture(t);
  await assert.rejects(createArchivedDelegationEvidence(f.settings)({ ...f.input,
    remaining: { ...f.input.remaining, tokens: f.input.remaining.tokens + 1 } }),
  /differs from the replayed task state/);
  await assert.rejects(createArchivedDelegationEvidence(f.settings)({ ...f.input,
    eligible_plans: f.input.eligible_plans.slice(1), eligible_total: 4 }),
  /plans or active grants differ/);
});

test('current task cannot attest to its own prior trial and temporary archives are test-only', async t => {
  const f = await fixture(t);
  const ref = f.manifest.episodes[0].receipts[0];
  const verdict = JSON.parse(await readFile(path.join(f.root, 'verdicts',
    `${ref.verdict_sha256}.json`), 'utf8'));
  verdict.source_task_ref = f.input.task_ref;
  ref.verdict_sha256 = await archived(f.root, 'verdicts', verdict);
  const nextManifest = await archived(f.root, 'trials', f.manifest);
  f.current.spec.policy_version = `delegation:${nextManifest}`;
  await assert.rejects(createArchivedDelegationEvidence({ ...f.settings,
    manifestSha256: nextManifest })(f.input), /cannot be its own prior trial/);
  await assert.rejects(createArchivedDelegationEvidence({ ...f.settings,
    manifestSha256: nextManifest,
    allowUnsafeArchiveForTest: false, now: undefined })(f.input),
    /production archive must be outside/);
});

test('real task-program snapshot consumes the host adapter and holds at one without archived pairs', async t => {
  const f = await fixture(t, 0);
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'delegation-program-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const controller = createTaskControl({ storeRoot: path.join(root, 'control'),
    allowUnsafeStoreRootForTest: true });
  const workerBudget = { tokens: 100, fuel: 2, children: 0,
    integrations: 0, evaluations: 0 };
  const spec = { goal: 'Four independent archived checks',
    acceptance: 'Independent verifier checks the task result',
    scopes: ['research'], integration_owner: 'integrator',
    initial_head: 'a'.repeat(40),
    pinned_versions: { evaluator_sha256: EVALUATOR,
      case_set_sha256: CASES, toolchain: 'keyless-test' },
    limits: { max_tasks: 4, max_branches: 4, max_active_grants: 4,
      max_depth: 0, tokens: 10_000, fuel: 100,
      integrations: 1, evaluations: 1 },
    policy_version: `delegation:${f.manifestSha}` };
  const calls = [];
  const checkedAdapter = createArchivedDelegationEvidence({ ...f.settings,
    controller, observeCapacity: async ({ task_ref, causal_cut }) => ({
      ...f.getCapacity(), task_ref, causal_cut }),
    independentPlans: async ({ eligible_plans }) => eligible_plans.map(plan => plan.ref) });
  const options = { controller, spec, prompt: 'Check four independent methods',
    programId: 'archived-width-integration',
    stateRoot: path.join(root, 'program'),
    allowUnsafeStateRootForTest: true,
    maxLiveWorkers: 4, delegationEvidence: checkedAdapter,
    planner: async () => ({ tasks: Array.from({ length: 4 }, (_, index) => ({
      id: `check-${index}`, kind: 'research', scope: 'research',
      deliverable: `Check method ${index}`, acceptance: `Verify method ${index}`,
      source_refs: [], oracle_sha256: EVALUATOR, budget: workerBudget,
      depends_on: [], parent_plan_ref: null })),
      next_cursor: null, done: true }),
    grantForPlan: async ({ plan }) => ({ branch: `branch-${plan.id}`,
      owner: 'worker', budget: workerBudget,
      location: path.join(root, plan.id), parent_grant_ref: null }),
    worker: async ({ grant }) => { calls.push(grant.ref); } };
  const first = await createTaskProgram(options).run();
  assert.equal(first.status, 'waiting-workers');
  assert.equal(first.dispatched, 1);
  assert.equal(calls.length, 1);
  const snapshot = await controller.replay(first.task_ref);
  assert.equal(snapshot.grants.length, 1);
  assert.equal(snapshot.spec.policy_version, `delegation:${f.manifestSha}`);
  const restarted = await createTaskProgram(options).run();
  assert.equal(restarted.dispatched, 0);
  assert.equal(calls.length, 1);
});
