import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createAlgorithmPromotion } from './algorithm-promotion.mjs';
import { selectCandidate } from './core.mjs';
import { createTaskControl } from './task-control.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const canon = value => value === null || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(canon).join(',')}]`
    : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canon(value[key])}`).join(',')}}`;
const fileJson = async (directory, value) => {
  const bytes = `${JSON.stringify(value)}\n`;
  const digest = sha(bytes);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${digest}.json`), bytes);
  return digest;
};
const budget = { tokens: 10000, fuel: 100, children: 0, integrations: 1, evaluations: 1 };

async function fixture(t, options = {}) {
  const priorUnsafeArchive = process.env.TELEPATHY_DSH_TEST_ALLOW_UNSAFE_ARCHIVE;
  process.env.TELEPATHY_DSH_TEST_ALLOW_UNSAFE_ARCHIVE = '1';
  t.after(() => {
    if (priorUnsafeArchive === undefined) delete process.env.TELEPATHY_DSH_TEST_ALLOW_UNSAFE_ARCHIVE;
    else process.env.TELEPATHY_DSH_TEST_ALLOW_UNSAFE_ARCHIVE = priorUnsafeArchive;
  });
  const root = await mkdtemp(path.join(os.tmpdir(), 'telepathy-algorithm-promotion-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspaceRoot = path.join(root, 'workspace');
  const archiveRoot = path.join(root, 'archive');
  const journalRoot = path.join(root, 'journal');
  const storeRoot = path.join(root, 'task-state');
  for (const directory of [workspaceRoot, archiveRoot, journalRoot, storeRoot]) await mkdir(directory);
  execFileSync('jj', ['git', 'init', '--no-colocate', workspaceRoot], { encoding: 'utf8' });
  const jj = args => execFileSync('jj', args, { cwd: workspaceRoot, encoding: 'utf8' }).trim();
  const initial = jj(['--ignore-working-copy', 'log', '-r', '@-', '--no-graph', '-T', 'commit_id']);
  const sourcePath = 'kernel.bend';
  const source = 'def main = 1\n';
  await writeFile(path.join(workspaceRoot, sourcePath), source);
  jj(['status']);
  const acceptedHead = jj(['--ignore-working-copy', 'log', '-r', '@', '--no-graph', '-T', 'commit_id']);
  assert.notEqual(initial, acceptedHead);
  const sourceSha = sha(source);
  await mkdir(path.join(archiveRoot, 'candidates'));
  await writeFile(path.join(archiveRoot, 'candidates', `${sourceSha}.bend`), source);

  const verifierSource = `import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export async function verifyFreshEvidence({ evidence, binding, evidenceSha, privateRoot }) {
  const read = async (kind, digest) => {
    const bytes = await readFile(path.join(privateRoot, kind, digest + '.json'));
    if (sha(bytes) !== digest) return null;
    return JSON.parse(bytes);
  };
  const gate = await read('gates', evidence.gate.receipt_sha256);
  const baseline = await read('fresh-runs', evidence.fresh.baseline_receipt_sha256);
  const candidate = await read('fresh-runs', evidence.fresh.candidate_receipt_sha256);
  const ok = gate?.revision === binding.accepted_head && gate?.exit_code === 0 &&
    baseline?.revision === evidence.fresh.baseline_commit &&
    candidate?.revision === binding.accepted_head &&
    baseline?.task_set_sha256 === binding.fresh_task_set_sha256 &&
    candidate?.task_set_sha256 === binding.fresh_task_set_sha256 &&
    baseline?.compute_budget_sha256 === binding.compute_budget_sha256 &&
    candidate?.compute_budget_sha256 === binding.compute_budget_sha256 &&
    baseline?.passed === false && candidate?.passed === true;
  const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value)
    : Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
      : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  const evidenceBytes = await readFile(path.join(privateRoot, 'evidence', evidenceSha + '.json')).catch(() => null);
  return { ok: Boolean(ok && evidenceBytes && sha(evidenceBytes) === evidenceSha),
    binding_sha256: sha(canonical(binding)), evidence_sha256: evidenceSha };
}`;
  const verifierPath = path.join(root, 'fresh-verifier.mjs');
  await writeFile(verifierPath, verifierSource);
  const freshVerifierSha256 = sha(verifierSource);
  const taskSet = 'fresh-task-1\n';
  const freshTaskSetPath = path.join(root, 'fresh-tasks.txt');
  await writeFile(freshTaskSetPath, taskSet);
  const freshTaskSetSha256 = sha(taskSet);
  const evaluatorPath = path.join(root, 'score-evaluator.mjs');
  const caseSetPath = path.join(root, 'score-cases.json');
  await writeFile(evaluatorPath, 'fixed score evaluator\n');
  await writeFile(caseSetPath, 'fixed cases\n');
  const evaluatorSha256 = sha('fixed score evaluator\n');
  const caseSetSha256 = sha('fixed cases\n');
  const receiptId = randomUUID();
  const run = { schema: 1, receipt_id: receiptId, session_id: 'root-session', call_id: 'call-1',
    source: sourcePath, source_sha256: sourceSha, status: 'executed',
    bend_version: 'bend-test', compiler: 'clang-test', target: 'test-target', execution_policy: 'test-policy' };
  const runSha = await fileJson(path.join(archiveRoot, 'receipts'), run);
  await writeFile(path.join(archiveRoot, 'receipts', `${receiptId}.json`), `${JSON.stringify(run)}\n`);
  const report = { schema: 1, mode: 'receipt', source_sha256: sourceSha, receipt_sha256: runSha,
    evaluator_sha256: evaluatorSha256, case_set_sha256: caseSetSha256, ok: true,
    toolchain: { bend_version: run.bend_version, compiler: run.compiler,
      target: run.target, execution_policy: run.execution_policy },
    coverage: { total: 1, observed: 1, passed: 1, failed: 0 }, cases: [{ id: 'case-1', pass: true }] };
  const scoreSha = await fileJson(path.join(archiveRoot, 'scores'), { schema: 1, receipt_id: receiptId,
    receipt_sha256: runSha, source_sha256: sourceSha, evaluator_sha256: evaluatorSha256,
    case_set_sha256: caseSetSha256, report });
  const verifierState = { combinedHead: acceptedHead, evidenceSha: null, gateSha: null };
  const taskControl = createTaskControl({ storeRoot, allowUnsafeStoreRootForTest: true,
    allowSyntheticCombinedVerifierForTest: true,
    inspectWorkspace: async () => workspaceRoot,
    verifyCombined: async ({ expected_head, candidates }) => ({
      ok: true, combined_commit: verifierState.combinedHead, checked_commit: verifierState.combinedHead,
      base_commit: expected_head, candidate_events: candidates.map(row => row.event_digest),
      evaluator_sha256: freshVerifierSha256, case_set_sha256: freshTaskSetSha256,
      toolchain: 'bend-test', receipt_sha256: verifierState.evidenceSha,
      ancestry_ok: true, conflicts_resolved: true, task_accepted: false,
      gate: { revision: verifierState.combinedHead,
        argv: ['jj', '--ignore-working-copy', 'run', '--ignore-changes', '--clean', '--root', '-r', verifierState.combinedHead,
          '--', 'node', 'scripts/check.mjs', '--require-dsh'],
        exit_code: 0, receipt_sha256: options.settlementGateMismatch ? 'e'.repeat(64) : verifierState.gateSha },
    }) });
  const opened = await taskControl.open({ goal: 'Improve kernel', acceptance: 'Fresh task gain', scopes: ['algorithm'],
    integration_owner: 'integrator', initial_head: initial,
    pinned_versions: { evaluator_sha256: freshVerifierSha256, case_set_sha256: freshTaskSetSha256, toolchain: 'bend-test' },
    limits: { max_tasks: 2, max_branches: 2, max_active_grants: 1, max_depth: 0,
      tokens: 40000, fuel: 400, integrations: 2, evaluations: 2 }, policy_version: 'v1' });
  const plan = await taskControl.plan(opened.task_ref, { id: 'plan-1', kind: 'algorithm', scope: 'algorithm',
    deliverable: 'One Bend source', acceptance: 'Fresh task gain', source_refs: [],
    oracle_sha256: freshVerifierSha256, budget, depends_on: [], parent_plan_ref: null,
    expected_log_head: opened.log_head });
  const beforeGrant = await taskControl.replay(opened.task_ref);
  const grant = await taskControl.grant(opened.task_ref, { id: 'grant-1', plan_ref: plan.plan_ref,
    branch: 'algorithm-branch', owner: 'integrator', scope: 'algorithm', deliverable: 'One Bend source',
    base_refs: { task_commit: initial, causal_event: beforeGrant.log_head }, budget, location: workspaceRoot,
    parent_grant_ref: null });
  const session = { id: 'root-session', header: { origin: 'user', cwd: workspaceRoot } };
  await taskControl.bindRootSession(opened.task_ref, { id: 'bind-root', grant_ref: grant.grant_ref,
    session_id: session.id }, { sessions: { get: id => id === session.id ? session : null } });
  const candidateAdmission = { id: 'candidate-1', grant_ref: grant.grant_ref, actor: 'integrator',
    scope: 'algorithm', base_commit: initial, parents: [grant.event_digest], kind: 'candidate',
    payload: { commit: acceptedHead, artifact_sha256: sourceSha, observation_receipt_sha256: runSha } };
  const candidate = await taskControl.admit(opened.task_ref, candidateAdmission);
  const gate = { revision: acceptedHead, exit_code: 0 };
  verifierState.gateSha = await fileJson(path.join(journalRoot, 'gates'), gate);
  const computeBudgetSha = sha('same-budget');
  const baselineSha = await fileJson(path.join(journalRoot, 'fresh-runs'), {
    revision: initial, task_set_sha256: freshTaskSetSha256, compute_budget_sha256: computeBudgetSha, passed: false });
  const candidateSha = await fileJson(path.join(journalRoot, 'fresh-runs'), {
    revision: acceptedHead, task_set_sha256: freshTaskSetSha256, compute_budget_sha256: computeBudgetSha, passed: true });
  const binding = { task_ref: opened.task_ref, candidate_event: candidate.event_digest,
    accepted_head: acceptedHead, candidate_commit: acceptedHead,
    candidate_grant_ref: grant.grant_ref, candidate_session_id: 'root-session',
    candidate_budget_sha256: sha(canon(budget)), integration_grant_ref: grant.grant_ref,
    integration_budget_sha256: sha(canon(budget)), source_path: sourcePath,
    source_sha256: sourceSha, run_receipt_sha256: runSha, score_sha256: scoreSha,
    score_evaluator_sha256: evaluatorSha256, score_case_set_sha256: caseSetSha256,
    fresh_verifier_sha256: freshVerifierSha256, gate_receipt_sha256: verifierState.gateSha,
    fresh_task_set_sha256: freshTaskSetSha256, baseline_commit: initial,
    baseline_receipt_sha256: baselineSha, candidate_receipt_sha256: candidateSha,
    compute_budget_sha256: computeBudgetSha, expected_active_score_sha256: null };
  verifierState.evidenceSha = await fileJson(path.join(journalRoot, 'evidence'), { schema: 1, binding,
    gate: { revision: acceptedHead, receipt_sha256: verifierState.gateSha },
    fresh: { task_set_sha256: freshTaskSetSha256, baseline_commit: initial,
      candidate_commit: acceptedHead, baseline_receipt_sha256: baselineSha,
      candidate_receipt_sha256: candidateSha, compute_budget_sha256: computeBudgetSha } });
  const settlement = { id: 'settle-1', integration_grant_ref: grant.grant_ref,
    expected_head: initial, candidate_events: [candidate.event_digest] };
  assert.equal((await taskControl.settle(opened.task_ref, settlement)).status, 'accepted');
  const settings = { taskControl, taskStoreRoot: storeRoot, workspaceRoot, archiveRoot, journalRoot, sourcePath,
    evaluatorPath, evaluatorSha256, caseSetPath, caseSetSha256,
    freshVerifierPath: verifierPath, freshVerifierSha256, freshTaskSetPath, freshTaskSetSha256,
    allowUnsafeRootsForTest: true };
  const request = { task_ref: opened.task_ref, candidate_admission: candidateAdmission,
    settlement, score_sha256: scoreSha, incumbent_score_sha256: null,
    expected_active_score_sha256: null };
  return { settings, request, archiveRoot, journalRoot, runSha, scoreSha, sourceSha,
    evidenceSha: verifierState.evidenceSha, candidateSha, workspaceRoot, taskControl, opened,
    acceptedHead, verifierState, freshVerifierSha256 };
}

async function advanceTaskHead(f) {
  execFileSync('jj', ['new'], { cwd: f.workspaceRoot });
  await writeFile(path.join(f.workspaceRoot, 'kernel.bend'), 'def main = 2\n');
  execFileSync('jj', ['status'], { cwd: f.workspaceRoot });
  const nextHead = execFileSync('jj', ['--ignore-working-copy', 'log', '-r', '@', '--no-graph', '-T', 'commit_id'],
    { cwd: f.workspaceRoot, encoding: 'utf8' }).trim();
  f.verifierState.combinedHead = nextHead;
  f.verifierState.evidenceSha = sha('second private evaluation');
  f.verifierState.gateSha = sha('second exact gate');
  const beforePlan = await f.taskControl.replay(f.opened.task_ref);
  const secondPlan = await f.taskControl.plan(f.opened.task_ref, { id: 'plan-2', kind: 'algorithm',
    scope: 'algorithm', deliverable: 'Second Bend source', acceptance: 'Second fresh gain', source_refs: [],
    oracle_sha256: f.freshVerifierSha256, budget, depends_on: [], parent_plan_ref: null,
    expected_log_head: beforePlan.log_head });
  const beforeGrant = await f.taskControl.replay(f.opened.task_ref);
  const secondGrant = await f.taskControl.grant(f.opened.task_ref, { id: 'grant-2', plan_ref: secondPlan.plan_ref,
    branch: 'second-branch', owner: 'integrator', scope: 'algorithm', deliverable: 'Second Bend source',
    base_refs: { task_commit: f.acceptedHead, causal_event: beforeGrant.log_head }, budget,
    location: path.join(path.dirname(f.workspaceRoot), 'second-worker'), parent_grant_ref: null });
  const secondCandidate = await f.taskControl.admit(f.opened.task_ref, { id: 'candidate-2',
    grant_ref: secondGrant.grant_ref, actor: 'integrator', scope: 'algorithm',
    base_commit: f.acceptedHead, parents: [secondGrant.event_digest], kind: 'candidate',
    payload: { commit: nextHead, artifact_sha256: sha('second source'),
      observation_receipt_sha256: sha('second run') } });
  const secondSettlement = await f.taskControl.settle(f.opened.task_ref, { id: 'settle-2',
    integration_grant_ref: secondGrant.grant_ref, expected_head: f.acceptedHead,
    candidate_events: [secondCandidate.event_digest] });
  assert.equal(secondSettlement.status, 'accepted');
  assert.equal((await f.taskControl.replay(f.opened.task_ref)).task_head, nextHead);
  return nextHead;
}

test('accepted exact head prepares intent, selects once, and replays after restart', async t => {
  const f = await fixture(t);
  const host = createAlgorithmPromotion(f.settings);
  const prepared = await host.prepare(f.request);
  assert.equal(prepared.status, 'prepared');
  const intent = JSON.parse(await readFile(path.join(f.journalRoot, 'intents', `${prepared.promotion_id}.json`)));
  assert.equal(intent.evidence_sha256, f.evidenceSha);
  assert.equal(intent.run_receipt_sha256, f.runSha);
  const result = await host.apply(prepared.promotion_id);
  assert.equal(result.status, 'selected');
  assert.equal(result.active.score_sha256, f.scoreSha);
  const restarted = createAlgorithmPromotion(f.settings);
  assert.equal((await restarted.apply(prepared.promotion_id)).existing, true);
});

test('unsettled or altered model artifacts cannot prepare promotion', async t => {
  const f = await fixture(t);
  const host = createAlgorithmPromotion(f.settings);
  await assert.rejects(host.prepare({ ...f.request, candidate_admission: {
    ...f.request.candidate_admission, payload: { ...f.request.candidate_admission.payload,
      artifact_sha256: 'f'.repeat(64) } } }), /event ID reused/);
  await assert.rejects(host.prepare({ ...f.request, settlement: { ...f.request.settlement, id: 'fabricated' } }),
    /prior admission and accepted settlement/);
  await writeFile(path.join(f.journalRoot, 'fresh-runs', `${f.candidateSha}.json`), '{}\n');
  await assert.rejects(host.prepare(f.request), /fresh clone evaluator did not accept/);
});

test('fresh evidence must name the gate receipt accepted by exact settlement', async t => {
  const f = await fixture(t, { settlementGateMismatch: true });
  await assert.rejects(createAlgorithmPromotion(f.settings).prepare(f.request), /gate differs from settled/);
});

test('intent replays a selector CAS that completed before selected marker', async t => {
  const f = await fixture(t);
  const host = createAlgorithmPromotion(f.settings);
  const prepared = await host.prepare(f.request);
  await selectCandidate({ candidate_score_sha256: f.scoreSha, incumbent_score_sha256: null,
    expected_active_score_sha256: null }, f.settings);
  const restarted = createAlgorithmPromotion(f.settings);
  const result = await restarted.apply(prepared.promotion_id);
  assert.equal(result.status, 'selected');
  assert.equal(result.existing, true);
  assert.equal(result.active.source_sha256, f.sourceSha);
});

test('selected marker remains historical after another accepted task head and active selection', async t => {
  const f = await fixture(t);
  const host = createAlgorithmPromotion(f.settings);
  const prepared = await host.prepare(f.request);
  const first = await host.apply(prepared.promotion_id);
  await advanceTaskHead(f);
  const laterPointer = { ...first.active, score_sha256: 'f'.repeat(64),
    parent_score_sha256: f.scoreSha };
  await writeFile(path.join(f.archiveRoot, 'active.json'), `${JSON.stringify(laterPointer)}\n`);
  const replayed = await createAlgorithmPromotion(f.settings).apply(prepared.promotion_id);
  assert.equal(replayed.existing, true);
  assert.equal(replayed.active.score_sha256, f.scoreSha);
});

test('a later accepted task head blocks the selector after fresh validation', async t => {
  const f = await fixture(t);
  let selected = false;
  const originalLock = f.taskControl.withCurrentHead;
  const host = createAlgorithmPromotion({ ...f.settings,
    taskControl: { ...f.taskControl, withCurrentHead: async (...args) => {
      await advanceTaskHead(f);
      return originalLock(...args);
    } },
    selectForTest: async () => { selected = true; throw new Error('stale selector ran'); } });
  const prepared = await host.prepare(f.request);
  await assert.rejects(host.apply(prepared.promotion_id), /promotion task head changed before selection/);
  assert.equal(selected, false);
  await assert.rejects(readFile(path.join(f.archiveRoot, 'active.json')), { code: 'ENOENT' });
  await assert.rejects(readFile(path.join(f.journalRoot, 'selected', `${prepared.promotion_id}.json`)), { code: 'ENOENT' });
});

test('unmarked intent fails closed after another selector takes the active pointer', async t => {
  const f = await fixture(t);
  const host = createAlgorithmPromotion(f.settings);
  const prepared = await host.prepare(f.request);
  await writeFile(path.join(f.archiveRoot, 'active.json'), `${JSON.stringify({ schema: 1,
    score_sha256: 'f'.repeat(64) })}\n`);
  await assert.rejects(host.apply(prepared.promotion_id), /active pointer changed before selection/);
});
