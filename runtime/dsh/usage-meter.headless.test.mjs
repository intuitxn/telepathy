import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createTaskControl } from './task-control.mjs';
import { createTaskControlBinding, createUsageMeter } from './usage-meter.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const digest = character => character.repeat(64);
const budget = { tokens: 1_000, fuel: 10, children: 0, integrations: 1, evaluations: 0 };

function execute(file, args, options) {
  return new Promise((resolve, reject) => execFile(file, args, {
    ...options, timeout: 60_000, maxBuffer: 4 * 1024 * 1024,
  }, (error, stdout, stderr) => error ? reject(new Error(`${error.message}\n${stderr}\n${stdout}`))
    : resolve({ stdout, stderr })));
}

async function fundedRoot(storeRoot, workspace) {
  const baseCommit = execFileSync('jj', ['--ignore-working-copy', 'log', '-r', '@-', '--no-graph', '-T', 'commit_id'],
    { cwd: workspace, encoding: 'utf8' }).trim();
  const controller = createTaskControl({ storeRoot, allowUnsafeStoreRootForTest: true });
  const opened = await controller.open({
    goal: 'Measure a keyless DSH model turn', acceptance: 'Provider usage reaches the host ledger',
    scopes: ['meter'], integration_owner: 'host', initial_head: baseCommit,
    pinned_versions: { evaluator_sha256: digest('1'), case_set_sha256: digest('2'), toolchain: 'test' },
    limits: { max_tasks: 1, max_branches: 1, max_active_grants: 1, max_depth: 0,
      tokens: 10_000, fuel: 100, integrations: 1, evaluations: 1 },
    policy_version: 'usage-meter-test-v1',
  });
  const planned = await controller.plan(opened.task_ref, {
    id: 'meter-plan', kind: 'evaluation', scope: 'meter', deliverable: 'One measured turn',
    acceptance: 'Ledger charges provider usage', source_refs: [], oracle_sha256: digest('1'),
    budget, depends_on: [], parent_plan_ref: null, expected_log_head: opened.log_head,
  });
  const head = await controller.replay(opened.task_ref);
  const granted = await controller.grant(opened.task_ref, {
    id: 'meter-grant', plan_ref: planned.plan_ref, branch: 'meter-root', owner: 'host',
    scope: 'meter', deliverable: 'One measured turn',
    base_refs: { task_commit: head.task_head, causal_event: head.log_head },
    budget, location: workspace, parent_grant_ref: null,
  });
  return { controller, taskRef: opened.task_ref, grantRef: granted.grant_ref };
}

test('pinned DSH production patch charges provider usage to the bound root grant', async t => {
  const cli = process.env.TELEPATHY_DSH_CLI_BIN;
  const llmModule = process.env.TELEPATHY_DSH_LLM_MODULE;
  if (!cli || !llmModule) return t.skip('set TELEPATHY_DSH_CLI_BIN and TELEPATHY_DSH_LLM_MODULE to a built pinned DSH clone');

  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'telepathy-usage-headless-'));
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  const home = path.join(fixtureRoot, 'dsh-home');
  await mkdir(home);
  const workspacePath = path.join(fixtureRoot, 'workspace');
  execFileSync('jj', ['git', 'init', '--no-colocate', workspacePath], { encoding: 'utf8' });
  const workspace = await realpath(workspacePath);
  const storeRoot = path.join(home, 'tasks');
  const overlay = path.join(home, 'mock.patch.yml');
  const mock = path.join(home, 'mock-llm.mjs');
  const providerLog = path.join(home, 'provider-calls.log');
  const { controller, taskRef, grantRef } = await fundedRoot(storeRoot, workspace);
  await writeFile(mock, `
const { LlmAdapter } = await import(process.env.TELEPATHY_DSH_LLM_MODULE);
class UsageMock extends LlmAdapter {
  async resolveModel(provider, model) { return { provider, id: model, name: model }; }
  async *stream() {
    if (process.env.TELEPATHY_DSH_PROVIDER_CALL_LOG)
      (await import('node:fs')).appendFileSync(process.env.TELEPATHY_DSH_PROVIDER_CALL_LOG, 'called\\n');
    if (process.env.TELEPATHY_DSH_PROVIDER_CALLED_MARKER)
      (await import('node:fs')).writeFileSync(process.env.TELEPATHY_DSH_PROVIDER_CALLED_MARKER, 'called');
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text: 'metered' };
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'metered' } };
    yield { type: 'usage', usage: { inputTokens: 3, outputTokens: 2,
      cacheReadTokens: 4, totalTokens: 9 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}
export const name = 'telepathy-usage-mock';
export const inject = ['llm'];
export function apply(ctx) { ctx.llm.registerAdapter(['telepathy-usage-mock'], new UsageMock()); }
`);
  await writeFile(overlay, `
- id: agent-default-model
  config:
    provider: telepathy-usage-mock
    model: telepathy-usage-mock
- id: agent-loop
  config:
    agents:
      - id: main
        provider: telepathy-usage-mock
        model: telepathy-usage-mock
        cwd: ${JSON.stringify(workspace)}
- id: llm-deepseek
  disabled: true
- insert:
    - id: telepathy-usage-mock
      name: ./mock-llm.mjs
`);
  const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? home,
    DSH_HOME: home, TELEPATHY_DSH_WORKSPACE: workspace, TELEPATHY_DSH_TRUSTED_ROOT: repo,
    TELEPATHY_DSH_LLM_MODULE: llmModule, TELEPATHY_DSH_ARCHIVE: path.join(home, 'algorithms'),
    TELEPATHY_DSH_PROVIDER_CALL_LOG: providerLog,
    TELEPATHY_TASK_STATE: storeRoot, TELEPATHY_TASK_REF: taskRef, TELEPATHY_ROOT_GRANT_REF: grantRef,
    TELEPATHY_DSH_TEST_ALLOW_UNSAFE_ARCHIVE: '1',
    TELEPATHY_DSH_TEST_ALLOW_UNSAFE_TASK_STORE: '1',
    TELEPATHY_DSH_TEST_ALLOW_UNSAFE_USAGE_STORE: '1' };
  let stdout;
  try {
    ({ stdout } = await execute(process.execPath,
      [cli, '--profile', 'headless', '--patch', path.join(repo, 'runtime/dsh/cordis.patch.yml'),
        '--patch', overlay, '--json', 'Return one short answer.'], { cwd: workspace, env }));
  } catch (error) {
    const ledger = path.join(home, 'model-usage', 'usage.sqlite');
    if (existsSync(ledger)) {
      const db = new DatabaseSync(ledger);
      try { error.message += `\nledger=${JSON.stringify(db.prepare('SELECT * FROM grants').all())}`; }
      finally { db.close(); }
    }
    throw error;
  }
  const events = stdout.trim().split('\n').map(line => JSON.parse(line));
  const sessionId = events.find(event => event.type === 'session')?.sessionId;
  assert.ok(sessionId, stdout);
  assert.equal(events.at(-1)?.type, 'final', stdout);
  const grant = (await controller.replay(taskRef)).grants.find(row => row.ref === grantRef);
  assert.equal(grant.session_id, sessionId);
  const meter = createUsageMeter({ storeRoot: path.join(home, 'model-usage'),
    allowUnsafeStoreRootForTest: true,
    bindingForSession: createTaskControlBinding(controller, taskRef) });
  const snapshot = await meter.snapshotForSession(sessionId);
  const providerCalls = (await readFile(providerLog, 'utf8')).trim().split('\n').length;
  assert.ok(providerCalls >= 1);
  assert.equal(snapshot.used_tokens, 9 * providerCalls, JSON.stringify({ snapshot, providerCalls }));
  assert.equal(snapshot.remaining_tokens, budget.tokens - 9 * providerCalls);
  assert.equal(snapshot.uncertain, false, JSON.stringify({ snapshot, events }));

  const marker = path.join(home, 'partial-provider-called');
  await assert.rejects(execute(process.execPath,
    [cli, '--profile', 'headless', '--patch', path.join(repo, 'runtime/dsh/cordis.patch.yml'),
      '--patch', overlay, '--json', 'This partial task launch must fail before the provider.'],
    { cwd: workspace, env: { ...env, TELEPATHY_ROOT_GRANT_REF: '',
      TELEPATHY_DSH_PROVIDER_CALLED_MARKER: marker } }), /telepathyStartupReady|no agent factory registered/);
  assert.equal(existsSync(marker), false, 'partially configured task must never reach the model provider');
});
