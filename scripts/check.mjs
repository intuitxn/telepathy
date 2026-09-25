#!/usr/bin/env node
// Check the new DSH algorithm source path and preserve the independent review gates.
// Bend is optional for a quick local check; CI and `make check` require it.
//
// Usage: node scripts/check.mjs [--root DIR] [--require-bend] [--require-dsh]
// Node standard library only.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// (a) Resolve the repo root from this file's location unless --root is given.
let root = path.resolve(HERE, '..');
let requireBend = false;
let requireDsh = false;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === '--require-bend') {
    requireBend = true;
  } else if (arg === '--require-dsh') {
    requireDsh = true;
    requireBend = true;
  } else if (arg === '--root') {
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
const checkHome = fs.mkdtempSync(path.join(os.tmpdir(), 'telepathy-check-home-'));
process.on('exit', () => { fs.rmSync(checkHome, { recursive: true, force: true }); });
const childEnv = {
  PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: checkHome,
  ...process.env.TELEPATHY_DSH_CLI_BIN ? { TELEPATHY_DSH_CLI_BIN: process.env.TELEPATHY_DSH_CLI_BIN } : {},
  ...process.env.TELEPATHY_DSH_LLM_MODULE ? { TELEPATHY_DSH_LLM_MODULE: process.env.TELEPATHY_DSH_LLM_MODULE } : {},
  ...process.env.TELEPATHY_DSH_SDK_CLIENT_MODULE ?
    { TELEPATHY_DSH_SDK_CLIENT_MODULE: process.env.TELEPATHY_DSH_SDK_CLIENT_MODULE } : {},
  ...process.env.BEND ? { BEND: process.env.BEND } : {},
};
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
  'mundus',
  'runtime/meta_shell.py',
  'runtime/meta_shell_test.py',
  'runtime/meta_shell_jj_test.py',
  'runtime/META_SHELL.md',
  'runtime/worker/run.sh',
  'runtime/worker/mundus.test.mjs',
  'runtime/ops/run.sh',
  'scripts/ops-driver.test.mjs',
  'scripts/install-meta.sh',
  'plugins/telepathy-mailbox',
  'scripts/telepathy-discover.mjs',
  'scripts/telepathy-discover.test.mjs',
  '.opencode/commands/meta.md',
  '.opencode/agents/meta.md',
  'ops/loops',
];
const stillPresent = RETIRED.filter((rel) => fs.existsSync(path.join(root, rel)));
if (stillPresent.length > 0) {
  record('FAIL', 'retirement guard', `retired path(s) still present: ${stillPresent.join(', ')}`);
} else {
  record('PASS', 'retirement guard', 'no retired paths present');
}

// (c) RETENTION GUARD: every retained path must exist.
const REQUIRED = [
  'runtime/core/telepathy.bend',
  'runtime/dsh/core.mjs',
  'runtime/dsh/task-control.mjs',
  'runtime/dsh/task-control.test.mjs',
  'runtime/dsh/synthesis-contract.mjs',
  'runtime/dsh/task-program.mjs',
  'runtime/dsh/task-program.test.mjs',
  'runtime/dsh/task-program.delegation.test.mjs',
  'runtime/dsh/task-host.mjs',
  'runtime/dsh/task-host.test.mjs',
  'runtime/dsh/research-claim.mjs',
  'runtime/dsh/research-claim.test.mjs',
  'runtime/dsh/algorithm-spec.mjs',
  'runtime/dsh/algorithm-spec.test.mjs',
  'runtime/dsh/algorithm-language.mjs',
  'runtime/dsh/algorithm-language.test.mjs',
  'runtime/dsh/delegation-governor.mjs',
  'runtime/dsh/delegation-evidence.mjs',
  'runtime/dsh/delegation-evidence.test.mjs',
  'runtime/dsh/synthesis-host.mjs',
  'runtime/dsh/synthesis-host.test.mjs',
  'runtime/dsh/synthesis-session.mjs',
  'runtime/dsh/synthesis-session.test.mjs',
  'runtime/dsh/fresh-clone-comparison.mjs',
  'runtime/dsh/fresh-clone-comparison.test.mjs',
  'runtime/dsh/algorithm-promotion.mjs',
  'runtime/dsh/algorithm-promotion.test.mjs',
  'runtime/dsh/research-only.patch.yml',
  'runtime/dsh/usage-meter.mjs',
  'runtime/dsh/usage-meter.test.mjs',
  'runtime/dsh/usage-meter.headless.test.mjs',
  'runtime/dsh/tool-boundary.mjs',
  'runtime/dsh/tool-boundary.test.mjs',
  'runtime/dsh/startup-ready.mjs',
  'runtime/dsh/startup-ready.test.mjs',
  'runtime/dsh/task-program.headless.test.mjs',
  'runtime/dsh/cordis.patch.yml',
  'runtime/dsh/core.test.mjs',
  'runtime/dsh/headless.test.mjs',
  'runtime/dsh/skill-root.test.mjs',
  'runtime/core/telepathy.test.mjs',
  'benchmarks/core/run.mjs',
  'benchmarks/core/run.test.mjs',
  'benchmarks/core/cases.json',
  'benchmarks/core/kernel-cases.json',
  'benchmarks/core/reference.bend',
  'benchmarks/exploration/run.mjs',
  'benchmarks/exploration/run.test.mjs',
  'benchmarks/exploration/scenarios.json',
  'benchmarks/delegation/run.mjs',
  'benchmarks/delegation/run.test.mjs',
  'benchmarks/discovery/run.mjs',
  'benchmarks/discovery/run.test.mjs',
  '.agents/skills/bend-kernels/SKILL.md',
  '.opencode/agents/reviewer.md',
  'plugins/telepathy-meta-agents/registry.json',
  'runtime/workspace/server.py',
  'scripts/workspace-service.py',
  'site/package.json',
  'activity/README.md',
  'scripts/jj-gate.mjs',
  'scripts/install-dsh-release.mjs',
  'scripts/release-gate.test.mjs',
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
    env: { ...childEnv, ...extraEnv },
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
  'scripts/agit-retirement.test.mjs',
  'scripts/jj-workspace.test.mjs',
  'scripts/release-gate.test.mjs',
  'runtime/dsh/task-control.test.mjs',
  'runtime/dsh/task-program.test.mjs',
  'runtime/dsh/task-program.delegation.test.mjs',
  'runtime/dsh/delegation-evidence.test.mjs',
  'runtime/dsh/synthesis-host.test.mjs',
  'runtime/dsh/synthesis-session.test.mjs',
  'runtime/dsh/task-host.test.mjs',
  'runtime/dsh/research-claim.test.mjs',
  'runtime/dsh/fresh-clone-comparison.test.mjs',
  'benchmarks/delegation/run.test.mjs',
  'runtime/dsh/algorithm-promotion.test.mjs',
  'runtime/dsh/usage-meter.test.mjs',
];
const missingPureTests = PURE_TESTS.filter((file) => !fs.existsSync(path.join(root, file)));
if (missingPureTests.length > 0) {
  record('FAIL', 'pure tests', `missing test file(s): ${missingPureTests.join(', ')}`);
} else {
  const pure = runNode(['--test', ...PURE_TESTS]);
  record(pure.status === 0 ? 'PASS' : 'FAIL', `test ${PURE_TESTS.join(' ')}`,
    pure.status === 0 ? 'exit 0' : describe(pure));
}

// (f) BEND-OPTIONAL checks.
// BEND lets a caller point at an alternate binary (and lets verification force
// the skip path with a nonexistent path); otherwise use the standard install.
const bendBin = process.env.BEND || path.join(os.homedir(), '.bend/bin/bend');
const dshCli = process.env.TELEPATHY_DSH_CLI_BIN;
const dshLlm = process.env.TELEPATHY_DSH_LLM_MODULE;
const dshReady = Boolean(dshCli && dshLlm && fs.existsSync(dshCli) && fs.existsSync(dshLlm));
if (dshReady) {
  record('PASS', 'dsh integration environment', 'pinned CLI and LLM module paths exist');
} else {
  record(requireDsh ? 'FAIL' : 'SKIP', 'dsh integration environment',
    'set TELEPATHY_DSH_CLI_BIN and TELEPATHY_DSH_LLM_MODULE to a built pinned DSH checkout');
}
let bendExecutable = false;
try {
  fs.accessSync(bendBin, fs.constants.X_OK);
  bendExecutable = true;
} catch {
  bendExecutable = false;
}

if (!bendExecutable) {
  record(requireBend ? 'FAIL' : 'SKIP', 'bend', `binary not found: ${bendBin}${requireBend ? ' (--require-bend)' : ''}`);
} else {
  const BEND_FILES = [
    'runtime/core/telepathy.bend',
    'benchmarks/core/reference.bend',
  ];
  for (const file of BEND_FILES) {
    const sourceText = fs.readFileSync(path.join(root, file), 'utf8');
    const importLines = sourceText.match(/^\s*import\s+[^\n]+$/gm) ?? [];
    const baseImports = sourceText.match(/^\s*import\s+Base\s*$/gm) ?? [];
    if (importLines.length !== baseImports.length) {
      record('FAIL', `bend ${file}`, 'one-file gate permits Base imports only');
      continue;
    }
    const check = spawnSync(bendBin, [file, '--check-only'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...childEnv, BEND_NO_TELEMETRY: '1' },
      maxBuffer: 64 * 1024 * 1024,
    });
    const ok = check.status === 0 && (check.stdout || '').includes('All terms check.');
    if (ok) {
      record('PASS', `bend ${file}`, 'All terms check.');
    } else {
      record('FAIL', `bend ${file}`, describe(check));
    }
  }

  const BEND_TESTS = [
    'runtime/dsh/algorithm-spec.test.mjs',
    'runtime/dsh/algorithm-language.test.mjs',
    'benchmarks/core/run.test.mjs',
    'benchmarks/exploration/run.test.mjs',
    'benchmarks/discovery/run.test.mjs',
    'runtime/core/telepathy.test.mjs',
    'runtime/dsh/core.test.mjs',
    'runtime/dsh/headless.test.mjs',
    'runtime/dsh/skill-root.test.mjs',
    'runtime/dsh/tool-boundary.test.mjs',
    'runtime/dsh/startup-ready.test.mjs',
    'runtime/dsh/task-program.headless.test.mjs',
    'runtime/dsh/usage-meter.headless.test.mjs',
  ];
  // Pin the test subprocesses to the exact binary validated above so the file
  // checks and the tests can never disagree about which Bend they used (the test
  // files themselves also read process.env.BEND, falling back to ~/.bend/bin/bend).
  const missingBendTests = BEND_TESTS.filter((file) => !fs.existsSync(path.join(root, file)));
  if (missingBendTests.length > 0) {
    record('FAIL', 'bend tests', `missing test file(s): ${missingBendTests.join(', ')}`);
  } else {
    // Both keyless DSH tests launch a real host; run them in sequence so the
    // gate measures program behavior without two compiler/session boots racing.
    const bendTests = runNode(['--test', '--test-reporter=tap', '--test-concurrency=1', ...BEND_TESTS], {
      BEND_NO_TELEMETRY: '1', BEND: bendBin, BEND_BIN: bendBin, BEND_BINARY: bendBin,
    });
    // Node's t.skip() exits zero. A required integration gate must detect
    // that separately from this checker's own optional-check SKIP records.
    const skipped = /^# skipped (\d+)\s*$/m.exec(bendTests.stdout ?? '');
    const complete = bendTests.status === 0 && skipped !== null && Number(skipped[1]) === 0;
    record(complete ? 'PASS' : 'FAIL', `bend test ${BEND_TESTS.join(' ')}`,
      complete ? 'exit 0; 0 test skips' : `${describe(bendTests)}; node skips=${skipped?.[1] ?? 'unknown'}`);
  }

  for (const [name, args] of [
    ['reference benchmark', []],
    ['core benchmark', ['--source', 'runtime/core/telepathy.bend', '--cases', 'benchmarks/core/kernel-cases.json']],
  ]) {
    const benchmark = runNode(['benchmarks/core/run.mjs', ...args], {
      BEND_NO_TELEMETRY: '1', BEND_BINARY: bendBin,
    });
    if (benchmark.status !== 0) {
      record('FAIL', name, describe(benchmark));
      continue;
    }
    try {
      const report = JSON.parse(benchmark.stdout);
      if (report.ok === true && report.coverage?.failed === 0 &&
          report.coverage?.passed === report.coverage?.total && report.coverage.total > 0) {
        record('PASS', name, `${report.coverage.passed}/${report.coverage.total} exact cases`);
      } else {
        record('FAIL', name, 'runner exited 0 without a complete passing report');
      }
    } catch (error) {
      record('FAIL', name, `invalid JSON report: ${error.message}`);
    }
  }
}

// (g) Verdict.
const failed = results.filter((r) => r.status === 'FAIL').length;
const passed = results.filter((r) => r.status === 'PASS').length;
const skipped = results.filter((r) => r.status === 'SKIP').length;
console.log(`check: ${failed > 0 ? 'FAIL' : 'PASS'} (${passed} passed, ${failed} failed, ${skipped} skipped)`);
if (skipped > 0) console.log('Skipped optional checks are not verification; use --require-bend and --require-dsh for the complete local gate.');
process.exit(failed > 0 ? 1 : 0);
