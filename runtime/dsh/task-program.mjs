// Host-owned prompt-to-task driver. Logical plans are durable task-control
// records; only granted plans are handed to a bounded number of live workers.
// This module never treats a worker return as verified task acceptance.
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { recommendWidth } from './delegation-governor.mjs';

const DIGEST = /^[a-f0-9]{64}$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;
const PLAN_KINDS = new Set(['research', 'algorithm', 'implementation', 'evaluation',
  'integration', 'retrieval', 'analysis']);
const MAX_PAGE_REPLANS = 3;
export const MAX_TASK_PROGRAM_STEPS = 1024;
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = message => { throw new Error(`task program: ${message}`); };
const localRunTails = new Map();

function canonical(value) {
  const seen = new Set();
  function walk(item, depth) {
    if (depth > 32) fail('JSON nesting is too deep');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (Array.isArray(item)) {
      if (seen.has(item)) fail('cyclic JSON');
      seen.add(item);
      const copy = item.map(child => walk(child, depth + 1));
      seen.delete(item);
      return copy;
    }
    if (!item || typeof item !== 'object' || Object.getPrototypeOf(item) !== Object.prototype) fail('JSON must contain plain objects');
    if (seen.has(item)) fail('cyclic JSON');
    seen.add(item);
    const copy = {};
    for (const key of Object.keys(item).sort()) copy[key] = walk(item[key], depth + 1);
    seen.delete(item);
    return copy;
  }
  return JSON.stringify(walk(value, 0));
}
const clone = value => JSON.parse(canonical(value));
function bounded(value, bytes, label) {
  const encoded = canonical(value);
  if (Buffer.byteLength(encoded) > bytes) fail(`${label} exceeds ${bytes} bytes`);
  return JSON.parse(encoded);
}
function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(`${label} must be in ${min}..${max}`);
  return value;
}
function id(value, label) {
  if (typeof value !== 'string' || !ID.test(value)) fail(`${label} is invalid`);
  return value;
}
function digest(value, label) {
  if (typeof value !== 'string' || !DIGEST.test(value)) fail(`${label} must be SHA-256`);
  return value;
}
function string(value, max, label) {
  if (typeof value !== 'string' || !value || value.length > max)
    fail(`${label} must be a nonempty bounded string`);
  return value;
}
function plain(value, label, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(`${label} must be a plain object`);
  for (const key of Object.keys(value)) if (!fields.includes(key)) fail(`${label} has unknown field ${key}`);
  return value;
}
function within(root, target) { return target === root || target.startsWith(`${root}${path.sep}`); }

// Matches task-control's deterministic plan reference, so a planner can name
// dependencies within a page without asking the host to create sessions.
export function logicalPlanRef(taskRef, planId) {
  return hash(`${digest(taskRef, 'task_ref')}\nplan\n${id(planId, 'plan id')}`);
}

function readCheckpoint(db, signature) {
  const row = db.prepare('SELECT revision, payload, digest FROM checkpoint WHERE id = 1').get();
  if (!row) fail('checkpoint is missing');
  if (hash(row.payload) !== row.digest) fail('checkpoint digest mismatch');
  const state = JSON.parse(row.payload);
  if (state.schema !== 1 || state.signature !== signature || !Number.isSafeInteger(state.planned_count) ||
      typeof state.planning_done !== 'boolean' || !Object.hasOwn(state, 'cursor') ||
      !Object.hasOwn(state, 'page') || !Object.hasOwn(state, 'intent')) fail('checkpoint does not match this program');
  // Older checkpoints predate page rejection records. Preserve their durable
  // planner intents, and add the new fields on the next checkpoint write.
  state.rejected_page ??= null;
  state.quarantined_page ??= null;
  state.replan_count ??= 0;
  state.feedback_barrier ??= null;
  state.feedback_outcomes ??= [];
  if (state.feedback_barrier !== null) {
    if (!Array.isArray(state.feedback_barrier) || state.feedback_barrier.length < 1 ||
        state.feedback_barrier.length > 64) fail('feedback barrier must contain 1..64 plans');
    for (const ref of state.feedback_barrier) digest(ref, 'feedback barrier plan');
    if (new Set(state.feedback_barrier).size !== state.feedback_barrier.length)
      fail('feedback barrier plans must be unique');
  }
  if (!Array.isArray(state.feedback_outcomes) || state.feedback_outcomes.length > 64)
    fail('feedback outcomes must be bounded');
  integer(state.replan_count, 0, MAX_PAGE_REPLANS, 'page replan count');
  if (state.rejected_page !== null) {
    plain(state.rejected_page, 'rejected page',
      ['page_sha256', 'response_sha256', 'reason', 'attempt_id', 'input_sha256']);
    digest(state.rejected_page.page_sha256, 'rejected page digest');
    if (Object.hasOwn(state.rejected_page, 'response_sha256')) {
      digest(state.rejected_page.response_sha256, 'rejected raw response digest');
      if (state.rejected_page.response_sha256 !== state.rejected_page.page_sha256)
        fail('rejected raw response digest differs from replan digest');
    }
    digest(state.rejected_page.input_sha256, 'rejected page input digest');
    id(state.rejected_page.attempt_id, 'rejected page attempt id');
    string(state.rejected_page.reason, 512, 'rejected page reason');
    if (state.intent || state.page) fail('rejected page overlaps pending work');
  }
  if (state.quarantined_page !== null) {
    plain(state.quarantined_page, 'quarantined page',
      ['page_sha256', 'reason', 'index', 'failed_task_id']);
    digest(state.quarantined_page.page_sha256, 'quarantined page digest');
    string(state.quarantined_page.reason, 512, 'quarantined page reason');
    integer(state.quarantined_page.index, 0, 64, 'quarantined page index');
    id(state.quarantined_page.failed_task_id, 'quarantined page task id');
    if (!state.page || state.intent || state.rejected_page)
      fail('quarantined page is missing its pending page');
  }
  return { revision: row.revision, state };
}

function openCheckpoint(file, signature) {
  const db = new DatabaseSync(file);
  try {
    db.exec('PRAGMA busy_timeout = 5000; PRAGMA synchronous = FULL;');
    db.exec('CREATE TABLE IF NOT EXISTS checkpoint (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL, payload TEXT NOT NULL, digest TEXT NOT NULL)');
    const initial = canonical({ schema: 1, signature, cursor: null, page: null, intent: null,
      rejected_page: null, quarantined_page: null, replan_count: 0,
      planning_done: false, planned_count: 0, feedback_barrier: null,
      feedback_outcomes: [] });
    db.prepare('INSERT OR IGNORE INTO checkpoint (id, revision, payload, digest) VALUES (1, 0, ?, ?)').run(initial, hash(initial));
    return readCheckpoint(db, signature);
  } finally { db.close(); }
}

function saveCheckpoint(file, signature, prior, next) {
  const payload = canonical(next);
  if (Buffer.byteLength(payload) > 2 * 1024 * 1024) fail('checkpoint exceeds 2 MiB');
  const db = new DatabaseSync(file);
  let begun = false;
  try {
    db.exec('PRAGMA busy_timeout = 5000; PRAGMA synchronous = FULL;');
    db.exec('BEGIN IMMEDIATE;');
    begun = true;
    const current = readCheckpoint(db, signature);
    if (current.revision !== prior.revision) fail('concurrent program driver changed the checkpoint');
    db.prepare('UPDATE checkpoint SET revision = ?, payload = ?, digest = ? WHERE id = 1')
      .run(prior.revision + 1, payload, hash(payload));
    db.exec('COMMIT;');
    begun = false;
    return { revision: prior.revision + 1, state: next };
  } catch (error) {
    if (begun) db.exec('ROLLBACK;');
    throw error;
  } finally { db.close(); }
}

async function withRunLock(file, work) {
  // Serialize within a process before taking SQLite's crash-released writer
  // lock. This lock spans planner and worker invocation, so a second driver
  // cannot audit a still-running callback as absent and repeat its work.
  const previous = localRunTails.get(file) ?? Promise.resolve();
  let release;
  const done = new Promise(resolve => { release = resolve; });
  localRunTails.set(file, done);
  await previous;
  try {
    const db = new DatabaseSync(`${file}.driver-lock`);
    try {
      db.exec('PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE;');
      await fs.chmod(`${file}.driver-lock`, 0o600);
      try { return await work(); }
      finally { db.exec('COMMIT;'); }
    } finally { db.close(); }
  } finally {
    if (localRunTails.get(file) === done) localRunTails.delete(file);
    release();
  }
}

function planRefs(value, label) {
  if (!Array.isArray(value) || value.length > 32) fail(`${label} must be a bounded array`);
  const refs = value.map((ref, index) => digest(ref, `${label} ${index}`));
  if (new Set(refs).size !== refs.length) fail(`${label} must be unique`);
  return refs;
}

function validatePageTasks(tasks, taskRef, spec, snapshot) {
  // Mirror task-control's normalizePlan and plan admission checks against a
  // virtual state. No controller.plan call occurs until every page member is
  // valid and the entire page fits the remaining planning grant.
  const plans = new Map(snapshot.plans.map(plan => [plan.ref, plan.scope]));
  const eventIds = new Set(snapshot.events.map(event => event.id));
  let fuel = snapshot.remaining.fuel;
  let tokens = snapshot.remaining.tokens;
  if (tasks.length > snapshot.remaining.tasks) fail('planner page exceeds the remaining logical task limit');
  for (const [index, task] of tasks.entries()) {
    const label = `planner task ${index}`;
    if (eventIds.has(task.id)) fail(`${label} reuses an admitted event id`);
    if (!PLAN_KINDS.has(task.kind)) fail(`${label} kind is unsupported`);
    id(task.scope, `${label} scope`);
    if (!spec.scopes.includes(task.scope)) fail(`${label} scope is outside frozen task scope`);
    string(task.deliverable, 2048, `${label} deliverable`);
    string(task.acceptance, 2048, `${label} acceptance`);
    planRefs(task.source_refs, `${label} source refs`);
    digest(task.oracle_sha256, `${label} oracle`);
    if (task.oracle_sha256 !== spec.pinned_versions.evaluator_sha256)
      fail(`${label} oracle differs from frozen evaluator`);
    const dependencies = planRefs(task.depends_on, `${label} dependencies`);
    plain(task.budget, `${label} budget`, ['tokens', 'fuel', 'children', 'integrations', 'evaluations']);
    for (const key of ['tokens', 'fuel', 'children', 'integrations', 'evaluations'])
      integer(task.budget[key], 0, 1_000_000_000, `${label} budget ${key}`);
    if (task.parent_plan_ref !== null) {
      digest(task.parent_plan_ref, `${label} parent`);
      if (plans.get(task.parent_plan_ref) !== task.scope)
        fail(`${label} parent is absent or outside scope`);
    }
    for (const ref of dependencies) {
      if (plans.get(ref) !== task.scope) fail(`${label} dependency is absent or outside scope`);
    }
    const request = { ...task, expected_log_head: snapshot.log_head };
    const cost = Math.max(1, Buffer.byteLength(canonical(request)));
    if (fuel < 1 || tokens < cost) fail('planner page exceeds the remaining planning fuel or tokens');
    fuel--;
    tokens -= cost;
    plans.set(logicalPlanRef(taskRef, task.id), task.scope);
    eventIds.add(task.id);
  }
}

function normalizePage(raw, cursor, remainingTasks, taskRef, spec, snapshot,
  planIdPrefix = null) {
  plain(raw, 'planner page', ['tasks', 'next_cursor', 'done']);
  // The caller may be a model-backed planner or a cold-session auditor. Bound
  // the entire reply before inspecting fields, including fields later ignored
  // when `done` is true.
  bounded(raw, 1024 * 1024, 'planner page');
  if (!Array.isArray(raw.tasks) || raw.tasks.length > 64 || (raw.tasks.length === 0 && raw.done !== true))
    fail('planner page must contain 1..64 tasks, or finish');
  if (planIdPrefix && raw.tasks.some(task => typeof task?.id !== 'string' ||
      !task.id.startsWith(planIdPrefix)))
    fail('planner page includes a plan outside this program namespace');
  if (typeof raw.done !== 'boolean') fail('planner page done flag is required');
  if (raw.tasks.length > remainingTasks) fail('planner page exceeds the frozen logical task limit');
  const nextCursor = raw.done ? null : bounded(raw.next_cursor, 4096, 'planner cursor');
  if (!raw.done && canonical(nextCursor) === canonical(cursor)) fail('planner cursor did not advance');
  const tasks = raw.tasks.map((task, index) => {
    plain(task, `planner task ${index}`, ['id', 'kind', 'scope', 'deliverable', 'acceptance',
      'source_refs', 'oracle_sha256', 'budget', 'depends_on', 'parent_plan_ref']);
    id(task.id, `planner task ${index} id`);
    return bounded(task, 12 * 1024, `planner task ${index}`);
  });
  validatePageTasks(tasks, taskRef, spec, snapshot);
  return bounded({ tasks, next_cursor: nextCursor, done: raw.done, index: 0, request: null },
    1024 * 1024, 'planner page');
}

// The host auditor uses this digest to bind the exact returned page to its
// receipt. It applies the same whole-reply byte cap as normal planner output.
export function plannerPageDigest(raw) {
  plain(raw, 'planner audit page', ['tasks', 'next_cursor', 'done']);
  return hash(canonical(bounded(raw, 1024 * 1024, 'planner audit page')));
}

function plannerIntent(value, taskRef, prompt, spec, state) {
  plain(value, 'planner intent', ['phase', 'attempt_id', 'input', 'input_sha256']);
  if (!['planner-prepared', 'planner-invoking'].includes(value.phase)) fail('planner intent phase is invalid');
  id(value.attempt_id, 'planner attempt id');
  digest(value.input_sha256, 'planner input digest');
  const input = bounded(value.input, 64 * 1024, 'planner input');
  plain(input, 'planner input', ['task_ref', 'prompt', 'cursor', 'spec', 'remaining',
    'planned_count', 'log_head', 'feedback']);
  if (input.task_ref !== taskRef || input.prompt !== prompt || canonical(input.spec) !== canonical(spec) ||
      canonical(input.cursor) !== canonical(state.cursor) || input.planned_count !== state.planned_count ||
      (Object.hasOwn(input, 'feedback') &&
        canonical(input.feedback) !== canonical(state.feedback_outcomes)) ||
      hash(canonical(input)) !== value.input_sha256) fail('planner intent does not match its frozen input');
  digest(input.log_head, 'planner input log head');
  plain(input.remaining, 'planner remaining budget', ['tasks', 'branches', 'tokens', 'fuel', 'integrations', 'evaluations']);
  integer(input.remaining.tasks, 0, 100_000, 'planner remaining tasks');
  return input;
}

function normalizeGrantParts(raw) {
  plain(raw, 'grant factory result', ['branch', 'owner', 'budget', 'location', 'parent_grant_ref']);
  id(raw.branch, 'grant branch'); id(raw.owner, 'grant owner');
  if (typeof raw.location !== 'string' || !path.isAbsolute(raw.location) ||
      path.normalize(raw.location) !== raw.location) fail('grant location must be a normalized absolute path');
  plain(raw.budget, 'grant budget', ['tokens', 'fuel', 'children', 'integrations', 'evaluations']);
  for (const key of ['tokens', 'fuel', 'children', 'integrations', 'evaluations'])
    integer(raw.budget[key], 0, 1_000_000_000, `grant budget ${key}`);
  if (raw.parent_grant_ref !== null) digest(raw.parent_grant_ref, 'parent grant ref');
  return clone(raw);
}

function settledFeedback(snapshot, refs) {
  const byRef = new Map(snapshot.plans.map(plan => [plan.ref, plan]));
  const plans = refs.map(ref => {
    const plan = byRef.get(ref);
    if (!plan) fail('feedback barrier lost an admitted plan');
    return plan;
  });
  if (plans.some(plan => !['accepted', 'failed', 'done', 'rejected'].includes(plan.status)))
    return null;
  const wanted = new Set(refs);
  const settlements = new Map();
  for (let index = snapshot.events.length - 1; index >= 0 && settlements.size < wanted.size; index--) {
    const event = snapshot.events[index];
    const ref = event.result?.plan_ref;
    if (event.type === 'result_settled' && wanted.has(ref) && !settlements.has(ref))
      settlements.set(ref, event);
  }
  const outcomes = [];
  for (const plan of plans) {
    const ref = plan.ref;
    const event = settlements.get(ref);
    if (!event || !DIGEST.test(event.result?.receipt_sha256 ?? '')) return undefined;
    outcomes.push({ plan_ref: ref, id: plan.id, status: plan.status,
      deliverable: plan.deliverable.slice(0, 256),
      acceptance: plan.acceptance.slice(0, 256),
      settlement_event: event.digest,
      verdict_receipt_sha256: event.result.receipt_sha256,
      verdict_reason: event.result.reason?.slice(0, 256) ?? null });
  }
  return bounded(outcomes, 48 * 1024, 'planner feedback');
}

/**
 * `planner` returns bounded pages of logical task records. Its exact input and
 * attempt ID are checkpointed before invocation. After an uncertain invocation,
 * `reconcilePlanner` must prove a completed page or exact absence; unknown stops
 * the program. The audit binds `task_ref`, `attempt_id`, and `input_sha256`.
 * Completed, absent, and invalid require `receipt_sha256`; completed also requires a bounded
 * `page` with `page_sha256` from `plannerPageDigest`. A trusted `invalid` audit
 * instead supplies the SHA-256 of the exact raw response bytes and a bounded
 * reason, so malformed or oversized replies can enter the finite replan flow.
 * An audited invalid page remains stopped with its digest and reason. The
 * host may explicitly call `run({ replanPageDigest })` for that exact page,
 * at most three times per cursor. A controller rejection during admission
 * quarantines the page with its index. Every later run returns
 * `planner-page-repair-required` until a host reconciles the admitted tasks
 * and checkpoint; the driver has no automatic repair action for that state.
 * `grantForPlan` is a side-effect-free host decision; provision its workspace
 * before driving this program. `worker` may start DSH under the already durable
 * grant and must admit results through task-control. A crash after its invocation
 * requires a host audit through `reconcileDispatch`; unknown means stop. A
 * worker must bind `dispatch_id` to its durable child/session start, and return
 * after starting that work rather than waiting for the whole session.
 * `delegationEvidence` is a host-only policy source. More than one live worker
 * requires matched archived independent verdict and compute receipts, measured
 * current capacity, and exact eligible plan refs selected against active work.
 * This module validates and applies that decision, but cannot authenticate a
 * receipt that the host invented or failed to archive.
 */
export function createTaskProgram(settings) {
  plain(settings, 'settings', ['controller', 'spec', 'prompt', 'programId', 'stateRoot',
    'workspaceRoot', 'allowUnsafeStateRootForTest', 'maxLiveWorkers', 'planner',
    'grantForPlan', 'worker', 'reconcileDispatch', 'reconcilePlanner',
    'feedbackPlanning', 'plannerGrantRef', 'delegationEvidence', 'planIdPrefix',
    'beforeFreshInvocation']);
  const { controller, spec, planner, grantForPlan, worker, reconcileDispatch, reconcilePlanner } = settings;
  for (const method of ['open', 'plan', 'grant', 'checkpoint', 'replay'])
    if (typeof controller?.[method] !== 'function') fail(`controller.${method} is required`);
  for (const [name, callback] of [['planner', planner], ['grantForPlan', grantForPlan], ['worker', worker]])
    if (typeof callback !== 'function') fail(`${name} callback is required`);
  if (reconcileDispatch !== undefined && typeof reconcileDispatch !== 'function') fail('reconcileDispatch must be a callback');
  if (reconcilePlanner !== undefined && typeof reconcilePlanner !== 'function') fail('reconcilePlanner must be a callback');
  const beforeFreshInvocation = settings.beforeFreshInvocation;
  if (beforeFreshInvocation !== undefined && typeof beforeFreshInvocation !== 'function')
    fail('beforeFreshInvocation must be a host callback');
  const programId = id(settings.programId, 'programId');
  const planIdPrefix = settings.planIdPrefix === undefined ? null :
    settings.planIdPrefix;
  if (planIdPrefix !== null && (typeof planIdPrefix !== 'string' ||
      planIdPrefix.length > 64 || !ID.test(`${planIdPrefix}x`)))
    fail('planIdPrefix must be a bounded ID prefix');
  const ownsPlan = row => planIdPrefix === null || row.id.startsWith(planIdPrefix);
  const prompt = settings.prompt;
  if (typeof prompt !== 'string' || !prompt || Buffer.byteLength(prompt) > 16 * 1024) fail('prompt must be 1..16384 UTF-8 bytes');
  const frozenSpec = bounded(spec, 16 * 1024, 'task specification');
  const maxLiveWorkers = integer(settings.maxLiveWorkers ?? 1, 1, 64, 'maxLiveWorkers');
  if (maxLiveWorkers > frozenSpec.limits?.max_active_grants) fail('live worker pool exceeds frozen grant cap');
  const delegationEvidence = settings.delegationEvidence;
  if (delegationEvidence !== undefined && typeof delegationEvidence !== 'function')
    fail('delegationEvidence must be a host callback');
  if (maxLiveWorkers > 1 && !delegationEvidence)
    fail('more than one live worker needs host-owned delegation evidence');
  const feedbackPlanning = settings.feedbackPlanning === true;
  if (settings.feedbackPlanning !== undefined && typeof settings.feedbackPlanning !== 'boolean')
    fail('feedbackPlanning must be boolean');
  const plannerGrantRef = settings.plannerGrantRef === undefined ? null :
    digest(settings.plannerGrantRef, 'plannerGrantRef');
  if (plannerGrantRef && !feedbackPlanning) fail('plannerGrantRef requires feedback planning');
  if (plannerGrantRef && maxLiveWorkers + 1 > frozenSpec.limits.max_active_grants)
    fail('feedback planning needs planner plus worker grant capacity');
  const stateRoot = path.resolve(settings.stateRoot ?? process.env.TELEPATHY_TASK_PROGRAM_STATE ??
    path.join(os.homedir(), '.local', 'state', 'telepathy-dsh', 'programs'));
  const signature = hash(canonical({ programId, prompt, spec: frozenSpec, maxLiveWorkers,
    ...(planIdPrefix ? { planIdPrefix } : {}),
    ...(beforeFreshInvocation ? { preflightInvocation: true } : {}),
    ...(delegationEvidence ? { adaptiveDelegation: true } : {}),
    ...(feedbackPlanning ? { feedbackPlanning, plannerGrantRef } : {}) }));
  const fileName = `${hash(programId)}.sqlite`;
  const checkpointPrefix = `program:${hash(programId).slice(0, 16)}:checkpoint:`;

  async function initialize() {
    await fs.mkdir(stateRoot, { recursive: true, mode: 0o700 });
    const actualRoot = await fs.realpath(stateRoot);
    if (!settings.allowUnsafeStateRootForTest) {
      const roots = [settings.workspaceRoot ?? process.cwd(), os.tmpdir(), '/tmp', '/var/tmp'];
      for (const root of roots) {
        const actual = await fs.realpath(root).catch(() => path.resolve(root));
        if (within(actual, actualRoot) || within(actual, stateRoot))
          fail('production program state must be outside the workspace and temporary roots');
      }
      const stat = await fs.stat(actualRoot);
      if (stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0)
        fail('production program state directory must be owned by the host and private');
    }
    const file = path.join(actualRoot, fileName);
    const record = openCheckpoint(file, signature);
    await fs.chmod(file, 0o600);
    return { file, record };
  }

  async function admissibleWidth(taskRef, snapshot) {
    if (!delegationEvidence) return { width: maxLiveWorkers, independent: null };
    const active = snapshot.grants.filter(row =>
      (row.status === 'active' || row.status === 'ready') && row.ref !== plannerGrantRef);
    const byRef = new Map(snapshot.plans.map(row => [row.ref, row]));
    const eligible = snapshot.plans.filter(row => ownsPlan(row) && row.status === 'planned' &&
      row.depends_on.every(ref => byRef.get(ref)?.status === 'accepted'));
    const visible = eligible.slice(0, 64);
    // This callback runs in the host, never in a worker or planner session. It
    // must read archived independent verdict and compute receipts for matched
    // task-set, evaluator, and frozen-budget trials, plus measured live rates.
    const evidence = bounded(await delegationEvidence({ task_ref: taskRef,
      causal_cut: snapshot.log_head, evaluator_sha256: frozenSpec.pinned_versions.evaluator_sha256,
      case_set_sha256: frozenSpec.pinned_versions.case_set_sha256,
      active_grants: clone(active), eligible_plans: clone(visible),
      eligible_total: eligible.length,
      pending_evaluations: clone(snapshot.pending_evaluations),
      remaining: clone(snapshot.remaining) }), 256 * 1024, 'delegation evidence');
    plain(evidence, 'delegation evidence', ['capacity', 'episodes', 'independent_plan_refs']);
    if (!Array.isArray(evidence.episodes)) fail('delegation episodes must be an array');
    if (!Array.isArray(evidence.independent_plan_refs) ||
        evidence.independent_plan_refs.length > visible.length)
      fail('independent plan refs must be a bounded array');
    const visibleRefs = new Set(visible.map(row => row.ref));
    const independent = new Set();
    for (const ref of evidence.independent_plan_refs) {
      digest(ref, 'independent plan ref');
      if (!visibleRefs.has(ref) || independent.has(ref))
        fail('independent plan ref is absent, ineligible, or repeated');
      independent.add(ref);
    }
    for (const episode of evidence.episodes) {
      if (episode.evaluator_sha256 !== frozenSpec.pinned_versions.evaluator_sha256)
        fail('paired trial evaluator differs from the frozen task evaluator');
    }
    plain(evidence.capacity, 'delegation capacity', ['eligible_independent',
      'funded_grants', 'provider_slots', 'workspace_slots', 'verifier_backlog',
      'integration_backlog', 'unknown_verdicts', 'horizon_units', 'worker_rate',
      'verifier_rate', 'integration_rate']);
    const capacity = { ...evidence.capacity,
      eligible_independent: Math.min(evidence.capacity.eligible_independent,
        active.length + independent.size),
      funded_grants: Math.min(evidence.capacity.funded_grants,
        active.length + snapshot.remaining.branches, maxLiveWorkers),
      verifier_backlog: Math.max(evidence.capacity.verifier_backlog,
        active.filter(row => row.status === 'ready').length),
      unknown_verdicts: Math.max(evidence.capacity.unknown_verdicts,
        snapshot.pending_evaluations.length) };
    return { width: Math.min(maxLiveWorkers, recommendWidth({ capacity,
      episodes: evidence.episodes }).width), independent };
  }

  async function run({ maxSteps = 64, replanPageDigest = null } = {}) {
    integer(maxSteps, 1, MAX_TASK_PROGRAM_STEPS, 'maxSteps');
    if (replanPageDigest !== null) digest(replanPageDigest, 'replanPageDigest');
    const opened = await controller.open(frozenSpec);
    const taskRef = opened.task_ref;
    const { file } = await initialize();
    return withRunLock(file, async () => {
    let record = openCheckpoint(file, signature);
    let snapshot = await controller.replay(taskRef);
    let head = snapshot.log_head;
    let planned = 0;
    let dispatched = 0;
    let status = 'running';
    const save = next => { record = saveCheckpoint(file, signature, record, next); };

    if (replanPageDigest !== null) {
      const rejected = record.state.rejected_page;
      if (!rejected || rejected.page_sha256 !== replanPageDigest)
        fail('replan decision does not bind the rejected page');
      if (snapshot.terminal) fail('cannot replan a terminal task');
      if (record.state.replan_count >= MAX_PAGE_REPLANS)
        fail('replan limit is exhausted for this cursor');
      if (snapshot.remaining.tasks < 1 || snapshot.remaining.fuel < 1 || snapshot.remaining.tokens < 1)
        fail('replan needs a remaining planning grant');
      save({ ...record.state, rejected_page: null, replan_count: record.state.replan_count + 1 });
    }

    for (let step = 0; step < maxSteps; step++) {
      const state = record.state;
      if (snapshot.terminal) { status = 'terminal'; break; }
      if (state.rejected_page) { status = 'planner-page-invalid'; break; }
      if (state.quarantined_page) { status = 'planner-page-repair-required'; break; }

      if (state.intent?.phase === 'planner-invoking') {
        const input = plannerIntent(state.intent, taskRef, prompt, frozenSpec, state);
        if (!reconcilePlanner) { status = 'planner-audit-required'; break; }
        const audit = await reconcilePlanner({ task_ref: taskRef, intent: clone(state.intent) });
        plain(audit, 'planner audit', ['status', 'task_ref', 'attempt_id', 'input_sha256',
          'receipt_sha256', 'page_sha256', 'page', 'response_sha256', 'reason']);
        if (audit.task_ref !== taskRef || audit.attempt_id !== state.intent.attempt_id ||
            audit.input_sha256 !== state.intent.input_sha256)
          fail('planner audit does not bind the exact attempt and input');
        if (audit.status === 'unknown') {
          if (Object.hasOwn(audit, 'page') || Object.hasOwn(audit, 'page_sha256') ||
              Object.hasOwn(audit, 'receipt_sha256') || Object.hasOwn(audit, 'response_sha256') ||
              Object.hasOwn(audit, 'reason')) fail('unknown planner audit cannot carry a result');
          status = 'planner-audit-required';
          break;
        }
        if (!['completed', 'absent', 'invalid'].includes(audit.status)) fail('planner audit status is invalid');
        digest(audit.receipt_sha256, 'planner audit receipt');
        if (audit.status === 'invalid') {
          if (Object.hasOwn(audit, 'page') || Object.hasOwn(audit, 'page_sha256'))
            fail('invalid planner audit cannot carry a page');
          digest(audit.response_sha256, 'planner audit raw response digest');
          string(audit.reason, 512, 'planner audit invalid reason');
          if (Buffer.byteLength(audit.reason) > 512)
            fail('planner audit invalid reason exceeds 512 bytes');
          save({ ...state, intent: null, rejected_page: {
            page_sha256: audit.response_sha256, response_sha256: audit.response_sha256,
            reason: audit.reason, attempt_id: state.intent.attempt_id,
            input_sha256: state.intent.input_sha256 } });
          status = 'planner-page-invalid';
          break;
        }
        if (audit.status === 'absent') {
          if (Object.hasOwn(audit, 'page') || Object.hasOwn(audit, 'page_sha256') ||
              Object.hasOwn(audit, 'response_sha256') || Object.hasOwn(audit, 'reason'))
            fail('absent planner audit cannot carry a page');
          save({ ...state, intent: null });
          continue;
        }
        if (Object.hasOwn(audit, 'response_sha256') || Object.hasOwn(audit, 'reason'))
          fail('completed planner audit cannot carry an invalid response');
        digest(audit.page_sha256, 'planner audit page digest');
        const rawPage = bounded(audit.page, 1024 * 1024, 'planner audit page');
        if (plannerPageDigest(rawPage) !== audit.page_sha256) fail('planner audit page digest mismatch');
        snapshot = await controller.replay(taskRef);
        head = snapshot.log_head;
        let page;
        try {
          page = normalizePage(rawPage, input.cursor, input.remaining.tasks,
            taskRef, frozenSpec, snapshot, planIdPrefix);
        } catch (error) {
          if (!String(error?.message).startsWith('task program:')) throw error;
          save({ ...state, intent: null, rejected_page: {
            page_sha256: audit.page_sha256, reason: String(error.message).slice(0, 512),
            attempt_id: state.intent.attempt_id, input_sha256: state.intent.input_sha256 } });
          status = 'planner-page-invalid';
          break;
        }
        save({ ...state, intent: null, page });
        continue;
      }

      if (state.intent?.phase === 'planner-prepared') {
        const input = plannerIntent(state.intent, taskRef, prompt, frozenSpec, state);
        if (beforeFreshInvocation) await beforeFreshInvocation({ task_ref: taskRef,
          kind: 'planner', controller });
        save({ ...state, intent: { ...state.intent, phase: 'planner-invoking' } });
        const rawPage = await planner({ ...clone(input),
          attempt_id: state.intent.attempt_id, input_sha256: state.intent.input_sha256,
          planRef: planId => logicalPlanRef(taskRef, planId) });
        snapshot = await controller.replay(taskRef);
        head = snapshot.log_head;
        const page = normalizePage(rawPage, input.cursor, input.remaining.tasks,
          taskRef, frozenSpec, snapshot, planIdPrefix);
        save({ ...record.state, intent: null, page });
        continue;
      }

      if (state.intent?.phase === 'invoking') {
        snapshot = await controller.replay(taskRef);
        head = snapshot.log_head;
        const grant = snapshot.grants.find(row => row.ref === state.intent.grant_ref);
        if (!grant) fail('dispatch intent lost its grant');
        if (grant.status !== 'active') { save({ ...state, intent: null }); continue; }
        if (!reconcileDispatch) { status = 'dispatch-audit-required'; break; }
        const audit = await reconcileDispatch({ task_ref: taskRef, grant: clone(grant),
          intent: clone(state.intent) });
        plain(audit, 'dispatch audit', ['status', 'grant_ref', 'dispatch_id', 'receipt_sha256']);
        if (audit.status === 'unknown') { status = 'dispatch-audit-required'; break; }
        if (!['started', 'absent'].includes(audit.status) || audit.grant_ref !== grant.ref ||
            audit.dispatch_id !== state.intent.dispatch_id)
          fail('dispatch audit does not bind the exact attempt');
        digest(audit.receipt_sha256, 'dispatch audit receipt');
        save({ ...state, intent: audit.status === 'started' ? null :
          { ...state.intent, phase: 'granted', dispatch_id: null,
            audit_receipt_sha256: audit.receipt_sha256 } });
        continue;
      }

      if (state.intent?.phase === 'grant-pending') {
        snapshot = await controller.replay(taskRef);
        head = snapshot.log_head;
        const alreadyGranted = snapshot.events.some(event => event.id === state.intent.request.id);
        if (!alreadyGranted && state.intent.request.base_refs.task_commit !== snapshot.task_head) {
          save({ ...state, intent: null }); // A changed base needs a fresh workspace.
          continue;
        }
        // A crash may leave a prepared request after verifier capacity falls.
        // Retain an already admitted exact grant, but cancel an uncommitted
        // request rather than letting it bypass the current measured width.
        if (!alreadyGranted) {
          const active = snapshot.grants.filter(row =>
            (row.status === 'active' || row.status === 'ready') && row.ref !== plannerGrantRef);
          const policy = await admissibleWidth(taskRef, snapshot);
          if (active.length >= policy.width ||
              (policy.independent && !policy.independent.has(state.intent.request.plan_ref))) {
            save({ ...state, intent: null });
            continue;
          }
        }
        if (!alreadyGranted && state.intent.request.base_refs.causal_event !== head) {
          save({ ...state, intent: { ...state.intent,
            request: { ...state.intent.request, base_refs: {
              ...state.intent.request.base_refs, causal_event: head } } } });
          continue;
        }
        const result = await controller.grant(taskRef, state.intent.request);
        head = result.existing ? (await controller.replay(taskRef)).log_head : result.log_head;
        save({ ...state, intent: { ...state.intent, phase: 'granted', grant_ref: result.grant_ref } });
        continue;
      }

      if (state.intent?.phase === 'granted') {
        snapshot = await controller.replay(taskRef);
        head = snapshot.log_head;
        const grant = snapshot.grants.find(row => row.ref === state.intent.grant_ref);
        if (!grant) fail('granted dispatch intent lost its grant');
        if (grant.status !== 'active') { save({ ...state, intent: null }); continue; }
        if (delegationEvidence) {
          const active = snapshot.grants.filter(row =>
            (row.status === 'active' || row.status === 'ready') && row.ref !== plannerGrantRef);
          if (active.length > (await admissibleWidth(taskRef, snapshot)).width) {
            status = 'delegation-capacity-held';
            break;
          }
        }
        if (beforeFreshInvocation) await beforeFreshInvocation({ task_ref: taskRef,
          kind: 'worker', controller });
        // Persist before entering arbitrary host code. A crash at this boundary
        // is uncertain and will not issue a duplicate worker without an audit.
        const dispatchId = randomUUID();
        save({ ...state, intent: { ...state.intent, phase: 'invoking', dispatch_id: dispatchId } });
        await worker({ task_ref: taskRef, prompt, spec: clone(frozenSpec),
          plan: clone(snapshot.plans.find(row => row.ref === grant.plan_ref)), grant: clone(grant),
          dispatch_id: dispatchId, controller });
        save({ ...record.state, intent: null });
        dispatched++;
        continue;
      }

      if (!state.planning_done) {
        if (!state.page) {
          snapshot = await controller.replay(taskRef);
          head = snapshot.log_head;
          if (feedbackPlanning && state.feedback_barrier) {
            const outcomes = settledFeedback(snapshot, state.feedback_barrier);
            if (outcomes === null) {
              // Dispatch work from this page, then wait for independent verdicts.
            } else if (outcomes === undefined) {
              status = 'feedback-verdict-required';
              break;
            } else {
              save({ ...state, feedback_barrier: null, feedback_outcomes: outcomes });
              continue;
            }
          } else {
            const input = bounded({ task_ref: taskRef, prompt,
              cursor: clone(state.cursor), spec: clone(frozenSpec), remaining: clone(snapshot.remaining),
              planned_count: state.planned_count, log_head: head,
              ...(feedbackPlanning ? { feedback: clone(state.feedback_outcomes) } : {}) },
            64 * 1024, 'planner input');
            save({ ...state, intent: { phase: 'planner-prepared', attempt_id: randomUUID(),
              input, input_sha256: hash(canonical(input)) } });
            continue;
          }
        }
        if (state.page && state.page.index === state.page.tasks.length) {
          save({ ...state, cursor: state.page.next_cursor, planning_done: state.page.done,
            page: null, replan_count: 0,
            feedback_barrier: feedbackPlanning && !state.page.done ?
              state.page.tasks.map(task => logicalPlanRef(taskRef, task.id)) : null,
            feedback_outcomes: [] });
          continue;
        }
        if (state.page && !state.page.request) {
          const task = state.page.tasks[state.page.index];
          save({ ...state, page: { ...state.page, request: { ...task, expected_log_head: head } } });
          continue;
        }
        if (state.page) {
          let result;
          try { result = await controller.plan(taskRef, state.page.request); }
          catch (error) {
            if (/stale logical task causal cut/.test(String(error))) {
              snapshot = await controller.replay(taskRef);
              head = snapshot.log_head;
              if (snapshot.events.some(event => event.id === state.page.request.id)) throw error;
              save({ ...state, page: { ...state.page,
                request: { ...state.page.request, expected_log_head: head } } });
              continue;
            }
            // A host/controller rule can change after page validation. If it
            // rejects an uncommitted item, keep the whole page and its index for
            // explicit repair instead of replaying that item on every run.
            if (!String(error?.message).startsWith('task control:')) throw error;
            snapshot = await controller.replay(taskRef);
            head = snapshot.log_head;
            if (snapshot.events.some(event => event.id === state.page.request.id &&
                event.type === 'planned')) throw error; // An uncertain committed reply remains retryable.
            save({ ...state, quarantined_page: {
              page_sha256: hash(canonical({ tasks: state.page.tasks,
                next_cursor: state.page.next_cursor, done: state.page.done })),
              reason: String(error.message).slice(0, 512), index: state.page.index,
              failed_task_id: state.page.request.id } });
            status = 'planner-page-repair-required';
            break;
          }
          head = result.existing ? (await controller.replay(taskRef)).log_head : result.log_head;
          save({ ...state, planned_count: state.planned_count + 1,
            page: { ...state.page, index: state.page.index + 1, request: null } });
          planned++;
          continue;
        }
      }

      snapshot = await controller.replay(taskRef);
      head = snapshot.log_head;
      const active = snapshot.grants.filter(row => (row.status === 'active' || row.status === 'ready') &&
        row.ref !== plannerGrantRef);
      if (!delegationEvidence && active.length >= maxLiveWorkers) {
        status = active.some(row => row.status === 'ready') ? 'needs-integration' : 'waiting-workers';
        break;
      }
      const byRef = new Map(snapshot.plans.map(row => [row.ref, row]));
      const eligiblePlans = snapshot.plans.filter(row => ownsPlan(row) && row.status === 'planned' &&
        row.depends_on.every(ref => byRef.get(ref)?.status === 'accepted'));
      if (!active.length && !eligiblePlans.length) {
        status = snapshot.pending_evaluations.length ? 'evaluation-audit-required' :
          feedbackPlanning && record.state.feedback_barrier ? 'waiting-feedback' :
          snapshot.plans.some(row => ownsPlan(row) && row.status === 'planned') ? 'blocked-dependencies' :
          'no-eligible-work';
        break;
      }
      const policy = await admissibleWidth(taskRef, snapshot);
      const width = policy.width;
      if (active.length >= width) {
        status = width === 0 || active.length > width ? 'delegation-capacity-held' :
          active.some(row => row.status === 'ready') ? 'needs-integration' : 'waiting-workers';
        break;
      }
      if (snapshot.remaining.branches < 1) { status = 'branch-budget-exhausted'; break; }
      const eligible = eligiblePlans.find(row =>
        policy.independent === null || policy.independent.has(row.ref));
      if (!eligible) {
        status = eligiblePlans.length ? 'delegation-capacity-held' :
          snapshot.pending_evaluations.length ? 'evaluation-audit-required' :
            active.some(row => row.status === 'ready') ? 'needs-integration' :
            feedbackPlanning && record.state.feedback_barrier ? 'waiting-feedback' :
              snapshot.plans.some(row => ownsPlan(row) && row.status === 'planned') ? 'blocked-dependencies' :
                active.length ? 'waiting-workers' : 'no-eligible-work';
        break;
      }
      const parts = normalizeGrantParts(await grantForPlan({ task_ref: taskRef, prompt,
        spec: clone(frozenSpec), plan: clone(eligible), task_head: snapshot.task_head,
        log_head: head }));
      for (const key of ['tokens', 'fuel', 'integrations', 'evaluations']) {
        if (parts.budget[key] > eligible.budget[key] || parts.budget[key] > snapshot.remaining[key])
          fail(`${key} grant exceeds a frozen budget`);
      }
      if (parts.budget.children > eligible.budget.children) fail('child grant exceeds the plan budget');
      const request = { id: `grant:${hash(`${programId}\n${eligible.ref}`).slice(0, 40)}`,
        plan_ref: eligible.ref, branch: parts.branch, owner: parts.owner,
        scope: eligible.scope, deliverable: eligible.deliverable,
        base_refs: { task_commit: snapshot.task_head, causal_event: head },
        budget: parts.budget, location: parts.location,
        parent_grant_ref: parts.parent_grant_ref };
      save({ ...state, intent: { phase: 'grant-pending', request } });
    }

    snapshot = await controller.replay(taskRef);
    // A controller checkpoint is an admitted causal decision. Avoid appending
    // the same idle decision on every driver poll.
    const last = snapshot.events.at(-1);
    let decision = last?.type === 'checkpointed' && last.id.startsWith(checkpointPrefix) ? last.result : null;
    if (!record.state.intent && !record.state.page?.request &&
        !record.state.rejected_page && !record.state.quarantined_page && !decision) {
      decision = await controller.checkpoint(taskRef, {
        id: `${checkpointPrefix}${snapshot.log_head.slice(0, 40)}`,
        expected_log_head: snapshot.log_head });
      snapshot = await controller.replay(taskRef);
    }
    if (status !== 'planner-page-invalid' && status !== 'planner-page-repair-required') {
      if (decision?.decision === 'stop') status = 'terminal';
      else if (decision?.decision === 'integrate' && status === 'waiting-workers') status = 'needs-integration';
    }
    return { task_ref: taskRef, program_id: programId, status, planned, dispatched,
      planning_done: record.state.planning_done, planned_count: record.state.planned_count,
      rejected_page: record.state.rejected_page ? clone(record.state.rejected_page) : null,
      quarantined_page: record.state.quarantined_page ? clone(record.state.quarantined_page) : null,
      replans_remaining: MAX_PAGE_REPLANS - record.state.replan_count,
      active_grants: snapshot.grants.filter(row => row.status === 'active' || row.status === 'ready').length,
      log_head: snapshot.log_head, decision: decision?.decision ?? null,
      reason: decision?.reason ?? null };
    });
  }

  return Object.freeze({ run });
}
