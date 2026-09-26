// Cross-session task authority for the DSH host. This is a small control
// service, never an agent loop or a scheduler. DSH drives all model turns.
//
// DSH Session.append cannot safely accept a new event type at the pinned
// revision: unknown stored event types prevent reopening. Task state therefore
// lives in a private, content-addressed event chain. The mutable head is only
// a pointer; every accepted transition can be replayed after process restart.
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync, lstatSync, promises as fs, readFileSync, realpathSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { isPinnedSynthesisVerifier } from './synthesis-contract.mjs';

const DIGEST = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40,64}$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;
const MAX_EVENT_BYTES = 16 * 1024;
const MAX_VIEW_ITEMS = 64;
// For subprocess tools, one fuel unit reserves one second of maximum wall
// time. The active pointer read costs one control unit. A call spends its full
// reservation before work begins, including on crash/cancel.
// Scoring and selection are host-only until evaluator and origin authority
// are tied to task-control evaluation/integration reservations.
const ALGORITHM_CALLS = Object.freeze({
  algorithm_run: Object.freeze({ fuel: 60, max_wall_ms: 60_000 }),
  algorithm_compile: Object.freeze({ fuel: 1, max_wall_ms: 0 }),
  algorithm_execute: Object.freeze({ fuel: 60, max_wall_ms: 60_000 }),
  algorithm_active: Object.freeze({ fuel: 1, max_wall_ms: 0 }),
});
const REQUIRED_GATE_ARGS = commitId => ['jj', '--ignore-working-copy', 'run', '--ignore-changes', '--clean', '--root', '-r', commitId,
  '--', 'node', 'scripts/check.mjs', '--require-dsh'];
const PINNED_DSH_COMMIT = '477b4f420553e8a52c2fbccc464d7561b239c443';
// A verdict object alone cannot prove that a jj gate ran. Production source
// settlement accepts only the host adapter below, which calls the checked
// release gate script before the independent evaluator. Synthetic callbacks remain a test
// seam for temporary task stores.
const combinedVerifierAdapters = new WeakSet();
const hash = value => createHash('sha256').update(value).digest('hex');
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function fail(message) { throw new Error(`task control: ${message}`); }
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(`${label} must be a plain object`);
  return value;
}
function keys(value, allowed, label) {
  object(value, label);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${label} has unknown field ${key}`);
}
function str(value, label, max = 1024) {
  if (typeof value !== 'string' || !value || value.length > max) fail(`${label} must be a nonempty bounded string`);
  return value;
}
function id(value, label) { if (typeof value !== 'string' || !ID.test(value)) fail(`${label} is invalid`); return value; }
function digest(value, label) { if (typeof value !== 'string' || !DIGEST.test(value)) fail(`${label} must be SHA-256`); return value; }
function commit(value, label) { if (typeof value !== 'string' || !COMMIT.test(value)) fail(`${label} must be an exact commit ID`); return value; }
function integer(value, label, min = 0, max = 1_000_000_000) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(`${label} must be an integer in ${min}..${max}`);
  return value;
}

// Canonical JSON rejects undefined, cycles, unusual prototypes and nonfinite
// numbers; digests are independent of JS object insertion order.
function canonical(value) {
  const seen = new Set();
  const walk = (item, depth) => {
    if (depth > 32) fail('JSON nesting is too deep');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (Array.isArray(item)) {
      if (seen.has(item)) fail('cyclic JSON');
      seen.add(item);
      const result = item.map(value => walk(value, depth + 1));
      seen.delete(item);
      return result;
    }
    object(item, 'JSON value');
    if (seen.has(item)) fail('cyclic JSON');
    seen.add(item);
    const result = {};
    for (const key of Object.keys(item).sort()) result[key] = walk(item[key], depth + 1);
    seen.delete(item);
    return result;
  };
  return JSON.stringify(walk(value, 0));
}
function clone(value) { return JSON.parse(canonical(value)); }
function bounded(value, label, limit = MAX_EVENT_BYTES) {
  const bytes = Buffer.byteLength(canonical(value));
  if (bytes > limit) fail(`${label} exceeds ${limit} bytes`);
  return clone(value);
}
function normalizeBudget(value, label) {
  keys(value, ['tokens', 'fuel', 'children', 'integrations', 'evaluations'], label);
  const out = {};
  for (const key of ['tokens', 'fuel', 'children', 'integrations', 'evaluations']) out[key] = integer(value[key], `${label}.${key}`);
  return out;
}
function normalizeAlgorithmCall(value) {
  keys(value, ['session_id', 'call_id', 'tool', 'input_sha256'], 'algorithm call');
  const sessionId = id(value.session_id, 'algorithm session_id');
  const callId = str(value.call_id, 'algorithm call_id', 256);
  const tool = str(value.tool, 'algorithm tool', 64);
  if (!Object.hasOwn(ALGORITHM_CALLS, tool)) fail('algorithm tool has no funded compute schedule');
  return { session_id: sessionId, call_id: callId, tool,
    input_sha256: digest(value.input_sha256, 'algorithm input_sha256') };
}
const MAX_TASK_EVENTS = 1_000_000;
function normalizeSpec(value) {
  keys(value, ['goal', 'acceptance', 'scopes', 'integration_owner', 'initial_head', 'pinned_versions', 'limits', 'policy_version'], 'task spec');
  const scopes = value.scopes;
  if (!Array.isArray(scopes) || !scopes.length || scopes.length > 64) fail('task scopes must contain 1..64 entries');
  const normalizedScopes = scopes.map((scope, index) => id(scope, `scope ${index}`));
  if (new Set(normalizedScopes).size !== normalizedScopes.length) fail('task scopes must be unique');
  keys(value.pinned_versions, ['evaluator_sha256', 'case_set_sha256', 'toolchain', 'synthesis_oracle_sha256'], 'pinned_versions');
  keys(value.limits, ['max_tasks', 'max_branches', 'max_active_grants', 'max_depth', 'tokens', 'fuel', 'integrations', 'evaluations'], 'limits');
  const spec = {
    goal: str(value.goal, 'goal', 4096), acceptance: str(value.acceptance, 'acceptance', 4096),
    scopes: normalizedScopes, integration_owner: id(value.integration_owner, 'integration_owner'),
    initial_head: commit(value.initial_head, 'initial_head'),
    pinned_versions: {
      evaluator_sha256: digest(value.pinned_versions.evaluator_sha256, 'evaluator_sha256'),
      case_set_sha256: digest(value.pinned_versions.case_set_sha256, 'case_set_sha256'),
      toolchain: str(value.pinned_versions.toolchain, 'toolchain', 256),
      ...(value.pinned_versions.synthesis_oracle_sha256 === undefined ? {} : {
        synthesis_oracle_sha256: digest(value.pinned_versions.synthesis_oracle_sha256, 'synthesis_oracle_sha256') }),
    },
    limits: {
      max_tasks: integer(value.limits.max_tasks, 'max_tasks', 1, 100_000),
      max_branches: integer(value.limits.max_branches, 'max_branches', 1, 20_000),
      max_active_grants: integer(value.limits.max_active_grants, 'max_active_grants', 1, 64),
      max_depth: integer(value.limits.max_depth, 'max_depth', 0, 64),
      tokens: integer(value.limits.tokens, 'tokens', 1),
      fuel: integer(value.limits.fuel, 'fuel', 1),
      integrations: integer(value.limits.integrations, 'integrations', 1),
      evaluations: integer(value.limits.evaluations, 'evaluations', 1),
    },
    policy_version: str(value.policy_version, 'policy_version', 128),
  };
  if (spec.limits.max_active_grants > spec.limits.max_branches) fail('active grant cap exceeds total branch bound');
  return spec;
}
function normalizePlan(value) {
  keys(value, ['id', 'kind', 'scope', 'deliverable', 'acceptance', 'source_refs', 'oracle_sha256',
    'budget', 'depends_on', 'parent_plan_ref', 'expected_log_head'], 'logical task');
  if (!['research', 'algorithm', 'implementation', 'evaluation', 'integration', 'retrieval', 'analysis', 'synthesis'].includes(value.kind)) fail('logical task kind is unsupported');
  if (!Array.isArray(value.source_refs) || value.source_refs.length > 32 ||
    !Array.isArray(value.depends_on) || value.depends_on.length > 32) fail('logical task refs must be bounded arrays');
  const sourceRefs = value.source_refs.map((ref, index) => digest(ref, `source ref ${index}`));
  const dependsOn = value.depends_on.map((ref, index) => digest(ref, `dependency ${index}`));
  if (new Set(sourceRefs).size !== sourceRefs.length || new Set(dependsOn).size !== dependsOn.length) fail('logical task refs must be unique');
  return { id: id(value.id, 'logical task id'), kind: value.kind, scope: id(value.scope, 'logical task scope'),
    deliverable: str(value.deliverable, 'logical task deliverable', 2048),
    acceptance: str(value.acceptance, 'logical task acceptance', 2048),
    source_refs: sourceRefs, oracle_sha256: digest(value.oracle_sha256, 'logical task oracle_sha256'),
    budget: normalizeBudget(value.budget, 'logical task budget'), depends_on: dependsOn,
    parent_plan_ref: value.parent_plan_ref === null ? null : digest(value.parent_plan_ref, 'parent_plan_ref'),
    expected_log_head: digest(value.expected_log_head, 'expected_log_head') };
}
function normalizeBase(value) {
  keys(value, ['task_commit', 'causal_event'], 'base_refs');
  return { task_commit: commit(value.task_commit, 'base_refs.task_commit'), causal_event: digest(value.causal_event, 'base_refs.causal_event') };
}
function normalizeGrant(value) {
  keys(value, ['id', 'plan_ref', 'branch', 'owner', 'scope', 'deliverable', 'base_refs', 'budget', 'location', 'parent_grant_ref'], 'grant');
  const location = str(value.location, 'location', 4096);
  if (!path.isAbsolute(location) || path.normalize(location) !== location) fail('location must be a normalized absolute workspace path');
  return {
    id: id(value.id, 'grant id'), plan_ref: digest(value.plan_ref, 'plan_ref'),
    branch: id(value.branch, 'branch'), owner: id(value.owner, 'owner'),
    scope: id(value.scope, 'scope'), deliverable: str(value.deliverable, 'deliverable', 2048),
    base_refs: normalizeBase(value.base_refs), budget: normalizeBudget(value.budget, 'grant budget'), location,
    parent_grant_ref: value.parent_grant_ref === null ? null : digest(value.parent_grant_ref, 'parent_grant_ref'),
  };
}
function normalizeAdmit(value) {
  keys(value, ['id', 'grant_ref', 'actor', 'scope', 'base_commit', 'parents', 'kind', 'payload'], 'admission');
  if (!Array.isArray(value.parents) || !value.parents.length || value.parents.length > 16) fail('parents must contain 1..16 digests');
  const parents = value.parents.map((parent, index) => digest(parent, `parent ${index}`));
  if (new Set(parents).size !== parents.length) fail('parents must be unique');
  const kind = value.kind;
  if (!['prediction', 'observation', 'candidate', 'result', 'handoff', 'external_effect', 'finding', 'done', 'failed'].includes(kind)) fail('event kind is unsupported');
  const payload = bounded(value.payload, 'event payload', 8192);
  if (kind === 'candidate') {
    keys(payload, ['commit', 'artifact_sha256', 'observation_receipt_sha256'], 'candidate payload');
    commit(payload.commit, 'candidate commit'); digest(payload.artifact_sha256, 'artifact_sha256');
    digest(payload.observation_receipt_sha256, 'observation_receipt_sha256');
  } else if (kind === 'result') {
    keys(payload, ['artifact_sha256', 'evidence_receipt_sha256', 'source_refs', 'source_cut'], 'result payload');
    digest(payload.artifact_sha256, 'result artifact_sha256');
    digest(payload.evidence_receipt_sha256, 'result evidence_receipt_sha256');
    if (!Array.isArray(payload.source_refs) || payload.source_refs.length > 32) fail('result source refs must be bounded');
    payload.source_refs.forEach((ref, index) => digest(ref, `result source ${index}`));
    if (new Set(payload.source_refs).size !== payload.source_refs.length) fail('result source refs must be unique');
    if (payload.source_cut !== undefined) digest(payload.source_cut, 'result source_cut');
  } else if (kind === 'handoff') {
    keys(payload, ['message_sha256', 'causal_cut', 'context_refs'], 'handoff payload');
    digest(payload.message_sha256, 'message_sha256'); digest(payload.causal_cut, 'causal_cut');
    if (!Array.isArray(payload.context_refs) || payload.context_refs.length > 16) fail('handoff context_refs must be bounded');
    payload.context_refs.forEach((ref, index) => digest(ref, `context_refs ${index}`));
  } else if (kind === 'observation' || kind === 'external_effect') {
    digest(payload.receipt_sha256, 'receipt_sha256');
  } else if (kind === 'finding') {
    keys(payload, ['claim_sha256', 'evidence_receipt_sha256', 'source_refs'], 'finding payload');
    digest(payload.claim_sha256, 'claim_sha256'); digest(payload.evidence_receipt_sha256, 'evidence_receipt_sha256');
    if (!Array.isArray(payload.source_refs) || payload.source_refs.length > 32) fail('finding source refs must be bounded');
    payload.source_refs.forEach((ref, index) => digest(ref, `finding source ${index}`));
  } else if (kind === 'done' || kind === 'failed') {
    str(payload.reason, 'terminal reason', 1024);
  }
  return {
    id: id(value.id, 'event id'), grant_ref: digest(value.grant_ref, 'grant_ref'),
    actor: id(value.actor, 'actor'), scope: id(value.scope, 'scope'),
    base_commit: commit(value.base_commit, 'base_commit'), parents, kind, payload,
  };
}
function normalizeSettle(value) {
  keys(value, ['id', 'integration_grant_ref', 'expected_head', 'candidate_events'], 'settlement');
  if (!Array.isArray(value.candidate_events) || !value.candidate_events.length || value.candidate_events.length > 16) fail('candidate_events must contain 1..16 digests');
  const events = value.candidate_events.map((ref, index) => digest(ref, `candidate_event ${index}`));
  if (new Set(events).size !== events.length) fail('candidate_events must be unique');
  return { id: id(value.id, 'settlement id'), integration_grant_ref: digest(value.integration_grant_ref, 'integration_grant_ref'),
    expected_head: commit(value.expected_head, 'expected_head'), candidate_events: events };
}
function normalizeResultSettle(value) {
  keys(value, ['id', 'grant_ref', 'plan_ref', 'result_event', 'expected_head'], 'result settlement');
  return { id: id(value.id, 'result settlement id'), grant_ref: digest(value.grant_ref, 'result grant_ref'),
    plan_ref: digest(value.plan_ref, 'result plan_ref'), result_event: digest(value.result_event, 'result event'),
    expected_head: commit(value.expected_head, 'result expected_head') };
}
function normalizeCheckpoint(value) {
  keys(value, ['id', 'expected_log_head'], 'checkpoint');
  return { id: id(value.id, 'checkpoint id'), expected_log_head: digest(value.expected_log_head, 'expected_log_head') };
}
function normalizeStart(value) {
  keys(value, ['id', 'grant_ref', 'session_id', 'parent_session'], 'child start');
  return { id: id(value.id, 'child start id'), grant_ref: digest(value.grant_ref, 'child grant_ref'),
    session_id: id(value.session_id, 'child session_id'), parent_session: id(value.parent_session, 'parent_session') };
}
function canonicalPath(input) {
  const suffix = [];
  let current = path.resolve(input);
  while (!existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) fail('path has no existing ancestor');
    suffix.unshift(path.basename(current));
    current = parent;
  }
  return path.join(realpathSync(current), ...suffix);
}
function runCommand(file, args, options) {
  return new Promise((resolve, reject) => execFile(file, args, {
    cwd: options.cwd, timeout: options.timeout ?? 30_000, maxBuffer: 4 * 1024 * 1024,
    encoding: 'utf8', env: options.env ?? process.env,
  }, (error, stdout, stderr) => error ? reject(new Error(`${file} ${args.join(' ')}: ${String(stderr || error.message).slice(0, 512)}`))
    : resolve({ stdout, stderr })));
}
function linkedJjStore(workspace) {
  const jjDir = path.join(workspace, '.jj');
  const pointer = path.join(jjDir, 'repo');
  const stat = requireRealEntry(pointer);
  if (stat.isDirectory()) return realpathSync(pointer);
  if (!stat.isFile()) fail('jj workspace has no linked store');
  const relative = readFileSync(pointer, 'utf8').trim();
  if (!relative || path.isAbsolute(relative) || /[\r\n\0]/.test(relative))
    fail('jj workspace store pointer is invalid');
  return realpathSync(path.resolve(jjDir, relative));
}
function requireRealEntry(file) {
  const stat = lstatSync(file);
  if (stat.isSymbolicLink() || realpathSync(file) !== file)
    fail('checked release or jj path is redirected');
  return stat;
}
async function checkedReleaseGate(repoRoot, releasePath, revision) {
  if (typeof releasePath !== 'string' || !path.isAbsolute(releasePath))
    fail('trustedReleaseRoot is required for the production jj gate');
  const releaseRoot = path.normalize(releasePath);
  const releaseStat = requireRealEntry(releaseRoot);
  const within = (root, target) => target === root || target.startsWith(`${root}${path.sep}`);
  const temporaryRoots = ['/tmp', '/var/tmp',
    ...(process.platform === 'darwin' ? ['/var/folders'] : [])].map(canonicalPath);
  if (!releaseStat.isDirectory() || releaseStat.uid !== process.getuid() ||
      (releaseStat.mode & 0o077) !== 0 || within(repoRoot, releaseRoot) ||
      temporaryRoots.some(root => within(root, releaseRoot)))
    fail('trusted release must be private and outside workspace and temporary roots');
  const manifestPath = path.join(releaseRoot, 'release.json');
  if (!requireRealEntry(manifestPath).isFile()) fail('trusted release manifest is not a file');
  const manifestBytes = await fs.readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes);
  const store = linkedJjStore(repoRoot);
  const script = path.join(releaseRoot, 'scripts', 'jj-gate.mjs');
  const jjBin = manifest.jj_bin_path;
  if (manifest.schema !== 'telepathy.dsh-release/v1' ||
      manifest.commit_id !== path.basename(releaseRoot) ||
      manifest.jj_repo_store !== store || manifest.node_exec_path !== process.execPath ||
      typeof jjBin !== 'string' || !path.isAbsolute(jjBin) ||
      !DIGEST.test(manifest.jj_sha256 ?? '') ||
      !DIGEST.test(manifest.files?.['scripts/jj-gate.mjs'] ?? '') ||
      !Array.isArray(manifest.trust_inputs) ||
      manifest.trust_inputs.some(item => typeof item !== 'string' ||
        !DIGEST.test(manifest.files?.[item] ?? '')))
    fail('trusted release manifest does not bind the jj gate and store');
  if (!requireRealEntry(script).isFile() || !requireRealEntry(jjBin).isFile() ||
      within(repoRoot, jjBin) || temporaryRoots.some(root => within(root, jjBin)) ||
      hash(await fs.readFile(script)) !== manifest.files['scripts/jj-gate.mjs'] ||
      hash(await fs.readFile(jjBin)) !== manifest.jj_sha256)
    fail('trusted release gate or jj binary changed');
  const cli = process.env.TELEPATHY_DSH_CLI_BIN;
  const llm = process.env.TELEPATHY_DSH_LLM_MODULE;
  const bend = process.env.BEND ?? path.join(os.homedir(), '.bend', 'bin', 'bend');
  if (![cli, llm, bend].every(file => typeof file === 'string' && path.isAbsolute(file)))
    fail('host-pinned DSH and Bend paths are required');
  for (const file of [cli, llm, bend]) {
    if (!requireRealEntry(file).isFile() || within(repoRoot, file) ||
        temporaryRoots.some(root => within(root, file)))
      fail('host-pinned toolchain must be outside workspace and temporary roots');
  }
  // Give the exact-revision check a private, host-created temporary directory.
  // Inheriting TMPDIR lets a caller redirect test scratch space; omitting it
  // changes the checked release's test environment on macOS.
  const systemTemp = process.platform === 'darwin'
    ? (await runCommand('/usr/bin/getconf', ['DARWIN_USER_TEMP_DIR'], {
      cwd: repoRoot, env: { HOME: os.homedir(), PATH: '/usr/bin:/bin' },
    })).stdout.trim()
    : '/tmp';
  const temporaryRoot = canonicalPath(systemTemp);
  const expectedTempRoot = canonicalPath(process.platform === 'darwin' ? '/var/folders' : '/tmp');
  const temporaryRootStat = requireRealEntry(temporaryRoot);
  if (!within(expectedTempRoot, temporaryRoot) || !temporaryRootStat.isDirectory() ||
      (process.platform === 'darwin' &&
        (temporaryRootStat.uid !== process.getuid() || (temporaryRootStat.mode & 0o077) !== 0)))
    fail('system temporary root is not a private OS directory');
  const gateTemp = await fs.mkdtemp(path.join(temporaryRoot, 'telepathy-dsh-gate-'));
  try {
    const gateTempStat = requireRealEntry(gateTemp);
    if (!gateTempStat.isDirectory() || gateTempStat.uid !== process.getuid() ||
        (gateTempStat.mode & 0o077) !== 0 || !within(temporaryRoot, gateTemp))
      fail('checked gate temporary directory is not private');
    // No caller-supplied JJ_CONFIG, PATH, aliases, test overrides, or injected
    // gate callback enter the production gate process.
    const env = { HOME: os.homedir(), TMPDIR: gateTemp, JJ_WORKSPACE_ROOT: repoRoot,
      PATH: ['/usr/bin', '/bin', '/usr/sbin', '/sbin', path.dirname(jjBin),
        path.dirname(process.execPath), path.dirname(bend)].join(path.delimiter),
      TELEPATHY_DSH_CLI_BIN: cli, TELEPATHY_DSH_LLM_MODULE: llm, BEND: bend };
    const configured = await runCommand(jjBin,
      ['--ignore-working-copy', 'config', 'get', 'aliases.telepathy-gate'],
      { cwd: repoRoot, env });
    const expectedAlias = ['util', 'exec', '--', process.execPath, script];
    if (canonical(JSON.parse(configured.stdout.trim())) !== canonical(expectedAlias))
      fail('effective jj gate alias differs from the checked release');
    const run = await runCommand(process.execPath, [script, revision], {
      cwd: repoRoot, timeout: 10 * 60_000, env });
    const lines = run.stdout.trim().split('\n');
    if (lines.length !== 1) fail('checked jj gate emitted more than one receipt');
    const receipt = JSON.parse(lines[0]);
    const trusted = Object.fromEntries(manifest.trust_inputs.map(item => [item, manifest.files[item]]));
    if (receipt.schema !== 'telepathy.jj-gate/v1' || receipt.commit_id !== revision ||
        receipt.ok !== true || receipt.gate !== 'node scripts/check.mjs --require-dsh' ||
        receipt.trusted_release_commit_id !== manifest.commit_id ||
        receipt.jj_repo_store !== store || receipt.jj_bin_path !== jjBin ||
        receipt.jj_sha256 !== manifest.jj_sha256 ||
        receipt.trust_inputs_sha256 !== hash(JSON.stringify(trusted)) ||
        receipt.node_exec_path !== process.execPath || receipt.node_version !== process.version ||
        receipt.dsh_source_commit !== PINNED_DSH_COMMIT ||
        receipt.dsh_cli_sha256 !== hash(await fs.readFile(cli)) ||
        receipt.dsh_llm_sha256 !== hash(await fs.readFile(llm)) ||
        receipt.bend_sha256 !== hash(await fs.readFile(bend)) ||
        typeof receipt.bend_version !== 'string' || !receipt.bend_version ||
        !Number.isSafeInteger(receipt.checked_at_ms) || receipt.checked_at_ms < 1 ||
        !DIGEST.test(receipt.output_sha256 ?? ''))
      fail('checked jj gate receipt lacks trusted release provenance');
    if (!(await fs.readFile(manifestPath)).equals(manifestBytes) ||
        hash(await fs.readFile(script)) !== manifest.files['scripts/jj-gate.mjs'] ||
        hash(await fs.readFile(jjBin)) !== manifest.jj_sha256 ||
        linkedJjStore(repoRoot) !== store)
      fail('checked release or jj store changed during gate');
    return receipt;
  } finally {
    await fs.rm(gateTemp, { recursive: true, force: true });
  }
}
async function inspectJjWorkspace(grant) {
  if ((await fs.lstat(grant.location)).isSymbolicLink()) fail('granted workspace itself may not be a symlink');
  const cwd = await fs.realpath(grant.location);
  await fs.access(path.join(cwd, '.jj'));
  const inspected = await runCommand('jj', ['--ignore-working-copy', 'log', '-r', '@-', '--no-graph', '-T', 'commit_id'], { cwd });
  if (inspected.stdout.trim() !== grant.base_refs.task_commit) fail('child workspace parent differs from exact granted base');
  return cwd;
}

async function syncDirectory(directory) {
  const handle = await fs.open(directory, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
async function writeComplete(file, content) {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}-${randomUUID()}`);
  const handle = await fs.open(temporary, 'wx', 0o600);
  try { await handle.writeFile(content); await handle.sync(); }
  finally { await handle.close(); }
  return temporary;
}
async function publishImmutable(file, content) {
  const temporary = await writeComplete(file, content);
  try {
    try { await fs.link(temporary, file); await syncDirectory(path.dirname(file)); return true; }
    catch (error) { if (error.code !== 'EEXIST') throw error; return false; }
  } finally { await fs.unlink(temporary).catch(() => {}); }
}
async function replaceAtomic(file, content) {
  const temporary = await writeComplete(file, content);
  try { await fs.rename(temporary, file); await syncDirectory(path.dirname(file)); }
  finally { await fs.unlink(temporary).catch(() => {}); }
}
async function readJson(file) { return JSON.parse(await fs.readFile(file, 'utf8')); }
const localLockTails = new Map();
async function withLock(directory, work) {
  // DatabaseSync waits synchronously. Serialize callers in this process first
  // so another async caller cannot block the event loop that holds the lock.
  const previous = localLockTails.get(directory) ?? Promise.resolve();
  let release;
  const done = new Promise(resolve => { release = resolve; });
  localLockTails.set(directory, done);
  await previous;
  try {
  // SQLite owns the cross-process mutex. Its transaction releases on process
  // death, unlike a mkdir lock; the content-addressed files remain the source
  // of truth. The database contains no task data and is safe to rebuild.
  const lockDb = new DatabaseSync(path.join(directory, '.lock.sqlite'));
  lockDb.exec('PRAGMA busy_timeout=10000;');
  try {
    lockDb.exec('BEGIN IMMEDIATE');
    try { return await work(); }
    finally { lockDb.exec('COMMIT'); }
  } finally { lockDb.close(); }
  } finally {
    if (localLockTails.get(directory) === done) localLockTails.delete(directory);
    release();
  }
}
function eventPath(directory, eventDigest) { return path.join(directory, 'events', `${eventDigest}.json`); }
async function replay(directory, taskRef, eventLimit = MAX_TASK_EVENTS) {
  const spec = await readJson(path.join(directory, 'spec.json'));
  if (hash(canonical(spec)) !== taskRef) fail('task spec digest mismatch');
  const pointer = await readJson(path.join(directory, 'head.json'));
  if (pointer.schema !== 1 || !DIGEST.test(pointer.event ?? '')) fail('task head pointer is invalid');
  const reverse = [];
  const seen = new Set();
  let cursor = pointer.event;
  while (cursor !== null) {
    if (seen.has(cursor)) fail('cycle in task event chain');
    seen.add(cursor);
    const event = await readJson(eventPath(directory, cursor));
    if (hash(canonical(event)) !== cursor) fail('task event digest mismatch');
    if (event.schema !== 1 || (event.prev !== null && !DIGEST.test(event.prev ?? ''))) fail('task event envelope is invalid');
    reverse.push({ ...event, digest: cursor });
    cursor = event.prev;
    if (reverse.length > eventLimit) fail('task event chain exceeds replay limit');
  }
  const events = reverse.reverse();
  if (events[0]?.type !== 'opened' || events[0]?.payload?.task_ref !== taskRef) fail('task genesis event is invalid');
  const state = fold(spec, events);
  state.logHead = pointer.event;
  return { spec, events, state };
}
function fold(spec, events) {
  const state = {
    taskHead: spec.initial_head, remaining: { tasks: spec.limits.max_tasks, branches: spec.limits.max_branches,
      tokens: spec.limits.tokens, fuel: spec.limits.fuel,
      integrations: spec.limits.integrations, evaluations: spec.limits.evaluations },
    plans: new Map(), grants: new Map(), candidates: new Map(), results: new Map(), knowledge: new Map(),
    pendingEvaluations: new Set(),
    ids: new Map(), byDigest: new Map(),
    terminal: null, lastSettlement: null,
  };
  for (const event of events) applyEvent(state, event);
  return state;
}
function evaluationGrant(state, settlementId) {
  const isResult = settlementId.startsWith('!result:');
  const intentId = isResult ? `eval-result:${settlementId.slice('!result:'.length)}` : `eval:${settlementId}`;
  const intent = state.ids.get(intentId);
  return isResult ? intent?.payload.grant_ref : intent?.payload.integration_grant_ref;
}
function failExhaustedResult(state, grantRef) {
  const grant = state.grants.get(grantRef);
  if (!grant || grant.status !== 'ready' || grant.left.evaluations > 0) return;
  if ([...state.pendingEvaluations].some(settlementId => evaluationGrant(state, settlementId) === grantRef)) return;
  const plan = state.plans.get(grant.plan_ref);
  const readyResults = [...state.results.values()].filter(result => result.grant_ref === grantRef && result.status === 'ready');
  if (!plan || plan.status !== 'ready' || !readyResults.length) return;
  for (const result of readyResults) result.status = 'rejected';
  grant.status = 'failed';
  plan.status = 'failed';
}
// A synthesis citation is an attributed, independently settled result, never
// an arbitrary event digest or a model's statement about another scope.
function acceptedCitation(state, ref) {
  const result = state.results.get(ref);
  const event = state.byDigest.get(ref);
  if (result?.status !== 'accepted' || event?.type !== 'admitted' || event.payload.kind !== 'result' ||
      !result.settlement_event_digest || !result.verifier_receipt_sha256)
    fail('synthesis source is not an accepted result at the causal cut');
  const grant = state.grants.get(result.grant_ref);
  const plan = grant && state.plans.get(grant.plan_ref);
  if (!grant || !plan || !['research', 'analysis'].includes(plan.kind) ||
      grant.scope !== event.payload.scope || !state.byDigest.has(result.settlement_event_digest))
    fail('synthesis source has invalid attribution');
  return { event_digest: ref, scope: grant.scope, plan_ref: plan.ref,
    artifact_sha256: event.payload.payload.artifact_sha256,
    evidence_receipt_sha256: event.payload.payload.evidence_receipt_sha256,
    verifier_receipt_sha256: result.verifier_receipt_sha256,
    settlement_event_digest: result.settlement_event_digest };
}
function applyEvent(state, event) {
    if (state.ids.has(event.id)) fail('duplicate event ID in task chain');
    state.ids.set(event.id, event);
    state.byDigest.set(event.digest, event);
    if (event.type === 'planned') {
      const plan = clone(event.payload.plan);
      plan.ref = event.result.plan_ref;
      plan.status = 'planned';
      plan.event_digest = event.digest;
      if (event.payload.citations) plan.citations = clone(event.payload.citations);
      state.plans.set(plan.ref, plan);
      state.remaining.tasks--;
      state.remaining.fuel--;
      state.remaining.tokens -= event.payload.planning_cost_tokens;
    } else if (event.type === 'granted') {
      const grant = clone(event.payload.grant);
      grant.ref = event.result.grant_ref;
      grant.event_digest = event.digest;
      grant.last_event = event.digest;
      grant.status = 'active';
      grant.depth = event.payload.depth;
      grant.left = clone(grant.budget);
      state.grants.set(grant.ref, grant);
      state.plans.get(grant.plan_ref).status = 'granted';
      state.remaining.branches--;
      for (const key of ['tokens', 'fuel', 'integrations', 'evaluations']) state.remaining[key] -= grant.budget[key];
      if (grant.parent_grant_ref) state.grants.get(grant.parent_grant_ref).left.children--;
    } else if (event.type === 'admitted') {
      const admission = event.payload;
      const grant = state.grants.get(admission.grant_ref);
      if (!grant) fail('admission references missing grant');
      grant.last_event = event.digest;
      grant.left.fuel--;
      grant.left.tokens -= admission.payload_cost_tokens;
      if (admission.kind === 'candidate') {
        grant.status = 'ready';
        state.plans.get(grant.plan_ref).status = 'ready';
        state.candidates.set(event.digest, { grant_ref: grant.ref, status: 'ready' });
      } else if (admission.kind === 'result') {
        grant.status = 'ready';
        state.plans.get(grant.plan_ref).status = 'ready';
        state.results.set(event.digest, { grant_ref: grant.ref, status: 'ready' });
        failExhaustedResult(state, grant.ref);
      } else if (admission.kind === 'finding') {
        state.knowledge.set(`${admission.scope}\n${admission.payload.claim_sha256}`, {
          event_digest: event.digest, scope: admission.scope,
          evidence_receipt_sha256: admission.payload.evidence_receipt_sha256,
          verifier_receipt_sha256: admission.evidence_verification.receipt_sha256 });
      } else if (admission.kind === 'done' || admission.kind === 'failed') {
        grant.status = admission.kind;
        state.plans.get(grant.plan_ref).status = admission.kind;
      }
    } else if (event.type === 'algorithm_call_reserved') {
      const grant = state.grants.get(event.payload.grant_ref);
      if (!grant || grant.session_id !== event.payload.session_id) fail('algorithm reservation has no bound grant');
      grant.left.fuel -= event.payload.fuel_cost;
      if (grant.left.fuel < 0) fail('algorithm reservation overdraws grant fuel');
    } else if (event.type === 'child_start_requested') {
      const grant = state.grants.get(event.payload.grant_ref);
      if (!grant) fail('child start intent references missing grant');
      grant.pending_session_id = event.payload.session_id;
      grant.pending_start_id = event.payload.id;
      grant.pending_parent_session = event.payload.parent_session;
      grant.pending_cwd = event.payload.cwd;
      grant.pending_intent_digest = event.digest;
    } else if (event.type === 'child_started') {
      const grant = state.grants.get(event.payload.grant_ref);
      if (!grant) fail('started child references missing grant');
      grant.session_id = event.payload.session_id;
      grant.parent_session = event.payload.parent_session;
      delete grant.pending_session_id;
      delete grant.pending_start_id;
      delete grant.pending_parent_session;
      delete grant.pending_cwd;
      delete grant.pending_intent_digest;
    } else if (event.type === 'root_session_bound') {
      const grant = state.grants.get(event.payload.grant_ref);
      if (!grant) fail('root session binding references missing grant');
      grant.session_id = event.payload.session_id;
      grant.parent_session = null;
    } else if (event.type === 'child_start_failed') {
      const grant = state.grants.get(event.payload.grant_ref);
      if (!grant) fail('failed child start references missing grant');
      grant.status = 'failed';
      state.plans.get(grant.plan_ref).status = 'failed';
      delete grant.pending_session_id;
      delete grant.pending_start_id;
      delete grant.pending_parent_session;
      delete grant.pending_cwd;
      delete grant.pending_intent_digest;
    } else if (event.type === 'evaluation_started') {
      const grant = state.grants.get(event.payload.integration_grant_ref);
      if (!grant) fail('evaluation reservation references missing integrator');
      grant.left.evaluations--;
      state.pendingEvaluations.add(event.payload.id);
    } else if (event.type === 'result_evaluation_started') {
      const grant = state.grants.get(event.payload.grant_ref);
      if (!grant) fail('result evaluation reservation references missing grant');
      grant.left.evaluations--;
      state.pendingEvaluations.add(event.payload.id);
    } else if (event.type === 'evaluation_abandoned') {
      state.pendingEvaluations.delete(event.payload.settlement_id);
      failExhaustedResult(state, evaluationGrant(state, event.payload.settlement_id));
    } else if (event.type === 'settled') {
      const { request, verdict } = event.payload;
      state.pendingEvaluations.delete(request.id);
      if (event.payload.stale) {
        state.lastSettlement = { ok: false, reason: 'stale-head-after-verification', event_digest: event.digest };
        return;
      }
      const integrator = state.grants.get(request.integration_grant_ref);
      if (!integrator) fail('settlement references missing integrator');
      integrator.left.integrations--;
      // A failed integration check consumes its measured budget but does not
      // destroy a candidate. The owner may fix the checker or collect another
      // independent measurement if a fresh evaluation grant remains.
      if (verdict.ok) for (const ref of request.candidate_events) {
        state.candidates.get(ref).status = 'accepted';
        const grant = state.grants.get(state.candidates.get(ref).grant_ref);
        grant.status = 'accepted';
        state.plans.get(grant.plan_ref).status = 'accepted';
      }
      if (verdict.ok) {
        state.taskHead = verdict.combined_commit;
        if (verdict.task_accepted) state.terminal = {
          reason: 'verified-acceptance', receipt_sha256: verdict.receipt_sha256,
          ...(verdict.goal_evidence_sha256 ? {
            goal_receipt_sha256: verdict.goal_evidence_sha256 } : {}) };
      }
      state.lastSettlement = { ok: verdict.ok, reason: verdict.reason ?? null, event_digest: event.digest };
      failExhaustedResult(state, request.integration_grant_ref);
    } else if (event.type === 'result_settled') {
      const { request, verdict } = event.payload;
      state.pendingEvaluations.delete(`!result:${request.id}`);
      if (event.payload.stale) {
        state.lastSettlement = { ok: false, reason: 'stale-result-after-verification', event_digest: event.digest };
        failExhaustedResult(state, request.grant_ref);
        return;
      }
      if (verdict.ok) {
        const result = state.results.get(request.result_event);
        if (!result) fail('result settlement references missing proposal');
        result.status = 'accepted';
        result.verifier_receipt_sha256 = verdict.receipt_sha256;
        result.settlement_event_digest = event.digest;
        const grant = state.grants.get(request.grant_ref);
        grant.status = 'accepted';
        state.plans.get(request.plan_ref).status = 'accepted';
      }
      state.lastSettlement = { ok: verdict.ok, reason: verdict.reason ?? null, event_digest: event.digest };
      if (!verdict.ok) failExhaustedResult(state, request.grant_ref);
    } else if (event.type === 'checkpointed' && event.result.decision === 'stop') {
      state.terminal = state.terminal ?? { reason: event.result.reason, receipt_sha256: null };
    }
}

export function createTaskControl(settings = {}) {
  const eventLimit = settings.allowUnsafeStoreRootForTest && settings.maxEventsForTest !== undefined
    ? integer(settings.maxEventsForTest, 'maxEventsForTest', 2, MAX_TASK_EVENTS) : MAX_TASK_EVENTS;
  const storeRoot = canonicalPath(settings.storeRoot ?? process.env.TELEPATHY_TASK_STATE
    ?? path.join(os.homedir(), '.local', 'state', 'telepathy-dsh', 'tasks'));
  const within = (root, target) => target === root || target.startsWith(`${root}${path.sep}`);
  if (settings.allowUnsafeStoreRootForTest) {
    // This test-only escape must not follow TMPDIR: a production process can
    // set it to its private state parent and thereby bypass verifier branding.
    const temporaryRoots = ['/tmp', '/var/tmp',
      ...(process.platform === 'darwin' ? ['/var/folders'] : [])].map(canonicalPath);
    if (!temporaryRoots.some(root => within(root, storeRoot)))
      fail('test-only unsafe task store must remain under the temporary root');
  } else {
    const unsafeRoots = [settings.workspaceRoot ?? process.cwd(), os.tmpdir(), '/tmp', '/var/tmp'].map(canonicalPath);
    if (unsafeRoots.some(root => within(root, storeRoot))) {
      fail('production task store must be outside the workspace and temporary directory');
    }
  }
  const verifyCombined = settings.verifyCombined;
  if (verifyCombined !== undefined && typeof verifyCombined !== 'function')
    fail('combined verifier must be a function');
  if (settings.allowSyntheticCombinedVerifierForTest &&
      !settings.allowUnsafeStoreRootForTest)
    fail('synthetic combined verifier requires a temporary test store');
  if (verifyCombined && !settings.allowSyntheticCombinedVerifierForTest &&
      !combinedVerifierAdapters.has(verifyCombined))
    fail('production source settlement requires the checked jj verifier adapter');
  const verifyKnowledge = settings.verifyKnowledge;
  const verifyResult = settings.verifyResult;
  const verifySynthesis = settings.verifySynthesis;
  if (verifySynthesis !== undefined && typeof verifySynthesis !== 'function')
    fail('synthesis verifier must be a function');
  if (settings.allowSyntheticSynthesisVerifierForTest && !settings.allowUnsafeStoreRootForTest)
    fail('synthetic synthesis verifier requires a temporary test store');
  if (verifySynthesis && !settings.allowSyntheticSynthesisVerifierForTest &&
      !isPinnedSynthesisVerifier(verifySynthesis, settings.allowUnsafeStoreRootForTest === true))
    fail('production synthesis requires a host-pinned oracle adapter');
  const setupChild = settings.setupChild;
  const auditChildAbsence = settings.auditChildAbsence;
  const auditEvaluationAbandonment = settings.auditEvaluationAbandonment;
  const inspectWorkspace = settings.inspectWorkspace ?? inspectJjWorkspace;
  const taskDir = taskRef => path.join(storeRoot, digest(taskRef, 'task_ref'));
  const cache = new Map();
  const load = async taskRef => {
    const directory = taskDir(taskRef);
    const pointer = await readJson(path.join(directory, 'head.json'));
    const cached = cache.get(taskRef);
    if (cached?.state.logHead === pointer.event) return cached;
    const current = await replay(directory, taskRef, eventLimit);
    cache.set(taskRef, current);
    return current;
  };

  async function append(directory, previous, request, type, payload, result) {
    if (previous.events.length >= eventLimit) fail('task event chain exhausted before publication');
    const event = { schema: 1, id: request.id, type, prev: previous.state.logHead,
      request_digest: hash(canonical(request)), payload: bounded(payload, 'task event payload'),
      result: bounded(result, 'task event result'), wall_time_ms: Date.now() };
    const eventDigest = hash(canonical(event));
    const eventFile = eventPath(directory, eventDigest);
    await publishImmutable(eventFile, `${canonical(event)}\n`);
    await replaceAtomic(path.join(directory, 'head.json'), `${canonical({ schema: 1, event: eventDigest })}\n`);
    const admitted = { ...event, digest: eventDigest };
    applyEvent(previous.state, admitted);
    previous.state.logHead = eventDigest;
    previous.events.push(admitted);
    cache.set(previous.spec ? hash(canonical(previous.spec)) : result.task_ref, previous);
    return { ...result, event_digest: eventDigest, log_head: eventDigest, existing: false };
  }
  async function transact(taskRef, request, type, decide) {
    const directory = taskDir(taskRef);
    return withLock(directory, async () => {
      const current = await load(taskRef);
      const previous = current.state.ids.get(request.id);
      if (previous) {
        if (previous.type !== type || previous.request_digest !== hash(canonical(request))) fail('event ID reused with different content');
        return { ...previous.result, event_digest: previous.digest, log_head: previous.digest, existing: true };
      }
      if (current.state.terminal && !['checkpointed', 'child_started', 'child_start_failed', 'settled', 'result_settled', 'evaluation_abandoned'].includes(type)) fail(`task is terminal: ${current.state.terminal.reason}`);
      const { payload, result } = await decide(current);
      return append(directory, current, request, type, payload, result);
    });
  }

  async function open(specInput) {
    const spec = normalizeSpec(specInput);
    const taskRef = hash(canonical(spec));
    const directory = taskDir(taskRef);
    await fs.mkdir(path.join(directory, 'events'), { recursive: true, mode: 0o700 });
    return withLock(directory, async () => {
      const specFile = path.join(directory, 'spec.json');
      await publishImmutable(specFile, `${canonical(spec)}\n`);
      const stored = await readJson(specFile);
      if (hash(canonical(stored)) !== taskRef) fail('task spec archive conflicts with task ref');
      let hasHead = true;
      try { await fs.access(path.join(directory, 'head.json')); }
      catch (error) { if (error.code === 'ENOENT') hasHead = false; else throw error; }
      if (hasHead) {
        const current = await load(taskRef);
        return { task_ref: taskRef, spec_sha256: taskRef, task_head: current.state.taskHead,
          log_head: current.state.logHead, existing: true };
      }
      const request = { id: `open:${taskRef}` };
      const event = { schema: 1, id: request.id, type: 'opened', prev: null, request_digest: hash(canonical(request)),
        payload: { task_ref: taskRef }, result: { task_ref: taskRef }, wall_time_ms: Date.now() };
      const eventDigest = hash(canonical(event));
      await publishImmutable(eventPath(directory, eventDigest), `${canonical(event)}\n`);
      await replaceAtomic(path.join(directory, 'head.json'), `${canonical({ schema: 1, event: eventDigest })}\n`);
      cache.delete(taskRef);
      return { task_ref: taskRef, spec_sha256: taskRef, task_head: spec.initial_head, log_head: eventDigest, existing: false };
    });
  }

  // A typed task-program element is a logical record, not a DSH session.
  // Thousands can be admitted before a small number receive active grants.
  async function plan(taskRef, input) {
    const request = normalizePlan(input);
    return transact(taskRef, request, 'planned', async ({ spec, state }) => {
      if (request.expected_log_head !== state.logHead) fail('stale logical task causal cut');
      if (!spec.scopes.includes(request.scope)) fail('logical task scope is outside frozen task scope');
      const oracle = request.kind === 'synthesis' ? spec.pinned_versions.synthesis_oracle_sha256
        : spec.pinned_versions.evaluator_sha256;
      if (!oracle || request.oracle_sha256 !== oracle) fail('logical task oracle differs from frozen evaluator');
      if (state.remaining.tasks < 1) fail('logical task bound exhausted');
      const planningCostTokens = Math.max(1, Buffer.byteLength(canonical(request)));
      if (state.remaining.fuel < 1 || state.remaining.tokens < planningCostTokens) fail('planning compute grant exhausted');
      if (request.parent_plan_ref) {
        const parent = state.plans.get(request.parent_plan_ref);
        if (!parent || parent.scope !== request.scope) fail('logical task parent is absent or outside scope');
      }
      for (const ref of request.depends_on) {
        const dependency = state.plans.get(ref);
        if (!dependency || dependency.scope !== request.scope) fail('logical task dependency is absent or outside scope');
      }
      let citations = null;
      if (request.kind === 'synthesis') {
        if (spec.scopes.length < 2 || request.source_refs.length < 2 || request.source_refs.length > 16)
          fail('synthesis requires 2..16 accepted sources across frozen scopes');
        citations = request.source_refs.map(ref => acceptedCitation(state, ref));
        if (new Set(citations.map(row => row.scope)).size < 2)
          fail('synthesis requires accepted results from distinct scopes');
      }
      const planRef = hash(`${taskRef}\nplan\n${request.id}`);
      return { payload: { plan: request, ...(citations ? { citations } : {}), planning_cost_tokens: planningCostTokens },
        result: { plan_ref: planRef, status: 'planned', charged: { fuel: 1, token_units: planningCostTokens } } };
    });
  }

  async function grant(taskRef, input) {
    const request = normalizeGrant(input);
    return transact(taskRef, request, 'granted', async ({ spec, state }) => {
      if (request.base_refs.task_commit !== state.taskHead || request.base_refs.causal_event !== state.logHead) fail('stale grant base refs');
      if (!spec.scopes.includes(request.scope)) fail('grant scope is outside frozen task scope');
      if (state.remaining.branches < 1) fail('branch grant exhausted');
      // A ready candidate can still have a live DSH child until settlement.
      if ([...state.grants.values()].filter(row => row.status === 'active' || row.status === 'ready').length >= spec.limits.max_active_grants) fail('active grant cap reached');
      const plan = state.plans.get(request.plan_ref);
      if (!plan || plan.status !== 'planned' || plan.scope !== request.scope || plan.deliverable !== request.deliverable) fail('grant is not linked to an eligible logical task');
      if (plan.depends_on.some(ref => state.plans.get(ref)?.status !== 'accepted')) fail('logical task dependencies are not accepted');
      if (plan.kind === 'synthesis' && (request.owner !== spec.integration_owner || request.parent_grant_ref !== null))
        fail('synthesis grant requires the frozen root integration owner');
      if ([...state.grants.values()].some(row => row.branch === request.branch || row.location === request.location)) fail('branch or workspace location already granted');
      if ([...state.grants.values()].some(row => row.owner === request.owner && row.scope !== request.scope &&
        ['active', 'ready'].includes(row.status))) fail('owner already has a live grant in another scope');
      for (const key of ['tokens', 'fuel', 'integrations', 'evaluations']) {
        if (request.budget[key] > state.remaining[key]) fail(`${key} grant exhausted`);
        if (request.budget[key] > plan.budget[key]) fail(`${key} grant exceeds logical task budget`);
      }
      if (request.budget.children > plan.budget.children) fail('child grant exceeds logical task budget');
      if (request.budget.integrations && request.owner !== spec.integration_owner) fail('integration grant requires frozen integration owner');
      let depth = 0;
      if (request.parent_grant_ref) {
        const parent = state.grants.get(request.parent_grant_ref);
        if (!parent || parent.status !== 'active' || parent.left.children < 1) fail('parent has no live child grant');
        if (parent.scope !== request.scope) fail('child grant cannot cross parent scope');
        depth = parent.depth + 1;
      }
      if (depth > spec.limits.max_depth) fail('child grant exceeds max depth');
      if (request.budget.children > spec.limits.max_branches - 1) fail('child allowance exceeds branch bound');
      const grantRef = hash(`${taskRef}\n${request.id}`);
      return { payload: { grant: request, depth }, result: { grant_ref: grantRef, task_head: state.taskHead,
        remaining_branches: state.remaining.branches - 1 } };
    });
  }

  async function admit(taskRef, input) {
    const request = normalizeAdmit(input);
    // Evidence verification may involve retrieval or an external evaluator.
    // Never hold the task's SQLite writer lock while awaiting that work.
    let evidenceVerification = null;
    if (request.kind === 'finding') {
      if (typeof verifyKnowledge !== 'function') fail('independent knowledge verifier is not installed');
      const checked = await verifyKnowledge({ task_ref: taskRef, scope: request.scope,
        grant_ref: request.grant_ref, finding: clone(request.payload) });
      keys(checked, ['verified', 'claim_sha256', 'evidence_receipt_sha256', 'receipt_sha256'], 'knowledge verdict');
      if (checked.verified !== true || checked.claim_sha256 !== request.payload.claim_sha256 ||
        checked.evidence_receipt_sha256 !== request.payload.evidence_receipt_sha256) fail('knowledge evidence was not independently verified');
      evidenceVerification = { receipt_sha256: digest(checked.receipt_sha256, 'knowledge verifier receipt') };
    }
    return transact(taskRef, request, 'admitted', async ({ spec, state }) => {
      const grant = state.grants.get(request.grant_ref);
      if (!grant || grant.status !== 'active') fail('grant is not active');
      if (request.actor !== grant.owner || request.scope !== grant.scope || request.base_commit !== grant.base_refs.task_commit) fail('admission exceeds grant authority');
      const plan = state.plans.get(grant.plan_ref);
      if (request.kind === 'result' && !['research', 'analysis', 'synthesis'].includes(plan?.kind))
        fail('result proposal requires a research, analysis or synthesis plan');
      if (request.kind === 'result' && plan.kind === 'synthesis') {
        if (grant.owner !== spec.integration_owner ||
            request.payload.source_cut !== plan.expected_log_head ||
            canonical(request.payload.source_refs) !== canonical(plan.source_refs))
          fail('synthesis proposal differs from its frozen sources');
      } else if (request.kind === 'result' && request.payload.source_cut !== undefined) {
        fail('ordinary result cannot claim a synthesis source cut');
      }
      const payloadCostTokens = Math.max(1, Buffer.byteLength(canonical(request.payload)));
      if (grant.left.fuel < 1 || grant.left.tokens < payloadCostTokens) fail('branch fuel or context allowance exhausted');
      if (!request.parents.includes(grant.last_event)) fail('admission omits branch causal head');
      for (const parentRef of request.parents) {
        const parent = state.byDigest.get(parentRef);
        if (!parent) fail('admission names an unknown causal parent');
        if (parent.type === 'granted') {
          if (parent.result.grant_ref !== grant.ref) fail('admission names another branch grant');
        } else if (parent.type !== 'admitted' || parent.payload.scope !== request.scope) fail('admission parent crosses scope');
      }
      if (request.kind === 'handoff') {
        const cut = state.byDigest.get(request.payload.causal_cut);
        if (!cut || !request.parents.includes(cut.digest)) fail('handoff causal cut must be an admitted parent');
        for (const ref of request.payload.context_refs) {
          const event = state.byDigest.get(ref);
          if (!event || event.type !== 'admitted' || event.payload.scope !== request.scope) fail('handoff context ref crosses scope');
        }
      }
      return { payload: { ...request, payload_cost_tokens: payloadCostTokens, evidence_verification: evidenceVerification },
        result: { status: 'admitted', kind: request.kind, grant_ref: grant.ref, charged: { fuel: 1, token_units: payloadCostTokens },
          verifier_receipt_sha256: evidenceVerification?.receipt_sha256 ?? null } };
    });
  }

  // Only a trusted DSH tool wrapper calls this method. Reserve the full
  // worst-case subprocess deadline before invoking any model-facing algorithm
  // tool; a repeated call ID cannot run twice against one reservation.
  async function reserveAlgorithmCall(taskRef, input) {
    const request = normalizeAlgorithmCall(input);
    const schedule = ALGORITHM_CALLS[request.tool];
    const eventId = `algorithm:${hash(`${taskRef}\n${request.session_id}\n${request.call_id}`)}`;
    const reserved = await transact(taskRef, { id: eventId, ...request }, 'algorithm_call_reserved',
      async ({ state }) => {
        const matches = [...state.grants.values()].filter(grant => grant.session_id === request.session_id);
        if (matches.length !== 1 || matches[0].status !== 'active')
          fail('algorithm call has no live bound grant');
        const grant = matches[0];
        const plan = state.plans.get(grant.plan_ref);
        if (!plan || !['algorithm', 'implementation', 'evaluation', 'integration'].includes(plan.kind) ||
            plan.scope !== grant.scope || plan.status !== 'granted')
          fail('algorithm call requires an eligible scoped algorithm grant');
        if (grant.left.fuel < schedule.fuel) fail('algorithm call exceeds remaining grant fuel');
        return { payload: { grant_ref: grant.ref, session_id: request.session_id,
          call_id: request.call_id, tool: request.tool, input_sha256: request.input_sha256,
          fuel_cost: schedule.fuel, max_wall_ms: schedule.max_wall_ms },
        result: { status: 'reserved', grant_ref: grant.ref, charged: { fuel: schedule.fuel },
          max_wall_ms: schedule.max_wall_ms } };
      });
    if (reserved.existing) fail('algorithm call ID already spent a compute reservation');
    return reserved;
  }

  // Host-only boundary for an external selection that must observe the current
  // task head atomically with settlement. The callback must not call another
  // task-control method: it runs under the same crash-released task lock used
  // by settlement's final CAS. The host keeps it short and bounded.
  async function withCurrentHead(taskRef, expectedHead, action) {
    commit(expectedHead, 'promotion expected_head');
    if (typeof action !== 'function') fail('promotion action is required');
    return withLock(taskDir(taskRef), async () => {
      const current = await load(taskRef);
      if (current.state.taskHead !== expectedHead) fail('promotion task head changed before selection');
      return action();
    });
  }

  // This host-only adapter creates one actual DSH child for an admitted grant.
  // The caller owns the returned handle and sends a followup after creation.
  // A trusted setupChild must restrict tools/context before DSH publishes it.
  async function startChild(taskRef, input, ctx, options = {}) {
    const request = normalizeStart(input);
    if (typeof setupChild !== 'function') fail('trusted child scope setup is not installed');
    if (typeof ctx?.agents?.create !== 'function') fail('DSH agent factory is unavailable');
    if (!options.parentAgent || options.parentAgent.session?.id !== request.parent_session ||
      ctx.sessions?.get?.(request.parent_session) !== options.parentAgent.session) {
      fail('child requires its matching live DSH parent agent');
    }
    const initial = await load(taskRef);
    const grant = initial.state.grants.get(request.grant_ref);
    if (!grant) fail('child grant does not exist');
    const parentGrant = grant.parent_grant_ref && initial.state.grants.get(grant.parent_grant_ref);
    if (!parentGrant || !['active', 'ready'].includes(parentGrant.status) ||
      parentGrant.session_id !== request.parent_session) fail('child parent session does not own its parent grant');
    const toolBoundary = ctx.get?.('telepathyToolBoundary');
    if (typeof toolBoundary?.bindChildWorkspace !== 'function')
      fail('trusted child tool boundary is not installed');
    const cwd = await inspectWorkspace(clone(grant));
    const intentRequest = { ...request, id: `${request.id}:intent` };
    const intent = await transact(taskRef, intentRequest, 'child_start_requested', async ({ state }) => {
      const latest = state.grants.get(request.grant_ref);
      if (!latest || latest.status !== 'active' || latest.session_id || latest.pending_session_id) fail('child grant is unavailable or already starting');
      const currentParent = latest.parent_grant_ref && state.grants.get(latest.parent_grant_ref);
      if (!currentParent || !['active', 'ready'].includes(currentParent.status) ||
        currentParent.session_id !== request.parent_session) fail('child parent grant changed before start');
      if (latest.left.tokens < 1 || latest.left.fuel < 1) fail('child grant has no compute');
      if ([...state.grants.values()].some(row => row.session_id === request.session_id || row.pending_session_id === request.session_id)) fail('session already belongs to another grant');
      if (latest.location !== grant.location || latest.base_refs.task_commit !== grant.base_refs.task_commit) fail('grant changed during workspace inspection');
      return { payload: { ...request, cwd }, result: { status: 'requested', session_id: request.session_id,
        grant_ref: request.grant_ref, cwd } };
    });
    if (intent.existing) {
      const now = await load(taskRef);
      const already = now.state.grants.get(request.grant_ref)?.session_id === request.session_id;
      return { status: already ? 'already-started' : 'pending-reconciliation', session_id: request.session_id,
        grant_ref: request.grant_ref, intent_digest: intent.event_digest, handle: null };
    }
    let handle = null;
    try {
      const setup = setupChild({ task_ref: taskRef, grant: clone(grant), causal_cut: intent.event_digest });
      if (typeof setup !== 'function') fail('trusted child setup must return a DSH setup callback');
      const guardedSetup = (agentCtx, agent) => {
        toolBoundary.bindChildWorkspace(agent, clone(grant));
        return setup(agentCtx, agent);
      };
      handle = await ctx.agents.create({ sessionId: request.session_id,
        parentAgent: options.parentAgent,
        meta: { cwd, parentSession: request.parent_session, origin: 'subagent', delegationDepth: grant.depth },
        agentOptions: { provider: 'deepseek-official', model: 'deepseek-flash', maxTokens: Math.min(4096, grant.left.tokens) },
        setup: guardedSetup, signal: AbortSignal.timeout(30_000) });
      const result = await transact(taskRef, { ...request, id: `${request.id}:started` }, 'child_started', async ({ state }) => {
        const latest = state.grants.get(request.grant_ref);
        if (!latest || latest.pending_session_id !== request.session_id || latest.pending_start_id !== request.id ||
          state.terminal || latest.status !== 'active') fail('child intent changed before publication');
        return { payload: { ...request, cwd, intent_digest: intent.event_digest },
          result: { session_id: request.session_id, grant_ref: latest.ref, status: 'started', cwd } };
      });
      return { ...result, handle };
    } catch (error) {
      if (handle && typeof handle.dispose === 'function') await handle.dispose().catch(() => {});
      await transact(taskRef, { ...request, id: `${request.id}:failed` }, 'child_start_failed', async ({ state }) => {
        const latest = state.grants.get(request.grant_ref);
        if (!latest || latest.pending_session_id !== request.session_id) fail('child start failure has no pending intent');
        return { payload: { ...request, reason: String(error.message ?? error).slice(0, 512) },
          result: { status: 'failed', grant_ref: latest.ref, session_id: request.session_id } };
      }).catch(() => {});
      throw error;
    }
  }

  // The first root model call can bind a previously funded integration grant.
  // Only the host supplies this exact grant ref; no model tool exposes it.
  async function bindRootSession(taskRef, input, ctx) {
    keys(input, ['id', 'grant_ref', 'session_id'], 'root session binding');
    const request = { id: id(input.id, 'root binding id'),
      grant_ref: digest(input.grant_ref, 'root grant_ref'),
      session_id: id(input.session_id, 'root session_id') };
    const live = ctx?.sessions?.get?.(request.session_id);
    if (!live || live.id !== request.session_id || live.header?.origin === 'subagent' ||
      live.header?.parentSession !== undefined) fail('root binding requires a live root DSH session');
    const initial = await load(taskRef);
    const initialGrant = initial.state.grants.get(request.grant_ref);
    if (!initialGrant) fail('root integration grant does not exist');
    const cwd = await inspectWorkspace(clone(initialGrant));
    if (live.header.cwd !== cwd) fail('root session cwd differs from granted jj workspace');
    return transact(taskRef, request, 'root_session_bound', async ({ spec, state }) => {
      const grant = state.grants.get(request.grant_ref);
      if (!grant || grant.status !== 'active' || grant.session_id || grant.pending_session_id ||
        grant.owner !== spec.integration_owner || grant.parent_grant_ref !== null ||
        grant.left.tokens < 1 || grant.left.fuel < 1) fail('root integration grant is unavailable');
      if (grant.location !== initialGrant.location ||
        grant.base_refs.task_commit !== initialGrant.base_refs.task_commit) fail('root grant changed during workspace inspection');
      if ([...state.grants.values()].some(row => row.session_id === request.session_id ||
        row.pending_session_id === request.session_id)) fail('DSH session already belongs to another grant');
      return { payload: { grant_ref: grant.ref, session_id: request.session_id },
        result: { status: 'bound', grant_ref: grant.ref, session_id: request.session_id } };
    });
  }

  // Recovery is deliberately conservative: DSH's ctx.sessions.get sees only
  // live sessions. A cold missing session stays unknown until a host audits
  // persistence; the controller never spawns a duplicate on an old intent.
  async function reconcilePendingChild(taskRef, grantRef, ctx) {
    const { state } = await load(taskRef);
    const grant = state.grants.get(digest(grantRef, 'grant_ref'));
    if (!grant?.pending_session_id) fail('grant has no pending child intent');
    const live = ctx?.sessions?.get?.(grant.pending_session_id);
    if (!live) return { status: 'unknown-cold-session', session_id: grant.pending_session_id,
      reason: 'inspect DSH persistence before deciding whether to resume or fail this intent' };
    if (live.header?.cwd !== grant.pending_cwd || live.header?.origin !== 'subagent' ||
      live.header?.parentSession !== grant.pending_parent_session ||
      live.header?.delegationDepth !== grant.depth) fail('live DSH session metadata differs from grant');
    return transact(taskRef, { id: `${grant.pending_start_id}:started`, grant_ref: grant.ref,
      session_id: grant.pending_session_id, parent_session: live.header.parentSession }, 'child_started',
    async ({ state: latest }) => {
      const row = latest.grants.get(grant.ref);
      if (row?.pending_session_id !== grant.pending_session_id) fail('pending child intent changed during reconciliation');
      return { payload: { id: grant.pending_start_id, grant_ref: grant.ref,
        session_id: grant.pending_session_id, parent_session: live.header.parentSession,
        cwd: grant.pending_cwd, intent_digest: row.pending_intent_digest },
      result: { status: 'started', session_id: grant.pending_session_id, grant_ref: grant.ref,
        cwd: grant.pending_cwd, reconciled: true } };
    });
  }

  // Host-only crash resolution. A missing in-memory session is insufficient:
  // the audit must inspect DSH's durable catalog and bind the exact intent.
  async function abandonPendingChild(taskRef, grantRef) {
    if (typeof auditChildAbsence !== 'function') fail('durable DSH child absence audit is not installed');
    const { state } = await load(taskRef);
    const grant = state.grants.get(digest(grantRef, 'grant_ref'));
    if (!grant?.pending_session_id) fail('grant has no pending child intent');
    const target = { task_ref: taskRef, grant_ref: grant.ref, session_id: grant.pending_session_id,
      parent_session: grant.pending_parent_session, cwd: grant.pending_cwd,
      intent_digest: grant.pending_intent_digest };
    const audited = await auditChildAbsence(clone(target));
    keys(audited, ['status', 'session_id', 'intent_digest', 'receipt_sha256'], 'child absence audit');
    if (audited.status !== 'absent' || audited.session_id !== target.session_id ||
      audited.intent_digest !== target.intent_digest) fail('durable child audit did not prove this exact intent absent');
    digest(audited.receipt_sha256, 'child absence receipt');
    return transact(taskRef, { id: `${grant.pending_start_id}:abandoned`, grant_ref: grant.ref,
      session_id: target.session_id, intent_digest: target.intent_digest }, 'child_start_failed',
    async ({ state: latest }) => {
      const row = latest.grants.get(grant.ref);
      if (row?.pending_session_id !== target.session_id || row.pending_intent_digest !== target.intent_digest)
        fail('pending child changed during durable audit');
      return { payload: { grant_ref: grant.ref, session_id: target.session_id,
        reason: 'durable-dsh-session-absent', audit_receipt_sha256: audited.receipt_sha256 },
      result: { status: 'failed', grant_ref: grant.ref, session_id: target.session_id,
        audit_receipt_sha256: audited.receipt_sha256 } };
    });
  }

  // An abandoned evaluation still consumes its reserved budget. A host audit
  // must establish that no verifier can later publish an acceptance for it.
  async function abandonPendingEvaluation(taskRef, settlementId) {
    if (typeof auditEvaluationAbandonment !== 'function') fail('evaluation abandonment audit is not installed');
    const isResult = typeof settlementId === 'string' && settlementId.startsWith('!result:');
    const resultId = isResult ? settlementId.slice('!result:'.length) : null;
    id(isResult ? resultId : settlementId, 'settlement id');
    const { state } = await load(taskRef);
    if (!state.pendingEvaluations.has(settlementId)) fail('evaluation is not pending');
    const intentId = isResult ? `eval-result:${resultId}` : `eval:${settlementId}`;
    const intent = state.ids.get(intentId);
    if (!intent || !['evaluation_started', 'result_evaluation_started'].includes(intent.type))
      fail('pending evaluation intent is missing');
    const target = { task_ref: taskRef, settlement_id: settlementId, intent_digest: intent.digest };
    const audited = await auditEvaluationAbandonment(clone(target));
    keys(audited, ['status', 'settlement_id', 'intent_digest', 'receipt_sha256'], 'evaluation abandonment audit');
    if (audited.status !== 'abandoned' || audited.settlement_id !== settlementId ||
      audited.intent_digest !== intent.digest) fail('evaluation audit did not bind the exact intent');
    digest(audited.receipt_sha256, 'evaluation abandonment receipt');
    return transact(taskRef, { id: isResult ? `eval-result:${resultId}:abandoned` : `eval:${settlementId}:abandoned`, settlement_id: settlementId,
      intent_digest: intent.digest }, 'evaluation_abandoned', async ({ state: latest }) => {
      if (!latest.pendingEvaluations.has(settlementId) || latest.ids.get(intentId)?.digest !== intent.digest)
        fail('pending evaluation changed during audit');
      return { payload: { settlement_id: settlementId, audit_receipt_sha256: audited.receipt_sha256 },
        result: { status: 'abandoned', settlement_id: settlementId,
          audit_receipt_sha256: audited.receipt_sha256 } };
    });
  }

  // A research/analysis/synthesis result is a proposal until this host-only independent
  // check accepts its exact plan, grant, artifact and causal cut. Acceptance
  // unlocks dependent plans but does not change the jj source head or declare
  // the frozen task goal complete.
  async function settleResult(taskRef, input) {
    const request = normalizeResultSettle(input);
    const before = await load(taskRef);
    const prior = before.state.ids.get(request.id);
    if (prior) {
      if (prior.type !== 'result_settled' || prior.request_digest !== hash(canonical(request)))
        fail('event ID reused with different content');
      return { ...prior.result, event_digest: prior.digest, log_head: prior.digest, existing: true };
    }
    const { spec, state } = before;
    if (state.terminal || state.taskHead !== request.expected_head) fail('stale task head for result settlement');
    const grant = state.grants.get(request.grant_ref);
    const plan = state.plans.get(request.plan_ref);
    const event = state.byDigest.get(request.result_event);
    if (!grant || !plan || grant.plan_ref !== plan.ref || !['research', 'analysis', 'synthesis'].includes(plan.kind) ||
      grant.status !== 'ready' || plan.status !== 'ready' || grant.left.evaluations < 1 ||
      grant.base_refs.task_commit !== request.expected_head ||
      !event || event.type !== 'admitted' || event.payload.kind !== 'result' ||
      event.payload.grant_ref !== grant.ref || state.results.get(event.digest)?.status !== 'ready')
      fail('result settlement is not bound to a ready research, analysis or synthesis grant');
    const synthesis = plan.kind === 'synthesis';
    const verifier = synthesis ? verifySynthesis : verifyResult;
    if (typeof verifier !== 'function') fail(synthesis
      ? 'host-pinned synthesis oracle is not installed' : 'independent result verifier is not installed');
    if (synthesis && (grant.owner !== spec.integration_owner ||
        plan.oracle_sha256 !== spec.pinned_versions.synthesis_oracle_sha256 ||
        event.payload.payload.source_cut !== plan.expected_log_head ||
        canonical(event.payload.payload.source_refs) !== canonical(plan.source_refs) ||
        !Array.isArray(plan.citations)))
      fail('synthesis result differs from frozen integration authority');
    const proposed = { event_digest: event.digest, artifact_sha256: event.payload.payload.artifact_sha256,
      evidence_receipt_sha256: event.payload.payload.evidence_receipt_sha256,
      source_refs: event.payload.payload.source_refs, causal_parents: event.payload.parents };
    if (synthesis) proposed.source_cut = event.payload.payload.source_cut;
    const pendingId = `!result:${request.id}`;
    const reservation = await transact(taskRef, { ...request, id: `eval-result:${request.id}` },
      'result_evaluation_started', async ({ spec: latestSpec, state: latest }) => {
        const currentGrant = latest.grants.get(request.grant_ref);
        const currentPlan = latest.plans.get(request.plan_ref);
        const currentEvent = latest.byDigest.get(request.result_event);
        if (latest.terminal || latest.taskHead !== request.expected_head ||
          latestSpec.pinned_versions.evaluator_sha256 !== spec.pinned_versions.evaluator_sha256 ||
          latestSpec.pinned_versions.synthesis_oracle_sha256 !== spec.pinned_versions.synthesis_oracle_sha256 ||
          !currentGrant || !currentPlan || currentGrant.plan_ref !== currentPlan.ref ||
          currentGrant.status !== 'ready' || currentPlan.status !== 'ready' ||
          currentGrant.left.evaluations < 1 || currentGrant.base_refs.task_commit !== request.expected_head ||
          currentEvent?.payload?.grant_ref !== currentGrant.ref ||
          latest.results.get(request.result_event)?.status !== 'ready')
          fail('result grant changed before evaluation reservation');
        return { payload: { id: pendingId, grant_ref: currentGrant.ref, request },
          result: { status: 'evaluation-reserved', settlement_id: pendingId,
            plan_ref: currentPlan.ref, result_event: request.result_event } };
      });
    if (reservation.existing) fail('result evaluation is already pending; inspect its prior attempt');
    const binding = { task_ref: taskRef, plan_ref: plan.ref, grant_ref: grant.ref,
      result_event: request.result_event, expected_head: request.expected_head,
      causal_cut: reservation.log_head, artifact_sha256: proposed.artifact_sha256,
      evidence_receipt_sha256: proposed.evidence_receipt_sha256,
      evaluator_sha256: plan.oracle_sha256,
      case_set_sha256: spec.pinned_versions.case_set_sha256,
      toolchain: spec.pinned_versions.toolchain };
    if (synthesis) {
      binding.source_cut = plan.expected_log_head;
      binding.citations_sha256 = hash(canonical(plan.citations));
      binding.synthesis_oracle_sha256 = spec.pinned_versions.synthesis_oracle_sha256;
    }
    let raw;
    try {
      raw = await verifier({ ...clone(binding), ...(synthesis ? { citations: clone(plan.citations) } : {}),
        spec: clone(spec), plan: clone(plan),
        grant: clone(grant), result: clone(proposed) });
    } catch (error) {
      raw = { ...binding, ok: false,
        receipt_sha256: hash(`result-verifier-error:${request.id}:${String(error)}`),
        reason: 'independent-result-verifier-error' };
    }
    try {
      keys(raw, [...Object.keys(binding), 'ok', 'receipt_sha256', 'reason'], 'independent result verdict');
      if (typeof raw.ok !== 'boolean') fail('result verifier returned invalid verdict flag');
      digest(raw.receipt_sha256, 'result verifier receipt_sha256');
      for (const [key, value] of Object.entries(binding))
        if (canonical(raw[key]) !== canonical(value)) fail(`result verifier returned different ${key}`);
      if (!raw.ok) str(raw.reason, 'result rejection reason', 1024);
      bounded(raw, 'independent result verdict', 4096);
    } catch (error) {
      raw = { ...binding, ok: false,
        receipt_sha256: hash(`invalid-result-verdict:${request.id}:${String(error)}`),
        reason: 'invalid-independent-result-verdict' };
    }
    const verdict = bounded(raw, 'independent result verdict', 4096);
    return transact(taskRef, request, 'result_settled', async ({ state: latest }) => {
      const currentGrant = latest.grants.get(request.grant_ref);
      const currentPlan = latest.plans.get(request.plan_ref);
      // The reservation is the immutable causal cut checked by the verifier.
      // Other grants may append while this result's own proposal stays ready.
      const stale = Boolean(latest.terminal || latest.taskHead !== request.expected_head ||
        !currentGrant || currentGrant.status !== 'ready' ||
        currentGrant.plan_ref !== request.plan_ref ||
        currentGrant.base_refs.task_commit !== request.expected_head ||
        currentGrant.last_event !== request.result_event ||
        !currentPlan || currentPlan.status !== 'ready' ||
        (synthesis && (currentPlan.oracle_sha256 !== spec.pinned_versions.synthesis_oracle_sha256 ||
          canonical(currentPlan.citations) !== canonical(plan.citations) ||
          currentPlan.source_refs.some(ref => latest.results.get(ref)?.status !== 'accepted'))) ||
        latest.results.get(request.result_event)?.status !== 'ready' ||
        !latest.pendingEvaluations.has(pendingId));
      return { payload: { request, verdict, stale }, result: {
        status: stale ? 'rejected' : verdict.ok ? 'accepted' : 'rejected',
        plan_ref: request.plan_ref, result_event: request.result_event,
        task_head: latest.taskHead, task_accepted: false,
        receipt_sha256: verdict.receipt_sha256,
        reason: stale ? 'stale-result-after-verification' : verdict.ok ? null : verdict.reason,
      } };
    });
  }

  async function settle(taskRef, input) {
    const request = normalizeSettle(input);
    if (typeof verifyCombined !== 'function') fail('independent combined-revision verifier is not installed');
    const before = await load(taskRef);
    const prior = before.state.ids.get(request.id);
    if (prior) {
      if (prior.type !== 'settled' || prior.request_digest !== hash(canonical(request))) fail('event ID reused with different content');
      return { ...prior.result, event_digest: prior.digest, log_head: prior.digest, existing: true };
    }
    const { spec, state } = before;
    if (state.terminal || request.expected_head !== state.taskHead) fail('stale task head; integration requires CAS');
    const integrator = state.grants.get(request.integration_grant_ref);
    if (!integrator || !['active', 'ready'].includes(integrator.status) ||
      integrator.owner !== spec.integration_owner || integrator.left.integrations < 1 ||
      integrator.left.evaluations < 1) fail('integration/evaluation grant is missing or exhausted');
    if (integrator.base_refs.task_commit !== request.expected_head) fail('integration grant is based on a stale commit');
    const candidates = request.candidate_events.map(ref => {
      const event = state.byDigest.get(ref);
      const candidate = state.candidates.get(ref);
      if (!event || event.type !== 'admitted' || event.payload.kind !== 'candidate' || candidate?.status !== 'ready') fail('settlement names an unready candidate');
      const grant = state.grants.get(candidate.grant_ref);
      if (!grant || grant.base_refs.task_commit !== request.expected_head) fail('candidate has a stale base');
      return { event_digest: ref, grant_ref: grant.ref, scope: grant.scope,
        base_commit: grant.base_refs.task_commit, commit: event.payload.payload.commit,
        artifact_sha256: event.payload.payload.artifact_sha256,
        observation_receipt_sha256: event.payload.payload.observation_receipt_sha256 };
    });
    const acceptedResults = [...state.results.entries()]
      .filter(([, result]) => result.status === 'accepted')
      .map(([event_digest, result]) => {
        const event = state.byDigest.get(event_digest);
        const grant = state.grants.get(result.grant_ref);
        const plan = grant && state.plans.get(grant.plan_ref);
        if (event?.type !== 'admitted' || event.payload.kind !== 'result' ||
            !grant || !plan || !result.settlement_event_digest ||
            !result.verifier_receipt_sha256)
          fail('accepted goal source lacks independent settlement evidence');
        return { event_digest, scope: grant.scope, kind: plan.kind,
          artifact_sha256: event.payload.payload.artifact_sha256,
          settlement_event_digest: result.settlement_event_digest,
          verifier_receipt_sha256: result.verifier_receipt_sha256 };
      }).sort((a, b) => a.event_digest.localeCompare(b.event_digest));
    const priorLogHead = state.logHead;
    const otherPendingEvaluations = state.pendingEvaluations.size;
    // Reserve the evaluation before running an expensive verifier. Replaying
    // the log after a crash still shows the spent slot and pending intent;
    // another settlement cannot spend the same grant concurrently.
    const reservation = await transact(taskRef, { ...request, id: `eval:${request.id}` },
      'evaluation_started', async ({ spec: latestSpec, state: latest }) => {
        const current = latest.grants.get(request.integration_grant_ref);
        if (latest.terminal || latest.logHead !== priorLogHead ||
          latest.taskHead !== request.expected_head ||
          !current || !['active', 'ready'].includes(current.status) ||
          current.owner !== latestSpec.integration_owner ||
          current.left.integrations < 1 || current.left.evaluations < 1 ||
          request.candidate_events.some(ref => latest.candidates.get(ref)?.status !== 'ready')) {
          fail('integration/evaluation grant changed before reservation');
        }
        return { payload: { id: request.id, integration_grant_ref: current.ref,
          expected_head: request.expected_head, candidate_events: request.candidate_events },
        result: { status: 'evaluation-reserved', settlement_id: request.id } };
      });
    if (reservation.existing) fail('evaluation is already pending; inspect its prior attempt');
    // The expensive host verifier runs without the task mutex. A final locked
    // CAS below decides adoption and still records a stale result if another
    // integration won during verification.
    let raw;
    try {
      raw = await verifyCombined({ task_ref: taskRef, spec: clone(spec), expected_head: request.expected_head,
        candidates: clone(candidates), integration_grant: clone(integrator),
        goal_context: { causal_cut: reservation.log_head,
          accepted_results: clone(acceptedResults),
          other_pending_evaluations: otherPendingEvaluations } });
    } catch (error) {
      raw = { ok: false, task_accepted: false, base_commit: request.expected_head,
        candidate_events: request.candidate_events,
        evaluator_sha256: spec.pinned_versions.evaluator_sha256,
        case_set_sha256: spec.pinned_versions.case_set_sha256,
        toolchain: spec.pinned_versions.toolchain,
        receipt_sha256: hash(`verifier-error:${request.id}:${String(error)}`),
        reason: 'independent-verifier-error' };
    }
    try {
      keys(raw, ['ok', 'combined_commit', 'checked_commit', 'base_commit', 'candidate_events',
        'evaluator_sha256', 'case_set_sha256', 'toolchain', 'receipt_sha256',
        'ancestry_ok', 'conflicts_resolved', 'task_accepted', 'reason', 'gate',
        'goal_evidence', 'goal_evidence_sha256'], 'independent verdict');
      if (typeof raw.ok !== 'boolean' || typeof raw.task_accepted !== 'boolean') fail('verifier returned invalid verdict flags');
      digest(raw.receipt_sha256, 'verifier receipt_sha256');
      if (raw.base_commit !== request.expected_head || canonical(raw.candidate_events) !== canonical(request.candidate_events) ||
        raw.evaluator_sha256 !== spec.pinned_versions.evaluator_sha256 ||
        raw.case_set_sha256 !== spec.pinned_versions.case_set_sha256 || raw.toolchain !== spec.pinned_versions.toolchain) fail('verifier returned a verdict for different pinned inputs');
      if (raw.ok) {
        commit(raw.combined_commit, 'combined_commit');
        if (raw.checked_commit !== raw.combined_commit || raw.ancestry_ok !== true || raw.conflicts_resolved !== true) fail('verifier did not check the exact reconciled revision');
        keys(raw.gate, ['revision', 'argv', 'exit_code', 'receipt_sha256'], 'exact-revision gate');
        if (raw.gate.revision !== raw.combined_commit || canonical(raw.gate.argv) !== canonical(REQUIRED_GATE_ARGS(raw.combined_commit)) ||
          raw.gate.exit_code !== 0) fail('verifier did not pass the exact jj revision gate');
        digest(raw.gate.receipt_sha256, 'gate receipt_sha256');
        if (raw.task_accepted && combinedVerifierAdapters.has(verifyCombined) &&
            (!raw.goal_evidence || !raw.goal_evidence_sha256 ||
              hash(canonical(raw.goal_evidence)) !== raw.goal_evidence_sha256))
          fail('accepted production task lacks a bound goal evidence receipt');
      } else {
        if (raw.task_accepted) fail('failed verification cannot accept the task');
        str(raw.reason, 'rejection reason', 1024);
      }
      bounded(raw, 'independent verdict', 4096);
    } catch (error) {
      // A malformed host result has still spent an evaluation. Persist a
      // fail-closed receipt so restart cannot strand the reservation.
      raw = { ok: false, task_accepted: false, base_commit: request.expected_head,
        candidate_events: request.candidate_events,
        evaluator_sha256: spec.pinned_versions.evaluator_sha256,
        case_set_sha256: spec.pinned_versions.case_set_sha256,
        toolchain: spec.pinned_versions.toolchain,
        receipt_sha256: hash(`invalid-verdict:${request.id}:${String(error)}`),
        reason: 'invalid-independent-verdict' };
    }
    const verdict = bounded(raw, 'independent verdict', 4096);
      return transact(taskRef, request, 'settled', async ({ spec: latestSpec, state: latest }) => {
        const currentIntegrator = latest.grants.get(request.integration_grant_ref);
        const stale = Boolean(latest.terminal || request.expected_head !== latest.taskHead ||
          !currentIntegrator || !['active', 'ready'].includes(currentIntegrator.status) ||
          currentIntegrator.left.integrations < 1 ||
          !latest.pendingEvaluations.has(request.id) ||
          (raw.task_accepted && latest.logHead !== reservation.log_head) ||
          request.candidate_events.some(ref => latest.candidates.get(ref)?.status !== 'ready'));
        if (latestSpec.pinned_versions.evaluator_sha256 !== spec.pinned_versions.evaluator_sha256) fail('frozen evaluator changed');
        const result = { status: stale ? 'rejected' : raw.ok ? 'accepted' : 'rejected',
          accepted_head: stale ? latest.taskHead : raw.ok ? raw.combined_commit : latest.taskHead,
          task_accepted: !stale && raw.ok && raw.task_accepted,
          receipt_sha256: raw.receipt_sha256,
          ...(!stale && raw.ok && raw.task_accepted && raw.goal_evidence_sha256 ?
            { goal_receipt_sha256: raw.goal_evidence_sha256 } : {}),
          reason: stale ? 'stale-head-after-verification' : raw.ok ? null : str(raw.reason, 'rejection reason', 1024) };
        return { payload: { request, verdict, stale }, result };
      });
  }

  async function checkpoint(taskRef, input) {
    const request = normalizeCheckpoint(input);
    return transact(taskRef, request, 'checkpointed', async ({ spec, state }) => {
      if (request.expected_log_head !== state.logHead) fail('stale checkpoint causal cut');
      const grants = [...state.grants.values()];
      const pending = [...state.candidates.values()].filter(row => row.status === 'ready').length;
      const readyResults = [...state.results.values()].filter(row => row.status === 'ready');
      const pendingResults = readyResults.length;
      const evaluableResult = readyResults.some(row => {
        const grant = state.grants.get(row.grant_ref);
        return grant?.status === 'ready' && state.plans.get(grant.plan_ref)?.status === 'ready' &&
          grant.left.evaluations > 0 && grant.base_refs.task_commit === state.taskHead;
      });
      const staleResultWithEvaluation = readyResults.some(row => {
        const grant = state.grants.get(row.grant_ref);
        return grant?.left.evaluations > 0 && grant.base_refs.task_commit !== state.taskHead;
      });
      const pendingChildren = grants.filter(row => row.pending_session_id).length;
      const active = grants.filter(row => row.status === 'active').length;
      const occupied = grants.filter(row => row.status === 'active' || row.status === 'ready').length;
      const plannedRows = [...state.plans.values()].filter(row => row.status === 'planned');
      const planned = plannedRows.length;
      const eligiblePlanned = plannedRows.some(row =>
        row.depends_on.every(ref => state.plans.get(ref)?.status === 'accepted'));
      const inputs = { task_head: state.taskHead, log_head: state.logHead,
        active_branches: active, occupied_worker_slots: occupied,
        planned_tasks: planned, pending_candidates: pending, pending_results: pendingResults,
        pending_evaluations: state.pendingEvaluations.size, pending_children: pendingChildren,
        remaining: clone(state.remaining),
        last_settlement: state.lastSettlement, policy_version: spec.policy_version };
      let decision = 'inspect';
      let reason = 'no eligible work is currently admitted';
      if (state.terminal) { decision = 'stop'; reason = state.terminal.reason; }
      else if (state.pendingEvaluations.size) { decision = 'continue'; reason = 'independent evaluation is in progress or needs reconciliation'; }
      else if (pendingChildren) { decision = 'continue'; reason = 'DSH child start needs durable reconciliation'; }
      else if (evaluableResult) {
        decision = 'evaluate'; reason = 'ready research, analysis or synthesis result requires independent evaluation';
      }
      else if (pending && grants.some(row => ['active', 'ready'].includes(row.status) &&
        row.owner === spec.integration_owner && row.left.integrations > 0 &&
        row.left.evaluations > 0 && row.base_refs.task_commit === state.taskHead)) {
        decision = 'integrate'; reason = 'ready candidates and a funded integration grant';
      } else if (pendingResults) {
        decision = 'inspect'; reason = staleResultWithEvaluation ? 'result-base-stale' : 'result-evaluation-budget-exhausted';
      } else if (eligiblePlanned && state.remaining.branches > 0 && occupied < spec.limits.max_active_grants) {
        decision = 'delegate'; reason = 'funded logical task and worker slot remain';
      } else if (active) { decision = 'continue'; reason = 'active branch work remains'; }
      else if (pending) { decision = 'stop'; reason = 'integration-or-evaluation-budget-exhausted'; }
      else if (planned) {
        decision = 'inspect';
        reason = eligiblePlanned ? 'branch-budget-exhausted' : 'blocked-dependencies';
      }
      else if (state.remaining.tasks > 0) { decision = 'inspect'; reason = 'typed task decomposition is pending'; }
      else { decision = 'stop'; reason = 'no-active-branches-or-grants'; }
      return { payload: { inputs, decision, reason }, result: { decision, reason, policy_version: spec.policy_version, inputs } };
    });
  }

  async function view(taskRef, agent, causalCut, tokenBudget) {
    id(agent, 'agent'); integer(tokenBudget, 'token_budget', 1, 65_536);
    const { spec, events, state } = await load(taskRef);
    const cut = causalCut === null || causalCut === undefined ? state.logHead : digest(causalCut, 'causal_cut');
    const index = events.findIndex(event => event.digest === cut);
    if (index < 0) fail('causal cut is not admitted');
    const atCut = fold(spec, events.slice(0, index + 1));
    const liveGrants = [...atCut.grants.values()].filter(grant => grant.owner === agent &&
      (grant.status === 'active' || grant.status === 'ready'));
    const scopes = new Set(liveGrants.map(grant => grant.scope));
    if (!scopes.size) fail('agent has no grant at causal cut');
    const ownedGrants = liveGrants.reverse();
    const assignmentCandidates = ownedGrants.slice(0, MAX_VIEW_ITEMS)
      .map(grant => { const plan = atCut.plans.get(grant.plan_ref); return {
        grant_ref: grant.ref, plan_ref: plan.ref, scope: plan.scope, kind: plan.kind,
        deliverable: plan.deliverable, acceptance: plan.acceptance, source_refs: plan.source_refs,
        oracle_sha256: plan.oracle_sha256, base_commit: grant.base_refs.task_commit,
        ...(plan.kind === 'synthesis' && grant.owner === spec.integration_owner
          ? { source_cut: plan.expected_log_head, citations: plan.citations } : {}),
      }; });
    const assignments = [];
    let bytes = 0;
    for (const candidate of assignmentCandidates) {
      const cost = Buffer.byteLength(canonical(candidate));
      if (bytes + cost <= tokenBudget) { assignments.push(candidate); bytes += cost; }
    }
    // Keep independently accepted evidence visible when a long session has
    // accumulated many newer proposals. The three bounded buckets retain
    // recency within each class; neither a model assertion nor a receipt name
    // alone turns a proposal into an accepted finding.
    const buckets = [[], [], []];
    const sourceRefs = new Set(assignments.flatMap(assignment => assignment.source_refs));
    let eligible = 0;
    for (let i = index; i >= 0; i--) {
      const event = events[i];
      if (event.type !== 'admitted' || !scopes.has(event.payload.scope)) continue;
      eligible++;
      const admission = event.payload;
      const stateStatus = admission.kind === 'candidate' ? atCut.candidates.get(event.digest)?.status
        : admission.kind === 'result' ? atCut.results.get(event.digest)?.status : null;
      const evidenceStatus = admission.kind === 'finding' ? 'verified'
        : stateStatus === 'accepted' ? 'accepted'
          : stateStatus === 'rejected' ? 'rejected' : 'proposed';
      const row = { event_digest: event.digest, kind: event.payload.kind, scope: event.payload.scope,
        grant_ref: event.payload.grant_ref, causal_parents: event.payload.parents,
        artifact_sha256: event.payload.payload.artifact_sha256 ?? null,
        claim_sha256: event.payload.payload.claim_sha256 ?? null,
        message_sha256: event.payload.payload.message_sha256 ?? null,
        receipt_sha256: event.payload.payload.receipt_sha256 ?? event.payload.payload.observation_receipt_sha256 ?? null,
        evidence_status: evidenceStatus };
      const assignedSource = sourceRefs.has(row.event_digest) ||
        (row.artifact_sha256 && sourceRefs.has(row.artifact_sha256)) ||
        (row.claim_sha256 && sourceRefs.has(row.claim_sha256));
      const priority = assignedSource ? 0 : (evidenceStatus === 'verified' || evidenceStatus === 'accepted') ? 1 : 2;
      if (buckets[priority].length < MAX_VIEW_ITEMS) buckets[priority].push(row);
    }
    const refs = [];
    for (const bucket of buckets) for (const row of bucket) {
      if (refs.length >= MAX_VIEW_ITEMS) break;
      // UTF-8 bytes are a conservative, tokenizer-independent allowance for
      // the reference-only JSON view. An exact provider count can be added by
      // the context assembler; no full transcript is copied here.
      const cost = Buffer.byteLength(canonical(row));
      if (bytes + cost > tokenBudget) continue;
      refs.push(row); bytes += cost;
    }
    return { task_ref: taskRef, causal_cut: cut, task_head: atCut.taskHead,
      scopes: [...scopes].sort(), assignments, context_refs: refs,
      budget_units: 'utf8-bytes-upper-bound', used: bytes,
      truncated: refs.length < eligible || assignments.length < assignmentCandidates.length || ownedGrants.length > MAX_VIEW_ITEMS };
  }

  return Object.freeze({ open, plan, view, grant, admit, reserveAlgorithmCall, withCurrentHead,
    startChild, bindRootSession, reconcilePendingChild,
    abandonPendingChild, abandonPendingEvaluation,
    settle, settleResult, checkpoint, replay: async taskRef => {
    const { spec, state, events } = await load(taskRef);
    return { task_ref: taskRef, spec: clone(spec), task_head: state.taskHead, log_head: state.logHead,
      terminal: clone(state.terminal), remaining: clone(state.remaining),
      pending_evaluations: [...state.pendingEvaluations],
      grants: [...state.grants.values()].map(clone), plans: [...state.plans.values()].map(clone),
      results: [...state.results.entries()].map(([event_digest, result]) => ({ event_digest, ...clone(result) })),
      knowledge: [...state.knowledge.values()].map(clone), events: events.map(event => ({
        id: event.id, type: event.type, digest: event.digest, prev: event.prev, result: event.result })) };
  } });
}

/**
 * Host-owned settlement adapter. `reconcile` creates/checks one exact jj
 * combination; the installed checked-release gate tests that exact revision; the
 * separate `evaluateIndependent` reads a frozen oracle outside the candidate
 * revision. Neither a worker's score nor the candidate's checker is Q.
 */
export function createJjCombinedVerifier(settings) {
  const repoRoot = path.resolve(str(settings.repoRoot, 'verifier repoRoot', 4096));
  if (realpathSync(repoRoot) !== repoRoot) fail('verifier repoRoot must be canonical');
  const requestedComparisonRoot = settings.freshComparisonRoot === undefined ? null :
    path.resolve(str(settings.freshComparisonRoot, 'fresh comparison root', 4096));
  const comparisonRoot = requestedComparisonRoot && realpathSync(requestedComparisonRoot);
  if (comparisonRoot) {
    if ((settings.gateRunner === undefined && requestedComparisonRoot !== comparisonRoot) ||
        !lstatSync(comparisonRoot).isDirectory())
      fail('fresh comparison root must be a real directory');
    const below = (root, target) => target === root || target.startsWith(`${root}${path.sep}`);
    if (settings.gateRunner === undefined &&
        [repoRoot, os.tmpdir(), '/tmp', '/var/tmp'].some(root =>
          below(realpathSync(root), comparisonRoot)))
      fail('production fresh comparison root must be outside model and temporary workspaces');
    const stat = lstatSync(comparisonRoot);
    if (stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0)
      fail('fresh comparison root must be private to the host');
  }
  if (typeof settings.reconcile !== 'function' || typeof settings.evaluateIndependent !== 'function') {
    fail('reconcile and host-pinned evaluateIndependent callbacks are required');
  }
  if (settings.gateRunner !== undefined &&
      (typeof settings.gateRunner !== 'function' || settings.allowMockGateRunnerForTest !== true))
    fail('injected jj gate runner requires an explicit test-only setting');
  if (settings.env !== undefined) fail('caller-supplied jj gate environment is forbidden');
  if (settings.gateRunner === undefined && !settings.trustedReleaseRoot)
    fail('trustedReleaseRoot is required for the production jj gate');
  const gateRunner = settings.gateRunner ?? (revision =>
    checkedReleaseGate(repoRoot, settings.trustedReleaseRoot, revision));
  const verify = async input => {
    keys(input.goal_context, ['causal_cut', 'accepted_results',
      'other_pending_evaluations'], 'goal context');
    digest(input.goal_context.causal_cut, 'goal causal cut');
    integer(input.goal_context.other_pending_evaluations,
      'other pending evaluations');
    if (!Array.isArray(input.goal_context.accepted_results))
      fail('goal accepted results must be an array');
    for (const row of input.goal_context.accepted_results) {
      keys(row, ['event_digest', 'scope', 'kind', 'artifact_sha256',
        'settlement_event_digest', 'verifier_receipt_sha256'], 'accepted goal result');
      for (const name of ['event_digest', 'artifact_sha256',
        'settlement_event_digest', 'verifier_receipt_sha256'])
        digest(row[name], `accepted goal result ${name}`);
      id(row.scope, 'accepted goal result scope');
      if (!['research', 'analysis', 'synthesis'].includes(row.kind))
        fail('accepted goal result has unsupported kind');
    }
    const common = { base_commit: input.expected_head,
      candidate_events: input.candidates.map(row => row.event_digest),
      evaluator_sha256: input.spec.pinned_versions.evaluator_sha256,
      case_set_sha256: input.spec.pinned_versions.case_set_sha256,
      toolchain: input.spec.pinned_versions.toolchain };
    let combined;
    try { combined = await settings.reconcile(clone(input)); }
    catch (error) { return { ...common, ok: false, task_accepted: false,
      receipt_sha256: hash(`reconcile-error:${String(error)}`), reason: 'jj-reconciliation-failed' }; }
    keys(combined, ['commit', 'base_commit', 'candidate_events', 'ancestry_ok', 'conflicts_resolved'], 'reconciled revision');
    commit(combined.commit, 'reconciled commit');
    if (combined.base_commit !== input.expected_head || canonical(combined.candidate_events) !== canonical(common.candidate_events) ||
      combined.ancestry_ok !== true || combined.conflicts_resolved !== true) fail('reconciler did not bind exact parents and conflict state');
    let gateReceipt;
    try { gateReceipt = await gateRunner(combined.commit); }
    catch (error) { return { ...common, ok: false, task_accepted: false,
      receipt_sha256: hash(`gate-error:${combined.commit}:${String(error)}`), reason: 'exact-revision-gate-failed' }; }
    if (gateReceipt?.commit_id !== combined.commit || gateReceipt?.ok !== true ||
      gateReceipt?.gate !== 'node scripts/check.mjs --require-dsh') fail('jj gate returned a receipt for another revision');
    const gate = { revision: combined.commit, argv: REQUIRED_GATE_ARGS(combined.commit),
      exit_code: 0, receipt_sha256: hash(canonical(gateReceipt)) };
    const goalBinding = { task_ref: digest(input.task_ref, 'goal task_ref'),
      goal_sha256: hash(input.spec.goal), acceptance_sha256: hash(input.spec.acceptance),
      causal_cut: input.goal_context.causal_cut,
      base_commit: input.expected_head, combined_commit: combined.commit,
      candidate_events: common.candidate_events,
      accepted_results_sha256: hash(canonical(input.goal_context.accepted_results)),
      accepted_result_count: input.goal_context.accepted_results.length,
      evaluator_sha256: common.evaluator_sha256,
      case_set_sha256: common.case_set_sha256, toolchain: common.toolchain,
      gate_receipt_sha256: gate.receipt_sha256 };
    let measured;
    try { measured = await settings.evaluateIndependent({ ...clone(input), combined_commit: combined.commit,
      gate_receipt: clone(gateReceipt), goal_binding: clone(goalBinding) }); }
    catch (error) { return { ...common, ok: false, task_accepted: false,
      receipt_sha256: hash(`independent-evaluator-error:${combined.commit}:${String(error)}`), reason: 'independent-evaluator-failed' }; }
    keys(measured, ['ok', 'task_accepted', 'receipt_sha256', 'evaluator_sha256',
      'case_set_sha256', 'toolchain', 'reason', 'goal_evidence'], 'independent measurement');
    if (typeof measured.ok !== 'boolean' || typeof measured.task_accepted !== 'boolean') fail('independent measurement flags are invalid');
    digest(measured.receipt_sha256, 'independent receipt_sha256');
    if (measured.evaluator_sha256 !== common.evaluator_sha256 ||
      measured.case_set_sha256 !== common.case_set_sha256 || measured.toolchain !== common.toolchain) fail('independent measurement used different pinned inputs');
    if (measured.task_accepted) {
      if (!measured.ok || input.goal_context.other_pending_evaluations !== 0)
        fail('whole-goal acceptance has unresolved evaluations or failed revision checks');
      const evidence = measured.goal_evidence;
      keys(evidence, ['schema', 'binding', 'fresh_clone_receipt_sha256',
        'case_count', 'passed_count', 'hard_constraints_passed',
        'unsupported_claims', 'counterexamples'], 'goal evidence');
      if (evidence.schema !== 'telepathy.goal-evaluation/v1' ||
          canonical(evidence.binding) !== canonical(goalBinding))
        fail('goal evidence differs from frozen task and exact revision');
      digest(evidence.fresh_clone_receipt_sha256, 'fresh clone receipt');
      integer(evidence.case_count, 'goal case count', 1);
      integer(evidence.passed_count, 'goal passed count');
      integer(evidence.unsupported_claims, 'unsupported goal claims');
      integer(evidence.counterexamples, 'goal counterexamples');
      if (evidence.passed_count !== evidence.case_count ||
          evidence.hard_constraints_passed !== true ||
          evidence.unsupported_claims !== 0 || evidence.counterexamples !== 0)
        fail('goal evidence does not support independent acceptance');
      if (!comparisonRoot) fail('whole-goal acceptance needs a private fresh comparison root');
      const comparisonFile = path.join(comparisonRoot, 'fresh-comparisons',
        `${evidence.fresh_clone_receipt_sha256}.json`);
      let comparisonStat;
      let comparisonBytes;
      try {
        comparisonStat = await fs.lstat(comparisonFile);
      } catch { fail('fresh comparison receipt is unavailable'); }
      if (!comparisonStat.isFile() || comparisonStat.size > 1024 * 1024)
        fail('fresh comparison receipt must be a bounded regular file');
      try { comparisonBytes = await fs.readFile(comparisonFile); }
      catch { fail('fresh comparison receipt is unavailable'); }
      if (comparisonBytes.length > 1024 * 1024)
        fail('fresh comparison receipt exceeds its bound');
      if (hash(comparisonBytes) !== evidence.fresh_clone_receipt_sha256)
        fail('fresh comparison receipt digest differs from archived bytes');
      let comparison;
      try { comparison = JSON.parse(comparisonBytes); }
      catch { fail('fresh comparison receipt is not JSON'); }
      if (comparisonBytes.toString('utf8') !== `${canonical(comparison)}\n` ||
          comparison?.schema !== 1 ||
          comparison.policy !== 'telepathy.fresh-clone-comparison/v1' ||
          comparison.fresh?.candidate_commit !== combined.commit ||
          comparison.fresh?.task_set_sha256 !== common.case_set_sha256 ||
          comparison.evaluator_sha256 !== common.evaluator_sha256 ||
          comparison.verdict !== 'supported' ||
          !Array.isArray(comparison.candidate_cases) ||
          comparison.candidate_cases.length !== evidence.case_count ||
          comparison.candidate_cases.some(row => row?.supported !== true ||
            !Number.isSafeInteger(row.quality) || row.quality < 1 ||
            row.counterexample !== false || row.unsupported_claims !== 0) ||
          comparison.candidate?.unsupported_claims !== 0 ||
          !Array.isArray(comparison.counterexamples) ||
          comparison.counterexamples.length !== 0 ||
          !Array.isArray(comparison.regressions) ||
          comparison.regressions.length !== 0 ||
          !Number.isSafeInteger(comparison.candidate?.quality) ||
          !Number.isSafeInteger(comparison.baseline?.quality) ||
          comparison.candidate.quality <= comparison.baseline.quality)
        fail('fresh comparison does not independently support this goal');
    }
    return { ...common, ok: measured.ok, task_accepted: measured.ok && measured.task_accepted,
      combined_commit: combined.commit, checked_commit: combined.commit,
      ancestry_ok: true, conflicts_resolved: true, gate,
      receipt_sha256: measured.receipt_sha256,
      ...(measured.task_accepted ? { goal_evidence: clone(measured.goal_evidence),
        goal_evidence_sha256: hash(canonical(measured.goal_evidence)) } : {}),
      ...(measured.ok ? {} : { reason: str(measured.reason, 'independent rejection reason', 1024) }) };
  };
  // A synthetic runner can exercise the adapter protocol in tests, but it
  // must never confer production source-adoption authority.
  if (settings.gateRunner === undefined) combinedVerifierAdapters.add(verify);
  return verify;
}

// Optional DSH tool: a model proposes a typed logical task against a
// host-opened frozen goal. The host session binding supplies the task ref and
// allowed scopes; the tool grants no worker, filesystem, or settlement right.
// Cross-scope synthesis remains host-only: it is deliberately absent from
// this model-facing enum, even though the controller can plan it.
export function createTaskPlanTool(controller, settings) {
  if (typeof settings?.bindingForSession !== 'function') fail('task_plan needs a host-owned session binding');
  return {
    name: 'task_plan',
    description: 'Propose one bounded, typed logical task under a frozen host task. This records a plan; it does not spawn an agent or grant authority.',
    parameters: { type: 'object', additionalProperties: false,
      required: ['id', 'kind', 'scope', 'deliverable', 'acceptance', 'source_refs', 'oracle_sha256',
        'budget', 'depends_on', 'parent_plan_ref', 'expected_log_head'],
      properties: {
        id: { type: 'string' }, kind: { type: 'string', enum: ['research', 'algorithm', 'implementation', 'evaluation', 'integration', 'retrieval', 'analysis'] },
        scope: { type: 'string' }, deliverable: { type: 'string' }, acceptance: { type: 'string' },
        source_refs: { type: 'array', items: { type: 'string' } }, oracle_sha256: { type: 'string' },
        budget: { type: 'object', additionalProperties: false,
          required: ['tokens', 'fuel', 'children', 'integrations', 'evaluations'],
          properties: Object.fromEntries(['tokens', 'fuel', 'children', 'integrations', 'evaluations'].map(key => [key, { type: 'integer', minimum: 0 }])) },
        depends_on: { type: 'array', items: { type: 'string' } },
        parent_plan_ref: { type: ['string', 'null'] }, expected_log_head: { type: 'string' },
      } },
    output: { schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify({ status: value.status,
        plan_ref: value.plan_ref, event_digest: value.event_digest, charged: value.charged }) }] },
    execute: async (args, exec) => {
      const sessionId = String(exec.agent?.session?.id ?? '');
      if (!sessionId) fail('task_plan requires a DSH session');
      const binding = await settings.bindingForSession(sessionId);
      if (!binding || !Array.isArray(binding.allowed_scopes) || !binding.allowed_scopes.includes(args.scope)) fail('task_plan scope is not bound to this session');
      return controller.plan(digest(binding.task_ref, 'bound task_ref'), args);
    },
  };
}

// Mount this after the task verifier service in a DSH host composition. It
// intentionally exposes no model tool and creates no agent turns. A YAML-only
// mount without a verifier can inspect/admit but cannot settle source changes.
export const name = 'telepathy-task-control';
export function apply(ctx, config = {}) {
  const hostVerifier = config.verifyCombined ?? ctx.get?.('telepathyTaskVerifier')?.verifyCombined;
  const knowledgeVerifier = config.verifyKnowledge ?? ctx.get?.('telepathyKnowledgeVerifier')?.verifyKnowledge;
  const resultVerifier = config.verifyResult ?? ctx.get?.('telepathyResultVerifier')?.verifyResult;
  const synthesisVerifier = config.verifySynthesis ?? ctx.get?.('telepathySynthesisVerifier')?.verifySynthesis;
  ctx.provide('telepathyTaskControl', createTaskControl({ storeRoot: config.storeRoot,
    verifyCombined: hostVerifier, verifyKnowledge: knowledgeVerifier, verifyResult: resultVerifier,
    verifySynthesis: synthesisVerifier,
    setupChild: config.setupChild ?? ctx.get?.('telepathyChildScope')?.setupChild,
    auditChildAbsence: config.auditChildAbsence ?? ctx.get?.('telepathyChildAudit')?.auditChildAbsence,
    auditEvaluationAbandonment: config.auditEvaluationAbandonment ?? ctx.get?.('telepathyEvaluationAudit')?.auditEvaluationAbandonment,
    allowUnsafeStoreRootForTest: config.allowUnsafeStoreRootForTest }));
}
