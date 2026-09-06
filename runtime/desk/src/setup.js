import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, home } from './core.js';
import { checked } from './process.js';
export async function setup() {
  const base = home(); mkdirSync(base, { recursive: true, mode: 0o700 });
  const configFile = join(base, 'config.json');
  if (!existsSync(configFile)) writeFileSync(configFile, JSON.stringify({ runtime: 'codex', model: null, repositories: [ROOT], channels: [], authorizedPubkeys: [], since: Math.floor(Date.now()/1000), timeoutSeconds: 900, pollSeconds: 15 }, null, 2));
  await checked('npm', ['run', 'build', '--workspace=@telepathy/opencode-plugin'], { cwd: ROOT });
  const configDir = join(base, 'opencode/config/opencode'); mkdirSync(configDir, { recursive: true });
  const rules = [
    { action: '*', resource: '*', effect: 'ask' },
    ...['read','glob','grep','edit'].map(action => ({ action, resource: '*', effect: 'allow' })),
    { action: 'read', resource: '*.env*', effect: 'deny' },
    { action: 'subagent', resource: '*', effect: 'deny' },
    { action: 'telepathy_publish', resource: '*', effect: 'deny' },
  ];
  const runtime = {
    '$schema': 'https://opencode.ai/config.json',
    default_agent: 'intuitxn', warming: false,
    plugins: [join(ROOT, 'plugins/telepathy')],
    agents: {
      intuitxn: { mode: 'primary', description: 'Route intent to the narrowest telepathy agent; the desk engine executes jobs; Buzz relay is the human context.', system: 'Read AGENTS.md and docs/HARNESS_STATE.md. Route intent to the narrowest telepathy agent. The desk engine executes jobs; the Buzz relay is the human context layer. Company writing lives in artifacts. Draft first; humans accept; preserve sources and actual authorship.', permissions: [{ action: 'telepathy_draft', resource: '*', effect: 'allow' }] },
      'intuitxn-build': { mode: 'primary', description: 'Execute one accepted job in its assigned worktree with verification evidence.', system: 'Execute the provided job brief in the assigned worktree and verify it. Record changed files, verification commands and outcomes, unresolved issues, and the exact revision. Do not publish, push, merge, commit, or declare acceptance. State limits honestly.', permissions: rules },
    },
  };
  writeFileSync(join(configDir, 'opencode.json'), JSON.stringify(runtime, null, 2));
  writeFileSync(join(configDir, 'AGENTS.md'), readFileSync(join(ROOT, 'AGENTS.md'), 'utf8'));
  console.log(`Ready. Settings: ${configFile}\nNext: npm run doctor\nWrite: npm run desk -- new report "Report title"\nOpenCode: npm run opencode`);
}
if (process.argv[1] === new URL(import.meta.url).pathname) await setup();
