import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, home } from './core.js';
export async function setup() {
  const base = home(); mkdirSync(base, { recursive: true, mode: 0o700 });
  const configFile = join(base, 'config.json');
  if (!existsSync(configFile)) writeFileSync(configFile, JSON.stringify({ runtime: 'opencode', model: null, repositories: [ROOT], channels: [], authorizedPubkeys: [], since: Math.floor(Date.now()/1000), timeoutSeconds: 900, pollSeconds: 15 }, null, 2));
  console.log(`Ready. Settings: ${configFile}\nNext: npm run doctor\nWrite: npm run desk -- new report "Report title"\nOpenCode: npm run opencode`);
}
if (process.argv[1] === new URL(import.meta.url).pathname) await setup();
