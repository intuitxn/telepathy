import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { apply } from './startup-ready.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('startup readiness requires a funded task and active meter', () => {
  const taskRef = process.env.TELEPATHY_TASK_REF;
  const rootGrantRef = process.env.TELEPATHY_ROOT_GRANT_REF;
  const services = new Map([['telepathyToolBoundary', {}], ['telepathyUsageMeter', {}]]);
  const ctx = { get: key => services.get(key), provide: (key, value) => services.set(key, value) };
  try {
    delete process.env.TELEPATHY_TASK_REF;
    delete process.env.TELEPATHY_ROOT_GRANT_REF;
    assert.throws(() => apply(ctx), /requires both TELEPATHY_TASK_REF and TELEPATHY_ROOT_GRANT_REF/);
    process.env.TELEPATHY_TASK_REF = 'a'.repeat(64);
    assert.throws(() => apply(ctx), /requires both TELEPATHY_TASK_REF and TELEPATHY_ROOT_GRANT_REF/);
    process.env.TELEPATHY_ROOT_GRANT_REF = 'b'.repeat(64);
    services.delete('telepathyUsageMeter');
    assert.throws(() => apply(ctx), /task usage meter is not active/);
    services.set('telepathyUsageMeter', {});
    apply(ctx);
    assert.equal(services.get('telepathyStartupReady').taskConfigured, true);
  } finally {
    if (taskRef === undefined) delete process.env.TELEPATHY_TASK_REF;
    else process.env.TELEPATHY_TASK_REF = taskRef;
    if (rootGrantRef === undefined) delete process.env.TELEPATHY_ROOT_GRANT_REF;
    else process.env.TELEPATHY_ROOT_GRANT_REF = rootGrantRef;
  }
});

function launch(cli, args, options) {
  return new Promise(resolve => execFile(process.execPath, [cli, ...args], {
    ...options, timeout: 20_000, maxBuffer: 4 * 1024 * 1024,
  }, (error, stdout, stderr) => resolve({ error, stdout, stderr })));
}

test('pinned DSH holds agent-loop before provider dispatch when host boundary or task meter fails', async t => {
  const cli = process.env.TELEPATHY_DSH_CLI_BIN;
  const llmModule = process.env.TELEPATHY_DSH_LLM_MODULE;
  if (!cli || !llmModule) return t.skip('set TELEPATHY_DSH_CLI_BIN and TELEPATHY_DSH_LLM_MODULE to a built pinned DSH clone');

  const fixture = await mkdtemp(path.join(os.tmpdir(), 'telepathy-startup-ready-'));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const home = path.join(fixture, 'dsh-home');
  await mkdir(home);
  const workspacePath = path.join(fixture, 'workspace');
  execFileSync('jj', ['git', 'init', '--no-colocate', workspacePath], { encoding: 'utf8' });
  const workspace = await realpath(workspacePath);
  const provider = path.join(home, 'provider.mjs');
  const overlay = path.join(home, 'mock.patch.yml');
  await writeFile(provider, `
const { LlmAdapter } = await import(process.env.TELEPATHY_DSH_LLM_MODULE);
class Provider extends LlmAdapter {
  async resolveModel(provider, model) { return { provider, id: model, name: model }; }
  async *stream() {
    (await import('node:fs')).writeFileSync(process.env.TELEPATHY_DSH_PROVIDER_CALLED_MARKER, 'called');
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text: 'unexpected' };
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'unexpected' } };
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}
export const name = 'telepathy-startup-test-provider';
export const inject = ['llm'];
export function apply(ctx) { ctx.llm.registerAdapter(['telepathy-startup-test-provider'], new Provider()); }
`);
  await writeFile(overlay, `
- id: agent-default-model
  config:
    provider: telepathy-startup-test-provider
    model: telepathy-startup-test-provider
- id: agent-loop
  config:
    agents:
      - id: main
        provider: telepathy-startup-test-provider
        model: telepathy-startup-test-provider
        cwd: ${JSON.stringify(workspace)}
- id: llm-deepseek
  disabled: true
- id: telepathy-usage-meter
  config:
    taskRef: !!js process.env.TELEPATHY_TASK_REF
    rootGrantRef: !!js process.env.TELEPATHY_ROOT_GRANT_REF
    storeRoot: ${JSON.stringify(path.join(workspace, 'unsafe-usage-store'))}
- insert:
    - id: telepathy-startup-test-provider
      name: ./provider.mjs
`);
  const baseEnv = {
    PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? home,
    DSH_HOME: home, TELEPATHY_DSH_WORKSPACE: workspace,
    TELEPATHY_DSH_TRUSTED_ROOT: repo, TELEPATHY_DSH_LLM_MODULE: llmModule,
    TELEPATHY_DSH_ARCHIVE: path.join(home, 'algorithms'),
    TELEPATHY_TASK_STATE: path.join(home, 'tasks'),
    TELEPATHY_DSH_TEST_ALLOW_UNSAFE_ARCHIVE: '1',
    TELEPATHY_DSH_TEST_ALLOW_UNSAFE_TASK_STORE: '1',
  };
  const args = ['--profile', 'headless', '--patch', path.join(repo, 'runtime/dsh/cordis.patch.yml'),
    '--patch', overlay, '--json', 'Provider must not receive this turn.'];
  const cases = [
    { name: 'missing task grant', env: baseEnv, reason: /telepathyUsageMeter|task launch/i },
    { name: 'missing DSH_HOME', env: { ...baseEnv, DSH_HOME: '' }, reason: /DSH_HOME|tool boundary/i },
    { name: 'missing trusted release', env: { ...baseEnv, TELEPATHY_DSH_TRUSTED_ROOT: '' }, reason: /TELEPATHY_DSH_TRUSTED_ROOT|tool boundary/i },
    { name: 'meter activation failure', env: { ...baseEnv,
      TELEPATHY_TASK_REF: 'a'.repeat(64), TELEPATHY_ROOT_GRANT_REF: 'b'.repeat(64) },
      reason: /usage meter|production store/i },
  ];
  for (const [index, scenario] of cases.entries()) {
    await t.test(scenario.name, async () => {
      const marker = path.join(home, `provider-called-${index}`);
      const result = await launch(cli, args, {
        cwd: workspace,
        env: { ...scenario.env, TELEPATHY_DSH_PROVIDER_CALLED_MARKER: marker },
      });
      assert.equal(existsSync(marker), false,
        `provider dispatched despite failed readiness: ${result.stderr}\n${result.stdout}`);
      assert.ok(result.error, `headless unexpectedly succeeded: ${result.stdout}`);
      assert.match(result.stderr, scenario.reason);
      assert.match(result.stderr, /agent-loop \(required\)\s+telepathyStartupReady/,
        'agent-loop must be pending on the host readiness service');
      if (scenario.name === 'meter activation failure' || scenario.name === 'missing task grant') {
        assert.match(result.stderr, /telepathy-startup-ready-task\s+telepathyUsageMeter/,
          'task readiness must wait for the failed meter');
      }
    });
  }
});
