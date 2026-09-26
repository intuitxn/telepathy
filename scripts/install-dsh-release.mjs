#!/usr/bin/env node
// Publish the checked DSH plugin as an immutable, model-unwritable release.
// This prepares code for a later host switch; it does not restart any service.
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fs.realpathSync(path.resolve(process.env.JJ_WORKSPACE_ROOT ?? process.cwd()));
if (!fs.existsSync(path.join(repo, '.jj'))) {
  console.error('install-dsh-release: run from a jj workspace or through jj telepathy-install');
  process.exit(2);
}
const commit = process.argv[2];
const bootstrap = process.argv[3] === '--bootstrap';
if ((process.argv.length !== 3 && !(process.argv.length === 4 && bootstrap)) || !/^[a-f0-9]{40,64}$/.test(commit ?? '')) {
  console.error('usage: node scripts/install-dsh-release.mjs FULL_JJ_COMMIT_ID [--bootstrap]');
  process.exit(2);
}
const trustInputs = [
  'scripts/jj-gate.mjs',
  'scripts/install-dsh-release.mjs',
  'scripts/check.mjs',
  'scripts/release-gate.test.mjs',
  'scripts/validate-projections.mjs',
  'scripts/check-operator-docs.mjs',
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
  'runtime/dsh/resident-ingress.mjs',
  'runtime/dsh/resident-ingress.test.mjs',
  'runtime/dsh/scoped-context.mjs',
  'runtime/dsh/scoped-context.test.mjs',
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
const files = [...new Set([
  'runtime/dsh/cordis.patch.yml',
  'runtime/dsh/research-only.patch.yml',
  'runtime/dsh/core.mjs',
  'runtime/dsh/task-control.mjs',
  'runtime/dsh/synthesis-contract.mjs',
  'runtime/dsh/task-program.mjs',
  'runtime/dsh/task-host.mjs',
  'runtime/dsh/resident-ingress.mjs',
  'runtime/dsh/scoped-context.mjs',
  'runtime/dsh/research-claim.mjs',
  'runtime/dsh/algorithm-spec.mjs',
  'runtime/dsh/algorithm-language.mjs',
  'runtime/dsh/algorithm-lsp.mjs',
  'runtime/dsh/delegation-governor.mjs',
  'runtime/dsh/delegation-evidence.mjs',
  'runtime/dsh/synthesis-host.mjs',
  'runtime/dsh/synthesis-session.mjs',
  'runtime/dsh/fresh-clone-comparison.mjs',
  'runtime/dsh/algorithm-promotion.mjs',
  'runtime/dsh/usage-meter.mjs',
  'runtime/dsh/tool-boundary.mjs',
  'runtime/dsh/startup-ready.mjs',
  '.agents/skills/bend-kernels/SKILL.md',
  ...trustInputs,
])];
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
try { store = jjStore(repo); }
catch (error) { console.error(`install-dsh-release: ${error.message}`); process.exit(1); }
let previousReleaseManifest = null;
let previousRelease = null;
if (!bootstrap) {
  // A normal install must be executed from the previous checked release.
  // Calling an edited installer in the candidate workspace fails here.
  const script = fs.realpathSync(fileURLToPath(import.meta.url));
  previousRelease = path.dirname(path.dirname(script));
  let previous;
  try { previous = JSON.parse(fs.readFileSync(path.join(previousRelease, 'release.json'), 'utf8')); }
  catch { console.error('install-dsh-release: normal installs require the previous checked release'); process.exit(1); }
  if (previous.commit_id !== path.basename(previousRelease) ||
      previous.jj_repo_store !== store ||
      JSON.stringify(previous.trust_inputs) !== JSON.stringify(trustInputs) ||
      previous.node_exec_path !== process.execPath ||
      previous.files?.['scripts/install-dsh-release.mjs'] !== sha256(fs.readFileSync(script)) ||
      previous.files?.['scripts/jj-gate.mjs'] !== sha256(fs.readFileSync(path.join(previousRelease, 'scripts/jj-gate.mjs')))) {
    console.error('install-dsh-release: previous release manifest, jj store, Node path, installer, or gate differs');
    process.exit(1);
  }
  previousReleaseManifest = previous;
}
let jjBin;
try {
  jjBin = previousReleaseManifest?.jj_bin_path ?? findExecutable('jj');
  if (previousReleaseManifest && sha256(fs.readFileSync(jjBin)) !== previousReleaseManifest.jj_sha256) {
    throw new Error('previous release jj executable differs');
  }
} catch (error) { console.error(`install-dsh-release: ${error.message}`); process.exit(1); }
const jjHash = sha256(fs.readFileSync(jjBin));
const run = (file, args) => spawnSync(file === 'jj' ? jjBin : file, args, {
  cwd: repo, env: process.env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  timeout: 10 * 60 * 1000,
});
const configuredGate = run('jj', ['--ignore-working-copy', 'config', 'get', 'aliases.telepathy-gate']);
if (bootstrap && configuredGate.status === 0) {
  console.error('install-dsh-release: bootstrap is forbidden after a trusted jj gate alias exists');
  process.exit(1);
}
if (!bootstrap && configuredGate.status !== 0) {
  console.error('install-dsh-release: no trusted jj gate alias; first installation requires explicit --bootstrap');
  process.exit(1);
}
function aliasMatches(result, releaseRoot, relative) {
  if (result.error || result.status !== 0) return false;
  let actual;
  try { actual = JSON.parse(result.stdout.trim()); }
  catch { return false; }
  const expected = ['util', 'exec', '--', process.execPath, path.join(releaseRoot, relative)];
  return JSON.stringify(actual) === JSON.stringify(expected);
}
if (!bootstrap) {
  const configuredInstall = run('jj', ['--ignore-working-copy', 'config', 'get', 'aliases.telepathy-install']);
  if (!aliasMatches(configuredGate, previousRelease, 'scripts/jj-gate.mjs') ||
      !aliasMatches(configuredInstall, previousRelease, 'scripts/install-dsh-release.mjs')) {
    console.error('install-dsh-release: effective jj gate or installer alias differs from the previous checked release');
    process.exit(1);
  }
}
const gate = bootstrap
  ? run(process.execPath, [path.join(repo, 'scripts/jj-gate.mjs'), commit])
  : run('jj', ['--ignore-working-copy', 'telepathy-gate', commit]);
if (gate.error || gate.status !== 0) {
  console.error(`install-dsh-release: revision gate failed: ${gate.error?.message ?? gate.stderr.trim()}`);
  process.exit(1);
}
let receipt;
try { receipt = JSON.parse(gate.stdout.trim().split('\n').at(-1)); }
catch { console.error('install-dsh-release: gate did not emit one JSON receipt'); process.exit(1); }
if (receipt.ok !== true || receipt.commit_id !== commit || receipt.jj_repo_store !== store ||
    receipt.jj_bin_path !== jjBin || receipt.jj_sha256 !== jjHash ||
    receipt.node_exec_path !== process.execPath ||
    (!bootstrap && receipt.trusted_release_commit_id !== previousReleaseManifest.commit_id)) {
  console.error('install-dsh-release: gate receipt does not bind the requested commit');
  process.exit(1);
}
if (!bootstrap) {
  const currentGate = run('jj', ['--ignore-working-copy', 'config', 'get', 'aliases.telepathy-gate']);
  const currentInstall = run('jj', ['--ignore-working-copy', 'config', 'get', 'aliases.telepathy-install']);
  if (jjStore(repo) !== store || !aliasMatches(currentGate, previousRelease, 'scripts/jj-gate.mjs') ||
      !aliasMatches(currentInstall, previousRelease, 'scripts/install-dsh-release.mjs')) {
    console.error('install-dsh-release: jj store or effective aliases changed during the gate');
    process.exit(1);
  }
}

const base = path.resolve(process.env.TELEPATHY_DSH_RELEASES ??
  path.join(os.homedir(), '.local', 'share', 'telepathy-dsh', 'releases'));
fs.mkdirSync(base, { recursive: true, mode: 0o700 });
const realBase = fs.realpathSync(base);
const unsafe = [repo, os.tmpdir(), '/tmp', '/var/tmp'].map(item => fs.realpathSync(item));
if (unsafe.some(root => realBase === root || realBase.startsWith(`${root}${path.sep}`))) {
  console.error('install-dsh-release: release directory is model-writable workspace or temporary storage');
  process.exit(1);
}
const final = path.join(realBase, commit);
const stage = path.join(realBase, `.${commit}-${randomUUID()}.tmp`);
const manifest = { schema: 'telepathy.dsh-release/v1', commit_id: commit,
  jj_repo_store: store, jj_bin_path: jjBin, jj_sha256: jjHash,
  node_exec_path: process.execPath, trust_inputs: trustInputs,
  gate_receipt_sha256: sha256(Buffer.from(gate.stdout)), files: {} };
let installed = manifest;
try {
  fs.mkdirSync(stage, { mode: 0o700 });
  for (const relative of files) {
    const shown = spawnSync(jjBin, ['--ignore-working-copy', 'file', 'show', '-r', commit, relative],
      { cwd: repo, env: process.env, maxBuffer: 16 * 1024 * 1024 });
    if (shown.error || shown.status !== 0) throw new Error(`cannot read ${relative} at ${commit}: ${shown.stderr?.toString().trim() ?? shown.error?.message}`);
    const bytes = shown.stdout;
    const target = path.join(stage, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.writeFileSync(target, bytes, { flag: 'wx', mode: 0o444 });
    manifest.files[relative] = sha256(bytes);
  }
  if (previousReleaseManifest) {
    for (const controlFile of trustInputs) {
      if (manifest.files[controlFile] !== previousReleaseManifest.files[controlFile]) {
        throw new Error(`${controlFile} changed: control-plane promotion needs separate human review`);
      }
    }
  }
  const candidateTrust = Object.fromEntries(trustInputs.map(relative => [relative, manifest.files[relative]]));
  if (receipt.trust_inputs_sha256 !== sha256(JSON.stringify(candidateTrust))) {
    throw new Error('gate receipt does not bind the trusted evaluator inputs');
  }
  if (jjStore(repo) !== store || sha256(fs.readFileSync(jjBin)) !== jjHash) {
    throw new Error('jj store or executable changed during installation');
  }
  fs.writeFileSync(path.join(stage, 'release.json'), `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: 'wx', mode: 0o444 });
  try { fs.renameSync(stage, final); }
  catch (error) {
    if (error.code !== 'EEXIST' && error.code !== 'ENOTEMPTY') throw error;
    if (!fs.lstatSync(final).isDirectory() || fs.lstatSync(final).isSymbolicLink() ||
        fs.realpathSync(final) !== final) {
      throw new Error('existing release path is redirected');
    }
    const existing = JSON.parse(fs.readFileSync(path.join(final, 'release.json'), 'utf8'));
    if (existing.commit_id !== commit || existing.jj_repo_store !== store ||
        existing.jj_bin_path !== jjBin || existing.jj_sha256 !== jjHash ||
        existing.node_exec_path !== process.execPath ||
        JSON.stringify(existing.trust_inputs) !== JSON.stringify(trustInputs) ||
        JSON.stringify(existing.files) !== JSON.stringify(manifest.files)) {
      throw new Error('existing release differs from checked source');
    }
    installed = existing;
    fs.rmSync(stage, { recursive: true, force: true });
  }
  // Keep the jj command pinned to the last checked release, not to mutable
  // source in the agent's workspace. `jj util exec` supplies JJ_WORKSPACE_ROOT.
  const alias = JSON.stringify(['util', 'exec', '--', process.execPath,
    path.join(final, 'scripts/jj-gate.mjs')]);
  const configured = run('jj', ['--ignore-working-copy', 'config', 'set', '--repo',
    'aliases.telepathy-gate', alias]);
  if (configured.error || configured.status !== 0) throw new Error(`cannot install jj gate alias: ${configured.stderr?.trim() ?? configured.error?.message}`);
  const installAlias = JSON.stringify(['util', 'exec', '--', process.execPath,
    path.join(final, 'scripts/install-dsh-release.mjs')]);
  const configuredInstaller = run('jj', ['--ignore-working-copy', 'config', 'set', '--repo',
    'aliases.telepathy-install', installAlias]);
  if (configuredInstaller.error || configuredInstaller.status !== 0) throw new Error(`cannot install jj installer alias: ${configuredInstaller.stderr?.trim() ?? configuredInstaller.error?.message}`);
  const effectiveGate = run('jj', ['--ignore-working-copy', 'config', 'get', 'aliases.telepathy-gate']);
  const effectiveInstaller = run('jj', ['--ignore-working-copy', 'config', 'get', 'aliases.telepathy-install']);
  if (!aliasMatches(effectiveGate, final, 'scripts/jj-gate.mjs') ||
      !aliasMatches(effectiveInstaller, final, 'scripts/install-dsh-release.mjs') ||
      jjStore(repo) !== store) {
    throw new Error('installed jj aliases or store differ from the checked release');
  }
  console.log(JSON.stringify({ status: 'installed', commit_id: commit, trusted_root: final,
    jj_gate_alias: 'jj telepathy-gate FULL_JJ_COMMIT_ID',
    jj_install_alias: 'jj telepathy-install FULL_JJ_COMMIT_ID',
    gate_receipt_sha256: installed.gate_receipt_sha256, files: installed.files }));
} catch (error) {
  fs.rmSync(stage, { recursive: true, force: true });
  console.error(`install-dsh-release: ${error.message}`);
  process.exit(1);
}
