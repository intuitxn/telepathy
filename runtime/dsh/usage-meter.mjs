// Host-owned accounting for DSH model calls. The DSH token meter measures one
// conversation's context pressure; this ledger counts provider-reported usage
// across every model call assigned to a task grant, including cached input.
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync, chmodSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';

const DIGEST = /^[a-f0-9]{64}$/;
const SESSION = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;
const USAGE_FIELDS = new Set(['inputTokens', 'outputTokens', 'totalTokens',
  'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']);

function fail(message) { throw new Error(`usage meter: ${message}`); }
function canonicalPath(input) {
  const suffix = [];
  let current = path.resolve(input);
  while (!existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) fail('store has no existing ancestor');
    suffix.unshift(path.basename(current));
    current = parent;
  }
  return path.join(realpathSync(current), ...suffix);
}
function within(root, target) { return target === root || target.startsWith(`${root}${path.sep}`); }
function count(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum || value > 1_000_000_000) fail(`${label} must be an integer in ${minimum}..1000000000`);
  return value;
}
function bindingFor(value, sessionId) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail('host session binding is missing');
  if (Object.keys(value).some(key => !['session_id', 'task_ref', 'grant_ref', 'budget_tokens'].includes(key))) fail('host session binding has an unknown field');
  if (value.session_id !== sessionId || !SESSION.test(value.session_id)) fail('host session binding names another session');
  if (typeof value.task_ref !== 'string' || !DIGEST.test(value.task_ref) ||
      typeof value.grant_ref !== 'string' || !DIGEST.test(value.grant_ref)) fail('host session binding has an invalid task or grant');
  return { session_id: sessionId, task_ref: value.task_ref, grant_ref: value.grant_ref,
    budget_tokens: count(value.budget_tokens, 'grant token budget', 1) };
}

// DSH TokenUsage fields are disjoint except reasoningTokens, which is already
// part of outputTokens. totalTokens, when present, may include more tokens but
// must never understate the disjoint components.
export function measuredTokens(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail('provider usage is missing');
  if (Object.keys(value).some(key => !USAGE_FIELDS.has(key))) fail('provider usage has an unknown field');
  const input = count(value.inputTokens, 'inputTokens');
  const output = count(value.outputTokens, 'outputTokens');
  const cacheRead = value.cacheReadTokens === undefined ? 0 : count(value.cacheReadTokens, 'cacheReadTokens');
  const cacheWrite = value.cacheWriteTokens === undefined ? 0 : count(value.cacheWriteTokens, 'cacheWriteTokens');
  const reasoning = value.reasoningTokens === undefined ? 0 : count(value.reasoningTokens, 'reasoningTokens');
  if (reasoning > output) fail('reasoningTokens exceeds outputTokens');
  const components = input + output + cacheRead + cacheWrite;
  if (!Number.isSafeInteger(components) || components > 1_000_000_000) fail('provider usage total overflows');
  const total = value.totalTokens === undefined ? components : count(value.totalTokens, 'totalTokens');
  if (total < components || total === 0) fail('provider usage total is missing or understated');
  return total;
}

/** Derive a binding from the task control's replayed, host-owned grant state.
 * A child must already be started. A root may be bound only when the host
 * supplies an exact root grant and task control verifies the live DSH root.
 */
export function createTaskControlBinding(controller, taskRef, options = {}) {
  if (typeof controller?.replay !== 'function') fail('task control replay is required for grant binding');
  if (typeof taskRef !== 'string' || !DIGEST.test(taskRef)) fail('bound task_ref must be SHA-256');
  const rootGrantRef = options.rootGrantRef;
  if (rootGrantRef !== undefined && (typeof rootGrantRef !== 'string' || !DIGEST.test(rootGrantRef))) fail('rootGrantRef must be SHA-256');
  if (rootGrantRef !== undefined && (typeof controller.bindRootSession !== 'function' || !options.ctx)) {
    fail('root binding requires task control bindRootSession and the live DSH context');
  }
  return async sessionId => {
    if (typeof sessionId !== 'string' || !SESSION.test(sessionId)) fail('binding requires a DSH sessionId');
    let state = await controller.replay(taskRef);
    if (state?.task_ref !== taskRef || state.terminal) fail('bound task is unavailable or terminal');
    let grants = state.grants?.filter(grant => grant.session_id === sessionId) ?? [];
    if (grants.length === 0 && rootGrantRef !== undefined) {
      // The host control validates that this is the matching live root and
      // records an idempotent binding before any provider dispatch.
      await controller.bindRootSession(taskRef, {
        id: `root-bind:${sessionId}`, grant_ref: rootGrantRef, session_id: sessionId,
      }, options.ctx);
      state = await controller.replay(taskRef);
      if (state?.task_ref !== taskRef || state.terminal) fail('bound task is unavailable or terminal');
      grants = state.grants?.filter(grant => grant.session_id === sessionId) ?? [];
    }
    if (grants.length !== 1 || !['active', 'ready'].includes(grants[0].status)) fail('session has no live task grant');
    const grant = grants[0];
    return { session_id: sessionId, task_ref: taskRef, grant_ref: grant.ref,
      budget_tokens: grant.budget.tokens };
  };
}

/** Create a durable, grant-scoped ledger. bindingForSession must be supplied by
 * trusted host code, not a tool argument or a model-writable session field.
 * It must verify the live task/grant/session relationship and return the
 * grant's immutable token allocation. A crash during a call leaves a pending
 * marker that blocks further calls for that grant until host reconciliation.
 */
export function createUsageMeter(settings = {}) {
  if (typeof settings.bindingForSession !== 'function') fail('trusted bindingForSession callback is required');
  const root = canonicalPath(settings.storeRoot ?? path.join(process.env.DSH_HOME
    ?? path.join(os.homedir(), '.local', 'state', 'telepathy-dsh'), 'model-usage'));
  if (!settings.allowUnsafeStoreRootForTest) {
    const unsafe = [settings.workspaceRoot ?? process.cwd(), os.tmpdir(), '/tmp', '/var/tmp'].map(canonicalPath);
    if (unsafe.some(parent => within(parent, root))) fail('production store must be outside the workspace and temporary directory');
  }
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const database = path.join(root, 'usage.sqlite');
  const localCallTails = new Map();
  async function withLocalGrantCall(binding, work) {
    const key = `${binding.task_ref}:${binding.grant_ref}`;
    const previous = localCallTails.get(key) ?? Promise.resolve();
    let release;
    const done = new Promise(resolve => { release = resolve; });
    localCallTails.set(key, done);
    await previous;
    try { return await work(); }
    finally {
      if (localCallTails.get(key) === done) localCallTails.delete(key);
      release();
    }
  }
  const open = () => {
    const db = new DatabaseSync(database);
    db.exec('PRAGMA busy_timeout=10000');
    return db;
  };
  {
    const db = open();
    try {
      db.exec(`CREATE TABLE IF NOT EXISTS grants (
        task_ref TEXT NOT NULL, grant_ref TEXT NOT NULL,
        budget_tokens INTEGER NOT NULL, used_tokens INTEGER NOT NULL DEFAULT 0,
        pending_request TEXT, uncertain_reason TEXT,
        PRIMARY KEY (task_ref, grant_ref)
      );
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY, task_ref TEXT NOT NULL, grant_ref TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reconciliations (
        request_id TEXT PRIMARY KEY, task_ref TEXT NOT NULL, grant_ref TEXT NOT NULL,
        charged_tokens INTEGER NOT NULL, receipt_sha256 TEXT NOT NULL
      );`);
      chmodSync(database, 0o600);
    } finally { db.close(); }
  }
  const transaction = work => {
    const db = open();
    try {
      db.exec('BEGIN IMMEDIATE');
      try { const result = work(db); db.exec('COMMIT'); return result; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    } finally { db.close(); }
  };
  const selectGrant = (db, binding) => db.prepare('SELECT * FROM grants WHERE task_ref = ? AND grant_ref = ?')
    .get(binding.task_ref, binding.grant_ref);
  const checkGrant = (row, binding) => {
    if (row.budget_tokens !== binding.budget_tokens) fail('host grant budget changed after first binding');
  };
  const checkSession = (db, binding) => {
    const row = db.prepare('SELECT task_ref, grant_ref FROM sessions WHERE session_id = ?').get(binding.session_id);
    if (row && (row.task_ref !== binding.task_ref || row.grant_ref !== binding.grant_ref)) fail('session was rebound to another task or grant');
    if (!row) db.prepare('INSERT INTO sessions (session_id, task_ref, grant_ref) VALUES (?, ?, ?)')
      .run(binding.session_id, binding.task_ref, binding.grant_ref);
  };
  const begin = binding => {
    const requestId = randomUUID();
    transaction(db => {
      checkSession(db, binding);
      let grant = selectGrant(db, binding);
      if (!grant) {
        db.prepare('INSERT INTO grants (task_ref, grant_ref, budget_tokens, used_tokens) VALUES (?, ?, ?, 0)')
          .run(binding.task_ref, binding.grant_ref, binding.budget_tokens);
        grant = selectGrant(db, binding);
      }
      checkGrant(grant, binding);
      if (grant.pending_request || grant.uncertain_reason) fail('grant has an in-flight or uncertain model call');
      if (grant.used_tokens >= grant.budget_tokens) fail('grant model token budget exhausted');
      db.prepare('UPDATE grants SET pending_request = ? WHERE task_ref = ? AND grant_ref = ?')
        .run(requestId, binding.task_ref, binding.grant_ref);
    });
    return requestId;
  };
  const settle = (binding, requestId, tokens) => transaction(db => {
    const grant = selectGrant(db, binding);
    if (!grant || grant.pending_request !== requestId || grant.uncertain_reason) fail('model call reservation changed before settlement');
    const used = grant.used_tokens + tokens;
    if (!Number.isSafeInteger(used)) fail('cumulative token usage overflows');
    db.prepare('UPDATE grants SET used_tokens = ?, pending_request = NULL WHERE task_ref = ? AND grant_ref = ?')
      .run(used, binding.task_ref, binding.grant_ref);
    return used <= grant.budget_tokens;
  });
  const poison = (binding, requestId) => transaction(db => {
    const grant = selectGrant(db, binding);
    if (grant?.pending_request === requestId) db.prepare('UPDATE grants SET uncertain_reason = ? WHERE task_ref = ? AND grant_ref = ?')
      .run('model-call-usage-unknown', binding.task_ref, binding.grant_ref);
  });

  async function* wrap(options, next) {
    const sessionId = options?.sessionId;
    if (typeof sessionId !== 'string' || !SESSION.test(sessionId)) fail('model request requires a bound DSH sessionId');
    const binding = bindingFor(await settings.bindingForSession(sessionId), sessionId);
    const result = await withLocalGrantCall(binding, async () => {
      const requestId = begin(binding); // durable before adapter dispatch
      let settled = false;
      let tokens;
      let finish;
      const chunks = [];
      let bufferedBytes = 0;
      try {
        for await (const chunk of next()) {
          if (finish) fail('provider emitted a chunk after finish');
          if (chunk?.type === 'usage') {
            if (tokens !== undefined) fail('provider emitted duplicate usage');
            tokens = measuredTokens(chunk.usage);
          } else if (chunk?.type === 'finish') {
            finish = chunk;
          }
          if (chunk?.type !== 'finish') {
            bufferedBytes += Buffer.byteLength(JSON.stringify(chunk));
            if (bufferedBytes > 4 * 1024 * 1024) fail('provider stream exceeds metered buffer');
            chunks.push(chunk);
          }
        }
        if (!finish || tokens === undefined) fail('provider stream ended without finish and measured usage');
        const withinBudget = settle(binding, requestId, tokens);
        settled = true;
        if (!withinBudget) fail('grant model token budget exceeded');
        return { chunks, finish };
      } finally {
        if (!settled) poison(binding, requestId);
      }
    });
    // DSH may cancel a consumer after seeing text and request another stream.
    // Complete and charge the provider call before releasing any chunks.
    for (const chunk of result.chunks) yield chunk;
    yield result.finish;
  }

  async function snapshotForSession(sessionId) {
    if (typeof sessionId !== 'string' || !SESSION.test(sessionId)) fail('snapshot requires a DSH sessionId');
    const binding = bindingFor(await settings.bindingForSession(sessionId), sessionId);
    const db = open();
    try {
      const session = db.prepare('SELECT task_ref, grant_ref FROM sessions WHERE session_id = ?').get(sessionId);
      if (session && (session.task_ref !== binding.task_ref || session.grant_ref !== binding.grant_ref)) fail('session was rebound to another task or grant');
      const grant = selectGrant(db, binding);
      if (grant) checkGrant(grant, binding);
      const used = grant?.used_tokens ?? 0;
      return { task_ref: binding.task_ref, grant_ref: binding.grant_ref, session_id: sessionId,
        budget_tokens: binding.budget_tokens, used_tokens: used,
        remaining_tokens: Math.max(0, binding.budget_tokens - used),
        blocked: Boolean(grant?.pending_request || grant?.uncertain_reason),
        uncertain: Boolean(grant?.uncertain_reason) };
    } finally { db.close(); }
  }

  async function reconcileUncertain(sessionId) {
    if (typeof settings.auditUncertainUsage !== 'function') fail('uncertain usage audit is not installed');
    if (typeof sessionId !== 'string' || !SESSION.test(sessionId)) fail('reconciliation requires a DSH sessionId');
    const binding = bindingFor(await settings.bindingForSession(sessionId), sessionId);
    const db = open();
    let pending;
    try {
      pending = selectGrant(db, binding);
      if (!pending?.pending_request) fail('grant has no uncertain provider request');
      checkGrant(pending, binding);
    } finally { db.close(); }
    const target = { task_ref: binding.task_ref, grant_ref: binding.grant_ref,
      request_id: pending.pending_request, budget_tokens: binding.budget_tokens,
      used_tokens: pending.used_tokens };
    const audited = await settings.auditUncertainUsage({ ...target });
    if (!audited || typeof audited !== 'object' || Array.isArray(audited) ||
      Object.getPrototypeOf(audited) !== Object.prototype ||
      Object.keys(audited).some(key => !['task_ref', 'grant_ref', 'request_id', 'status',
        'upper_bound_tokens', 'receipt_sha256'].includes(key)) ||
      audited.task_ref !== target.task_ref || audited.grant_ref !== target.grant_ref ||
      audited.request_id !== target.request_id ||
      !['unused', 'bounded'].includes(audited.status) ||
      typeof audited.receipt_sha256 !== 'string' || !DIGEST.test(audited.receipt_sha256)) {
      fail('usage audit does not bind the exact provider request');
    }
    const charged = count(audited.upper_bound_tokens, 'audited upper bound');
    if ((audited.status === 'unused' && charged !== 0) ||
        (audited.status === 'bounded' && charged < 1)) fail('usage audit has an inconsistent bound');
    return transaction(db2 => {
      const current = selectGrant(db2, binding);
      if (!current || current.pending_request !== target.request_id ||
        current.used_tokens !== target.used_tokens) fail('uncertain provider request changed during audit');
      const used = current.used_tokens + charged;
      if (!Number.isSafeInteger(used)) fail('audited cumulative token usage overflows');
      db2.prepare('INSERT INTO reconciliations (request_id, task_ref, grant_ref, charged_tokens, receipt_sha256) VALUES (?, ?, ?, ?, ?)')
        .run(target.request_id, binding.task_ref, binding.grant_ref, charged, audited.receipt_sha256);
      db2.prepare('UPDATE grants SET used_tokens = ?, pending_request = NULL, uncertain_reason = NULL WHERE task_ref = ? AND grant_ref = ?')
        .run(used, binding.task_ref, binding.grant_ref);
      return { status: 'reconciled', request_id: target.request_id, charged_tokens: charged,
        used_tokens: used, budget_exhausted: used >= binding.budget_tokens,
        receipt_sha256: audited.receipt_sha256 };
    });
  }
  return Object.freeze({ wrap, snapshotForSession, reconcileUncertain });
}

export const name = 'telepathy-usage-meter';
export const inject = ['telepathyTaskControl', 'sessions'];
export function apply(ctx, config = {}) {
  const bindingService = ctx.get?.('telepathyUsageBinding');
  // DSH can continue booting after a plugin startup failure. Keep a partial
  // task launch mounted and reject every provider call instead of throwing
  // during apply and silently losing the meter.
  if (Boolean(process.env.TELEPATHY_TASK_REF) !== Boolean(process.env.TELEPATHY_ROOT_GRANT_REF) ||
      (Boolean(config.rootGrantRef) && !config.taskRef &&
        !config.bindingForSession && !bindingService?.bindingForSession)) {
    const message = 'task launch requires both TELEPATHY_TASK_REF and TELEPATHY_ROOT_GRANT_REF';
    ctx.on('llm/stream', async function* () { fail(message); }, { global: true, prepend: true });
    return;
  }
  const controller = ctx.get?.('telepathyTaskControl');
  const bindingForSession = config.bindingForSession
    ?? (bindingService?.bindingForSession && (sessionId => bindingService.bindingForSession(sessionId)))
    ?? (config.taskRef && controller && createTaskControlBinding(controller, config.taskRef,
      { rootGrantRef: config.rootGrantRef, ctx }));
  const meter = createUsageMeter({ ...config, bindingForSession });
  ctx.provide('telepathyUsageMeter', meter);
  ctx.on('llm/stream', (options, next) => meter.wrap(options, next), { global: true, prepend: true });
}
