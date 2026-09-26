import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createFundedTaskProgram, createResearchTaskProgramHost, createSingleTaskHost,
  createTwoScopeResearchSynthesisHost, researchProgramForecast,
  twoScopeResearchSynthesisForecast, validatedDeepSeekEnv } from './task-host.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const workerWorkspaces = async root => (await readdir(root)).filter(name => /^worker-[a-f0-9]{40}$/.test(name));
const budget = { tokens: 4000, fuel: 5, children: 0, integrations: 0, evaluations: 1 };
const verifierSource = `
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
export async function verifyResult(input) {
  const { task_ref, plan_ref, grant_ref, result_event, expected_head, causal_cut,
    artifact_sha256, evidence_receipt_sha256, evaluator_sha256,
    case_set_sha256, toolchain, artifactRoot } = input;
  const bytes = await readFile(artifactRoot + '/artifacts/' + artifact_sha256 + '.txt');
  const evidence = await readFile(artifactRoot + '/evidence/' + evidence_receipt_sha256 + '.json');
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  const ok = sha(bytes) === artifact_sha256 && sha(evidence) === evidence_receipt_sha256 &&
    (input.research_proposal
      ? input.research_proposal.proposition === 'evidence: measured' &&
        input.research_proposal.source_refs.length === 0
      : bytes.toString('utf8') === 'evidence: measured');
  return { task_ref, plan_ref, grant_ref, result_event, expected_head, causal_cut,
    artifact_sha256, evidence_receipt_sha256, evaluator_sha256,
    case_set_sha256, toolchain, ok,
    receipt_sha256: sha(task_ref + ':' + result_event + ':' + ok),
    ...ok ? {} : { reason: 'artifact fails frozen acceptance' } };
}
`;

async function fixture(t, name, runSessionForTest) {
  const root = await mkdtemp(path.join(os.tmpdir(), `telepathy-host-${name}-`));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'workspace');
  execFileSync('jj', ['git', 'init', '--no-colocate', workspace], { encoding: 'utf8' });
  const actualWorkspace = await realpath(workspace);
  const initialHead = execFileSync('jj', ['--ignore-working-copy', 'log', '-r', '@-', '--no-graph', '-T', 'commit_id'],
    { cwd: actualWorkspace, encoding: 'utf8' }).trim();
  const verifierFile = path.join(root, 'verifier.mjs');
  await writeFile(verifierFile, verifierSource, { mode: 0o600 });
  const caseSetFile = path.join(root, 'cases.json');
  await writeFile(caseSetFile, 'fixture-cases', { mode: 0o600 });
  const spec = { goal: 'Answer a bounded research question', acceptance: 'artifact must equal frozen measured evidence',
    scopes: ['research'], integration_owner: 'host', initial_head: initialHead,
    pinned_versions: { evaluator_sha256: hash(verifierSource), case_set_sha256: hash('fixture-cases'), toolchain: 'fixture' },
    limits: { max_tasks: 1, max_branches: 1, max_active_grants: 1, max_depth: 0,
      tokens: 10_000, fuel: 100, integrations: 1, evaluations: 1 }, policy_version: 'single-host-test-v1' };
  const settings = { spec, prompt: 'Measure one claim.', programId: `host-${name}`,
    workerBudget: budget, workerWorkspace: actualWorkspace, verifierFile, caseSetFile,
    stateRoot: path.join(root, 'programs'), archiveRoot: path.join(root, 'archive'),
    taskStateRoot: path.join(root, 'tasks'), allowUnsafeRootsForTest: true,
    allowMockRunnerForTest: true, runSessionForTest };
  return { root, workspace: actualWorkspace, spec, settings };
}

function bindRoot(controller, taskRef, grant, dispatchId, workspace) {
  const live = { id: dispatchId, header: { cwd: workspace } };
  return controller.bindRootSession(taskRef, { id: `root-bind:${dispatchId}`,
    grant_ref: grant.ref, session_id: dispatchId },
  { sessions: { get: id => id === dispatchId ? live : undefined } });
}

test('one funded worker settles only with its pinned independent verifier and stays idempotent', async t => {
  let turns = 0;
  let workspace;
  const runSessionForTest = async ({ task_ref, grant, dispatch_id, controller }) => {
    turns++;
    await bindRoot(controller, task_ref, grant, dispatch_id, workspace);
    return { sessionId: dispatch_id, finalResponse: 'evidence: measured',
      events: [{ type: 'assistant/message', data: 'evidence: measured' }] };
  };
  const fixtureData = await fixture(t, 'accepted', runSessionForTest);
  workspace = fixtureData.workspace;
  const host = await createSingleTaskHost(fixtureData.settings);
  const first = await host.run();
  assert.equal(turns, 1);
  assert.equal(first.accepted_plans, 1);
  assert.equal(first.task_accepted, false, 'a research result does not close the frozen goal');
  const snap = await host.controller.replay(first.task_ref);
  assert.equal(snap.plans[0].status, 'accepted');
  assert.equal(snap.grants[0].status, 'accepted');
  assert.equal(snap.results[0].status, 'accepted');
  assert.ok(snap.events.some(row => row.type === 'result_settled'));
  assert.equal(await readFile(path.join(fixtureData.root, 'archive', 'artifacts', `${hash('evidence: measured')}.txt`), 'utf8'),
    'evidence: measured');
  const again = await host.run();
  assert.equal(turns, 1);
  assert.equal(again.dispatched, 0);
  assert.equal(again.accepted_plans, 1);
});

test('a rejected result exhausts evaluation and releases the worker slot', async t => {
  let workspace;
  const fixtureData = await fixture(t, 'rejected', async ({ task_ref, grant, dispatch_id, controller }) => {
    await bindRoot(controller, task_ref, grant, dispatch_id, workspace);
    return { sessionId: dispatch_id, finalResponse: 'unsupported claim', events: [] };
  });
  workspace = fixtureData.workspace;
  const host = await createSingleTaskHost(fixtureData.settings);
  const result = await host.run();
  assert.equal(result.accepted_plans, 0);
  const snap = await host.controller.replay(result.task_ref);
  assert.equal(snap.plans[0].status, 'failed');
  assert.equal(snap.grants[0].status, 'failed');
  assert.equal(snap.results[0].status, 'rejected');
});

test('uncertain worker after durable session binding does not dispatch a duplicate', async t => {
  let turns = 0;
  let workspace;
  const fixtureData = await fixture(t, 'uncertain', async ({ task_ref, grant, dispatch_id, controller }) => {
    turns++;
    await bindRoot(controller, task_ref, grant, dispatch_id, workspace);
    throw new Error('worker lost response after provider turn');
  });
  workspace = fixtureData.workspace;
  const first = await createSingleTaskHost(fixtureData.settings);
  await assert.rejects(first.run(), /worker lost response/);
  const restarted = await createSingleTaskHost(fixtureData.settings);
  const resumed = await restarted.run();
  assert.equal(turns, 1);
  assert.equal(resumed.dispatched, 0);
  assert.equal(resumed.status, 'dispatch-audit-required');
  assert.equal(resumed.accepted_plans, 0);
  const snap = await restarted.controller.replay(resumed.task_ref);
  assert.equal(snap.grants[0].status, 'active');
  assert.equal(snap.grants[0].session_id !== null, true);
});

test('a changed verifier is rejected before a worker or model turn', async t => {
  let called = false;
  const fixtureData = await fixture(t, 'verifier-pin', async () => { called = true; });
  await writeFile(fixtureData.settings.verifierFile, `${verifierSource}\n// changed`);
  await assert.rejects(createSingleTaskHost(fixtureData.settings), /verifier bytes differ/);
  assert.equal(called, false);
});

test('a conflicting admitted result ID cannot be adopted from an archive', async t => {
  let workspace;
  const data = await fixture(t, 'conflict', async ({ task_ref, grant, dispatch_id, controller }) => {
    await bindRoot(controller, task_ref, grant, dispatch_id, workspace);
    await controller.admit(task_ref, { id: `result:${dispatch_id}`, grant_ref: grant.ref,
      actor: grant.owner, scope: grant.scope, base_commit: grant.base_refs.task_commit,
      parents: [grant.last_event], kind: 'result', payload: {
        artifact_sha256: hash('conflicting artifact'),
        evidence_receipt_sha256: hash('conflicting evidence'), source_refs: [] } });
    return { sessionId: dispatch_id, finalResponse: 'evidence: measured', events: [] };
  });
  workspace = data.workspace;
  const host = await createSingleTaskHost(data.settings);
  await assert.rejects(host.run(), /event ID reused with different content/);
  const snap = await host.controller.replay((await host.controller.open(data.spec)).task_ref);
  assert.equal(snap.results[0].status, 'ready');
  assert.equal(snap.events.some(row => row.type === 'result_settled'), false);
});

test('host private roots and verifier cannot resolve into the worker workspace', async t => {
  const data = await fixture(t, 'path-escape', async () => { throw new Error('must not run'); });
  const inside = path.join(data.workspace, 'inside');
  await mkdir(inside);
  const alias = path.join(data.root, 'alias');
  await symlink(inside, alias);
  await assert.rejects(createSingleTaskHost({ ...data.settings,
    archiveRoot: path.join(alias, 'archive') }), /archiveRoot must be outside/);
  await assert.rejects(createSingleTaskHost({ ...data.settings,
    archiveRoot: alias }), /archiveRoot may not be a symlink/);
  const insideVerifier = path.join(inside, 'verifier.mjs');
  await writeFile(insideVerifier, verifierSource);
  await assert.rejects(createSingleTaskHost({ ...data.settings,
    verifierFile: insideVerifier }), /verifierFile must be outside/);
  await assert.rejects(createSingleTaskHost({ ...data.settings,
    runSessionForTest: undefined, dsh: {} }), /unsafe roots require an injected test session runner/);
});

test('production DSH child environment rejects runtime and provider overrides', () => {
  const base = { PATH: '/usr/bin:/bin', HOME: '/host/home', DEEPSEEK_API_KEY: 'private-test-key' };
  assert.deepEqual(validatedDeepSeekEnv(base), base);
  for (const key of ['DSH_SNAPSHOT', 'DSH_PRIMARY_RUNTIME', 'NODE_OPTIONS', 'NODE_PATH',
    'TELEPATHY_DSH_TEST_ALLOW_UNSAFE_TASK_STORE', 'TELEPATHY_TASK_REF']) {
    assert.throws(() => validatedDeepSeekEnv({ ...base, [key]: 'override' }),
      /DSH child environment must contain only/);
  }
  assert.throws(() => validatedDeepSeekEnv({ PATH: base.PATH, HOME: base.HOME }),
    /DSH child environment must contain only/);
});

async function plannerFixture(t, name, runPlannerSessionForTest, overrides = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), `telepathy-planner-${name}-`));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'planner-workspace');
  execFileSync('jj', ['git', 'init', '--no-colocate', workspace], { encoding: 'utf8' });
  const actualWorkspace = await realpath(workspace);
  const initialHead = execFileSync('jj', ['--ignore-working-copy', 'log', '-r', '@-', '--no-graph', '-T', 'commit_id'],
    { cwd: actualWorkspace, encoding: 'utf8' }).trim();
  const verifierFile = path.join(root, 'verifier.mjs');
  await writeFile(verifierFile, verifierSource, { mode: 0o600 });
  const caseSetFile = path.join(root, 'cases.json');
  await writeFile(caseSetFile, 'fixture-cases', { mode: 0o600 });
  const spec = { goal: 'Plan two bounded research measurements',
    acceptance: 'Each proposed result must pass the pinned oracle', scopes: ['research'],
    integration_owner: 'host', initial_head: initialHead,
    pinned_versions: { evaluator_sha256: hash(verifierSource), case_set_sha256: hash('fixture-cases'),
      toolchain: 'fixture' },
    limits: { max_tasks: 3, max_branches: 3, max_active_grants: 1, max_depth: 0,
      tokens: 25_000, fuel: 100, integrations: 1, evaluations: 2 },
    policy_version: 'planner-host-test-v1' };
  const archiveRoot = path.join(root, 'archive');
  const workerBudget = { tokens: 4000, fuel: 5, children: 0, integrations: 0, evaluations: 1 };
  const settings = { spec, prompt: 'Measure two distinct claims.', programId: `planner-${name}`,
    targetTasks: 2, feedbackPlanning: false,
    plannerBudget: { tokens: 1000, fuel: 2, children: 0,
      integrations: 0, evaluations: 0 }, workerBudget,
    plannerWorkspace: actualWorkspace, verifierFile, caseSetFile,
    stateRoot: path.join(root, 'programs'), taskStateRoot: path.join(root, 'tasks'),
    archiveRoot, allowUnsafeRootsForTest: true, allowMockRunnerForTest: true,
    runPlannerSessionForTest, grantForPlan: async ({ plan }) => ({
      branch: `worker:${plan.id}`, owner: 'host', budget: workerBudget,
      location: path.join(root, `worker-${plan.id}`), parent_grant_ref: null }),
    worker: async () => { throw new Error('fixture worker was not supplied'); },
    ...overrides };
  return { root, workspace: actualWorkspace, spec, archiveRoot, settings };
}

function plannerPage(input, oracle, workerBudget) {
  const index = input.planned_count;
  return { tasks: [{ id: `claim-${index}`, kind: 'research', scope: 'research',
    deliverable: `Measure claim ${index}`, acceptance: 'Provide measured evidence',
    source_refs: [], oracle_sha256: oracle, budget: workerBudget,
    depends_on: [], parent_plan_ref: null }],
  next_cursor: index === 0 ? 1 : null, done: index === 1 };
}

function researchResponse(causalParent, proposition = 'evidence: measured', overrides = {}) {
  return JSON.stringify({ schema: 'telepathy.research-proposal/v1',
    claim_type: 'hypothesis', proposition, domain: 'bounded fixture',
    method: 'Compare the proposed answer with the frozen fixture oracle.',
    assumptions: [], source_refs: [], input_refs: [],
    predicted_observation: 'The fixture oracle accepts the measured answer.',
    observed_refs: [], counterexample_refs: [],
    uncertainty: 'The worker cannot independently accept this claim.',
    causal_parent: causalParent, ...overrides });
}

test('funded planner archives each exact page and closes before independently settled workers', async t => {
  let data;
  let plannerCalls = 0;
  let workerCalls = 0;
  let plannerSession;
  const runPlanner = async ({ task_ref, grant, session_id, input, controller }) => {
    plannerCalls++;
    plannerSession ??= session_id;
    assert.equal(session_id, plannerSession, 'each page uses the same funded DSH root session');
    if (plannerCalls === 1) await bindRoot(controller, task_ref, grant, session_id, data.workspace);
    const page = plannerPage(input, data.spec.pinned_versions.evaluator_sha256,
      data.settings.workerBudget);
    return { sessionId: session_id, finalResponse: JSON.stringify(page),
      events: [{ type: 'planner-page', index: input.planned_count }] };
  };
  data = await plannerFixture(t, 'accepted', runPlanner);
  data.settings.worker = async ({ task_ref, grant, plan, dispatch_id, controller }) => {
    workerCalls++;
    const state = await controller.replay(task_ref);
    assert.equal(state.grants.find(row => row.ref === data.host.planner_grant_ref)?.status, 'done',
      'planner grant closes before any worker dispatch');
    await mkdir(path.join(data.archiveRoot, 'artifacts'), { recursive: true });
    await mkdir(path.join(data.archiveRoot, 'evidence'), { recursive: true });
    const result = 'evidence: measured';
    const evidence = '[]';
    await writeFile(path.join(data.archiveRoot, 'artifacts', `${hash(result)}.txt`), result);
    await writeFile(path.join(data.archiveRoot, 'evidence', `${hash(evidence)}.json`), evidence);
    const admitted = await controller.admit(task_ref, { id: `result:${dispatch_id}`,
      grant_ref: grant.ref, actor: grant.owner, scope: grant.scope,
      base_commit: grant.base_refs.task_commit, parents: [grant.last_event],
      kind: 'result', payload: { artifact_sha256: hash(result),
        evidence_receipt_sha256: hash(evidence), source_refs: [] } });
    const settled = await controller.settleResult(task_ref, { id: `settle:${dispatch_id}`,
      grant_ref: grant.ref, plan_ref: plan.ref, result_event: admitted.event_digest,
      expected_head: grant.base_refs.task_commit });
    assert.equal(settled.status, 'accepted');
  };
  data.host = await createFundedTaskProgram(data.settings);
  let progress;
  for (let index = 0; index < 8; index++) {
    progress = await data.host.run({ maxSteps: 64 });
    if (progress.planning_done && workerCalls === 2) break;
  }
  assert.equal(progress.planning_done, true);
  assert.equal(progress.planned_count, 2);
  assert.equal(plannerCalls, 2);
  assert.equal(workerCalls, 2);
  const snapshot = await data.host.controller.replay(data.host.task_ref);
  assert.equal(snapshot.plans.filter(row => row.status === 'accepted').length, 2);
  assert.equal(snapshot.plans.find(row => row.kind === 'analysis')?.status, 'done');
  const receiptNames = await readdir(path.join(data.archiveRoot, 'planner-receipts'));
  assert.equal(receiptNames.length, 2);
  for (const name of receiptNames) {
    const receipt = JSON.parse(await readFile(path.join(data.archiveRoot, 'planner-receipts', name), 'utf8'));
    assert.equal(receipt.status, 'completed');
    assert.equal(receipt.session_id, plannerSession);
    assert.equal(receipt.input_sha256,
      hash(await readFile(path.join(data.archiveRoot, 'planner-inputs', `${receipt.attempt_id}.json`))));
    assert.equal(receipt.prompt_sha256,
      hash(await readFile(path.join(data.archiveRoot, 'planner-prompts', `${receipt.attempt_id}.txt`))));
    assert.equal(receipt.response_sha256,
      hash(await readFile(path.join(data.archiveRoot, 'planner-responses', `${receipt.attempt_id}.txt`))));
  }
  const resumed = await createFundedTaskProgram(data.settings);
  await resumed.run();
  assert.equal(plannerCalls, 2, 'restart does not repeat a funded planner turn');
  await assert.rejects(createFundedTaskProgram({ ...data.settings,
    workerBudget: { ...data.settings.workerBudget, tokens: 3999 } }),
  /existing planner plan differs from the frozen bootstrap/,
  'a restarted host cannot mix old pages with a changed worker budget');
});

test('funded planner resumes from a rejected verdict and proposes a measured follow-up', async t => {
  let data;
  let plannerCalls = 0;
  let workerCalls = 0;
  let secondFeedback;
  data = await plannerFixture(t, 'feedback', async ({ task_ref, grant, session_id,
    input, prompt, controller }) => {
    plannerCalls++;
    assert.match(prompt, /Scoped evidence references at this causal cut:/);
    if (plannerCalls === 1) {
      assert.deepEqual(input.feedback, []);
      await bindRoot(controller, task_ref, grant, session_id, data.workspace);
    } else if (plannerCalls === 2) {
      secondFeedback = input.feedback;
      assert.equal(secondFeedback.length, 1);
      assert.equal(secondFeedback[0].id, 'claim-0');
      assert.equal(secondFeedback[0].status, 'failed');
      assert.equal(secondFeedback[0].verdict_reason, 'artifact fails frozen acceptance');
      assert.match(secondFeedback[0].verdict_receipt_sha256, /^[a-f0-9]{64}$/);
      assert.match(secondFeedback[0].settlement_event, /^[a-f0-9]{64}$/);
      assert.match(prompt, /"evidence_status":"rejected"/);
    } else {
      assert.equal(plannerCalls, 3);
      assert.equal(input.feedback.length, 1);
      assert.equal(input.feedback[0].id, 'claim-1');
      assert.equal(input.feedback[0].status, 'accepted');
      assert.match(prompt, /"evidence_status":"accepted"/);
      return { sessionId: session_id,
        finalResponse: JSON.stringify({ tasks: [], next_cursor: null, done: true }),
        events: [] };
    }
    const page = plannerPage(input, data.spec.pinned_versions.evaluator_sha256,
      data.settings.workerBudget);
    if (plannerCalls === 2) {
      page.tasks[0].deliverable = 'Refute claim 0 with a fresh measurement';
      page.tasks[0].acceptance = 'Independently measure the counterexample';
      page.next_cursor = 2;
      page.done = false;
    }
    return { sessionId: session_id, finalResponse: JSON.stringify(page), events: [] };
  }, { feedbackPlanning: true });
  data.settings.targetTasks = 3;
  data.settings.spec.limits.max_tasks = 4;
  data.settings.spec.limits.max_branches = 4;
  data.settings.spec.limits.evaluations = 3;
  await assert.rejects(createFundedTaskProgram(data.settings),
    /feedback planning needs concurrent planner and worker grant capacity/);
  data.settings.spec.limits.max_active_grants = 2;
  data.settings.worker = async ({ task_ref, grant, plan, dispatch_id, controller }) => {
    workerCalls++;
    const snapshot = await controller.replay(task_ref);
    if (workerCalls === 1)
      assert.equal(snapshot.grants.find(row => row.ref === data.host.planner_grant_ref)?.status,
        'active', 'planner stays funded while the first worker is measured');
    const result = workerCalls === 1 ? 'unsupported claim' : 'evidence: measured';
    const evidence = '[]';
    await mkdir(path.join(data.archiveRoot, 'artifacts'), { recursive: true });
    await mkdir(path.join(data.archiveRoot, 'evidence'), { recursive: true });
    await writeFile(path.join(data.archiveRoot, 'artifacts', `${hash(result)}.txt`), result);
    await writeFile(path.join(data.archiveRoot, 'evidence', `${hash(evidence)}.json`), evidence);
    const admitted = await controller.admit(task_ref, { id: `result:${dispatch_id}`,
      grant_ref: grant.ref, actor: grant.owner, scope: grant.scope,
      base_commit: grant.base_refs.task_commit, parents: [grant.last_event],
      kind: 'result', payload: { artifact_sha256: hash(result),
        evidence_receipt_sha256: hash(evidence), source_refs: [] } });
    const settled = await controller.settleResult(task_ref, { id: `settle:${dispatch_id}`,
      grant_ref: grant.ref, plan_ref: plan.ref, result_event: admitted.event_digest,
      expected_head: grant.base_refs.task_commit });
    assert.equal(settled.status, workerCalls === 1 ? 'rejected' : 'accepted');
  };
  data.host = await createFundedTaskProgram(data.settings);
  for (let step = 0; step < 32 && workerCalls === 0; step++)
    await data.host.run({ maxSteps: 1 });
  assert.equal(workerCalls, 1);
  assert.equal(plannerCalls, 1, 'the next page is held until the first result settles');
  data.host = await createFundedTaskProgram(data.settings);
  for (let step = 0; step < 32 && workerCalls < 2; step++)
    await data.host.run({ maxSteps: 1 });
  for (let step = 0; step < 32 && plannerCalls < 3; step++)
    await data.host.run({ maxSteps: 1 });
  const stopped = await data.host.run();
  assert.equal(stopped.planning_done, true);
  assert.equal(stopped.planned_count, 2, 'verified feedback may stop before the target ceiling');
  assert.equal(plannerCalls, 3);
  assert.equal(workerCalls, 2);
  const snapshot = await data.host.controller.replay(data.host.task_ref);
  assert.deepEqual(snapshot.plans.filter(row => row.id.startsWith('claim-'))
    .map(row => row.status), ['failed', 'accepted']);
  assert.equal(snapshot.grants.filter(row => ['active', 'ready'].includes(row.status)).length, 0);
  await data.host.run();
  assert.equal(plannerCalls, 3, 'restart does not repeat a completed planner attempt');
  assert.equal(workerCalls, 2, 'restart does not repeat a settled worker');
});

test('uncertain and invalid planner turns do not silently repeat', async t => {
  let data;
  let calls = 0;
  data = await plannerFixture(t, 'uncertain', async ({ task_ref, grant, session_id, controller }) => {
    calls++;
    await bindRoot(controller, task_ref, grant, session_id, data.workspace);
    throw new Error('provider response lost before archive');
  });
  const first = await createFundedTaskProgram(data.settings);
  await assert.rejects(first.run(), /provider response lost/);
  const restarted = await createFundedTaskProgram(data.settings);
  const held = await restarted.run();
  assert.equal(held.status, 'planner-audit-required');
  assert.equal(calls, 1);

  let malformed;
  malformed = await plannerFixture(t, 'malformed', async ({ task_ref, grant, session_id, controller }) => {
    await bindRoot(controller, task_ref, grant, session_id, malformed.workspace);
    return { sessionId: session_id, finalResponse: '{bad', events: [] };
  });
  const invalidHost = await createFundedTaskProgram(malformed.settings);
  await assert.rejects(invalidHost.run(), /planner response is invalid/);
  const audited = await (await createFundedTaskProgram(malformed.settings)).run();
  assert.equal(audited.status, 'planner-page-invalid');
  assert.equal(audited.rejected_page.response_sha256, hash('{bad'));

  let semantic;
  let semanticCalls = 0;
  semantic = await plannerFixture(t, 'semantic', async ({ task_ref, grant, session_id, input, controller }) => {
    semanticCalls++;
    await bindRoot(controller, task_ref, grant, session_id, semantic.workspace);
    const page = plannerPage(input, semantic.spec.pinned_versions.evaluator_sha256,
      semantic.settings.workerBudget);
    page.tasks[0].acceptance = '';
    return { sessionId: session_id, finalResponse: JSON.stringify(page), events: [] };
  });
  await assert.rejects((await createFundedTaskProgram(semantic.settings)).run(),
    /planner task 0 acceptance/);
  const semanticAudit = await (await createFundedTaskProgram(semantic.settings)).run();
  assert.equal(semanticAudit.status, 'planner-page-invalid');
  assert.equal(semanticCalls, 1, 'a completed but invalid page is audited without another model turn');
});

test('a renamed duplicate on a later planner page is archived and never admitted', async t => {
  let data;
  let calls = 0;
  data = await plannerFixture(t, 'duplicate-across-pages', async ({ task_ref, grant,
    session_id, input, prompt, controller }) => {
    calls++;
    if (calls === 1) await bindRoot(controller, task_ref, grant, session_id, data.workspace);
    assert.match(prompt, /Frozen goal: Plan two bounded research measurements/);
    assert.match(prompt, /Frozen acceptance: Each proposed result must pass the pinned oracle/);
    assert.ok(prompt.includes(`Causal cut: ${input.log_head}`));
    const page = plannerPage(input, data.spec.pinned_versions.evaluator_sha256,
      data.settings.workerBudget);
    if (calls === 2) {
      assert.match(prompt, /Recent tasks:.*Measure claim 0/);
      page.tasks[0].deliverable = '  measure  CLAIM 0  ';
      page.tasks[0].acceptance = 'Provide\n measured evidence';
    }
    return { sessionId: session_id, finalResponse: JSON.stringify(page), events: [] };
  });
  const host = await createFundedTaskProgram(data.settings);
  await assert.rejects(host.run(), /planner response is invalid/);
  const resumed = await createFundedTaskProgram(data.settings);
  const progress = await resumed.run();
  assert.equal(progress.status, 'planner-page-invalid');
  assert.match(progress.rejected_page.reason, /repeats an admitted or same-page task/);
  assert.equal(progress.planned_count, 1);
  assert.equal(calls, 2, 'the rejected funded turn is audited without another call');
  const snapshot = await resumed.controller.replay(resumed.task_ref);
  assert.deepEqual(snapshot.plans.filter(row => row.kind === 'research').map(row => row.id),
    ['claim-0']);
  const receipts = await Promise.all((await readdir(path.join(data.archiveRoot,
    'planner-receipts'))).map(name => readFile(path.join(data.archiveRoot,
    'planner-receipts', name), 'utf8').then(JSON.parse)));
  assert.deepEqual(receipts.map(row => row.status).sort(), ['completed', 'invalid']);
});

test('research program funds two distinct exact-base jj workers and settles both kinds', async t => {
  let data;
  let plannerCalls = 0;
  let workerCalls = 0;
  const locations = [];
  data = await plannerFixture(t, 'research-program', async ({ task_ref, grant, session_id, input, controller }) => {
    plannerCalls++;
    if (plannerCalls === 1) await bindRoot(controller, task_ref, grant, session_id, data.workspace);
    const page = plannerPage(input, data.spec.pinned_versions.evaluator_sha256,
      data.settings.workerBudget);
    if (input.planned_count === 1) page.tasks[0].kind = 'analysis';
    return { sessionId: session_id, finalResponse: JSON.stringify(page), events: [] };
  });
  await mkdir(path.join(data.root, 'workers'), { mode: 0o700 });
  data.settings.workerWorkspaceRoot = await realpath(path.join(data.root, 'workers'));
  data.settings.runWorkerSessionForTest = async ({ task_ref, grant, dispatch_id, prompt, controller }) => {
    workerCalls++;
    locations.push(grant.location);
    assert.match(prompt, /Frozen goal: Plan two bounded research measurements/);
    assert.match(prompt, /Frozen acceptance: Each proposed result must pass the pinned oracle/);
    assert.match(prompt, /Causal cut: [a-f0-9]{64}/);
    assert.match(prompt, /Scoped event references \(provenance, not verified facts\)/);
    assert.match(prompt, /Required delta: evidence for this exact deliverable and acceptance/);
    await bindRoot(controller, task_ref, grant, dispatch_id, grant.location);
    return { sessionId: dispatch_id,
      finalResponse: researchResponse(grant.last_event), events: [] };
  };
  const host = await createResearchTaskProgramHost(data.settings);
  let progress;
  for (let index = 0; index < 8; index++) {
    progress = await host.run({ maxSteps: 64 });
    if (progress.accepted_plans === 2) break;
  }
  assert.equal(progress.planning_done, true);
  assert.equal(progress.accepted_plans, 2);
  assert.equal(plannerCalls, 2);
  assert.equal(workerCalls, 2);
  assert.equal(new Set(locations).size, 2);
  assert.deepEqual(await workerWorkspaces(data.settings.workerWorkspaceRoot), [],
    'settled, clean worker checkouts are forgotten and removed');
  assert.equal((await readdir(path.join(data.archiveRoot, 'dispatches'))).length, 2,
    'workspace retirement preserves exact dispatch receipts');
  for (const location of locations)
    await assert.rejects(realpath(location), { code: 'ENOENT' });
  const snapshot = await host.controller.replay(host.task_ref);
  assert.deepEqual(snapshot.plans.filter(plan => plan.status === 'accepted').map(plan => plan.kind).sort(),
    ['analysis', 'research']);
  const restarted = await createResearchTaskProgramHost(data.settings);
  const again = await restarted.run();
  assert.equal(again.accepted_plans, 2);
  assert.equal(plannerCalls, 2);
  assert.equal(workerCalls, 2);
});

test('a rejected research result releases the slot for the next planned worker', async t => {
  let data;
  let plannerCalls = 0;
  let workerCalls = 0;
  data = await plannerFixture(t, 'rejected-then-accepted', async ({ task_ref, grant,
    session_id, input, controller }) => {
    plannerCalls++;
    if (plannerCalls === 1) await bindRoot(controller, task_ref, grant, session_id, data.workspace);
    const page = plannerPage(input, data.spec.pinned_versions.evaluator_sha256,
      data.settings.workerBudget);
    return { sessionId: session_id, finalResponse: JSON.stringify(page), events: [] };
  });
  await mkdir(path.join(data.root, 'workers'), { mode: 0o700 });
  data.settings.workerWorkspaceRoot = await realpath(path.join(data.root, 'workers'));
  data.settings.runWorkerSessionForTest = async ({ task_ref, grant, dispatch_id, controller }) => {
    workerCalls++;
    await bindRoot(controller, task_ref, grant, dispatch_id, grant.location);
    return { sessionId: dispatch_id,
      finalResponse: researchResponse(grant.last_event,
        workerCalls === 1 ? 'unsupported claim' : 'evidence: measured'),
      events: [] };
  };
  const host = await createResearchTaskProgramHost(data.settings);
  let progress;
  for (let index = 0; index < 8; index++) {
    progress = await host.run({ maxSteps: 64 });
    const snapshot = await host.controller.replay(host.task_ref);
    if (snapshot.plans.some(plan => plan.status === 'failed') &&
        snapshot.plans.some(plan => plan.status === 'accepted')) break;
  }
  assert.equal(plannerCalls, 2);
  assert.equal(workerCalls, 2);
  assert.equal(progress.accepted_plans, 1);
  const snapshot = await host.controller.replay(host.task_ref);
  assert.deepEqual(snapshot.plans.filter(plan => plan.id.startsWith('claim-'))
    .map(plan => plan.status).sort(), ['accepted', 'failed']);
  assert.equal(snapshot.grants.filter(grant => grant.status === 'active').length, 0);
  assert.deepEqual(await workerWorkspaces(data.settings.workerWorkspaceRoot), [],
    'rejected but settled clean workspaces are retired too');
  await assert.rejects(createResearchTaskProgramHost({ ...data.settings,
    workerBudget: { ...data.settings.workerBudget, evaluations: 2 } }),
  /exactly one evaluation/);
});

test('research program recovers an archived response and halts on an unarchived turn', async t => {
  async function runCase(name, afterArchive, loseResponse) {
    let data;
    let plannerCalls = 0;
    let workerCalls = 0;
    let interrupt = true;
    data = await plannerFixture(t, name, async ({ task_ref, grant, session_id, input, controller }) => {
      plannerCalls++;
      if (plannerCalls === 1) await bindRoot(controller, task_ref, grant, session_id, data.workspace);
      const page = plannerPage(input, data.spec.pinned_versions.evaluator_sha256,
        data.settings.workerBudget);
      return { sessionId: session_id, finalResponse: JSON.stringify(page), events: [] };
    });
    await mkdir(path.join(data.root, 'workers'), { mode: 0o700 });
    data.settings.workerWorkspaceRoot = await realpath(path.join(data.root, 'workers'));
    data.settings.runWorkerSessionForTest = async ({ task_ref, grant, dispatch_id, controller }) => {
      workerCalls++;
      await bindRoot(controller, task_ref, grant, dispatch_id, grant.location);
      if (loseResponse) throw new Error('provider turn lost before archive');
      return { sessionId: dispatch_id,
        finalResponse: researchResponse(grant.last_event), events: [] };
    };
    if (afterArchive) data.settings.afterWorkerArchiveForTest = async () => {
      if (interrupt) { interrupt = false; throw new Error('host stopped after archive'); }
    };
    const host = await createResearchTaskProgramHost(data.settings);
    await assert.rejects(host.run({ maxSteps: 128 }),
      afterArchive ? /host stopped after archive/ : /provider turn lost before archive/);
    assert.equal((await workerWorkspaces(data.settings.workerWorkspaceRoot)).length, 1,
      'uncertain or unsettled worker workspace remains available for audit');
    const restarted = await createResearchTaskProgramHost(data.settings);
    const resumed = await restarted.run({ maxSteps: 128 });
    assert.equal(plannerCalls, 2);
    assert.equal(workerCalls, afterArchive ? 2 : 1,
      'the uncertain worker turn is never repeated');
    if (afterArchive) {
      assert.equal(resumed.accepted_plans, 2);
      assert.deepEqual(await workerWorkspaces(data.settings.workerWorkspaceRoot), [],
        'recovery retires both clean workspaces after independent settlement');
    }
    else {
      assert.equal(resumed.status, 'dispatch-audit-required');
      assert.equal(resumed.accepted_plans, 0);
      assert.equal((await workerWorkspaces(data.settings.workerWorkspaceRoot)).length, 1);
    }
  }
  await runCase('archived-recovery', true, false);
  await runCase('unarchived-unknown', false, true);
});

test('retirement preserves worker files and stops at the retained-workspace bound', async t => {
  let data;
  let plannerCalls = 0;
  let workerCalls = 0;
  let retained;
  data = await plannerFixture(t, 'retained-capacity', async ({ task_ref, grant,
    session_id, input, controller }) => {
    plannerCalls++;
    if (plannerCalls === 1) await bindRoot(controller, task_ref, grant, session_id, data.workspace);
    return { sessionId: session_id,
      finalResponse: JSON.stringify(plannerPage(input,
        data.spec.pinned_versions.evaluator_sha256, data.settings.workerBudget)), events: [] };
  });
  await mkdir(path.join(data.root, 'workers'), { mode: 0o700 });
  data.settings.workerWorkspaceRoot = await realpath(path.join(data.root, 'workers'));
  data.settings.maxRetainedWorkerWorkspaces = 1;
  data.settings.runWorkerSessionForTest = async ({ task_ref, grant, dispatch_id, controller }) => {
    workerCalls++;
    retained = grant.location;
    await bindRoot(controller, task_ref, grant, dispatch_id, grant.location);
    await writeFile(path.join(grant.location, 'unarchived-notes.txt'), 'keep this source edit');
    return { sessionId: dispatch_id,
      finalResponse: researchResponse(grant.last_event), events: [] };
  };
  const host = await createResearchTaskProgramHost(data.settings);
  await assert.rejects(host.run({ maxSteps: 128 }), /retained worker workspace capacity 1 reached/);
  assert.equal(workerCalls, 1);
  assert.equal(await readFile(path.join(retained, 'unarchived-notes.txt'), 'utf8'),
    'keep this source edit');
  assert.equal((await readdir(path.join(data.archiveRoot, 'dispatches'))).length, 1);
  const snapshot = await host.controller.replay(host.task_ref);
  assert.equal(snapshot.plans.filter(row => row.status === 'accepted').length, 1);
  assert.equal((await workerWorkspaces(data.settings.workerWorkspaceRoot)).length, 1);
});

test('retirement preserves ignored private state even when jj reports an empty edit', async t => {
  let data;
  data = await plannerFixture(t, 'ignored-private-state', async ({ task_ref, grant,
    session_id, input, controller }) => {
    await bindRoot(controller, task_ref, grant, session_id, data.workspace);
    const page = plannerPage(input, data.settings.spec.pinned_versions.evaluator_sha256,
      data.settings.workerBudget);
    page.done = true;
    page.next_cursor = null;
    return { sessionId: session_id, finalResponse: JSON.stringify(page), events: [] };
  });
  await writeFile(path.join(data.workspace, '.gitignore'), 'private/**\n');
  execFileSync('jj', ['status'], { cwd: data.workspace, encoding: 'utf8' });
  execFileSync('jj', ['new'], { cwd: data.workspace, encoding: 'utf8' });
  const base = execFileSync('jj', ['--ignore-working-copy', 'log', '-r', '@-',
    '--no-graph', '-T', 'commit_id'], { cwd: data.workspace, encoding: 'utf8' }).trim();
  data.settings.spec = { ...data.spec, initial_head: base };
  data.settings.targetTasks = 1;
  await mkdir(path.join(data.root, 'workers'), { mode: 0o700 });
  data.settings.workerWorkspaceRoot = await realpath(path.join(data.root, 'workers'));
  let retained;
  data.settings.runWorkerSessionForTest = async ({ task_ref, grant, dispatch_id, controller }) => {
    retained = grant.location;
    await bindRoot(controller, task_ref, grant, dispatch_id, grant.location);
    await mkdir(path.join(grant.location, 'private'));
    await writeFile(path.join(grant.location, 'private', 'private-note'), 'preserve ignored evidence');
    return { sessionId: dispatch_id,
      finalResponse: researchResponse(grant.last_event), events: [] };
  };
  const host = await createResearchTaskProgramHost(data.settings);
  const progress = await host.run({ maxSteps: 64 });
  assert.equal(progress.accepted_plans, 1);
  assert.equal(execFileSync('jj', ['--ignore-working-copy', 'diff', '-r', '@', '--summary'],
    { cwd: retained, encoding: 'utf8' }).trim(), '');
  assert.equal(await readFile(path.join(retained, 'private', 'private-note'), 'utf8'),
    'preserve ignored evidence');
  assert.equal((await workerWorkspaces(data.settings.workerWorkspaceRoot)).length, 1);
});

test('serial research runs keep one linked checkout at peak across twelve tasks', async t => {
  let data;
  let plannerCalls = 0;
  let workerCalls = 0;
  let peak = 0;
  data = await plannerFixture(t, 'twelve-clean-workers', async ({ task_ref, grant,
    session_id, input, controller }) => {
    plannerCalls++;
    if (plannerCalls === 1) await bindRoot(controller, task_ref, grant, session_id, data.workspace);
    const tasks = Array.from({ length: 12 }, (_, index) => ({
      id: `measurement-${index}`, kind: 'research', scope: 'research',
      deliverable: `Measure distinct claim ${index}`, acceptance: 'Provide measured evidence',
      source_refs: [], oracle_sha256: data.spec.pinned_versions.evaluator_sha256,
      budget: data.settings.workerBudget, depends_on: [], parent_plan_ref: null }));
    assert.equal(input.planned_count, 0);
    return { sessionId: session_id,
      finalResponse: JSON.stringify({ tasks, next_cursor: null, done: true }), events: [] };
  });
  data.settings.targetTasks = 12;
  data.settings.spec = { ...data.spec, limits: { ...data.spec.limits,
    max_tasks: 13, max_branches: 13, tokens: 100_000, fuel: 200, evaluations: 12 } };
  data.settings.plannerBudget = { ...data.settings.plannerBudget, tokens: 10_000 };
  await mkdir(path.join(data.root, 'workers'), { mode: 0o700 });
  data.settings.workerWorkspaceRoot = await realpath(path.join(data.root, 'workers'));
  data.settings.maxRetainedWorkerWorkspaces = 1;
  data.settings.runWorkerSessionForTest = async ({ task_ref, grant, dispatch_id, controller }) => {
    workerCalls++;
    peak = Math.max(peak, (await workerWorkspaces(data.settings.workerWorkspaceRoot)).length);
    await bindRoot(controller, task_ref, grant, dispatch_id, grant.location);
    return { sessionId: dispatch_id,
      finalResponse: researchResponse(grant.last_event), events: [] };
  };
  const host = await createResearchTaskProgramHost(data.settings);
  const progress = await host.run({ maxSteps: 256 });
  assert.equal(progress.accepted_plans, 12);
  assert.equal(plannerCalls, 1);
  assert.equal(workerCalls, 12);
  assert.equal(peak, 1);
  assert.deepEqual(await workerWorkspaces(data.settings.workerWorkspaceRoot), []);
  assert.equal((await readdir(path.join(data.archiveRoot, 'dispatches'))).length, 12);
});

test('malformed, wrong-cut, and unsupported-source research claims are archived then rejected', async t => {
  for (const [name, responseFor] of [
    ['malformed-claim', () => '{bad'],
    ['wrong-cut-claim', () => researchResponse('f'.repeat(64))],
    ['unverified-source-claim', grant => researchResponse(grant.last_event,
      'evidence: measured', { source_refs: ['b'.repeat(64)] })],
  ]) {
    let data;
    let workerCalls = 0;
    let rawResponse;
    data = await plannerFixture(t, name, async ({ task_ref, grant, session_id,
      input, controller }) => {
      await bindRoot(controller, task_ref, grant, session_id, data.workspace);
      const page = plannerPage(input, data.spec.pinned_versions.evaluator_sha256,
        data.settings.workerBudget);
      page.done = true;
      page.next_cursor = null;
      return { sessionId: session_id, finalResponse: JSON.stringify(page), events: [] };
    });
    data.settings.targetTasks = 1;
    await mkdir(path.join(data.root, 'workers'), { mode: 0o700 });
    data.settings.workerWorkspaceRoot = await realpath(path.join(data.root, 'workers'));
    data.settings.runWorkerSessionForTest = async ({ task_ref, grant, dispatch_id, controller }) => {
      workerCalls++;
      await bindRoot(controller, task_ref, grant, dispatch_id, grant.location);
      rawResponse = responseFor(grant);
      return { sessionId: dispatch_id, finalResponse: rawResponse, events: [] };
    };
    const host = await createResearchTaskProgramHost(data.settings);
    await host.run({ maxSteps: 64 });
    const snapshot = await host.controller.replay(host.task_ref);
    assert.equal(snapshot.results[0].status, 'rejected', name);
    assert.equal(snapshot.plans.find(row => row.id === 'claim-0').status, 'failed', name);
    assert.equal(workerCalls, 1, name);
    const [receiptName] = await readdir(path.join(data.archiveRoot, 'dispatches'));
    const receipt = JSON.parse(await readFile(path.join(data.archiveRoot, 'dispatches', receiptName)));
    assert.deepEqual(receipt.source_refs, [], 'model-authored refs are not elevated to provenance');
    assert.equal((await readFile(path.join(data.archiveRoot, 'artifacts',
      `${receipt.artifact_sha256}.txt`), 'utf8')), rawResponse);
    const restarted = await createResearchTaskProgramHost(data.settings);
    await restarted.run({ maxSteps: 64 });
    assert.equal(workerCalls, 1, 'cold replay must not repeat a rejected provider turn');
  }
});

test('a malformed archived claim is independently rejected after host crash without another provider turn', async t => {
  let data;
  let workerCalls = 0;
  let interrupt = true;
  data = await plannerFixture(t, 'malformed-claim-recovery', async ({ task_ref, grant,
    session_id, input, controller }) => {
    await bindRoot(controller, task_ref, grant, session_id, data.workspace);
    const page = plannerPage(input, data.spec.pinned_versions.evaluator_sha256,
      data.settings.workerBudget);
    page.done = true;
    page.next_cursor = null;
    return { sessionId: session_id, finalResponse: JSON.stringify(page), events: [] };
  });
  data.settings.targetTasks = 1;
  await mkdir(path.join(data.root, 'workers'), { mode: 0o700 });
  data.settings.workerWorkspaceRoot = await realpath(path.join(data.root, 'workers'));
  data.settings.runWorkerSessionForTest = async ({ task_ref, grant, dispatch_id, controller }) => {
    workerCalls++;
    await bindRoot(controller, task_ref, grant, dispatch_id, grant.location);
    return { sessionId: dispatch_id, finalResponse: '{bad', events: [] };
  };
  data.settings.afterWorkerArchiveForTest = async () => {
    if (interrupt) { interrupt = false; throw new Error('stopped after malformed archive'); }
  };
  const host = await createResearchTaskProgramHost(data.settings);
  await assert.rejects(host.run({ maxSteps: 64 }), /stopped after malformed archive/);
  const resumed = await createResearchTaskProgramHost(data.settings);
  await resumed.run({ maxSteps: 64 });
  assert.equal(workerCalls, 1);
  const snapshot = await resumed.controller.replay(resumed.task_ref);
  assert.equal(snapshot.results[0].status, 'rejected');
  assert.equal((await readdir(path.join(data.archiveRoot, 'dispatches'))).length, 1);
  assert.deepEqual(await workerWorkspaces(data.settings.workerWorkspaceRoot), [],
    'cold settlement of the final worker retires its clean checkout');
});

test('distinct research programs sharing a worker root obey one atomic capacity', async t => {
  let releaseWorkers;
  const workerHold = new Promise(resolve => { releaseWorkers = resolve; });
  let firstWorkerEntered;
  const firstWorker = new Promise(resolve => { firstWorkerEntered = resolve; });
  const make = async name => {
    let data;
    data = await plannerFixture(t, name, async ({ task_ref, grant, session_id,
      input, controller }) => {
      await bindRoot(controller, task_ref, grant, session_id, data.workspace);
      const page = plannerPage(input, data.spec.pinned_versions.evaluator_sha256,
        data.settings.workerBudget);
      return { sessionId: session_id, finalResponse: JSON.stringify({ ...page,
        next_cursor: null, done: true }), events: [] };
    });
    data.settings.targetTasks = 1;
    data.settings.maxRetainedWorkerWorkspaces = 1;
    data.settings.runWorkerSessionForTest = async ({ task_ref, grant, dispatch_id, controller }) => {
      await bindRoot(controller, task_ref, grant, dispatch_id, grant.location);
      firstWorkerEntered();
      await workerHold;
      return { sessionId: dispatch_id,
        finalResponse: researchResponse(grant.last_event), events: [] };
    };
    return data;
  };
  const a = await make('shared-root-a');
  const b = await make('shared-root-b');
  b.spec.goal = 'Answer a second independently frozen research question';
  await mkdir(path.join(a.root, 'workers'), { mode: 0o700 });
  const sharedRoot = await realpath(path.join(a.root, 'workers'));
  a.settings.workerWorkspaceRoot = sharedRoot;
  b.settings.workerWorkspaceRoot = sharedRoot;
  const hosts = await Promise.all([createResearchTaskProgramHost(a.settings),
    createResearchTaskProgramHost(b.settings)]);
  const runs = hosts.map(host => host.run({ maxSteps: 64 }).then(
    value => ({ ok: true, value }), error => ({ ok: false, error })));
  await firstWorker;
  let timer;
  try {
    const early = await Promise.race([...runs, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('capacity decision did not settle')), 10_000);
    })]);
    assert.equal(early.ok, false, 'one program must wait or reject while the first worker is active');
    assert.match(early.error.message, /retained worker workspace capacity 1 reached/);
    assert.equal((await workerWorkspaces(sharedRoot)).length, 1);
  } finally {
    clearTimeout(timer);
    releaseWorkers();
  }
  const results = await Promise.all(runs);
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.deepEqual(await workerWorkspaces(sharedRoot), []);
});

test('restart forgets an exact settled jj registration after checkout removal', async t => {
  let data;
  let workerCalls = 0;
  let interrupt = true;
  data = await plannerFixture(t, 'retirement-registration-recovery', async ({ task_ref,
    grant, session_id, input, controller }) => {
    await bindRoot(controller, task_ref, grant, session_id, data.workspace);
    const page = plannerPage(input, data.spec.pinned_versions.evaluator_sha256,
      data.settings.workerBudget);
    return { sessionId: session_id,
      finalResponse: JSON.stringify({ ...page, next_cursor: null, done: true }), events: [] };
  });
  data.settings.targetTasks = 1;
  await mkdir(path.join(data.root, 'workers'), { mode: 0o700 });
  data.settings.workerWorkspaceRoot = await realpath(path.join(data.root, 'workers'));
  data.settings.runWorkerSessionForTest = async ({ task_ref, grant, dispatch_id, controller }) => {
    workerCalls++;
    await bindRoot(controller, task_ref, grant, dispatch_id, grant.location);
    return { sessionId: dispatch_id,
      finalResponse: researchResponse(grant.last_event), events: [] };
  };
  data.settings.afterWorkerWorkspaceRemoveForTest = async () => {
    if (interrupt) { interrupt = false; throw new Error('stopped before jj forget'); }
  };
  const first = await createResearchTaskProgramHost(data.settings);
  await assert.rejects(first.run({ maxSteps: 64 }), /stopped before jj forget/);
  const snapshot = await first.controller.replay(first.task_ref);
  const workerName = path.basename(snapshot.grants.find(row =>
    row.location?.startsWith(`${data.settings.workerWorkspaceRoot}${path.sep}`))?.location);
  const registered = () => execFileSync('jj', ['--ignore-working-copy', 'workspace', 'list',
    '-T', 'name ++ "\\n"'], { cwd: data.workspace, encoding: 'utf8' }).split('\n');
  assert.deepEqual(await workerWorkspaces(data.settings.workerWorkspaceRoot), []);
  assert.ok(registered().includes(workerName), 'jj still records the missing checkout');
  const resumed = await createResearchTaskProgramHost(data.settings);
  const progress = await resumed.run({ maxSteps: 64 });
  assert.equal(progress.accepted_plans, 1);
  assert.equal(workerCalls, 1);
  assert.ok(!registered().includes(workerName), 'cold audit forgets only its exact registration');
});

test('only accepted archived research claims enter the next bounded planner prompt', async t => {
  for (const [name, workerReply, expectedStatus] of [
    ['accepted-claim-feedback', grant => researchResponse(grant.last_event), 'accepted'],
    ['rejected-claim-feedback', grant => researchResponse(grant.last_event,
      'unsupported secret claim'), 'failed'],
    ['malformed-claim-feedback', () => '{unverified secret claim', 'failed'],
  ]) {
    let data;
    let plannerCalls = 0;
    let workerCalls = 0;
    let secondPrompt;
    let secondInput;
    data = await plannerFixture(t, name, async ({ task_ref, grant, session_id,
      input, prompt, controller }) => {
      plannerCalls++;
      if (plannerCalls === 1) {
        await bindRoot(controller, task_ref, grant, session_id, data.workspace);
        return { sessionId: session_id,
          finalResponse: JSON.stringify(plannerPage(input,
            data.spec.pinned_versions.evaluator_sha256, data.settings.workerBudget)), events: [] };
      }
      secondInput = input;
      secondPrompt = prompt;
      return { sessionId: session_id,
        finalResponse: JSON.stringify({ tasks: [], next_cursor: null, done: true }), events: [] };
    }, { feedbackPlanning: true });
    data.settings.spec.limits.max_active_grants = 2;
    await mkdir(path.join(data.root, 'workers'), { mode: 0o700 });
    data.settings.workerWorkspaceRoot = await realpath(path.join(data.root, 'workers'));
    data.settings.runWorkerSessionForTest = async ({ task_ref, grant, dispatch_id, controller }) => {
      workerCalls++;
      await bindRoot(controller, task_ref, grant, dispatch_id, grant.location);
      return { sessionId: dispatch_id, finalResponse: workerReply(grant), events: [] };
    };
    let host = await createResearchTaskProgramHost(data.settings);
    for (let step = 0; step < 8 && !secondPrompt; step++)
      await host.run({ maxSteps: 64 });
    assert.equal(plannerCalls, 2, name);
    assert.equal(workerCalls, 1, name);
    assert.equal(secondInput.feedback[0].status, expectedStatus, name);
    const [secondReceipt] = (await Promise.all((await readdir(path.join(data.archiveRoot,
      'planner-receipts'))).map(async file => JSON.parse(await readFile(path.join(
        data.archiveRoot, 'planner-receipts', file), 'utf8')))))
      .filter(receipt => receipt.input_sha256 === secondInput.input_sha256);
    assert.ok(secondReceipt, name);
    const feedbackBytes = await readFile(path.join(data.archiveRoot, 'planner-feedback',
      `${secondReceipt.attempt_id}.json`));
    assert.equal(hash(feedbackBytes), secondReceipt.research_feedback_sha256, name);
    const selected = JSON.parse(feedbackBytes);
    if (name === 'accepted-claim-feedback') {
      assert.equal(selected.records.length, 1);
      assert.equal(selected.records[0].proposition, 'evidence: measured');
      assert.equal(selected.records[0].reported_method,
        'Compare the proposed answer with the frozen fixture oracle.');
      assert.equal(selected.records[0].settlement_event,
        secondInput.feedback[0].settlement_event);
      assert.equal(selected.records[0].verdict_receipt_sha256,
        secondInput.feedback[0].verdict_receipt_sha256);
      assert.match(secondPrompt, /Host-selected accepted research proposals/);
      assert.match(secondPrompt, /"proposition":"evidence: measured"/);
      assert.doesNotMatch(secondPrompt, /"source_refs":/);
    } else {
      assert.deepEqual(selected, { records: [], omitted_accepted: 0 }, name);
      assert.doesNotMatch(secondPrompt, /unsupported secret claim|unverified secret claim/);
    }
    host = await createResearchTaskProgramHost(data.settings);
    await host.run({ maxSteps: 64 });
    assert.equal(plannerCalls, 2, 'cold restart does not repeat a planner page');
    assert.equal(workerCalls, 1, 'cold restart does not repeat a settled worker');
  }
});

test('accepted research survives an intervening rejected page at the exact causal cut', async t => {
  let data;
  let plannerCalls = 0;
  let workerCalls = 0;
  let thirdPrompt;
  data = await plannerFixture(t, 'cumulative-claim-feedback', async ({ task_ref, grant,
    session_id, input, prompt, controller }) => {
    plannerCalls++;
    if (plannerCalls === 1)
      await bindRoot(controller, task_ref, grant, session_id, data.workspace);
    if (plannerCalls === 3) {
      thirdPrompt = prompt;
      assert.equal(input.feedback.length, 1);
      assert.equal(input.feedback[0].status, 'failed');
      return { sessionId: session_id,
        finalResponse: JSON.stringify({ tasks: [], next_cursor: null, done: true }),
        events: [] };
    }
    const page = plannerPage(input, data.spec.pinned_versions.evaluator_sha256,
      data.settings.workerBudget);
    page.done = false;
    page.next_cursor = plannerCalls;
    return { sessionId: session_id, finalResponse: JSON.stringify(page), events: [] };
  }, { feedbackPlanning: true });
  data.settings.targetTasks = 3;
  data.settings.spec.limits.max_tasks = 4;
  data.settings.spec.limits.max_branches = 4;
  data.settings.spec.limits.max_active_grants = 2;
  data.settings.spec.limits.evaluations = 3;
  await mkdir(path.join(data.root, 'workers'), { mode: 0o700 });
  data.settings.workerWorkspaceRoot = await realpath(path.join(data.root, 'workers'));
  data.settings.runWorkerSessionForTest = async ({ task_ref, grant, dispatch_id, controller }) => {
    workerCalls++;
    await bindRoot(controller, task_ref, grant, dispatch_id, grant.location);
    return { sessionId: dispatch_id, finalResponse: researchResponse(grant.last_event,
      workerCalls === 1 ? 'evidence: measured' : 'unsupported second result'), events: [] };
  };
  const host = await createResearchTaskProgramHost(data.settings);
  let progress;
  for (let step = 0; step < 12 && !thirdPrompt; step++)
    progress = await host.run({ maxSteps: 64 });
  assert.equal(plannerCalls, 3);
  assert.equal(workerCalls, 2);
  assert.equal(progress.planning_done, true);
  assert.match(thirdPrompt, /"proposition":"evidence: measured"/);
  assert.doesNotMatch(thirdPrompt, /unsupported second result/);
  const snapshot = await host.controller.replay(host.task_ref);
  assert.deepEqual(snapshot.plans.filter(row => row.id.startsWith('claim-'))
    .map(row => row.status), ['accepted', 'failed']);
});

test('accepted feedback retains an older distinct claim behind more than 64 repeated acceptances', async t => {
  const acceptedCount = 65;
  let data;
  let plannerCalls = 0;
  let workerCalls = 0;
  let finalInput;
  let finalPrompt;
  data = await plannerFixture(t, 'distinct-claim-feedback', async ({ task_ref, grant,
    session_id, input, prompt, controller }) => {
    plannerCalls++;
    if (plannerCalls === 1)
      await bindRoot(controller, task_ref, grant, session_id, data.workspace);
    if (input.planned_count === acceptedCount) {
      finalInput = input;
      finalPrompt = prompt;
      return { sessionId: session_id,
        finalResponse: JSON.stringify({ tasks: [], next_cursor: null, done: true }),
        events: [] };
    }
    const page = plannerPage(input, data.spec.pinned_versions.evaluator_sha256,
      data.settings.workerBudget);
    page.done = false;
    page.next_cursor = input.planned_count + 1;
    return { sessionId: session_id, finalResponse: JSON.stringify(page), events: [] };
  }, { feedbackPlanning: true });
  data.settings.targetTasks = acceptedCount + 1;
  Object.assign(data.settings.spec.limits, {
    max_tasks: acceptedCount + 2, max_branches: acceptedCount + 2,
    max_active_grants: 2, tokens: 300_000, fuel: 500,
    evaluations: acceptedCount + 1 });
  await mkdir(path.join(data.root, 'workers'), { mode: 0o700 });
  data.settings.workerWorkspaceRoot = await realpath(path.join(data.root, 'workers'));
  data.settings.runWorkerSessionForTest = async ({ task_ref, grant, dispatch_id, controller }) => {
    workerCalls++;
    await bindRoot(controller, task_ref, grant, dispatch_id, grant.location);
    const method = workerCalls === 1 ? 'Distinct first verified method.' :
      workerCalls > acceptedCount - 8
        ? `Large distinct method ${workerCalls}: ${'x'.repeat(3900)}`
        : 'Repeated later verified method.';
    return { sessionId: dispatch_id,
      finalResponse: researchResponse(grant.last_event, 'evidence: measured', {
        method,
      }), events: [] };
  };
  const host = await createResearchTaskProgramHost(data.settings);
  for (let step = 0; step < acceptedCount + 8 && !finalInput; step++)
    await host.run({ maxSteps: 64 });
  assert.equal(workerCalls, acceptedCount);
  assert.equal(plannerCalls, acceptedCount + 1);
  const receipts = await Promise.all((await readdir(path.join(data.archiveRoot,
    'planner-receipts'))).map(async file => JSON.parse(await readFile(path.join(
    data.archiveRoot, 'planner-receipts', file), 'utf8'))));
  const finalReceipt = receipts.find(receipt => receipt.input_sha256 === finalInput.input_sha256);
  assert.ok(finalReceipt);
  const selected = JSON.parse(await readFile(path.join(data.archiveRoot,
    'planner-feedback', `${finalReceipt.attempt_id}.json`), 'utf8'));
  assert.ok(selected.records.length > 2 && selected.records.length <= 8);
  assert.equal(selected.omitted_accepted, acceptedCount - selected.records.length);
  assert.ok(Buffer.byteLength(JSON.stringify(selected)) <= 24 * 1024);
  assert.equal(selected.records[0].reported_method, 'Distinct first verified method.');
  assert.ok(selected.records.some(row =>
    row.reported_method === 'Repeated later verified method.'));
  assert.ok(selected.records.some(row =>
    row.reported_method.startsWith('Large distinct method 65:')));
  assert.match(finalPrompt, /Distinct first verified method/);
});

test('unknown worker outcome cannot create accepted claim feedback or a second page', async t => {
  let data;
  let plannerCalls = 0;
  let workerCalls = 0;
  data = await plannerFixture(t, 'unknown-claim-feedback', async ({ task_ref, grant,
    session_id, input, controller }) => {
    plannerCalls++;
    if (plannerCalls !== 1) throw new Error('no second planner page after unknown worker');
    await bindRoot(controller, task_ref, grant, session_id, data.workspace);
    return { sessionId: session_id, finalResponse: JSON.stringify(plannerPage(input,
      data.spec.pinned_versions.evaluator_sha256, data.settings.workerBudget)), events: [] };
  }, { feedbackPlanning: true });
  data.settings.spec.limits.max_active_grants = 2;
  await mkdir(path.join(data.root, 'workers'), { mode: 0o700 });
  data.settings.workerWorkspaceRoot = await realpath(path.join(data.root, 'workers'));
  data.settings.runWorkerSessionForTest = async ({ task_ref, grant, dispatch_id, controller }) => {
    workerCalls++;
    await bindRoot(controller, task_ref, grant, dispatch_id, grant.location);
    throw new Error('provider response unknown');
  };
  await assert.rejects((await createResearchTaskProgramHost(data.settings)).run({ maxSteps: 64 }),
    /provider response unknown/);
  const restarted = await createResearchTaskProgramHost(data.settings);
  assert.equal((await restarted.run({ maxSteps: 64 })).status, 'dispatch-audit-required');
  assert.equal(plannerCalls, 1);
  assert.equal(workerCalls, 1);
  assert.equal((await readdir(path.join(data.archiveRoot, 'planner-feedback'))).length, 1);
});

test('cold planner audit checks the exact accepted-claim feedback archive', async t => {
  let data;
  let plannerCalls = 0;
  let interrupted = false;
  let secondAttempt;
  data = await plannerFixture(t, 'feedback-archive-audit', async ({ task_ref, grant,
    session_id, input, controller }) => {
    plannerCalls++;
    if (plannerCalls === 1) await bindRoot(controller, task_ref, grant, session_id, data.workspace);
    return { sessionId: session_id,
      finalResponse: JSON.stringify(plannerCalls === 1 ? plannerPage(input,
        data.spec.pinned_versions.evaluator_sha256, data.settings.workerBudget) :
        { tasks: [], next_cursor: null, done: true }), events: [] };
  }, { feedbackPlanning: true });
  data.settings.spec.limits.max_active_grants = 2;
  await mkdir(path.join(data.root, 'workers'), { mode: 0o700 });
  data.settings.workerWorkspaceRoot = await realpath(path.join(data.root, 'workers'));
  data.settings.runWorkerSessionForTest = async ({ task_ref, grant, dispatch_id, controller }) => {
    await bindRoot(controller, task_ref, grant, dispatch_id, grant.location);
    return { sessionId: dispatch_id,
      finalResponse: researchResponse(grant.last_event), events: [] };
  };
  data.settings.afterPlannerArchiveForTest = async ({ input, attempt_id }) => {
    if (input.planned_count === 1 && !interrupted) {
      interrupted = true;
      secondAttempt = attempt_id;
      throw new Error('stopped after funded planner archive');
    }
  };
  await assert.rejects((await createResearchTaskProgramHost(data.settings)).run({ maxSteps: 128 }),
    /stopped after funded planner archive/);
  const feedbackFile = path.join(data.archiveRoot, 'planner-feedback', `${secondAttempt}.json`);
  const exact = await readFile(feedbackFile);
  await writeFile(feedbackFile, '{"records":[],"omitted_accepted":0}');
  await assert.rejects((await createResearchTaskProgramHost(data.settings)).run({ maxSteps: 64 }),
    /planner archived input or prompt differs from exact attempt/);
  await writeFile(feedbackFile, exact);
  const restored = await createResearchTaskProgramHost(data.settings);
  await restored.run({ maxSteps: 64 });
  assert.equal(plannerCalls, 2, 'audit consumes the archived planner reply without another model call');
});

test('research forecast reports exact lower-bound shortfall without grants', async t => {
  const data = await plannerFixture(t, 'forecast', async () => { throw new Error('no model call'); });
  const forecast = researchProgramForecast({ spec: data.spec, targetTasks: 2,
    plannerBudget: data.settings.plannerBudget, workerBudget: data.settings.workerBudget });
  assert.deepEqual(forecast.shortfall, { tasks: 0, branches: 0, tokens: 0,
    fuel: 0, evaluations: 0 });
  const shortage = researchProgramForecast({ spec: { ...data.spec,
    limits: { ...data.spec.limits, max_branches: 2, evaluations: 1 } },
  targetTasks: 2, plannerBudget: data.settings.plannerBudget,
  workerBudget: data.settings.workerBudget });
  assert.equal(shortage.shortfall.branches, 1);
  assert.equal(shortage.shortfall.evaluations, 1);
});

async function twoScopeFixture(t, name, rejectedScope = null) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), `telepathy-two-scope-${name}-`)));
  t.after(() => rm(root, { recursive: true, force: true }));
  const firstWorkspace = path.join(root, 'alpha-workspace');
  execFileSync('jj', ['git', 'init', '--no-colocate', firstWorkspace], { encoding: 'utf8' });
  const base = execFileSync('jj', ['--ignore-working-copy', 'log', '-r', '@-',
    '--no-graph', '-T', 'commit_id'], { cwd: firstWorkspace, encoding: 'utf8' }).trim();
  const secondWorkspace = path.join(root, 'beta-workspace');
  const synthesisWorkspace = path.join(root, 'synthesis-workspace');
  for (const [name, location] of [['beta', secondWorkspace], ['synthesis', synthesisWorkspace]])
    execFileSync('jj', ['workspace', 'add', '--name', name, '-r', base, location],
      { cwd: firstWorkspace, encoding: 'utf8' });
  const verifierFile = path.join(root, 'verifier.mjs');
  const caseSetFile = path.join(root, 'cases.json');
  await writeFile(verifierFile, verifierSource, { mode: 0o600 });
  await writeFile(caseSetFile, 'fixture-cases', { mode: 0o600 });
  const oracleRoot = path.join(root, 'oracle');
  await mkdir(oracleRoot, { mode: 0o700 });
  const oracleSource = `
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export async function verifySynthesis(input) {
  const { spec, plan, grant, result, citations, artifactRoot, ...binding } = input;
  const proposalBytes = await readFile(path.join(artifactRoot, 'artifacts', input.artifact_sha256 + '.txt'));
  const evidenceBytes = await readFile(path.join(artifactRoot, 'evidence', input.evidence_receipt_sha256 + '.json'));
  const proposal = JSON.parse(proposalBytes.toString('utf8'));
  let ok = sha(proposalBytes) === input.artifact_sha256 &&
    sha(evidenceBytes) === input.evidence_receipt_sha256 &&
    proposal.schema === 'telepathy.synthesis-proposal/v1' &&
    proposal.source_cut === input.source_cut &&
    JSON.stringify(proposal.source_refs) === JSON.stringify(plan.source_refs) &&
    proposal.prediction === 'joint result can be tested' &&
    new Set(citations.map(row => row.scope)).size === 2;
  for (const row of citations) {
    const source = await readFile(path.join(artifactRoot, 'artifacts', row.artifact_sha256 + '.txt'));
    const evidence = await readFile(path.join(artifactRoot, 'evidence', row.evidence_receipt_sha256 + '.json'));
    ok &&= sha(source) === row.artifact_sha256 && sha(evidence) === row.evidence_receipt_sha256;
  }
  return { ...binding, ok, receipt_sha256: sha('oracle:' + input.result_event + ':' + ok),
    ...ok ? {} : { reason: 'frozen synthesis evidence failed' } };
}`;
  const synthesisOracleFile = path.join(oracleRoot, 'oracle.mjs');
  await writeFile(synthesisOracleFile, oracleSource, { mode: 0o600 });
  const plannerBudget = { tokens: 1000, fuel: 2, children: 0,
    integrations: 0, evaluations: 0 };
  const workerBudget = { tokens: 4000, fuel: 5, children: 0,
    integrations: 0, evaluations: 1 };
  const synthesisBudget = { tokens: 6000, fuel: 5, children: 0,
    integrations: 0, evaluations: 1 };
  const spec = { goal: 'Find a checked relation across alpha and beta',
    acceptance: 'Each source and the joint prediction pass independent checks',
    scopes: ['alpha', 'beta'], integration_owner: 'host', initial_head: base,
    pinned_versions: { evaluator_sha256: hash(verifierSource),
      case_set_sha256: hash('fixture-cases'), synthesis_oracle_sha256: hash(oracleSource),
      toolchain: 'fixture' },
    limits: { max_tasks: 6, max_branches: 5, max_active_grants: 1, max_depth: 0,
      tokens: 40_000, fuel: 100, integrations: 1, evaluations: 3 },
    policy_version: 'two-scope-host-test-v1' };
  const calls = { planner: [], worker: [], synthesis: 0 };
  const settings = { spec, prompt: 'Measure each field, then test one joint claim.',
    programId: `two-scope-${name}`, plannerBudget, workerBudget, synthesisBudget,
    plannerWorkspaces: [firstWorkspace, secondWorkspace], synthesisWorkspace,
    workerWorkspaceRoot: path.join(root, 'workers'), verifierFile, caseSetFile,
    stateRoot: path.join(root, 'programs'), taskStateRoot: path.join(root, 'tasks'),
    archiveRoot: path.join(root, 'archive'), synthesisOracleTrustedRoot: oracleRoot,
    synthesisOracleFile, synthesisDeliverable: 'Form a falsifiable joint claim',
    synthesisAcceptance: 'Pinned oracle checks both sources and a prediction',
    synthesisModelTokenLimit: 2048, allowUnsafeRootsForTest: true,
    allowMockRunnerForTest: true,
    runPlannerSessionForTest: async ({ scope, session_id }) => {
      calls.planner.push(scope);
      return { sessionId: session_id, finalResponse: JSON.stringify({
        tasks: [{ id: `claim-${scope}`, kind: 'research', scope,
          deliverable: `Measure ${scope}`, acceptance: 'Provide measured evidence',
          source_refs: [], oracle_sha256: spec.pinned_versions.evaluator_sha256,
          budget: workerBudget, depends_on: [], parent_plan_ref: null }],
        next_cursor: null, done: true }), events: [] };
    },
    runWorkerSessionForTest: async ({ scope, task_ref, grant, dispatch_id, controller }) => {
      calls.worker.push(scope);
      await bindRoot(controller, task_ref, grant, dispatch_id, grant.location);
      return { sessionId: dispatch_id,
        finalResponse: researchResponse(grant.last_event,
          scope === rejectedScope ? 'unsupported claim' : 'evidence: measured'),
        events: [] };
    },
    runSynthesisSessionForTest: async ({ task_ref, grant, plan, dispatch_id, controller }) => {
      calls.synthesis++;
      await bindRoot(controller, task_ref, grant, dispatch_id, synthesisWorkspace);
      return { sessionId: dispatch_id, finalResponse: JSON.stringify({
        schema: 'telepathy.synthesis-proposal/v1', source_refs: plan.source_refs,
        source_cut: plan.expected_log_head,
        proposition: 'The two measurements imply a testable relation',
        method: 'Compare independently measured fields',
        uncertainty: 'Synthetic fixture only', prediction: 'joint result can be tested' }),
      events: [] };
    } };
  return { settings, calls };
}

test('two funded scopes feed one independently checked synthesis and replay once', async t => {
  const data = await twoScopeFixture(t, 'accepted');
  const forecast = twoScopeResearchSynthesisForecast(data.settings);
  assert.deepEqual(forecast.shortfall, { tasks: 0, branches: 0, tokens: 0,
    fuel: 0, evaluations: 0 });
  const host = await createTwoScopeResearchSynthesisHost(data.settings);
  const beforeForeign = await host.controller.replay(host.task_ref);
  await host.controller.plan(host.task_ref, { id: 'foreign-beta', kind: 'research',
    scope: 'beta', deliverable: 'Measure an unrelated beta claim',
    acceptance: 'Separate independent result', source_refs: [],
    oracle_sha256: data.settings.spec.pinned_versions.evaluator_sha256,
    budget: data.settings.workerBudget, depends_on: [], parent_plan_ref: null,
    expected_log_head: beforeForeign.log_head });
  const result = await host.run();
  assert.equal(result.phase, 'synthesis');
  assert.equal(result.status, 'accepted');
  assert.equal(result.task_accepted, false);
  assert.deepEqual(data.calls.planner, ['alpha', 'beta']);
  assert.deepEqual(data.calls.worker, ['alpha', 'beta']);
  assert.equal(data.calls.synthesis, 1);
  const state = await host.controller.replay(host.task_ref);
  assert.equal(state.results.filter(row => row.status === 'accepted').length, 3);
  assert.equal(state.plans.find(row => row.id === 'foreign-beta').status, 'planned');
  assert.equal(state.grants.some(row => row.plan_ref ===
    state.plans.find(plan => plan.id === 'foreign-beta').ref), false);
  assert.equal(state.plans.find(row => row.kind === 'synthesis').citations.length, 2);
  const restarted = await createTwoScopeResearchSynthesisHost(data.settings);
  assert.equal((await restarted.run()).status, 'accepted');
  assert.equal(data.calls.synthesis, 1);
  assert.deepEqual(data.calls.worker, ['alpha', 'beta']);
});

test('a constructed composition keeps its archived contract after caller mutation', async t => {
  const data = await twoScopeFixture(t, 'frozen-object');
  const originalPlanner = data.settings.runPlannerSessionForTest;
  const prompts = [];
  data.settings.runPlannerSessionForTest = async input => {
    prompts.push(input.prompt);
    return originalPlanner(input);
  };
  const host = await createTwoScopeResearchSynthesisHost(data.settings);
  data.settings.prompt = 'Changed request after construction';
  data.settings.spec.goal = 'Different goal after construction';
  data.settings.spec.scopes[1] = 'gamma';
  data.settings.synthesisDeliverable = 'Different joint output';
  data.settings.synthesisAcceptance = 'Different joint criterion';
  data.settings.synthesisBudget.tokens = 7000;
  data.settings.runSynthesisSessionForTest = async () => {
    throw new Error('changed callback must not run');
  };
  assert.equal((await host.run()).status, 'accepted');
  assert.equal(prompts.length, 2);
  assert.ok(prompts.every(value => value.includes('Measure each field, then test one joint claim.')));
  assert.ok(prompts.every(value => !value.includes('Changed request after construction')));
  const state = await host.controller.replay(host.task_ref);
  const synthesis = state.plans.find(row => row.kind === 'synthesis');
  assert.equal(synthesis.deliverable, 'Form a falsifiable joint claim');
  assert.equal(synthesis.acceptance, 'Pinned oracle checks both sources and a prediction');
  assert.equal(synthesis.budget.tokens, 6000);
  assert.equal(data.calls.synthesis, 1);
});

test('rejected second scope never funds synthesis', async t => {
  const data = await twoScopeFixture(t, 'rejected', 'beta');
  const host = await createTwoScopeResearchSynthesisHost(data.settings);
  const result = await host.run();
  assert.equal(result.phase, 'beta');
  assert.equal(result.status, 'source-rejected');
  assert.equal(data.calls.synthesis, 0);
  const state = await host.controller.replay(host.task_ref);
  assert.equal(state.plans.some(row => row.kind === 'synthesis'), false);
});

test('uncertain second-scope dispatch remains unknown across a cold restart', async t => {
  const data = await twoScopeFixture(t, 'uncertain');
  const original = data.settings.runWorkerSessionForTest;
  let uncertainCalls = 0;
  data.settings.runWorkerSessionForTest = async input => {
    if (input.scope !== 'beta') return original(input);
    uncertainCalls++;
    await bindRoot(input.controller, input.task_ref, input.grant,
      input.dispatch_id, input.grant.location);
    throw new Error('second scope lost its provider response');
  };
  const first = await createTwoScopeResearchSynthesisHost(data.settings);
  await assert.rejects(first.run(), /second scope lost its provider response/);
  await assert.rejects(createTwoScopeResearchSynthesisHost({ ...data.settings,
    synthesisAcceptance: 'A different synthesis criterion after field work' }),
  /immutable artifact conflicts/);
  assert.equal(uncertainCalls, 1);
  assert.equal(data.calls.synthesis, 0);
  for (const id of ['later-foreign-one', 'later-foreign-two']) {
    const state = await first.controller.replay(first.task_ref);
    await first.controller.plan(first.task_ref, { id, kind: 'research',
      scope: 'alpha', deliverable: id, acceptance: 'Separate result',
      source_refs: [], oracle_sha256: data.settings.spec.pinned_versions.evaluator_sha256,
      budget: data.settings.workerBudget, depends_on: [], parent_plan_ref: null,
      expected_log_head: state.log_head });
  }
  const restarted = await createTwoScopeResearchSynthesisHost(data.settings);
  const result = await restarted.run();
  assert.equal(result.phase, 'beta');
  assert.equal(result.status, 'dispatch-audit-required');
  assert.equal(uncertainCalls, 1);
  assert.equal(data.calls.synthesis, 0);
  const state = await restarted.controller.replay(restarted.task_ref);
  assert.equal(state.plans.some(row => row.kind === 'synthesis'), false);
});

test('cross-field compute and oracle preflight fail before a model turn', async t => {
  const data = await twoScopeFixture(t, 'preflight');
  const short = { ...data.settings, spec: { ...data.settings.spec,
    limits: { ...data.settings.spec.limits, evaluations: 2 } } };
  assert.equal(twoScopeResearchSynthesisForecast(short).shortfall.evaluations, 1);
  await assert.rejects(createTwoScopeResearchSynthesisHost(short), /cross-field compute shortfall/);
  await writeFile(data.settings.synthesisOracleFile, 'export const verifySynthesis = null;');
  await assert.rejects(createTwoScopeResearchSynthesisHost(data.settings),
    /synthesis oracle differs from frozen pin/);
  assert.deepEqual(data.calls, { planner: [], worker: [], synthesis: 0 });
});

test('shared-task spending is checked before a fresh cross-field model turn', async t => {
  const data = await twoScopeFixture(t, 'spent');
  const host = await createTwoScopeResearchSynthesisHost(data.settings);
  for (const id of ['foreign-one', 'foreign-two']) {
    const state = await host.controller.replay(host.task_ref);
    await host.controller.plan(host.task_ref, { id, kind: 'research',
      scope: 'beta', deliverable: `Unrelated ${id}`,
      acceptance: 'Independent answer', source_refs: [],
      oracle_sha256: data.settings.spec.pinned_versions.evaluator_sha256,
      budget: data.settings.workerBudget, depends_on: [], parent_plan_ref: null,
      expected_log_head: state.log_head });
  }
  await assert.rejects(host.run(), /live cross-field compute shortfall/);
  assert.deepEqual(data.calls, { planner: [], worker: [], synthesis: 0 });
});
