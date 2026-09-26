#!/usr/bin/env node
// Host-owned, durable ingress for the bounded DSH research program. No model
// tool mounts this module and no legacy Meta record is admitted by it.
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, realpathSync, mkdirSync, statSync, chmodSync,
  existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createResearchTaskProgramHost, createTwoScopeResearchSynthesisHost,
  dshToolchainFingerprint, researchProgramForecast,
  twoScopeResearchSynthesisForecast } from './task-host.mjs';
import { createCheckedSynthesisRunner } from './synthesis-session.mjs';
import { MAX_TASK_PROGRAM_STEPS } from './task-program.mjs';

const SHA = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40,64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const BUDGET = ['tokens', 'fuel', 'children', 'integrations', 'evaluations'];
const LIMITS = ['max_tasks', 'max_branches', 'max_active_grants', 'max_depth',
  'tokens', 'fuel', 'integrations', 'evaluations'];
const DSH = ['dshBin', 'sdkModule', 'llmModule', 'cliSha256', 'sdkSha256',
  'llmSha256', 'trustedRoot', 'dshHome'];
const AUDIT_STATUSES = new Set(['planner-audit-required', 'dispatch-audit-required',
  'evaluation-audit-required', 'planner-page-invalid',
  'planner-page-repair-required', 'feedback-verdict-required', 'waiting-workers']);
const localDriverTails = new Map();

function fail(message) { throw new Error(`resident ingress: ${message}`); }
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype)
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value))
    return JSON.stringify(value);
  fail('only JSON profile and request values are allowed');
}
function exactKeys(value, names, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== [...names].sort().join(','))
    fail(`${label} has missing or unexpected fields`);
}
function boundedText(value, label, bytes) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') ||
      Buffer.byteLength(value) > bytes) fail(`${label} must be nonempty and at most ${bytes} UTF-8 bytes`);
  return value;
}
function identifier(value, label) {
  if (typeof value !== 'string' || !ID.test(value)) fail(`${label} is invalid`);
  return value;
}
function sha(value, label) {
  if (typeof value !== 'string' || !SHA.test(value)) fail(`${label} must be SHA-256`);
  return value;
}
function absolute(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.normalize(value) !== value)
    fail(`${label} must be a normalized absolute path`);
  return value;
}
function count(value, label, min = 0, max = 1_000_000_000) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(`${label} is out of range`);
  return value;
}
function budget(value, label) {
  exactKeys(value, BUDGET, label);
  return Object.fromEntries(BUDGET.map(key => [key, count(value[key], `${label}.${key}`)]));
}
function inside(root, candidate) { return candidate === root || candidate.startsWith(`${root}${path.sep}`); }
const workspaces = profile => profile.mode === 'two_scope'
  ? [...(Array.isArray(profile.planner_workspaces) ? profile.planner_workspaces : []),
    profile.synthesis_workspace].filter(value => typeof value === 'string')
  : [profile.planner_workspace].filter(value => typeof value === 'string');

function profileValue(raw) {
  const twoScope = raw?.mode === 'two_scope';
  exactKeys(raw, twoScope ? ['id', 'mode', 'scopes', 'integration_owner',
    'initial_head', 'policy_version', 'pinned_versions', 'limits',
    'planner_budget', 'worker_budget', 'synthesis_budget',
    'planner_workspaces', 'synthesis_workspace', 'verifier_file',
    'case_set_file', 'synthesis_oracle_trusted_root', 'synthesis_oracle_file',
    'synthesis_deliverable', 'synthesis_acceptance',
    'synthesis_model_token_limit', 'dsh', 'max_retained_worker_workspaces'] :
    ['id', 'scope', 'integration_owner', 'initial_head', 'policy_version',
      'pinned_versions', 'limits', 'target_tasks', 'planner_budget', 'worker_budget',
      'planner_workspace', 'verifier_file', 'case_set_file', 'dsh',
      'max_retained_worker_workspaces'], 'profile');
  exactKeys(raw.pinned_versions, twoScope ? ['evaluator_sha256',
    'case_set_sha256', 'synthesis_oracle_sha256', 'toolchain'] :
    ['evaluator_sha256', 'case_set_sha256', 'toolchain'],
    'profile.pinned_versions');
  exactKeys(raw.limits, LIMITS, 'profile.limits');
  exactKeys(raw.dsh, DSH, 'profile.dsh');
  const profile = JSON.parse(canonical(raw));
  identifier(profile.id, 'profile id');
  if (twoScope) {
    if (!Array.isArray(profile.scopes) || profile.scopes.length !== 2 ||
        profile.scopes.some(value => typeof value !== 'string' || !ID.test(value)) ||
        new Set(profile.scopes).size !== 2) fail('two-scope profile needs two distinct scopes');
    sha(profile.pinned_versions.synthesis_oracle_sha256, 'synthesis oracle digest');
  } else identifier(profile.scope, 'profile scope');
  identifier(profile.integration_owner, 'integration owner');
  boundedText(profile.policy_version, 'policy version', 128);
  if (!COMMIT.test(profile.initial_head)) fail('profile initial_head must be an exact jj commit');
  sha(profile.pinned_versions.evaluator_sha256, 'evaluator digest');
  sha(profile.pinned_versions.case_set_sha256, 'case-set digest');
  if (profile.pinned_versions.toolchain !== dshToolchainFingerprint(
    sha(profile.dsh.cliSha256, 'DSH CLI digest'),
    sha(profile.dsh.sdkSha256, 'DSH SDK digest'),
    sha(profile.dsh.llmSha256, 'DSH LLM digest')))
    fail('profile toolchain does not bind the configured DSH entrypoints');
  for (const key of ['dshBin', 'sdkModule', 'llmModule', 'trustedRoot', 'dshHome'])
    absolute(profile.dsh[key], `dsh.${key}`);
  for (const key of ['verifier_file', 'case_set_file',
    ...(twoScope ? ['synthesis_workspace', 'synthesis_oracle_trusted_root',
      'synthesis_oracle_file'] : ['planner_workspace'])]) absolute(profile[key], key);
  if (twoScope) {
    if (!Array.isArray(profile.planner_workspaces) ||
        profile.planner_workspaces.length !== 2)
      fail('two-scope profile needs two planner workspaces');
    profile.planner_workspaces.forEach((value, index) =>
      absolute(value, `planner_workspaces[${index}]`));
    if (new Set(workspaces(profile)).size !== 3)
      fail('two-scope workspaces must be distinct');
    boundedText(profile.synthesis_deliverable, 'synthesis deliverable', 2048);
    boundedText(profile.synthesis_acceptance, 'synthesis acceptance', 2048);
    count(profile.synthesis_model_token_limit, 'synthesis model token limit', 1, 4096);
  }
  for (const key of LIMITS) count(profile.limits[key], `limits.${key}`,
    key === 'max_depth' ? 0 : 1, key === 'max_tasks' ? 100_000 :
      key === 'max_branches' ? 20_000 : key === 'max_active_grants' ? 64 :
      key === 'max_depth' ? 64 : 1_000_000_000);
  if (!twoScope) count(profile.target_tasks, 'target_tasks', 1, 10_000);
  count(profile.max_retained_worker_workspaces,
    'max_retained_worker_workspaces', 1, 1024);
  profile.planner_budget = budget(profile.planner_budget, 'planner_budget');
  profile.worker_budget = budget(profile.worker_budget, 'worker_budget');
  if (twoScope) profile.synthesis_budget = budget(profile.synthesis_budget,
    'synthesis_budget');
  if (profile.planner_budget.children !== 0 ||
      profile.planner_budget.integrations !== 0 ||
      profile.planner_budget.evaluations !== 0 ||
      profile.planner_budget.fuel < 1 || profile.planner_budget.tokens < 64)
    fail('planner profile needs funded tokens/fuel and no worker authority');
  if (profile.worker_budget.evaluations !== 1 ||
      profile.worker_budget.children !== 0 ||
      profile.worker_budget.integrations !== 0 ||
      profile.worker_budget.fuel < 2 || profile.worker_budget.tokens < 1)
    fail('research workers need one evaluation, funded tokens/fuel, and no child or integration authority');
  if (twoScope && (profile.synthesis_budget.children !== 0 ||
      profile.synthesis_budget.integrations !== 0 ||
      profile.synthesis_budget.evaluations !== 1 ||
      profile.synthesis_budget.fuel < 2 ||
      profile.synthesis_budget.tokens < profile.synthesis_model_token_limit + 1024))
    fail('synthesis profile needs a funded one-evaluation turn');
  const sample = specification(profile, 'Profile forecast', 'Profile forecast');
  const forecast = twoScope ? twoScopeResearchSynthesisForecast({ spec: sample,
    plannerBudget: profile.planner_budget, workerBudget: profile.worker_budget,
    synthesisBudget: profile.synthesis_budget,
    synthesisDeliverable: profile.synthesis_deliverable,
    synthesisAcceptance: profile.synthesis_acceptance }) :
    researchProgramForecast({ spec: sample, targetTasks: profile.target_tasks,
      plannerBudget: profile.planner_budget, workerBudget: profile.worker_budget });
  if (Object.values(forecast.shortfall).some(Boolean)) fail('profile compute forecast has a shortfall');
  if (!twoScope && profile.target_tasks > 1 && profile.limits.max_active_grants < 2)
    fail('multi-task feedback needs a planner and worker grant');
  if (profile.limits.max_active_grants > profile.limits.max_branches)
    fail('active grant cap exceeds branch bound');
  return profile;
}

function specification(profile, task, acceptance) {
  return { goal: task, acceptance,
    scopes: profile.mode === 'two_scope' ? profile.scopes : [profile.scope],
    integration_owner: profile.integration_owner, initial_head: profile.initial_head,
    pinned_versions: profile.pinned_versions, limits: profile.limits,
    policy_version: profile.policy_version };
}

function publicRow(row) {
  if (!row) return null;
  return { request_id: row.request_id, status: row.status,
    kind: row.kind, profile_id: row.profile_id, profile_sha256: row.profile_sha256,
    program_id: row.program_id, task_ref: row.task_ref,
    attempt_id: row.attempt_id, audit_required: ['invoking', 'unknown'].includes(row.status),
    progress: row.progress ? JSON.parse(row.progress) : null,
    audit_receipt_sha256: row.audit_receipt_sha256, error: row.error,
    created_ms: row.created_ms, updated_ms: row.updated_ms };
}

function progressState(progress, taskRef, kind, profile) {
  if (!progress || typeof progress !== 'object' || Array.isArray(progress) ||
      progress.task_ref !== taskRef || typeof progress.status !== 'string' ||
      !ID.test(progress.status) || progress.task_accepted !== false ||
      Buffer.byteLength(canonical(progress)) > 64 * 1024)
    fail('runner returned an unbound or oversized progress record');
  if (AUDIT_STATUSES.has(progress.status)) return 'unknown';
  if (kind === 'cross_field' && profile.mode === 'two_scope') {
    if (progress.phase === 'synthesis' &&
        ['accepted', 'rejected'].includes(progress.status) &&
        Array.isArray(progress.source_refs) && progress.source_refs.length === 2 &&
        progress.source_refs.every(ref => SHA.test(ref))) return 'reported';
    if (profile.scopes.includes(progress.phase) &&
        ['source-rejected', 'source-absent'].includes(progress.status) &&
        progress.progress?.planning_done === true)
      return 'reported';
  }
  if (progress.status === 'terminal' && progress.planning_done === true &&
      progress.active_grants === 0) return 'reported';
  return 'paused';
}

async function productionRun({ row, profile, stateRoot, spec }) {
  if (fileURLToPath(import.meta.url) !== path.join(profile.dsh.trustedRoot,
    'runtime/dsh/resident-ingress.mjs'))
    fail('production ingress must run from its checked release');
  const requestHash = hash(row.fingerprint);
  const taskStateRoot = path.join(stateRoot, 'tasks');
  const dsh = { ...profile.dsh, env: { PATH: process.env.PATH,
    HOME: process.env.HOME, DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY } };
  const common = {
    spec, prompt: row.task, programId: row.program_id,
    plannerBudget: profile.planner_budget, workerBudget: profile.worker_budget,
    workerWorkspaceRoot: path.join(stateRoot, 'workspaces', requestHash),
    stateRoot: path.join(stateRoot, 'programs'),
    taskStateRoot,
    archiveRoot: path.join(stateRoot, 'archives', requestHash),
    verifierFile: profile.verifier_file, caseSetFile: profile.case_set_file,
    maxRetainedWorkerWorkspaces: profile.max_retained_worker_workspaces,
    dsh,
  };
  const host = profile.mode === 'two_scope'
    ? await createTwoScopeResearchSynthesisHost({ ...common,
      plannerWorkspaces: profile.planner_workspaces,
      synthesisWorkspace: profile.synthesis_workspace,
      synthesisOracleTrustedRoot: profile.synthesis_oracle_trusted_root,
      synthesisOracleFile: profile.synthesis_oracle_file,
      synthesisBudget: profile.synthesis_budget,
      synthesisDeliverable: profile.synthesis_deliverable,
      synthesisAcceptance: profile.synthesis_acceptance,
      synthesisModelTokenLimit: profile.synthesis_model_token_limit,
      synthesisRunner: createCheckedSynthesisRunner({ dsh, taskStateRoot }),
    })
    : await createResearchTaskProgramHost({ ...common,
      targetTasks: profile.target_tasks,
      plannerWorkspace: profile.planner_workspace });
  return { task_ref: host.task_ref,
    progress: await host.run({ maxSteps: MAX_TASK_PROGRAM_STEPS }) };
}

/**
 * `runner` and unsafe temporary roots exist only for keyless tests. Production
 * profiles are host-owned data, not request fields or model tools. The returned
 * API has no method that imports Meta jobs or resumes an ACP session.
 */
export async function createResidentIngress(settings) {
  exactKeys(settings, ['stateRoot', 'profiles', 'runner', 'auditUnknown',
    'allowTestRunner'], 'settings');
  const testing = settings.allowTestRunner === true;
  if (settings.runner && !testing)
    fail('injected runner is test-only');
  if (settings.auditUnknown && typeof settings.auditUnknown !== 'function')
    fail('auditUnknown must be a host-owned function');
  if (testing && (typeof settings.runner !== 'function' ||
      (settings.auditUnknown && typeof settings.auditUnknown !== 'function')))
    fail('test runner and auditor must be functions');
  const stateRoot = absolute(settings.stateRoot, 'stateRoot');
  const legacyRoot = path.join(os.homedir(), '.local', 'state', 'intuitxn-meta');
  if (inside(legacyRoot, stateRoot) || inside(stateRoot, legacyRoot))
    fail('stateRoot overlaps the live or archived Meta private state');
  if (!testing) {
    const cwd = realpathSync(process.cwd());
    const temp = realpathSync(os.tmpdir());
    if (inside(cwd, stateRoot) || inside(temp, stateRoot))
      fail('production stateRoot must be outside the working tree and temporary roots');
  } else if (!inside(realpathSync(os.tmpdir()), stateRoot)) {
    fail('test runner requires temporary private state');
  }
  const parent = path.dirname(stateRoot);
  if (realpathSync(parent) !== parent) fail('stateRoot parent must be canonical');
  if (!existsSync(stateRoot)) mkdirSync(stateRoot, { recursive: false, mode: 0o700 });
  if (realpathSync(stateRoot) !== stateRoot) fail('stateRoot must be canonical');
  const stat = statSync(stateRoot);
  if (stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0)
    fail('stateRoot must be host-owned and private');
  if (!Array.isArray(settings.profiles) || settings.profiles.length > 64)
    fail('profiles must be a bounded array');
  const profiles = new Map();
  for (const raw of settings.profiles) {
    const profile = profileValue(raw);
    if (profiles.has(profile.id)) fail('profile IDs must be unique');
    profiles.set(profile.id, { value: profile, digest: hash(canonical(profile)) });
  }
  if (!testing) for (const { value: profile } of profiles.values()) {
    if (workspaces(profile).some(workspace => inside(workspace, stateRoot) ||
        inside(stateRoot, workspace)))
      fail('production stateRoot overlaps a model workspace');
  }
  const file = path.join(stateRoot, 'ingress.sqlite');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
  db.exec(`CREATE TABLE IF NOT EXISTS requests (
    request_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL UNIQUE,
    profile_id TEXT NOT NULL, profile_sha256 TEXT NOT NULL,
    kind TEXT NOT NULL, task TEXT NOT NULL, acceptance TEXT NOT NULL,
    spec TEXT, spec_sha256 TEXT, program_id TEXT,
    status TEXT NOT NULL, attempt_id TEXT, task_ref TEXT, progress TEXT,
    audit_receipt_sha256 TEXT, error TEXT,
    created_ms INTEGER NOT NULL, updated_ms INTEGER NOT NULL)`);
  db.exec(`CREATE TABLE IF NOT EXISTS request_aliases (
    request_id TEXT PRIMARY KEY, canonical_id TEXT NOT NULL,
    fingerprint TEXT NOT NULL)`);
  chmodSync(file, 0o600);
  const byId = db.prepare('SELECT * FROM requests WHERE request_id = ?');
  const byFingerprint = db.prepare('SELECT * FROM requests WHERE fingerprint = ?');
  const byAlias = db.prepare('SELECT * FROM request_aliases WHERE request_id = ?');
  const update = db.prepare(`UPDATE requests SET status = ?, attempt_id = ?, task_ref = ?,
    progress = ?, audit_receipt_sha256 = ?, error = ?, updated_ms = ?
    WHERE request_id = ? AND status = ? AND attempt_id IS ?`);
  const write = action => {
    db.exec('BEGIN IMMEDIATE;');
    try { const value = action(); db.exec('COMMIT;'); return value; }
    catch (error) { db.exec('ROLLBACK;'); throw error; }
  };
  const resolved = id => {
    const requestId = identifier(id, 'request_id');
    const row = byId.get(requestId);
    if (row) return row;
    const alias = byAlias.get(requestId);
    if (!alias) return null;
    const target = byId.get(alias.canonical_id);
    if (!target || target.fingerprint !== alias.fingerprint)
      fail('request alias differs from its canonical record');
    return target;
  };
  const get = id => publicRow(resolved(id));
  const run = settings.runner ?? (input => productionRun(input));
  const claim = () => write(() => {
    const row = db.prepare("SELECT * FROM requests WHERE status = 'queued' ORDER BY created_ms, request_id LIMIT 1").get();
    if (!row) return null;
    const profile = profiles.get(row.profile_id);
    if (!profile || profile.digest !== row.profile_sha256)
      fail('queued request profile changed; restore its exact reviewed profile');
    if (hash(row.spec) !== row.spec_sha256)
      fail('queued request frozen specification digest changed');
    const attemptId = randomUUID();
    const changed = update.run('invoking', attemptId, row.task_ref, row.progress,
      row.audit_receipt_sha256, null, Date.now(), row.request_id, 'queued', row.attempt_id);
    if (changed.changes !== 1) fail('queued request changed during claim');
    return { ...row, attempt_id: attemptId, profile: profile.value };
  });
  const finish = (row, next, taskRef, progress, receipt, error) => write(() => {
    const changed = update.run(next, row.attempt_id, taskRef,
      progress ? canonical(progress) : null, receipt, error, Date.now(),
      row.request_id, 'invoking', row.attempt_id);
    if (changed.changes !== 1) fail('invocation changed before its result was recorded');
    return get(row.request_id);
  });
  async function driverLock(action) {
    const previous = localDriverTails.get(stateRoot) ?? Promise.resolve();
    let release;
    const done = new Promise(resolve => { release = resolve; });
    localDriverTails.set(stateRoot, done);
    await previous;
    try {
      const lock = new DatabaseSync(path.join(stateRoot, 'driver-lock.sqlite'));
      try {
        chmodSync(path.join(stateRoot, 'driver-lock.sqlite'), 0o600);
        lock.exec('PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE;');
        try { return await action(); }
        finally { lock.exec('COMMIT;'); }
      } finally { lock.close(); }
    } finally {
      if (localDriverTails.get(stateRoot) === done) localDriverTails.delete(stateRoot);
      release();
    }
  }
  function submit(input) {
    exactKeys(input, ['request_id', 'profile_id', 'kind', 'task', 'acceptance'], 'request');
    const requestId = identifier(input.request_id, 'request_id');
    const profileId = identifier(input.profile_id, 'profile_id');
    const kind = identifier(input.kind, 'kind');
    const task = boundedText(input.task, 'task', 4096);
    const acceptance = boundedText(input.acceptance, 'acceptance', 4096);
    const profile = profiles.get(profileId);
    if (!profile) fail('unknown reviewed profile');
    const supported = profile.value.mode === 'two_scope'
      ? kind === 'cross_field' : kind === 'research' || kind === 'analysis';
    const spec = supported ? specification(profile.value, task, acceptance) : null;
    const specText = spec ? canonical(spec) : null;
    const fingerprint = hash(canonical({ profile_id: profileId,
      profile_sha256: profile.digest, kind, task, acceptance }));
    const programId = supported ? `ingress-${fingerprint.slice(0, 40)}` : null;
    return write(() => {
      const prior = resolved(requestId);
      if (prior) {
        if (prior.fingerprint !== fingerprint) fail('request_id belongs to different work');
        return publicRow(prior);
      }
      const equivalent = byFingerprint.get(fingerprint);
      if (equivalent) {
        db.prepare('INSERT INTO request_aliases (request_id, canonical_id, fingerprint) VALUES (?, ?, ?)')
          .run(requestId, equivalent.request_id, fingerprint);
        return publicRow(equivalent);
      }
      const now = Date.now();
      db.prepare(`INSERT INTO requests (request_id, fingerprint, profile_id,
        profile_sha256, kind, task, acceptance, spec, spec_sha256, program_id,
        status, created_ms, updated_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(requestId, fingerprint, profileId, profile.digest, kind, task,
          acceptance, specText, specText ? hash(specText) : null, programId,
          supported ? 'queued' : 'unsupported', now, now);
      return get(requestId);
    });
  }
  async function runNext() {
    return driverLock(async () => {
      // A lost process releases this OS lock. Its invocation is uncertain;
      // never call the provider again simply because the process restarted.
      write(() => db.prepare("UPDATE requests SET status = 'unknown', error = 'interrupted invocation requires exact host audit', updated_ms = ? WHERE status = 'invoking'")
        .run(Date.now()));
      const row = claim();
      if (!row) return null;
      try {
        const output = await run({ row, profile: row.profile,
          stateRoot, spec: JSON.parse(row.spec) });
        const taskRef = sha(output?.task_ref, 'runner task_ref');
        const state = progressState(output.progress, taskRef, row.kind, row.profile);
        return finish(row, state, taskRef, output.progress, null,
          state === 'unknown' ? 'DSH progress requires exact host audit' : null);
      } catch (error) {
        // Even a thrown preflight error is conservative here: no claim that
        // the provider was absent can be inferred from this stack trace.
        return finish(row, 'unknown', row.task_ref, null, null,
          `${error?.name ?? 'Error'}: ${String(error?.message ?? error).slice(0, 512)}`);
      }
    });
  }
  function resume(requestId) {
    return write(() => {
      const row = resolved(requestId);
      if (!row || row.status !== 'paused') fail('only a paused audited program can be explicitly resumed');
      const profile = profiles.get(row.profile_id);
      if (!profile || profile.digest !== row.profile_sha256)
        fail('paused request profile changed');
      const changed = update.run('queued', null, row.task_ref, row.progress,
        row.audit_receipt_sha256, null, Date.now(), row.request_id, 'paused', row.attempt_id);
      if (changed.changes !== 1) fail('paused request changed before resume');
      return get(requestId);
    });
  }
  async function reconcile(requestId) {
    if (typeof settings.auditUnknown !== 'function')
      fail('unknown dispatch requires a host-pinned audit callback');
    return driverLock(async () => {
      const row = resolved(requestId);
      if (!row || row.status !== 'unknown') fail('only an unknown invocation can be audited');
      const profile = profiles.get(row.profile_id);
      if (!profile || profile.digest !== row.profile_sha256)
        fail('unknown request profile changed');
      const audit = await settings.auditUnknown({ request_id: row.request_id,
        attempt_id: row.attempt_id, task_ref: row.task_ref,
        profile_sha256: row.profile_sha256, program_id: row.program_id,
        stateRoot });
      if (!audit || audit.attempt_id !== row.attempt_id ||
          audit.profile_sha256 !== row.profile_sha256 ||
          !['unknown', 'absent', 'completed'].includes(audit.status))
        fail('audit does not bind the exact invocation and profile');
      const receipt = sha(audit.receipt_sha256, 'audit receipt');
      let next = 'unknown';
      let taskRef = row.task_ref;
      let progress = row.progress ? JSON.parse(row.progress) : null;
      if (audit.status === 'absent') {
        if (audit.task_ref !== row.task_ref || audit.progress !== null)
          fail('absence audit cannot claim a task result');
        next = 'queued';
      } else if (audit.status === 'completed') {
        taskRef = sha(audit.task_ref, 'audited task_ref');
        if (row.task_ref && row.task_ref !== taskRef) fail('audit changed the bound task_ref');
        progress = audit.progress;
        next = progressState(progress, taskRef, row.kind, profile.value);
      }
      return write(() => {
        const changed = update.run(next, audit.status === 'absent' ? null : row.attempt_id,
          taskRef, progress ? canonical(progress) : null, receipt,
          next === 'unknown' ? 'exact host audit is still required' : null,
          Date.now(), row.request_id, 'unknown', row.attempt_id);
        if (changed.changes !== 1) fail('unknown request changed before audit publication');
        return get(requestId);
      });
    });
  }
  function list(limit = 30) {
    count(limit, 'list limit', 1, 100);
    return db.prepare('SELECT * FROM requests ORDER BY created_ms DESC, request_id DESC LIMIT ?')
      .all(limit).map(publicRow);
  }
  return Object.freeze({ submit, status: get, list, runNext, resume, reconcile,
    close: () => db.close() });
}

async function cli(argv) {
  if (argv.length < 3 || argv[0] !== '--config')
    fail('usage: resident-ingress.mjs --config PRIVATE_CONFIG.json submit|status|list|run-next|resume [request_id]');
  const configFile = absolute(path.resolve(argv[1]), 'config path');
  const fileStat = statSync(configFile);
  if (!fileStat.isFile() || realpathSync(configFile) !== configFile ||
      fileStat.uid !== process.getuid() || (fileStat.mode & 0o077) !== 0)
    fail('config must be a canonical private host-owned file');
  const config = JSON.parse(readFileSync(configFile, 'utf8'));
  exactKeys(config, ['stateRoot', 'profiles'], 'config');
  if (!Array.isArray(config.profiles)) fail('config profiles must be an array');
  const temp = realpathSync(os.tmpdir());
  const legacy = path.join(os.homedir(), '.local', 'state', 'intuitxn-meta');
  if (inside(temp, configFile) || inside(legacy, configFile) ||
       config.profiles.some(profile => workspaces(profile).some(workspace =>
         inside(absolute(workspace, 'profile workspace'), configFile))))
    fail('config must be outside temporary, legacy, and model workspace roots');
  const ingress = await createResidentIngress({ ...config,
    runner: null, auditUnknown: null, allowTestRunner: false });
  try {
    const action = argv[2];
    let value;
    if (action === 'submit') {
      const bytes = readFileSync(0);
      if (bytes.length > 20 * 1024) fail('submit input exceeds 20 KiB');
      value = ingress.submit(JSON.parse(bytes.toString('utf8')));
    } else if (action === 'status' && argv[3]) value = ingress.status(argv[3]);
    else if (action === 'list') value = ingress.list();
    else if (action === 'run-next') value = await ingress.runNext();
    else if (action === 'resume' && argv[3]) value = ingress.resume(argv[3]);
    else fail('unsupported CLI action');
    process.stdout.write(`${JSON.stringify(value)}\n`);
  } finally { ingress.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await cli(process.argv.slice(2)); }
  catch (error) { console.error(String(error?.message ?? error)); process.exitCode = 1; }
}
