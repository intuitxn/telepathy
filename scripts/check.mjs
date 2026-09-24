#!/usr/bin/env node
// Checks only the active meta node, agent language, and one Bend kernel.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requireBend = process.argv.includes('--require-bend');
if (process.argv.length > (requireBend ? 3 : 2)) {
  console.error('usage: node scripts/check.mjs [--require-bend]');
  process.exit(2);
}
const required = [
  'runtime/meta_shell.py', 'runtime/meta_shell_test.py',
  'runtime/meta_shell_jj_test.py', 'runtime/worker/system.bend',
  'runtime/worker/protocol.test.mjs', 'runtime/agent_programs/language.py',
  'runtime/agent_programs/test_language.py', 'runtime/rrsi.py',
  'runtime/rrsi_run.py', 'runtime/rrsi_loop.py', 'runtime/agent_programs/rrsi.meta',
  '.opencode/agents/meta.md',
];
const retired = ['site', 'runtime/workspace', 'runtime/programs', 'runtime/adaptive',
  'runtime/lorenz', 'runtime/evaluation', 'runtime/ops', 'ops/loops'];
for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`missing active file: ${file}`);
}
for (const file of retired) {
  if (fs.existsSync(path.join(root, file))) throw new Error(`retired path remains: ${file}`);
}
function run(name, command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...env },
  });
  if (result.error || result.status !== 0) {
    const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
    throw new Error(`${name}: ${result.error?.message || `exit ${result.status}`}\n${output.slice(-4000)}`);
  }
  console.log(`PASS ${name}`);
}
const python = process.env.PYTHON || 'python3';
const protocolReady = spawnSync(python, ['-c', 'import acp, mcp, starlette'], { cwd: root }).status === 0;
const uvReady = spawnSync('uv', ['--version'], { cwd: root }).status === 0;
if (!protocolReady && !uvReady) throw new Error('Install pinned MCP/ACP Python dependencies or uv');
const pythonRunner = protocolReady ? [python] :
  ['uv', 'run', '--with', 'mcp==1.27.0', '--with', 'agent-client-protocol==0.9.0', 'python'];
run('meta node and jj lifecycle', pythonRunner[0], [...pythonRunner.slice(1), '-m', 'unittest', 'discover', '-s', 'runtime', '-p', 'meta_shell*test.py']);
run('agent language', pythonRunner[0], [...pythonRunner.slice(1), '-m', 'unittest', 'discover', '-s', 'runtime/agent_programs', '-p', 'test_*.py']);
run('RRSI evidence and runner', python, ['-m', 'unittest', 'discover', '-s', 'runtime', '-p', 'rrsi*_test.py']);
const bend = process.env.BEND || path.join(process.env.HOME || '', '.bend/bin/bend');
if (fs.existsSync(bend)) {
  run('Bend kernel checker', bend, ['runtime/worker/system.bend', '--check-only'], { BEND_NO_TELEMETRY: '1' });
  run('Bend worker protocol', process.execPath, ['--test', 'runtime/worker/protocol.test.mjs'], { BEND: bend });
} else if (requireBend) {
  throw new Error(`Bend is required but absent: ${bend}`);
} else {
  console.log('SKIP Bend checks (compiler unavailable)');
}
