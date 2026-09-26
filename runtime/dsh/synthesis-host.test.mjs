import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createTaskControl } from './task-control.mjs';
import { createPinnedSynthesisVerifier } from './synthesis-contract.mjs';
import { createSynthesisHost } from './synthesis-host.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const D = character => character.repeat(64);
const budget = { tokens: 6000, fuel: 5, children: 0, integrations: 0, evaluations: 1 };
const sourceBudget = { tokens: 2000, fuel: 3, children: 0, integrations: 0, evaluations: 1 };

async function fixture(t, sourcePadding = 0, paddingCharacter = 'x') {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'telepathy-synthesis-host-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'workspace');
  execFileSync('jj', ['git', 'init', '--no-colocate', workspace], { encoding: 'utf8' });
  const actualWorkspace = await realpath(workspace);
  const base = execFileSync('jj', ['--ignore-working-copy', 'log', '-r', '@-', '--no-graph',
    '-T', 'commit_id'], { cwd: actualWorkspace, encoding: 'utf8' }).trim();
  const archiveRoot = path.join(root, 'archive');
  const oracleRoot = path.join(root, 'oracle');
  const storeRoot = path.join(root, 'tasks');
  for (const directory of [archiveRoot, oracleRoot, storeRoot])
    await mkdir(directory, { mode: 0o700 });
  for (const directory of ['artifacts', 'evidence'])
    await mkdir(path.join(archiveRoot, directory), { mode: 0o700 });
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
    new Set(citations.map(row => row.scope)).size >= 2;
  for (const row of citations) {
    const source = await readFile(path.join(artifactRoot, 'artifacts', row.artifact_sha256 + '.txt'));
    const evidence = await readFile(path.join(artifactRoot, 'evidence', row.evidence_receipt_sha256 + '.json'));
    ok &&= sha(source) === row.artifact_sha256 && sha(evidence) === row.evidence_receipt_sha256;
  }
  return { ...binding, ok, receipt_sha256: sha('oracle:' + input.result_event + ':' + ok),
    ...ok ? {} : { reason: 'frozen synthesis evidence failed' } };
}`;
  const oraclePath = path.join(oracleRoot, 'oracle.mjs');
  await writeFile(oraclePath, oracleSource, { mode: 0o600 });
  const oracleSha = sha(oracleSource);
  const verifySynthesis = createPinnedSynthesisVerifier({ trustedRoot: oracleRoot,
    workspaceRoot: actualWorkspace, artifactRoot: archiveRoot, oraclePath,
    allowUnsafeOraclePathForTest: true });
  const controller = createTaskControl({ storeRoot, allowUnsafeStoreRootForTest: true,
    verifyResult: input => {
      const { spec: _spec, plan: _plan, grant: _grant, result: _result, ...binding } = input;
      return { ...binding, ok: true, receipt_sha256: sha(`source:${input.result_event}`) };
    }, verifySynthesis });
  const spec = { goal: 'Find a checked cross-field relation',
    acceptance: 'Pinned oracle checks sources and prediction',
    scopes: ['alpha', 'beta'], integration_owner: 'integrator', initial_head: base,
    pinned_versions: { evaluator_sha256: D('1'), case_set_sha256: D('2'),
      synthesis_oracle_sha256: oracleSha, toolchain: 'keyless-test' },
    limits: { max_tasks: 4, max_branches: 4, max_active_grants: 2, max_depth: 0,
      tokens: 50000, fuel: 100, integrations: 1, evaluations: 3 },
    policy_version: 'synthesis-host-test-v1' };
  const opened = await controller.open(spec);
  const sourceRefs = [];
  for (const scope of spec.scopes) {
    let state = await controller.replay(opened.task_ref);
    const plan = await controller.plan(opened.task_ref, { id: `source-plan:${scope}`,
      kind: 'research', scope, deliverable: `Observe ${scope}`,
      acceptance: 'Source evidence is checked', source_refs: [],
      oracle_sha256: spec.pinned_versions.evaluator_sha256,
      budget: sourceBudget, depends_on: [], parent_plan_ref: null,
      expected_log_head: state.log_head });
    state = await controller.replay(opened.task_ref);
    const grant = await controller.grant(opened.task_ref, {
      id: `source-grant:${scope}`, plan_ref: plan.plan_ref,
      branch: `source:${scope}`, owner: `researcher:${scope}`, scope,
      deliverable: `Observe ${scope}`, base_refs: {
        task_commit: base, causal_event: state.log_head }, budget: sourceBudget,
      location: path.join(root, `source-${scope}`), parent_grant_ref: null });
    const artifact = Buffer.from(JSON.stringify({ field: scope,
      observation: `${scope} measured${paddingCharacter.repeat(sourcePadding)}` }));
    const evidence = Buffer.from(JSON.stringify({ field: scope, instrument: 'keyless fixture' }));
    await writeFile(path.join(archiveRoot, 'artifacts', `${sha(artifact)}.txt`), artifact);
    await writeFile(path.join(archiveRoot, 'evidence', `${sha(evidence)}.json`), evidence);
    const result = await controller.admit(opened.task_ref, {
      id: `source-result:${scope}`, grant_ref: grant.grant_ref,
      actor: `researcher:${scope}`, scope, base_commit: base,
      parents: [grant.event_digest], kind: 'result', payload: {
        artifact_sha256: sha(artifact), evidence_receipt_sha256: sha(evidence),
        source_refs: [] } });
    const settled = await controller.settleResult(opened.task_ref, {
      id: `source-settle:${scope}`, grant_ref: grant.grant_ref,
      plan_ref: plan.plan_ref, result_event: result.event_digest,
      expected_head: base });
    assert.equal(settled.status, 'accepted');
    sourceRefs.push(result.event_digest);
  }
  const settings = { controller, taskRef: opened.task_ref, synthesisId: 'join-fields',
    sourceRefs, scope: 'alpha', deliverable: 'Form a falsifiable joint law',
    acceptance: 'Pinned independent synthesis oracle accepts raw proposal',
    budget, workspace: actualWorkspace, archiveRoot,
    allowMockRunnerForTest: true, modelTokenLimit: 2048 };
  const bind = async (grant, dispatchId) => controller.bindRootSession(opened.task_ref, {
    id: `root-bind:${dispatchId}`, grant_ref: grant.ref, session_id: dispatchId },
  { sessions: { get: id => id === dispatchId
    ? { id, header: { cwd: actualWorkspace } } : undefined } });
  const proposal = plan => JSON.stringify({ schema: 'telepathy.synthesis-proposal/v1',
    source_refs: sourceRefs, source_cut: plan.expected_log_head,
    proposition: 'The observations share one testable relation',
    method: 'Compare independently measured domains',
    uncertainty: 'Synthetic fixture only', prediction: 'joint result can be tested' });
  return { ...settings, root, storeRoot, spec, bind, proposal };
}

test('funded synthesis archives its turn, uses the pinned oracle, and replays without a second provider call', async t => {
  const data = await fixture(t);
  let calls = 0;
  const settings = { ...data, runSessionForTest: async ({ grant, plan, dispatch_id,
    prompt, controller }) => {
    calls++;
    assert.match(prompt, /alpha measured/);
    assert.match(prompt, /beta measured/);
    assert.equal(plan.citations.length, 2);
    assert.equal(grant.owner, data.spec.integration_owner);
    await data.bind(grant, dispatch_id);
    return { sessionId: dispatch_id, finalResponse: data.proposal(plan),
      events: [{ type: 'assistant/message', body: 'proposed' }] };
  } };
  const host = await createSynthesisHost(settings);
  const first = await host.run();
  assert.equal(first.status, 'accepted');
  assert.equal(calls, 1);
  const snapshot = await data.controller.replay(data.taskRef);
  assert.equal(snapshot.task_head, data.spec.initial_head);
  assert.equal(snapshot.terminal, null);
  assert.equal(snapshot.plans.find(row => row.kind === 'synthesis').status, 'accepted');
  assert.equal(snapshot.results.find(row => row.event_digest === first.settlement.result_event).status, 'accepted');
  const intent = JSON.parse(await readFile(path.join(data.archiveRoot, 'intents', `${host.dispatchId}.json`)));
  const receipt = JSON.parse(await readFile(path.join(data.archiveRoot, 'dispatches', `${host.dispatchId}.json`)));
  assert.equal(receipt.source_cut, intent.source_cut);
  assert.equal(receipt.intent_sha256, sha(await readFile(path.join(data.archiveRoot,
    'intents', `${host.dispatchId}.json`))));
  const restarted = await createSynthesisHost(settings);
  assert.equal((await restarted.run()).status, 'accepted');
  assert.equal(calls, 1);
});

test('large accepted sources fit the funded prompt while the oracle checks full artifacts', async t => {
  // Backslashes expand once in the source JSON and again in the model prompt.
  const data = await fixture(t, 4000, '\\');
  let calls = 0;
  let sentPrompt;
  const host = await createSynthesisHost({ ...data,
    runSessionForTest: async ({ grant, plan, dispatch_id, prompt }) => {
      calls++;
      sentPrompt = prompt;
      assert.ok(Buffer.byteLength(prompt) <= budget.tokens - data.modelTokenLimit - 1024);
      assert.match(prompt, /alpha measured/);
      assert.match(prompt, /beta measured/);
      assert.equal((prompt.match(/"truncated":true/g) ?? []).length, 2);
      await data.bind(grant, dispatch_id);
      return { sessionId: dispatch_id, finalResponse: data.proposal(plan), events: [] };
    } });
  assert.equal((await host.run()).status, 'accepted');
  assert.equal(calls, 1);
  const state = await data.controller.replay(data.taskRef);
  const citations = state.plans.find(row => row.kind === 'synthesis').citations;
  for (const citation of citations) {
    const bytes = await readFile(path.join(data.archiveRoot, 'artifacts',
      `${citation.artifact_sha256}.txt`));
    assert.ok(bytes.length > 4000);
    assert.equal(sha(bytes), citation.artifact_sha256);
  }
  const intent = JSON.parse(await readFile(path.join(data.archiveRoot, 'intents',
    `${host.dispatchId}.json`)));
  assert.equal((await readFile(path.join(data.archiveRoot, 'prompts',
    `${intent.prompt_sha256}.txt`), 'utf8')), sentPrompt);
  const restarted = await createSynthesisHost({ ...data,
    runSessionForTest: async () => { calls++; throw Error('duplicate provider call'); } });
  assert.equal((await restarted.run()).status, 'accepted');
  assert.equal(calls, 1);
});

test('an unfunded fixed source manifest stops before dispatch or intent', async t => {
  const data = await fixture(t, 4000);
  let calls = 0;
  const host = await createSynthesisHost({ ...data,
    budget: { ...budget, tokens: data.modelTokenLimit + 1024 },
    runSessionForTest: async () => { calls++; throw Error('unfunded provider call'); } });
  await assert.rejects(host.run(), /synthesis source manifest exceeds funded context bound/);
  assert.equal(calls, 0);
  assert.deepEqual(await readdir(path.join(data.archiveRoot, 'intents')), []);
});

test('a lost output remains unknown; trusted exact-session audit recovers it without replaying the model', async t => {
  const data = await fixture(t);
  let calls = 0;
  let recovered;
  const first = await createSynthesisHost({ ...data,
    runSessionForTest: async ({ grant, plan, dispatch_id }) => {
      calls++;
      await data.bind(grant, dispatch_id);
      recovered = { sessionId: dispatch_id, finalResponse: data.proposal(plan), events: [] };
      throw new Error('provider response lost after durable session');
    } });
  await assert.rejects(first.run(), /provider response lost/);
  const withoutAudit = await createSynthesisHost({ ...data,
    runSessionForTest: async () => { calls++; throw Error('duplicate provider call'); } });
  assert.equal((await withoutAudit.run()).status, 'dispatch-audit-required');
  assert.equal(calls, 1);
  const withAudit = await createSynthesisHost({ ...data,
    runSessionForTest: async () => { calls++; throw Error('duplicate provider call'); },
    auditDispatchForTest: async ({ dispatch_id, intent_sha256 }) => ({
      status: 'completed', dispatch_id, intent_sha256,
      receipt_sha256: sha(`durable-audit:${dispatch_id}`), response: recovered }) });
  assert.equal((await withAudit.run()).status, 'accepted');
  assert.equal(calls, 1);
});

test('wrong frozen sources and unbound output cannot enter synthesis settlement', async t => {
  const data = await fixture(t);
  await assert.rejects(createSynthesisHost({ ...data, sourceRefs: [data.sourceRefs[0], D('9')],
    runSessionForTest: async () => { throw Error('must not run'); } }).then(host => host.run()),
  /not an accepted result/);
  let calls = 0;
  const host = await createSynthesisHost({ ...data,
    runSessionForTest: async ({ plan, dispatch_id }) => {
      calls++;
      return { sessionId: dispatch_id, finalResponse: data.proposal(plan), events: [] };
    } });
  await assert.rejects(host.run(), /session was not bound/);
  assert.equal(calls, 1);
  assert.equal((await host.run()).status, 'dispatch-audit-required');
  assert.equal(calls, 1);
  const snap = await data.controller.replay(data.taskRef);
  assert.equal(snap.results.some(row => row.status === 'accepted' &&
    snap.plans.find(plan => plan.ref === snap.grants.find(grant => grant.ref === row.grant_ref)?.plan_ref)?.kind === 'synthesis'), false);
});

test('a bad proposal is rejected by the independent oracle and archived bytes are checked on replay', async t => {
  const data = await fixture(t);
  let calls = 0;
  const host = await createSynthesisHost({ ...data,
    runSessionForTest: async ({ grant, plan, dispatch_id }) => {
      calls++;
      await data.bind(grant, dispatch_id);
      const bad = JSON.parse(data.proposal(plan));
      bad.prediction = 'self-certified';
      return { sessionId: dispatch_id, finalResponse: JSON.stringify(bad), events: [] };
    } });
  const first = await host.run();
  assert.equal(first.status, 'rejected');
  assert.equal(calls, 1);
  const replayed = await host.run();
  assert.equal(replayed.status, 'rejected');
  assert.equal(calls, 1);
  const receiptFile = path.join(data.archiveRoot, 'dispatches', `${host.dispatchId}.json`);
  const receipt = JSON.parse(await readFile(receiptFile));
  const replacement = Buffer.from('another internally valid artifact');
  await writeFile(path.join(data.archiveRoot, 'artifacts', `${sha(replacement)}.txt`), replacement);
  await writeFile(receiptFile, `${JSON.stringify({ ...receipt, artifact_sha256: sha(replacement) })}\n`);
  await assert.rejects(host.run(), /event ID reused with different content/);
  await writeFile(receiptFile, `${JSON.stringify(receipt)}\n`);
  await writeFile(path.join(data.archiveRoot, 'artifacts',
    `${receipt.artifact_sha256}.txt`), 'tampered result');
  await assert.rejects(host.run(), /archive item differs from its digest/);
  assert.equal(calls, 1);
});

test('audit cannot substitute another intent or session', async t => {
  const data = await fixture(t);
  let calls = 0;
  const first = await createSynthesisHost({ ...data,
    runSessionForTest: async ({ grant, dispatch_id }) => {
      calls++;
      await data.bind(grant, dispatch_id);
      throw new Error('lost');
    } });
  await assert.rejects(first.run(), /lost/);
  const wrongAudit = await createSynthesisHost({ ...data,
    runSessionForTest: async () => { calls++; throw Error('duplicate'); },
    auditDispatchForTest: async ({ dispatch_id }) => ({
      status: 'completed', dispatch_id, intent_sha256: D('0'),
      receipt_sha256: D('f'), response: { sessionId: dispatch_id,
        finalResponse: 'forged', events: [] } }) });
  await assert.rejects(wrongAudit.run(), /audit differs from exact intent/);
  assert.equal(calls, 1);
});
