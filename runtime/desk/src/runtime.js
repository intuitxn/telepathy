import { join } from 'node:path';
import { homedir } from 'node:os';
import { OpenCode } from '@opencode-ai/client';
import { Service } from '@opencode-ai/client/service';
import { home, ROOT } from './core.js';

// Fork runtime (oc2): the resident opencode2 node build. Its work profile has an
// authenticated opencode-go provider, so headless `opencode run` executes real
// model work — unlike the upstream beta's free zen tier, which is interactive-only.
export const FORK_BIN = join(homedir(), 'opencode2/packages/opencode/dist/opencode-darwin-arm64/bin/opencode');
export const DEFAULT_FORK_MODEL = 'opencode-go/deepseek-v4-flash';
export function forkEnv() {
  const base = join(homedir(), '.opencode2-profiles/work');
  const env = { ...process.env,
    XDG_CONFIG_HOME: join(base, 'config'), XDG_DATA_HOME: join(base, 'data'),
    XDG_STATE_HOME: join(base, 'state'), XDG_CACHE_HOME: join(base, 'cache'),
    OPENCODE_DB: join(base, 'data/opencode/opencode.db'),
  };
  for (const key of ['OPENCODE_CONFIG', 'OPENCODE_CONFIG_CONTENT', 'OPENCODE_CONFIG_DIR', 'OPENCODE_DISABLE_PROJECT_CONFIG']) delete env[key];
  return env;
}
export function runtimeEnv() {
  const base = join(home(), 'opencode');
  const env = { ...process.env, XDG_CONFIG_HOME: join(base, 'config'), XDG_DATA_HOME: join(base, 'data'), XDG_STATE_HOME: join(base, 'state'), XDG_CACHE_HOME: join(base, 'cache'), OPENCODE_DB: join(base, 'data/opencode/opencode.db') };
  for (const key of ['OPENCODE_CONFIG','OPENCODE_CONFIG_CONTENT','OPENCODE_CONFIG_DIR','OPENCODE_DISABLE_PROJECT_CONFIG']) delete env[key];
  return env;
}
export const cliPath = () => join(ROOT, 'node_modules/.bin/opencode2');
export async function connect() {
  Object.assign(process.env, runtimeEnv());
  for (const key of ['OPENCODE_CONFIG','OPENCODE_CONFIG_CONTENT','OPENCODE_CONFIG_DIR','OPENCODE_DISABLE_PROJECT_CONFIG']) delete process.env[key];
  const endpoint = await Service.ensure({ version: '0.0.0-beta-19192', command: [cliPath(), 'serve', '--service'] });
  return OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) });
}
