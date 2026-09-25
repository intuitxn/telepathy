import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import test from 'node:test';
import { createTaskControl } from './task-control.mjs';
import { createFundedTaskProgram } from './task-host.mjs';
import { createTaskProgram } from './task-program.mjs';
import { createTaskControlBinding, createUsageMeter } from './usage-meter.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const digest = character => character.repeat(64);
const budget = { tokens: 1000, fuel: 10, children: 0, integrations: 1, evaluations: 0 };

test('keyless SDK worker runs one funded prompt-to-task grant with durable dispatch binding', async t => {
  const cli = process.env.TELEPATHY_DSH_CLI_BIN;
  const llmModule = process.env.TELEPATHY_DSH_LLM_MODULE;
  if (!cli || !llmModule) return t.skip('set built pinned TELEPATHY_DSH_CLI_BIN and TELEPATHY_DSH_LLM_MODULE');
  const sdkModule = process.env.TELEPATHY_DSH_SDK_CLIENT_MODULE ??
    path.resolve(path.dirname(cli), '../../../packages/sdk/client/lib/index.js');
  if (!existsSync(sdkModule)) return t.skip('build the pinned DSH SDK client');
  const { DeepSeekHarness } = await import(pathToFileURL(sdkModule).href);

  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'telepathy-program-sdk-'));
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  const dshHome = path.join(fixtureRoot, 'dsh-home');
  await mkdir(dshHome);
  const workspacePath = path.join(fixtureRoot, 'workspace');
  // This jj repository is disposable test state; the Telepathy checkout is untouched.
  execFileSync('jj', ['git', 'init', '--no-colocate', workspacePath], { encoding: 'utf8' });
  const workspace = await realpath(workspacePath);
  const baseCommit = execFileSync('jj', ['--ignore-working-copy', 'log', '-r', '@-', '--no-graph', '-T', 'commit_id'],
    { cwd: workspace, encoding: 'utf8' }).trim();
  const storeRoot = path.join(fixtureRoot, 'tasks');
  const programRoot = path.join(fixtureRoot, 'programs');
  const providerLog = path.join(fixtureRoot, 'provider-calls.log');
  const controller = createTaskControl({ storeRoot, allowUnsafeStoreRootForTest: true });
  const spec = {
    goal: 'Answer one bounded keyless task', acceptance: 'Independent host oracle accepts evidence',
    scopes: ['research'], integration_owner: 'host', initial_head: baseCommit,
    pinned_versions: { evaluator_sha256: digest('1'), case_set_sha256: digest('2'), toolchain: 'keyless-test' },
    limits: { max_tasks: 1, max_branches: 1, max_active_grants: 1, max_depth: 0,
      tokens: 10_000, fuel: 100, integrations: 1, evaluations: 1 },
    policy_version: 'program-sdk-test-v1',
  };
  const mock = path.join(fixtureRoot, 'mock-llm.mjs');
  const overlay = path.join(fixtureRoot, 'mock.patch.yml');
  await writeFile(mock, `
const { LlmAdapter } = await import(process.env.TELEPATHY_DSH_LLM_MODULE);
class ProgramMock extends LlmAdapter {
  async resolveModel(provider, model) { return { provider, id: model, name: model }; }
  async *stream() {
    (await import('node:fs')).appendFileSync(process.env.TELEPATHY_DSH_PROVIDER_CALL_LOG, 'called\\n');
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text: 'keyless worker answer' };
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'keyless worker answer' } };
    yield { type: 'usage', usage: { inputTokens: 3, outputTokens: 2,
      cacheReadTokens: 4, totalTokens: 9 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}
export const name = 'telepathy-program-mock';
export const inject = ['llm'];
export function apply(ctx) { ctx.llm.registerAdapter(['telepathy-program-mock'], new ProgramMock()); }
`);
  await writeFile(overlay, `
- id: agent-default-model
  config:
    provider: telepathy-program-mock
    model: telepathy-program-mock
- id: llm-deepseek
  disabled: true
- insert:
    - id: telepathy-program-mock
      name: ./mock-llm.mjs
`);

  const prompt = 'Turn this authorized question into one research task.';
  let plannerCalls = 0;
  const sdkResults = [];
  const programSettings = { controller, spec, prompt, programId: 'keyless-sdk-one',
    stateRoot: programRoot, allowUnsafeStateRootForTest: true, maxLiveWorkers: 1,
    planner: async ({ prompt: received, cursor, remaining }) => {
      plannerCalls++;
      assert.equal(received, prompt);
      assert.equal(cursor, null);
      assert.equal(remaining.tasks, 1);
      return { tasks: [{ id: 'research-one', kind: 'research', scope: 'research',
        deliverable: 'Answer the authorized question', acceptance: 'Host oracle checks evidence',
        source_refs: [], oracle_sha256: digest('1'), budget,
        depends_on: [], parent_plan_ref: null }], next_cursor: null, done: true };
    },
    grantForPlan: async ({ plan, task_head }) => {
      assert.equal(plan.id, 'research-one');
      assert.equal(task_head, baseCommit);
      return { branch: 'keyless-root', owner: 'host', budget,
        location: workspace, parent_grant_ref: null };
    },
    worker: async ({ task_ref, grant, plan, dispatch_id }) => {
      const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? dshHome,
        DSH_HOME: dshHome, DSH_PRIMARY_RUNTIME: '',
        TELEPATHY_DSH_WORKSPACE: workspace, TELEPATHY_DSH_TRUSTED_ROOT: repo,
        TELEPATHY_DSH_LLM_MODULE: llmModule,
        TELEPATHY_DSH_ARCHIVE: path.join(dshHome, 'algorithms'),
        TELEPATHY_DSH_PROVIDER_CALL_LOG: providerLog,
        TELEPATHY_TASK_STATE: storeRoot,
        TELEPATHY_TASK_REF: task_ref, TELEPATHY_ROOT_GRANT_REF: grant.ref,
        TELEPATHY_DSH_TEST_ALLOW_UNSAFE_ARCHIVE: '1',
        TELEPATHY_DSH_TEST_ALLOW_UNSAFE_TASK_STORE: '1',
        TELEPATHY_DSH_TEST_ALLOW_UNSAFE_USAGE_STORE: '1' };
      const harness = new DeepSeekHarness({ dshBin: cli, profile: 'sdk',
        patches: [path.join(repo, 'runtime/dsh/cordis.patch.yml'),
          path.join(repo, 'runtime/dsh/research-only.patch.yml'), overlay],
        dshHome, processCwd: workspace, cwd: workspace,
        env, provider: 'telepathy-program-mock', model: 'telepathy-program-mock',
        maxTokens: 64, initializeTimeoutMs: 30_000, requestTimeoutMs: 30_000 });
      try {
        const response = await harness.session(dispatch_id).run(`Complete ${plan.deliverable}.`);
        sdkResults.push(response);
      } finally { await harness.close(); }
    },
  };
  const program = createTaskProgram(programSettings);

  const result = await program.run();
  assert.equal(result.planning_done, true);
  assert.equal(result.planned_count, 1);
  assert.equal(result.dispatched, 1);
  assert.equal(plannerCalls, 1);
  assert.equal(sdkResults.length, 1);
  assert.equal(sdkResults[0].finalResponse, 'keyless worker answer');
  const requestHeaders = sdkResults[0].events.filter(event => event.type === 'request/header');
  assert.ok(requestHeaders.length > 0, 'DSH must record the provider tool catalog');
  assert.doesNotMatch(JSON.stringify(requestHeaders),
    /algorithm_(?:active|run|score|select|execute)/,
    'a research grant must not expose Bend algorithm tools');
  const resumed = await createTaskProgram(programSettings).run();
  assert.equal(resumed.dispatched, 0);
  assert.equal(plannerCalls, 1);
  assert.equal(sdkResults.length, 1);
  const sessionId = sdkResults[0].sessionId;
  const restarted = createTaskControl({ storeRoot, allowUnsafeStoreRootForTest: true });
  const snapshot = await restarted.replay(result.task_ref);
  assert.equal(snapshot.plans.length, 1);
  assert.equal(snapshot.grants.length, 1);
  assert.equal(snapshot.grants[0].session_id, sessionId);
  assert.equal(snapshot.grants[0].status, 'active');
  assert.ok(snapshot.events.some(event => event.type === 'root_session_bound'));
  assert.equal(snapshot.terminal, null, 'model output is not independent verification');
  assert.equal((await readFile(providerLog, 'utf8')).trim(), 'called');
  const meter = createUsageMeter({ storeRoot: path.join(dshHome, 'model-usage'),
    allowUnsafeStoreRootForTest: true,
    bindingForSession: createTaskControlBinding(restarted, result.task_ref) });
  const usage = await meter.snapshotForSession(sessionId);
  assert.equal(usage.used_tokens, 9);
  assert.equal(usage.remaining_tokens, budget.tokens - 9);
  assert.equal(usage.uncertain, false);
});

test('keyless funded planner starts with an empty model tool catalog', async t => {
  const cli = process.env.TELEPATHY_DSH_CLI_BIN;
  const llmModule = process.env.TELEPATHY_DSH_LLM_MODULE;
  if (!cli || !llmModule) return t.skip('set built pinned TELEPATHY_DSH_CLI_BIN and TELEPATHY_DSH_LLM_MODULE');
  const sdkModule = process.env.TELEPATHY_DSH_SDK_CLIENT_MODULE ??
    path.resolve(path.dirname(cli), '../../../packages/sdk/client/lib/index.js');
  if (!existsSync(sdkModule)) return t.skip('build the pinned DSH SDK client');
  const { DeepSeekHarness } = await import(pathToFileURL(sdkModule).href);
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  const root = await mkdtemp(path.join(os.tmpdir(), 'telepathy-planner-catalog-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspacePath = path.join(root, 'workspace');
  execFileSync('jj', ['git', 'init', '--no-colocate', workspacePath], { encoding: 'utf8' });
  const workspace = await realpath(workspacePath);
  const baseCommit = execFileSync('jj', ['--ignore-working-copy', 'log', '-r', '@-', '--no-graph', '-T', 'commit_id'],
    { cwd: workspace, encoding: 'utf8' }).trim();
  const verifierSource = `export function verifyResult() { throw new Error('not evaluated'); }\n`;
  const verifierFile = path.join(root, 'verifier.mjs');
  const caseSetFile = path.join(root, 'cases.json');
  await writeFile(verifierFile, verifierSource);
  await writeFile(caseSetFile, '[]');
  const workerBudget = { tokens: 1000, fuel: 2, children: 0, integrations: 0, evaluations: 1 };
  const spec = { goal: 'Plan one research measurement', acceptance: 'Host oracle accepts measured evidence',
    scopes: ['research'], integration_owner: 'host', initial_head: baseCommit,
    pinned_versions: { evaluator_sha256: sha(verifierSource), case_set_sha256: sha('[]'), toolchain: 'keyless-test' },
    limits: { max_tasks: 2, max_branches: 2, max_active_grants: 1, max_depth: 0,
      tokens: 10_000, fuel: 20, integrations: 1, evaluations: 1 },
    policy_version: 'planner-catalog-test-v1' };
  const page = { tasks: [{ id: 'research-one', kind: 'research', scope: 'research',
    deliverable: 'Measure the claim', acceptance: 'Supply measured evidence', source_refs: [],
    oracle_sha256: spec.pinned_versions.evaluator_sha256, budget: workerBudget,
    depends_on: [], parent_plan_ref: null }], next_cursor: null, done: true };
  const mock = path.join(root, 'mock-llm.mjs');
  const overlay = path.join(root, 'mock.patch.yml');
  await writeFile(mock, `
const { LlmAdapter } = await import(process.env.TELEPATHY_DSH_LLM_MODULE);
class PlannerMock extends LlmAdapter {
  async resolveModel(provider, model) { return { provider, id: model, name: model }; }
  async *stream() {
    const answer = ${JSON.stringify(JSON.stringify(page))};
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text: answer };
    yield { type: 'block-end', index: 0, block: { type: 'text', text: answer } };
    yield { type: 'usage', usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}
export const name = 'telepathy-planner-catalog-mock';
export const inject = ['llm'];
export function apply(ctx) { ctx.llm.registerAdapter(['telepathy-planner-catalog-mock'], new PlannerMock()); }
`);
  await writeFile(overlay, `
- id: agent-default-model
  config:
    provider: telepathy-planner-catalog-mock
    model: telepathy-planner-catalog-mock
- id: llm-deepseek
  disabled: true
- insert:
    - id: telepathy-planner-catalog-mock
      name: ./mock-llm.mjs
`);
  const dshHome = path.join(root, 'dsh-home');
  await mkdir(dshHome);
  const archiveRoot = path.join(root, 'archive');
  let sdkResponse;
  const host = await createFundedTaskProgram({ spec, prompt: 'Measure one claim.',
    programId: 'keyless-planner-catalog', targetTasks: 1,
    plannerBudget: { tokens: 1000, fuel: 2, children: 0, integrations: 0, evaluations: 0 },
    workerBudget, plannerWorkspace: workspace, verifierFile, caseSetFile,
    stateRoot: path.join(root, 'programs'), taskStateRoot: path.join(root, 'tasks'),
    archiveRoot, allowUnsafeRootsForTest: true, allowMockRunnerForTest: true,
    runPlannerSessionForTest: async ({ task_ref, grant, session_id, prompt }) => {
      const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? dshHome,
        DSH_HOME: dshHome, DSH_PRIMARY_RUNTIME: '', TELEPATHY_DSH_WORKSPACE: workspace,
        TELEPATHY_DSH_TRUSTED_ROOT: repo, TELEPATHY_DSH_LLM_MODULE: llmModule,
        TELEPATHY_TASK_STATE: path.join(root, 'tasks'), TELEPATHY_TASK_REF: task_ref,
        TELEPATHY_ROOT_GRANT_REF: grant.ref,
        TELEPATHY_DSH_TEST_ALLOW_UNSAFE_TASK_STORE: '1',
        TELEPATHY_DSH_TEST_ALLOW_UNSAFE_USAGE_STORE: '1' };
      const harness = new DeepSeekHarness({ dshBin: cli, profile: 'sdk',
        patches: [path.join(repo, 'runtime/dsh/cordis.patch.yml'),
          path.join(repo, 'runtime/dsh/research-only.patch.yml'),
          path.join(archiveRoot, 'planner-no-tools.patch.yml'), overlay],
        dshHome, processCwd: workspace, cwd: workspace, env,
        provider: 'telepathy-planner-catalog-mock', model: 'telepathy-planner-catalog-mock',
        maxTokens: 64, initializeTimeoutMs: 30_000, requestTimeoutMs: 30_000 });
      try { sdkResponse = await harness.session(session_id).run(prompt); }
      finally { await harness.close(); }
      return sdkResponse;
    },
    grantForPlan: async () => ({ branch: 'research-one', owner: 'host', budget: workerBudget,
      location: path.join(root, 'worker'), parent_grant_ref: null }),
    worker: async () => {} });
  const progress = await host.run();
  assert.equal(progress.planned_count, 1);
  assert.equal(sdkResponse.finalResponse, JSON.stringify(page));
  const headers = sdkResponse.events.filter(event => event.type === 'request/header');
  assert.ok(headers.length > 0, 'the pinned DSH request must record a tool catalog');
  for (const header of headers)
    assert.equal(header.data.header.tools?.length ?? 0, 0,
      `planner model tool catalog is not empty: ${JSON.stringify(header.data.header.tools)}`);
});
