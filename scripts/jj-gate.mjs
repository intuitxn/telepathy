#!/usr/bin/env node
// Verify one immutable jj revision before a task head or bookmark adopts it.
// jj snapshots working files implicitly, so there is no native pre-commit
// event. `jj run --ignore-changes --clean` checks the exact revision in isolation.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// `jj util exec` supplies the workspace root when this gate is launched from
// the last checked release via the repository-local `jj telepathy-gate` alias.
const root = process.env.JJ_WORKSPACE_ROOT
  ? fs.realpathSync(process.env.JJ_WORKSPACE_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!fs.existsSync(path.join(root, '.jj'))) {
  console.error('jj-gate: JJ_WORKSPACE_ROOT must name a jj workspace');
  process.exit(2);
}
const pinnedDsh = '477b4f420553e8a52c2fbccc464d7561b239c443';
const requested = process.argv[2];
if (process.argv.length !== 3 || !/^[0-9a-f]{40,64}$/.test(requested ?? '')) {
  console.error('usage: node scripts/jj-gate.mjs FULL_JJ_COMMIT_ID');
  process.exit(2);
}
for (const key of ['TELEPATHY_DSH_TEST_TRUSTED_NATIVE_SHA256',
  'TELEPATHY_DSH_TEST_ALLOW_UNSAFE_ARCHIVE',
  'TELEPATHY_DSH_TEST_ALLOW_UNSAFE_TASK_STORE',
  'TELEPATHY_DSH_TEST_ALLOW_UNSAFE_USAGE_STORE']) {
  if (process.env[key]) {
    console.error(`jj-gate: test-only override ${key} is forbidden for exact revision promotion`);
    process.exit(1);
  }
}

// These are the executable checks and fixed evaluator inputs. A checked
// release may evaluate new program source, but a normal promotion cannot
// replace the measurement code that judges that source. Changing this set
// itself is a control-plane change requiring a separately reviewed bootstrap.
const trustInputs = [
  'scripts/jj-gate.mjs',
  'scripts/install-dsh-release.mjs',
  'scripts/check.mjs',
  'scripts/release-gate.test.mjs',
  'scripts/agit-retirement.test.mjs',
  'scripts/jj-workspace.test.mjs',
  'scripts/agit.py',
  'scripts/durability-guard.sh',
  'scripts/worktree-guard.sh',
  'runtime/evaluation/workflow-transfer.mjs',
  'runtime/evaluation/workflow-transfer.test.mjs',
  'runtime/dsh/cordis.patch.yml',
  'runtime/dsh/headless-smoke.patch.yml',
  'runtime/dsh/mock-llm.mjs',
  'runtime/dsh/core.mjs',
  'runtime/dsh/task-control.mjs',
  'runtime/dsh/synthesis-contract.mjs',
  'runtime/dsh/task-program.mjs',
  'runtime/dsh/task-host.mjs',
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
  'runtime/dsh/usage-meter.mjs',
  'runtime/dsh/tool-boundary.mjs',
  'runtime/dsh/startup-ready.mjs',
  'runtime/dsh/core.test.mjs',
  'runtime/dsh/headless.test.mjs',
  'runtime/dsh/skill-root.test.mjs',
  'runtime/dsh/tool-boundary.test.mjs',
  'runtime/dsh/startup-ready.test.mjs',
  'runtime/dsh/task-control.test.mjs',
  'runtime/dsh/task-program.test.mjs',
  'runtime/dsh/task-program.delegation.test.mjs',
  'runtime/dsh/task-host.test.mjs',
  'runtime/dsh/algorithm-promotion.mjs',
  'runtime/dsh/algorithm-promotion.test.mjs',
  'runtime/dsh/research-only.patch.yml',
  '.agents/skills/bend-kernels/SKILL.md',
  'runtime/dsh/task-program.headless.test.mjs',
  'runtime/dsh/usage-meter.test.mjs',
  'runtime/dsh/usage-meter.headless.test.mjs',
  'runtime/core/telepathy.test.mjs',
  'benchmarks/core/run.mjs',
  'benchmarks/core/run.test.mjs',
  'benchmarks/core/reference.bend',
  'benchmarks/core/cases.json',
  'benchmarks/core/kernel-cases.json',
  'benchmarks/exploration/run.mjs',
  'benchmarks/exploration/run.test.mjs',
  'benchmarks/exploration/scenarios.json',
  'benchmarks/delegation/run.mjs',
  'benchmarks/delegation/run.test.mjs',
  'benchmarks/discovery/run.mjs',
  'benchmarks/discovery/run.test.mjs',
];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = (child, parent) => child === parent || child.startsWith(`${parent}${path.sep}`);
function findExecutable(name) {
  for (const entry of (process.env.PATH ?? '').split(path.delimiter)) {
    const candidate = path.join(entry, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return fs.realpathSync(candidate);
    } catch { /* try the next PATH entry */ }
  }
  throw new Error(`${name} executable is unavailable`);
}
function jjStore(workspace) {
  const jjDir = path.join(workspace, '.jj');
  const pointer = path.join(jjDir, 'repo');
  if (!fs.lstatSync(jjDir).isDirectory() || fs.lstatSync(jjDir).isSymbolicLink()) {
    throw new Error('.jj must be a real directory');
  }
  const stat = fs.lstatSync(pointer);
  if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
    throw new Error('.jj/repo must be a directory or regular relative pointer');
  }
  let target = pointer;
  if (stat.isFile()) {
    const value = fs.readFileSync(pointer, 'utf8').trim();
    if (!value || path.isAbsolute(value) || /[\r\n\0]/.test(value)) {
      throw new Error('.jj/repo has an invalid relative pointer');
    }
    target = path.resolve(jjDir, value);
  }
  const store = fs.realpathSync(target);
  if (!fs.statSync(store).isDirectory() || inside(store, workspace)) {
    throw new Error('jj store must be a directory outside the candidate workspace');
  }
  return store;
}
let store;
try { store = jjStore(root); }
catch (error) { console.error(`jj-gate: ${error.message}`); process.exit(1); }
const script = fs.realpathSync(fileURLToPath(import.meta.url));
const releaseRoot = path.dirname(path.dirname(script));
let previousRelease = null;
if (releaseRoot !== root) {
  try {
    previousRelease = JSON.parse(fs.readFileSync(path.join(releaseRoot, 'release.json'), 'utf8'));
    if (previousRelease.commit_id !== path.basename(releaseRoot) ||
        previousRelease.jj_repo_store !== store ||
        previousRelease.node_exec_path !== process.execPath ||
        JSON.stringify(previousRelease.trust_inputs) !== JSON.stringify(trustInputs) ||
        previousRelease.files?.['scripts/jj-gate.mjs'] !== sha256(fs.readFileSync(script))) {
      throw new Error('previous release manifest, gate, or jj store differs');
    }
  } catch (error) {
    console.error(`jj-gate: previous checked release is invalid: ${error.message}`);
    process.exit(1);
  }
}
let jjBin;
try {
  jjBin = previousRelease?.jj_bin_path ?? findExecutable('jj');
  if (previousRelease && sha256(fs.readFileSync(jjBin)) !== previousRelease.jj_sha256) {
    throw new Error('previous release jj executable differs');
  }
} catch (error) { console.error(`jj-gate: ${error.message}`); process.exit(1); }
const jjHash = sha256(fs.readFileSync(jjBin));

const run = (args) => spawnSync(jjBin, args, {
  cwd: root, env: process.env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  timeout: 10 * 60 * 1000,
});
const fileHash = file => sha256(fs.readFileSync(file));
const resolved = run(['--ignore-working-copy', 'log', '-r', requested,
  '--no-graph', '-T', 'commit_id']);
if (resolved.error || resolved.status !== 0 || resolved.stdout.trim() !== requested) {
  console.error(`jj-gate: exact commit is unavailable: ${resolved.error?.message ?? resolved.stderr.trim()}`);
  process.exit(1);
}
const candidateTrust = {};
for (const relative of trustInputs) {
  const shown = spawnSync(jjBin, ['--ignore-working-copy', 'file', 'show', '-r', requested, relative], {
    cwd: root, env: process.env, maxBuffer: 16 * 1024 * 1024, timeout: 60 * 1000,
  });
  if (shown.error || shown.status !== 0) {
    console.error(`jj-gate: cannot read trusted input ${relative} at ${requested}`);
    process.exit(1);
  }
  const digest = sha256(shown.stdout);
  candidateTrust[relative] = digest;
  if (previousRelease && previousRelease.files?.[relative] !== digest) {
    console.error(`jj-gate: ${relative} changed: control-plane promotion needs separate human review`);
    process.exit(1);
  }
}
const trustDigest = sha256(JSON.stringify(candidateTrust));
const dshFiles = [process.env.TELEPATHY_DSH_CLI_BIN, process.env.TELEPATHY_DSH_LLM_MODULE];
if (dshFiles.some((file) => !file || !fs.existsSync(file))) {
  console.error('jj-gate: built pinned DSH CLI and LLM module paths are required');
  process.exit(1);
}
const dshRoot = spawnSync('git', ['-C', path.dirname(dshFiles[0]), 'rev-parse', '--show-toplevel'],
  { encoding: 'utf8' });
const dshHead = spawnSync('git', ['-C', path.dirname(dshFiles[0]), 'rev-parse', 'HEAD'],
  { encoding: 'utf8' });
const realDshRoot = dshRoot.status === 0 ? fs.realpathSync(dshRoot.stdout.trim()) : null;
if (!realDshRoot || dshHead.status !== 0 || dshHead.stdout.trim() !== pinnedDsh ||
    !dshFiles.every((file) => fs.realpathSync(file).startsWith(`${realDshRoot}${path.sep}`))) {
  console.error(`jj-gate: DSH build must come from pinned source ${pinnedDsh}`);
  process.exit(1);
}
const unsafeDshRoots = [root, os.tmpdir(), '/tmp', '/var/tmp'].map(item => fs.realpathSync(item));
if (unsafeDshRoots.some(parent => realDshRoot === parent || realDshRoot.startsWith(`${parent}${path.sep}`))) {
  console.error('jj-gate: DSH build must be outside the model workspace and temporary roots');
  process.exit(1);
}
const bend = process.env.BEND ?? path.join(os.homedir(), '.bend', 'bin', 'bend');
if (!fs.existsSync(bend)) {
  console.error(`jj-gate: Bend binary is unavailable: ${bend}`);
  process.exit(1);
}
const bendVersion = spawnSync(bend, ['version'], {
  encoding: 'utf8', env: { ...process.env, BEND_NO_TELEMETRY: '1' },
});
if (bendVersion.status !== 0) {
  console.error('jj-gate: Bend version check failed');
  process.exit(1);
}
const binaries = { dsh_cli: fileHash(dshFiles[0]), dsh_llm: fileHash(dshFiles[1]), bend: fileHash(bend) };
const check = run(['--ignore-working-copy', 'run', '--ignore-changes', '--clean', '--root', '-r', requested, '--',
  process.execPath, 'scripts/check.mjs', '--require-dsh']);
const output = `${check.stdout ?? ''}${check.stderr ?? ''}`;
if (check.error || check.status !== 0 || !/check: PASS \(\d+ passed, 0 failed, 0 skipped\)/.test(output)) {
  console.error(`jj-gate: exact-revision check failed for ${requested}`);
  console.error(output.slice(-4000));
  process.exit(1);
}
if (fileHash(dshFiles[0]) !== binaries.dsh_cli || fileHash(dshFiles[1]) !== binaries.dsh_llm ||
    fileHash(bend) !== binaries.bend) {
  console.error('jj-gate: a toolchain binary changed during the revision check');
  process.exit(1);
}
try {
  if (jjStore(root) !== store) throw new Error('jj store changed during verification');
  if (sha256(fs.readFileSync(jjBin)) !== jjHash) throw new Error('jj executable changed during verification');
} catch (error) {
  console.error(`jj-gate: ${error.message}`);
  process.exit(1);
}
const receipt = {
  schema: 'telepathy.jj-gate/v1', commit_id: requested,
  gate: 'node scripts/check.mjs --require-dsh',
  dsh_source_commit: pinnedDsh,
  jj_repo_store: store,
  jj_bin_path: jjBin,
  jj_sha256: jjHash,
  trust_inputs_sha256: trustDigest,
  trusted_release_commit_id: previousRelease?.commit_id ?? null,
  dsh_cli_sha256: binaries.dsh_cli,
  dsh_llm_sha256: binaries.dsh_llm,
  bend_version: bendVersion.stdout.trim(),
  bend_sha256: binaries.bend,
  node_version: process.version,
  node_exec_path: process.execPath,
  output_sha256: createHash('sha256').update(output).digest('hex'),
  checked_at_ms: Date.now(), ok: true,
};
console.log(JSON.stringify(receipt));
