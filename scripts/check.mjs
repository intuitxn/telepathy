#!/usr/bin/env node
// Retained-system check for the post-Desk workspace.
//
// Guards the Desk retirement, the retained runtime surface and the root package
// manifest, always runs the pure-Node evaluation test, and runs the Bend-backed
// checks when a Bend binary is available (skipped in CI).
//
// Usage: node scripts/check.mjs [--root DIR]
// Node standard library only.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// (a) Resolve the repo root from this file's location unless --root is given.
let root = path.resolve(HERE, '..');
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === '--root') {
    const value = argv[i + 1];
    if (!value) {
      console.error('check: --root requires a directory');
      process.exit(2);
    }
    root = path.resolve(value);
    i += 1;
  } else if (arg.startsWith('--root=')) {
    root = path.resolve(arg.slice('--root='.length));
  } else {
    console.error(`check: unknown argument ${arg}`);
    process.exit(2);
  }
}

const results = [];
function record(status, name, reason) {
  results.push({ status, name });
  console.log(`${status} ${name}: ${reason}`);
}

// (b) RETIREMENT GUARD: no retired path may exist.
const RETIRED = [
  'runtime/desk',
  'scripts/desk-watch.sh',
  'runtime/opencode-v2',
  'plugins/telepathy',
];
const stillPresent = RETIRED.filter((rel) => fs.existsSync(path.join(root, rel)));
if (stillPresent.length > 0) {
  record('FAIL', 'retirement guard', `retired path(s) still present: ${stillPresent.join(', ')}`);
} else {
  record('PASS', 'retirement guard', 'no retired paths present');
}

// (c) RETENTION GUARD: every retained path must exist.
const REQUIRED = [
  'runtime/worker/system.bend',
  'runtime/worker/diffusion.bend',
  'runtime/adaptive/system.bend',
  'runtime/lorenz/system.bend',
  'runtime/worker/BUZZ.md',
  '.opencode/agents/meta.md',
  '.opencode/agents/reviewer.md',
  'plugins/telepathy-mailbox/telepathy.ts',
  'plugins/telepathy-meta-agents/registry.json',
  'site/package.json',
  'activity/README.md',
];
const missing = REQUIRED.filter((rel) => !fs.existsSync(path.join(root, rel)));
if (missing.length > 0) {
  record('FAIL', 'retention guard', `required path(s) missing: ${missing.join(', ')}`);
} else {
  record('PASS', 'retention guard', `all ${REQUIRED.length} required paths present`);
}

// (d) PACKAGE GUARD: root package.json must be in the post-Desk shape.
const packageFaults = [];
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (Object.prototype.hasOwnProperty.call(pkg, 'workspaces')) {
    packageFaults.push('workspaces field present');
  }
  const scripts = (pkg && typeof pkg.scripts === 'object' && pkg.scripts) || {};
  for (const name of ['setup', 'doctor', 'desk', 'opencode']) {
    if (Object.prototype.hasOwnProperty.call(scripts, name)) {
      packageFaults.push(`script "${name}" present`);
    }
  }
  if (scripts.check !== 'node scripts/check.mjs') {
    packageFaults.push(`check script is ${JSON.stringify(scripts.check ?? null)}, expected "node scripts/check.mjs"`);
  }
} catch (err) {
  packageFaults.push(`cannot read/parse package.json: ${err.message}`);
}
if (packageFaults.length > 0) {
  record('FAIL', 'package guard', packageFaults.join('; '));
} else {
  record('PASS', 'package guard', 'no workspaces, no setup/doctor/desk/opencode scripts, check=node scripts/check.mjs');
}

function runNode(nodeArgs, extraEnv) {
  return spawnSync(process.execPath, nodeArgs, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
    maxBuffer: 64 * 1024 * 1024,
  });
}

function describe(result) {
  if (result.error) return result.error.message;
  const combined = `${result.stderr || ''}${result.stdout || ''}`.trim();
  const tail = combined.split('\n').slice(-6).join(' | ').slice(-800);
  return `exit ${result.status}${tail ? `: ${tail}` : ''}`;
}

// (e) ALWAYS run the pure-Node evaluation test (no Bend required).
const PURE_TESTS = [
  'runtime/evaluation/workflow-transfer.test.mjs',
  'scripts/telepathy-discover.test.mjs',
];
const pure = runNode(['--test', ...PURE_TESTS]);
if (pure.status === 0) {
  record('PASS', `test ${PURE_TESTS.join(' ')}`, 'exit 0');
} else {
  record('FAIL', `test ${PURE_TESTS.join(' ')}`, describe(pure));
}

// (f) BEND-OPTIONAL checks.
// BEND lets a caller point at an alternate binary (and lets verification force
// the skip path with a nonexistent path); otherwise use the standard install.
const bendBin = process.env.BEND || path.join(os.homedir(), '.bend/bin/bend');
let bendExecutable = false;
try {
  fs.accessSync(bendBin, fs.constants.X_OK);
  bendExecutable = true;
} catch {
  bendExecutable = false;
}

if (!bendExecutable) {
  record('SKIP', 'bend', 'binary not found');
} else {
  const BEND_FILES = [
    'runtime/worker/system.bend',
    'runtime/worker/diffusion.bend',
    'runtime/worker/history.bend',
    'runtime/adaptive/system.bend',
    'runtime/lorenz/system.bend',
    'runtime/ops/fold.bend',
    'runtime/ops/status.bend',
    'runtime/ops/ctx.bend',
    'runtime/programs/bend-laws/PROOF.bend',
  ];
  for (const file of BEND_FILES) {
    const check = spawnSync(bendBin, [file, '--check-only'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, BEND_NO_TELEMETRY: '1' },
      maxBuffer: 64 * 1024 * 1024,
    });
    const ok = check.status === 0 && (check.stdout || '').includes('All terms check.');
    if (ok) {
      record('PASS', `bend ${file}`, 'All terms check.');
    } else {
      record('FAIL', `bend ${file}`, describe(check));
    }
  }

  const BEND_TESTS = ['runtime/worker/protocol.test.mjs', 'runtime/lorenz/evaluate.test.mjs'];
  // Pin the test subprocesses to the exact binary validated above so the file
  // checks and the tests can never disagree about which Bend they used (the test
  // files themselves also read process.env.BEND, falling back to ~/.bend/bin/bend).
  const bendTests = runNode(['--test', ...BEND_TESTS], { BEND_NO_TELEMETRY: '1', BEND: bendBin });
  if (bendTests.status === 0) {
    record('PASS', `bend test ${BEND_TESTS.join(' ')}`, 'exit 0');
  } else {
    record('FAIL', `bend test ${BEND_TESTS.join(' ')}`, describe(bendTests));
  }
}

// (g) Verdict.
const failed = results.filter((r) => r.status === 'FAIL').length;
const passed = results.filter((r) => r.status === 'PASS').length;
const skipped = results.filter((r) => r.status === 'SKIP').length;
console.log(`check: ${failed > 0 ? 'FAIL' : 'PASS'} (${passed} passed, ${failed} failed, ${skipped} skipped)`);
process.exit(failed > 0 ? 1 : 0);
