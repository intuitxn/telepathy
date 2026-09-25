import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('pinned DSH discovers a checked-release skill from a nested SDK session cwd', async t => {
  const cli = process.env.TELEPATHY_DSH_CLI_BIN;
  if (!cli) return t.skip('set TELEPATHY_DSH_CLI_BIN to a built pinned DSH checkout');
  const home = await mkdtemp(path.join(os.tmpdir(), 'telepathy-dsh-skill-'));
  const patch = path.join(home, 'probe.patch.yml');
  const plugin = path.join(home, 'probe.mjs');
  const output = path.join(home, 'probe.json');
  const trustedRoot = path.join(home, 'checked-release');
  const checkedSkill = path.join(trustedRoot, '.agents/skills/telepathy-release-probe/SKILL.md');
  await mkdir(path.dirname(checkedSkill), { recursive: true });
  await writeFile(checkedSkill, '---\nname: telepathy-release-probe\ndescription: Verify checked release skill discovery.\n---\n\n# Probe\n');
  const nested = path.join(repo, 'runtime/dsh');
  await writeFile(patch, '- insert:\n    - id: telepathy-skill-probe\n      name: ./probe.mjs\n');
  await writeFile(plugin, `
import { writeFile } from 'node:fs/promises';
export const name = 'telepathy-skill-probe';
export const inject = ['skills', 'sandboxPolicy'];
export async function apply(ctx) {
  const cwd = process.env.TELEPATHY_DSH_SKILL_PROBE_CWD;
  const summaries = await ctx.skills.list({ cwd });
  const skill = await ctx.skills.get('telepathy-release-probe', { cwd });
  await writeFile(process.env.TELEPATHY_DSH_SKILL_PROBE_OUTPUT,
    JSON.stringify({ names: summaries.map(item => item.name), path: skill?.path ?? null,
      sandboxMode: ctx.sandboxPolicy?.defaultMode ?? null,
      usageMeter: typeof ctx.get('telepathyUsageMeter')?.snapshotForSession === 'function' }) + '\\n');
}
`);
  const child = spawn(process.execPath,
    [cli, '--profile', 'sdk', '--patch', 'runtime/dsh/cordis.patch.yml', '--patch', patch],
    { cwd: repo, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? home,
      DSH_HOME: home, TELEPATHY_DSH_WORKSPACE: repo,
      TELEPATHY_DSH_TRUSTED_ROOT: trustedRoot,
      TELEPATHY_DSH_TEST_ALLOW_UNSAFE_ARCHIVE: '1',
      TELEPATHY_DSH_TEST_ALLOW_UNSAFE_TASK_STORE: '1',
      TELEPATHY_DSH_TEST_ALLOW_UNSAFE_USAGE_STORE: '1',
      TELEPATHY_TASK_REF: 'a'.repeat(64), TELEPATHY_ROOT_GRANT_REF: 'b'.repeat(64),
      TELEPATHY_DSH_SKILL_PROBE_CWD: nested, TELEPATHY_DSH_SKILL_PROBE_OUTPUT: output },
    stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.end();
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  child.stdout.resume();
  const exitCode = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error('DSH skill probe timed out')); }, 30_000);
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('close', code => { clearTimeout(timeout); resolve(code); });
  });
  assert.equal(exitCode, 0, stderr);
  const result = JSON.parse(await readFile(output, 'utf8'));
  assert.ok(result.names.includes('telepathy-release-probe'));
  assert.equal(result.path, await realpath(checkedSkill));
  assert.equal(result.sandboxMode, 'workspace-write');
  assert.equal(result.usageMeter, true, stderr);
});
