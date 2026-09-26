import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { link, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createTaskControl } from './task-control.mjs';
import { apply, createToolBoundary } from './tool-boundary.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function call(agent, name, filePath, extra = {}) {
  return { agent, name, arguments: { file_path: filePath, ...extra } };
}

function execute(file, args, options) {
  return new Promise((resolve, reject) => execFile(file, args, {
    ...options, timeout: 90_000, maxBuffer: 8 * 1024 * 1024,
  }, (error, stdout, stderr) => error
    ? reject(new Error(`${error.message}\n${stderr}\n${stdout}`))
    : resolve({ stdout, stderr })));
}

test('model file tools are confined to canonical source paths and all other tools fail closed', async t => {
  const created = await mkdtemp(path.join(os.tmpdir(), 'telepathy-tool-boundary-'));
  const temp = await realpath(created);
  t.after(() => rm(created, { recursive: true, force: true }));
  const workspace = path.join(temp, 'workspace');
  const home = path.join(temp, 'dsh-home');
  const release = path.join(temp, 'release');
  await Promise.all([mkdir(path.join(workspace, 'runtime/core'), { recursive: true }),
    mkdir(path.join(workspace, '.jj'), { recursive: true }), mkdir(home), mkdir(release)]);
  await writeFile(path.join(workspace, 'runtime/core/kernel.bend'), 'def main(): 1\n');
  await writeFile(path.join(workspace, '.jj/repo'), '../../private-repo');
  await writeFile(path.join(home, '.credentials.yaml'), 'DEEPSEEK_API_KEY: private-test-value\n');
  await symlink(home, path.join(workspace, 'linked-home'));
  await symlink(path.join(workspace, '.jj'), path.join(workspace, 'linked-control'));
  await link(path.join(home, '.credentials.yaml'), path.join(workspace, 'hardlinked-secret'));
  const boundary = createToolBoundary({ workspaceRoot: workspace, privateRoots: [home, release] });
  const root = { session: { id: 'root', header: { cwd: workspace, origin: 'user' } } };

  assert.equal(boundary.guard(call(root, 'read', 'runtime/core/kernel.bend')), undefined);
  assert.equal(boundary.guard(call(root, 'write', 'runtime/core/new.bend')), undefined);
  assert.equal(boundary.guard(call(root, 'edit', 'runtime/core/kernel.bend')), undefined);
  assert.equal(boundary.guard(call(root, 'read_image', 'runtime/core/kernel.bend')), undefined);
  assert.equal(boundary.guard(call(root, 'algorithm_run', 'runtime/core/kernel.bend')), undefined);
  for (const name of ['bash', 'run_code', 'glob', 'grep', 'web_fetch', 'web_search',
    'workflow', 'subagent', 'subagent_fork', 'job_output', 'load_skill',
    'algorithm_score', 'algorithm_select', 'unknown']) {
    assert.match(boundary.guard(call(root, name, 'runtime/core/kernel.bend')), /outside.*capability/);
  }
  for (const target of [path.join(home, '.credentials.yaml'), '../dsh-home/.credentials.yaml',
    '.jj/repo', 'linked-control/repo', 'linked-home/.credentials.yaml',
    'hardlinked-secret', 'runtime/dsh/core.mjs', 'scripts/check.mjs',
    'package.json', 'Makefile', 'AGENTS.md', 'CLAUDE.md',
    '.agents/skills/bend-kernels/SKILL.md', 'runtime/core/.env.local']) {
    assert.notEqual(boundary.guard(call(root, 'read', target)), undefined, target);
    assert.notEqual(boundary.guard(call(root, 'write', target)), undefined, target);
  }
  assert.match(boundary.guard(call(root, 'write', 'runtime/core/new.bend',
    { sandbox_permissions: 'danger-full-access', justification: 'test' })), /escalation/);
  assert.match(boundary.guard(call(root, 'read', '')), /valid file_path/);
  assert.match(boundary.guard(call(root, 'read', 'runtime/core/\0secret')), /valid file_path/);
  const wrongRoot = { session: { id: 'other', header: { cwd: home, origin: 'user' } } };
  assert.match(boundary.guard(call(wrongRoot, 'read', 'runtime/core/kernel.bend')), /outside.*workspace/);
  assert.match(boundary.guard({ name: 'read', arguments: { file_path: 'runtime/core/kernel.bend' } }), /bound DSH session/);
  assert.throws(() => createToolBoundary({ workspaceRoot: workspace,
    privateRoots: [path.join(workspace, '.jj')] }), /private DSH state/);
  assert.throws(() => createToolBoundary({ workspaceRoot: workspace,
    privateRoots: [temp] }), /private DSH state/);
  assert.notEqual(boundary.guard(call(root, 'read', '.JJ/repo')), undefined);
  assert.notEqual(boundary.guard(call(root, 'write', 'NODE_MODULES/poison.js')), undefined);
});

test('child file tools require a host binding to the same Agent and grant location', async t => {
  const created = await mkdtemp(path.join(os.tmpdir(), 'telepathy-child-boundary-'));
  const temp = await realpath(created);
  t.after(() => rm(created, { recursive: true, force: true }));
  const root = path.join(temp, 'root');
  const child = path.join(temp, 'child');
  await Promise.all([mkdir(root), mkdir(child)]);
  const boundary = createToolBoundary({ workspaceRoot: root });
  const agent = { session: { id: 'child-id', header: {
    origin: 'subagent', parentSession: 'root-id', cwd: child, delegationDepth: 1,
  } } };
  const grant = { ref: 'a'.repeat(64), parent_grant_ref: 'b'.repeat(64),
    status: 'active', location: child, depth: 1 };
  assert.match(boundary.guard(call(agent, 'read', 'candidate.bend')), /no verified workspace grant/);
  assert.throws(() => boundary.bindChildWorkspace(agent, { ...grant, location: root }), /metadata differs/);
  boundary.bindChildWorkspace(agent, grant);
  assert.equal(boundary.guard(call(agent, 'write', 'candidate.bend')), undefined);
  assert.match(boundary.guard(call(agent, 'read', path.join(root, 'source.bend'))), /outside.*workspace/);
  assert.match(boundary.guard(call({ session: { ...agent.session } }, 'read', 'candidate.bend')), /no verified workspace grant/);
  assert.throws(() => boundary.bindChildWorkspace(agent, grant), /already bound/);
});

test('production plugin requires explicit private roots outside the model workspace', async t => {
  const created = await mkdtemp(path.join(os.tmpdir(), 'telepathy-tool-boundary-apply-'));
  const temp = await realpath(created);
  t.after(() => rm(created, { recursive: true, force: true }));
  const workspace = path.join(temp, 'workspace');
  const home = path.join(temp, 'dsh-home');
  const release = path.join(temp, 'release');
  await Promise.all([mkdir(workspace), mkdir(home), mkdir(release)]);
  const originalHome = process.env.DSH_HOME;
  const originalTrusted = process.env.TELEPATHY_DSH_TRUSTED_ROOT;
  const installed = {};
  const ctx = { tools: { guard(fn) { installed.guard = fn; } },
    provide(key, value) { installed[key] = value; } };
  try {
    delete process.env.DSH_HOME;
    process.env.TELEPATHY_DSH_TRUSTED_ROOT = release;
    assert.throws(() => apply(ctx, { workspaceRoot: workspace }), /DSH_HOME must be an absolute path/);
    process.env.DSH_HOME = home;
    delete process.env.TELEPATHY_DSH_TRUSTED_ROOT;
    assert.throws(() => apply(ctx, { workspaceRoot: workspace }), /TELEPATHY_DSH_TRUSTED_ROOT must be an absolute path/);
    process.env.TELEPATHY_DSH_TRUSTED_ROOT = temp;
    assert.throws(() => apply(ctx, { workspaceRoot: workspace }), /overlaps the model workspace/);
    process.env.TELEPATHY_DSH_TRUSTED_ROOT = release;
    apply(ctx, { workspaceRoot: workspace });
    assert.equal(typeof installed.guard, 'function');
    assert.equal(typeof installed.telepathyToolBoundary.bindChildWorkspace, 'function');
  } finally {
    if (originalHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = originalHome;
    if (originalTrusted === undefined) delete process.env.TELEPATHY_DSH_TRUSTED_ROOT;
    else process.env.TELEPATHY_DSH_TRUSTED_ROOT = originalTrusted;
  }
});

test('pinned headless DSH enforces the production boundary and still writes workspace source', async t => {
  const cli = process.env.TELEPATHY_DSH_CLI_BIN;
  const llm = process.env.TELEPATHY_DSH_LLM_MODULE;
  if (!cli || !llm || !existsSync(cli) || !existsSync(llm))
    return t.skip('set TELEPATHY_DSH_CLI_BIN and TELEPATHY_DSH_LLM_MODULE for the pinned DSH smoke');
  const created = await mkdtemp(path.join(os.tmpdir(), 'telepathy-tool-boundary-dsh-'));
  const temp = await realpath(created);
  t.after(() => rm(created, { recursive: true, force: true }));
  const workspace = path.join(temp, 'workspace');
  const home = path.join(temp, 'home');
  await mkdir(home);
  execFileSync('jj', ['git', 'init', '--no-colocate', workspace], { encoding: 'utf8' });
  await mkdir(path.join(workspace, 'runtime/core'), { recursive: true });
  const secret = path.join(home, '.credentials.yaml');
  await writeFile(secret, 'DEEPSEEK_API_KEY: private-smoke-value\n');
  const baseCommit = execFileSync('jj', ['--ignore-working-copy', 'log', '-r', '@-', '--no-graph', '-T', 'commit_id'],
    { cwd: workspace, encoding: 'utf8' }).trim();
  const taskStore = path.join(home, 'tasks');
  const controller = createTaskControl({ storeRoot: taskStore, allowUnsafeStoreRootForTest: true });
  const digest = character => character.repeat(64);
  const budget = { tokens: 1000, fuel: 10, children: 0, integrations: 1, evaluations: 0 };
  const opened = await controller.open({ goal: 'Exercise guarded production file tools',
    acceptance: 'Mock provider calls stay inside the granted workspace', scopes: ['boundary'],
    integration_owner: 'host', initial_head: baseCommit,
    pinned_versions: { evaluator_sha256: digest('1'), case_set_sha256: digest('2'), toolchain: 'test' },
    limits: { max_tasks: 1, max_branches: 1, max_active_grants: 1, max_depth: 0,
      tokens: 10_000, fuel: 100, integrations: 1, evaluations: 1 },
    policy_version: 'tool-boundary-smoke-v1' });
  const planned = await controller.plan(opened.task_ref, { id: 'boundary-plan', kind: 'implementation',
    scope: 'boundary', deliverable: 'Exercise guarded file tools',
    acceptance: 'Private paths are denied; source writes succeed', source_refs: [],
    oracle_sha256: digest('1'), budget, depends_on: [], parent_plan_ref: null,
    expected_log_head: opened.log_head });
  const head = await controller.replay(opened.task_ref);
  const granted = await controller.grant(opened.task_ref, { id: 'boundary-grant',
    plan_ref: planned.plan_ref, branch: 'boundary-root', owner: 'host', scope: 'boundary',
    deliverable: 'Exercise guarded file tools',
    base_refs: { task_commit: head.task_head, causal_event: head.log_head },
    budget, location: workspace, parent_grant_ref: null });
  const adapter = path.join(temp, 'mock-llm.mjs');
  const overlay = path.join(temp, 'mock.patch.yml');
  await writeFile(adapter, `
const { LlmAdapter, ToolCallId } = await import(process.env.TELEPATHY_DSH_LLM_MODULE);
let step = 0;
class BoundaryMock extends LlmAdapter {
  async resolveModel(provider, model) { return { provider, id: model, name: model }; }
  async *stream(options) {
    const visible = new Set((options.tools ?? []).map(tool => tool.name));
    if (!['read', 'write', 'edit'].every(name => visible.has(name)) ||
        ['bash', 'pwsh', 'grep', 'glob', 'web_search', 'web_fetch',
          'workflow', 'subagent', 'subagent_fork', 'run_code'].some(name => visible.has(name))) {
      throw new Error('production patch exposed an unsafe model tool set');
    }
    const calls = [
      { name: 'read', args: { file_path: process.env.TELEPATHY_TEST_SECRET } },
      { name: 'write', args: { file_path: 'runtime/core/new.bend', content: 'def main(): 1\\n' } },
      { name: 'read', args: { file_path: '.jj/repo' } },
      { name: 'read', args: { file_path: 'runtime/core/new.bend' } },
    ];
    const call = calls[step++];
    if (call) {
      const id = ToolCallId('boundary-' + step);
      const args = JSON.stringify(call.args);
      yield { type: 'block-start', index: 0, blockType: 'tool-call' };
      yield { type: 'tool-call-delta', index: 0, id, name: call.name, argumentsDelta: args };
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: call.name, arguments: args } };
      yield { type: 'usage', usage: { inputTokens: 4, outputTokens: 2 } };
      yield { type: 'finish', reason: { kind: 'tool-calls' } };
    } else {
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text: 'boundary complete' };
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'boundary complete' } };
      yield { type: 'usage', usage: { inputTokens: 4, outputTokens: 2 } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }
}
export const name = 'telepathy-boundary-mock';
export const inject = ['llm'];
export function apply(ctx) { ctx.llm.registerAdapter(['telepathy-boundary-mock'], new BoundaryMock()); }
`);
  await writeFile(overlay, `
- id: agent-default-model
  config:
    provider: telepathy-boundary-mock
    model: telepathy-boundary-mock
- id: llm-deepseek
  disabled: true
- insert:
    - id: telepathy-boundary-mock
      name: ./mock-llm.mjs
`);
  const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? home,
    DSH_HOME: home, TELEPATHY_DSH_WORKSPACE: workspace, TELEPATHY_DSH_TRUSTED_ROOT: repo,
    TELEPATHY_DSH_LLM_MODULE: llm, TELEPATHY_DSH_ARCHIVE: path.join(home, 'algorithms'),
    TELEPATHY_DSH_TEST_ALLOW_UNSAFE_ARCHIVE: '1', TELEPATHY_TEST_SECRET: secret,
    TELEPATHY_TASK_STATE: taskStore, TELEPATHY_TASK_REF: opened.task_ref,
    TELEPATHY_ROOT_GRANT_REF: granted.grant_ref,
    TELEPATHY_DSH_TEST_ALLOW_UNSAFE_TASK_STORE: '1',
    TELEPATHY_DSH_TEST_ALLOW_UNSAFE_USAGE_STORE: '1' };
  const { stdout } = await execute(process.execPath,
    [cli, '--profile', 'headless', '--patch', path.join(repo, 'runtime/dsh/cordis.patch.yml'),
      '--patch', overlay, '--json', 'Exercise the guarded file tools.'], { cwd: workspace, env });
  const events = stdout.trim().split('\n').map(line => JSON.parse(line));
  const results = events.filter(event => event.type === 'tool_result');
  assert.equal(results.length, 4, stdout);
  assert.equal(results[0].status, 'error', stdout);
  assert.equal(results[1].status, 'completed', stdout);
  assert.equal(results[2].status, 'error', stdout);
  assert.equal(results[3].status, 'completed', stdout);
  assert.equal(await readFile(path.join(workspace, 'runtime/core/new.bend'), 'utf8'), 'def main(): 1\n');
  assert.ok(!stdout.includes('private-smoke-value'), stdout);
  assert.equal(events.at(-1)?.type, 'final', stdout);
  const sessionId = events.find(event => event.type === 'session')?.sessionId;
  assert.equal((await controller.replay(opened.task_ref)).grants.find(row => row.ref === granted.grant_ref).session_id,
    sessionId);
});
