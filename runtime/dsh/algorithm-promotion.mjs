// Host-only bridge from an accepted task-control settlement to the next
// session's algorithm pointer. This module is deliberately not a DSH tool.
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promises as fs, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { selectCandidate } from './core.mjs';

const DIGEST = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40,64}$/;
const RECEIPT_ID = /^[a-f0-9-]{36}$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = reason => { throw new Error(`algorithm promotion: ${reason}`); };
function digest(value, label) { if (typeof value !== 'string' || !DIGEST.test(value)) fail(`${label} must be SHA-256`); return value; }
function commit(value, label) { if (typeof value !== 'string' || !COMMIT.test(value)) fail(`${label} must be an exact jj commit`); return value; }
function plain(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(`${label} must be a plain object`);
  return value;
}
function fields(value, allowed, label) {
  plain(value, label);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${label} has unknown field ${key}`);
}
function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  plain(value, 'journal value');
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
function below(root, target) { return target === root || target.startsWith(`${root}${path.sep}`); }
function safeRoot(input, label, workspace, allowUnsafe) {
  if (typeof input !== 'string' || !path.isAbsolute(input)) fail(`${label} must be an absolute host path`);
  const root = path.resolve(input);
  if (root !== input) fail(`${label} must be normalized`);
  if (!allowUnsafe) {
    const existing = realpathSync(root);
    if (existing !== root || [workspace, os.tmpdir(), '/tmp', '/var/tmp'].some(unsafe => below(realpathSync(unsafe), existing))) {
      fail(`${label} must be a private real directory outside workspace and temporary roots`);
    }
  }
  return root;
}
async function pinned(file, expected, label) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) fail(`${label} must be an absolute host path`);
  digest(expected, `${label} digest`);
  const real = await fs.realpath(file);
  const stat = await fs.stat(real);
  if (!stat.isFile()) fail(`${label} is not a file`);
  const bytes = await fs.readFile(real);
  if (hash(bytes) !== expected) fail(`${label} differs from host pin`);
  return bytes;
}
async function archivedJson(file, expected, label) {
  const bytes = await fs.readFile(file);
  if (hash(bytes) !== expected) fail(`${label} digest mismatch`);
  return plain(JSON.parse(bytes), label);
}
async function immutable(file, value) {
  const content = `${canonical(value)}\n`;
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}-${randomUUID()}`);
  const handle = await fs.open(temporary, 'wx', 0o600);
  try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
  try {
    try { await fs.link(temporary, file); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const directory = await fs.open(path.dirname(file), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } finally { await fs.unlink(temporary).catch(() => {}); }
  const saved = await fs.readFile(file, 'utf8');
  if (saved !== content) fail('immutable journal entry conflicts');
}
async function jjSource(root, revision, sourcePath) {
  return new Promise((resolve, reject) => execFile('jj', ['--ignore-working-copy', 'file', 'show', '-r', revision, sourcePath],
    { cwd: root, encoding: 'buffer', maxBuffer: 1024 * 1024, timeout: 30_000 },
    (error, stdout) => error ? reject(new Error(`algorithm promotion: exact jj source unavailable: ${error.message}`)) : resolve(stdout)));
}

/**
 * `freshVerifierPath` is a reviewed, self-contained ES module outside model
 * workspaces. It exports verifyFreshEvidence({ evidence, binding, privateRoot })
 * and must inspect the actual gate receipt and fresh baseline/candidate clone
 * run receipts. No callback from a model or candidate revision is accepted.
 */
export function createAlgorithmPromotion(settings) {
  plain(settings, 'settings');
  const controller = settings.taskControl;
  if (typeof controller?.replay !== 'function' || typeof controller?.admit !== 'function' ||
    typeof controller?.settle !== 'function' || typeof controller?.withCurrentHead !== 'function') {
    fail('task control with replay/admit/settle/withCurrentHead is required');
  }
  if (typeof settings.workspaceRoot !== 'string' || !path.isAbsolute(settings.workspaceRoot)) fail('workspaceRoot must be absolute');
  const allowUnsafe = settings.allowUnsafeRootsForTest === true;
  const workspaceRoot = realpathSync(settings.workspaceRoot);
  if (!allowUnsafe && settings.workspaceRoot !== workspaceRoot) fail('workspaceRoot must be a real path');
  const archiveRoot = safeRoot(settings.archiveRoot, 'archiveRoot', workspaceRoot, allowUnsafe);
  const journalRoot = safeRoot(settings.journalRoot, 'journalRoot', workspaceRoot, allowUnsafe);
  const taskStoreRoot = safeRoot(settings.taskStoreRoot, 'taskStoreRoot', workspaceRoot, allowUnsafe);
  const sourcePath = settings.sourcePath;
  if (typeof sourcePath !== 'string' || !sourcePath.endsWith('.bend') || path.isAbsolute(sourcePath) ||
    sourcePath.split('/').some(part => !part || part === '.' || part === '..') || sourcePath.includes('\\')) fail('sourcePath must be a fixed relative .bend path');
  for (const key of ['evaluatorSha256', 'caseSetSha256', 'freshVerifierSha256']) digest(settings[key], key);
  digest(settings.freshTaskSetSha256, 'freshTaskSetSha256');
  if (!allowUnsafe) {
    for (const key of ['evaluatorPath', 'caseSetPath', 'freshVerifierPath', 'freshTaskSetPath']) {
      const file = realpathSync(settings[key]);
      if ([workspaceRoot, os.tmpdir(), '/tmp', '/var/tmp'].some(root => below(realpathSync(root), file))) {
        fail(`${key} must be outside workspace and temporary roots`);
      }
    }
  }
  const selectorSettings = { archiveRoot, workspaceRoot,
    evaluatorPath: settings.evaluatorPath, evaluatorSha256: settings.evaluatorSha256,
    caseSetPath: settings.caseSetPath, caseSetSha256: settings.caseSetSha256 };
  // A test can simulate death after the real CAS. Production has no injected selector.
  if (settings.selectForTest && !allowUnsafe) fail('selector injection is test-only');
  const select = settings.selectForTest ?? selectCandidate;

  function normalize(input) {
    fields(input, ['task_ref', 'candidate_admission', 'settlement', 'score_sha256',
      'incumbent_score_sha256', 'expected_active_score_sha256'], 'request');
    digest(input.task_ref, 'task_ref');
    digest(input.score_sha256, 'score_sha256');
    for (const key of ['incumbent_score_sha256', 'expected_active_score_sha256']) {
      if (input[key] !== null) digest(input[key], key);
    }
    if (input.incumbent_score_sha256 !== input.expected_active_score_sha256) fail('incumbent and expected active score differ');
    const admission = plain(input.candidate_admission, 'candidate_admission');
    const settlement = plain(input.settlement, 'settlement');
    if (admission.kind !== 'candidate' || !admission.id || !settlement.id ||
      !Array.isArray(settlement.candidate_events) || settlement.candidate_events.length !== 1) fail('one prior candidate admission and settlement are required');
    commit(admission.payload?.commit, 'candidate commit');
    digest(admission.payload?.artifact_sha256, 'candidate artifact');
    digest(admission.payload?.observation_receipt_sha256, 'candidate run receipt');
    commit(settlement.expected_head, 'settlement expected_head');
    return JSON.parse(canonical(input));
  }

  async function validate(request, { requireCurrentHead = true } = {}) {
    const state = await controller.replay(request.task_ref);
    const admitted = state.events.find(row => row.id === request.candidate_admission.id && row.type === 'admitted');
    const settled = state.events.find(row => row.id === request.settlement.id && row.type === 'settled');
    if (!admitted || !settled) fail('prior admission and accepted settlement are required');
    // These calls must return existing=true. They cannot create an admission or
    // spend a new evaluation; task-control compares the exact request digest.
    const candidate = await controller.admit(request.task_ref, request.candidate_admission);
    const settlement = await controller.settle(request.task_ref, request.settlement);
    if (!candidate.existing || !settlement.existing || candidate.event_digest !== admitted.digest ||
      settlement.event_digest !== settled.digest || settlement.status !== 'accepted' ||
      settled.result?.status !== 'accepted' ||
      settlement.accepted_head !== settled.result.accepted_head ||
      request.settlement.candidate_events[0] !== candidate.event_digest) fail('prior exact accepted settlement changed');
    const acceptedHead = commit(settlement.accepted_head, 'accepted_head');
    if (requireCurrentHead && state.task_head !== acceptedHead) fail('accepted head is no longer current');
    const settledBytes = await fs.readFile(path.join(taskStoreRoot, request.task_ref, 'events', `${settled.digest}.json`));
    const settledEvent = plain(JSON.parse(settledBytes), 'settled event');
    if (settledBytes.toString('utf8') !== `${canonical(settledEvent)}\n` ||
      hash(canonical(settledEvent)) !== settled.digest || settledEvent.id !== request.settlement.id ||
      settledEvent.type !== 'settled' ||
      canonical(settledEvent.result) !== canonical(settled.result) ||
      settledEvent.request_digest !== hash(canonical(request.settlement))) {
      fail('private settled event does not match task-control replay');
    }
    const settledGate = settledEvent.payload?.verdict?.gate;
    if (settledGate?.revision !== acceptedHead || settledGate?.exit_code !== 0 ||
      !DIGEST.test(settledGate?.receipt_sha256 ?? '')) fail('accepted settlement has no exact gate receipt');
    const evidenceSha = digest(settlement.receipt_sha256, 'settlement evidence receipt');
    const runSha = request.candidate_admission.payload.observation_receipt_sha256;
    const sourceSha = request.candidate_admission.payload.artifact_sha256;
    await pinned(settings.evaluatorPath, settings.evaluatorSha256, 'score evaluator');
    await pinned(settings.caseSetPath, settings.caseSetSha256, 'score case set');
    const score = await archivedJson(path.join(archiveRoot, 'scores', `${request.score_sha256}.json`), request.score_sha256, 'score');
    if (score.schema !== 1 || score.source_sha256 !== sourceSha || score.receipt_sha256 !== runSha ||
      score.evaluator_sha256 !== settings.evaluatorSha256 || score.case_set_sha256 !== settings.caseSetSha256 ||
      score.report?.ok !== true || score.report?.mode !== 'receipt' ||
      score.report?.source_sha256 !== sourceSha || score.report?.receipt_sha256 !== runSha ||
      score.report?.evaluator_sha256 !== settings.evaluatorSha256 ||
      score.report?.case_set_sha256 !== settings.caseSetSha256) fail('score does not bind the candidate and host pins');
    if (typeof score.receipt_id !== 'string' || !RECEIPT_ID.test(score.receipt_id)) fail('score receipt_id invalid');
    const run = await archivedJson(path.join(archiveRoot, 'receipts', `${score.receipt_id}.json`), runSha, 'run receipt');
    if (run.schema !== 1 || run.status !== 'executed' || run.receipt_id !== score.receipt_id ||
      run.source_sha256 !== sourceSha || run.source !== sourcePath || !run.session_id || !run.call_id) fail('run receipt is not a bound execution');
    if (!score.report.toolchain || ['bend_version', 'compiler', 'target', 'execution_policy']
      .some(key => typeof run[key] !== 'string' || !run[key] || score.report.toolchain[key] !== run[key])) {
      fail('score toolchain differs from archived run receipt');
    }
    const candidateGrant = state.grants.find(row => row.ref === request.candidate_admission.grant_ref);
    const integrationGrant = state.grants.find(row => row.ref === request.settlement.integration_grant_ref);
    if (!candidateGrant || candidateGrant.session_id !== run.session_id ||
      !integrationGrant || integrationGrant.owner !== state.spec.integration_owner ||
      integrationGrant.budget?.integrations < 1 || integrationGrant.budget?.evaluations < 1) {
      fail('candidate session or funded integration grant differs from task control');
    }
    const archivedSource = await fs.readFile(path.join(archiveRoot, 'candidates', `${sourceSha}.bend`));
    if (hash(archivedSource) !== sourceSha || archivedSource.length > 512 * 1024) fail('Bend source archive differs from candidate');
    const exactSource = await jjSource(workspaceRoot, acceptedHead, sourcePath);
    if (hash(exactSource) !== sourceSha || !exactSource.equals(archivedSource)) fail('accepted jj head differs from archived Bend source');
    const evidence = await archivedJson(path.join(journalRoot, 'evidence', `${evidenceSha}.json`), evidenceSha, 'fresh evidence');
    fields(evidence, ['schema', 'binding', 'gate', 'fresh'], 'fresh evidence');
    if (evidence.schema !== 1) fail('fresh evidence schema mismatch');
    fields(evidence.gate, ['revision', 'receipt_sha256'], 'gate');
    fields(evidence.fresh, ['task_set_sha256', 'baseline_commit', 'candidate_commit',
      'baseline_receipt_sha256', 'candidate_receipt_sha256', 'compute_budget_sha256'], 'fresh');
    if (evidence.gate.revision !== acceptedHead || evidence.fresh.candidate_commit !== acceptedHead) fail('gate or clone evaluated a different revision');
    if (evidence.gate.receipt_sha256 !== settledGate.receipt_sha256) fail('fresh evidence gate differs from settled exact-revision gate');
    if (evidence.fresh.task_set_sha256 !== settings.freshTaskSetSha256) fail('fresh task set differs from host pin');
    digest(evidence.gate.receipt_sha256, 'gate receipt');
    for (const key of ['task_set_sha256', 'baseline_receipt_sha256', 'candidate_receipt_sha256', 'compute_budget_sha256']) digest(evidence.fresh[key], `fresh ${key}`);
    commit(evidence.fresh.baseline_commit, 'fresh baseline commit');
    await pinned(settings.freshTaskSetPath, settings.freshTaskSetSha256, 'fresh task set');
    const binding = { task_ref: request.task_ref, candidate_event: candidate.event_digest,
      accepted_head: acceptedHead,
      candidate_commit: request.candidate_admission.payload.commit,
      candidate_grant_ref: candidateGrant.ref, candidate_session_id: run.session_id,
      candidate_budget_sha256: hash(canonical(candidateGrant.budget)),
      integration_grant_ref: request.settlement.integration_grant_ref,
      integration_budget_sha256: hash(canonical(integrationGrant.budget)),
      source_path: sourcePath, source_sha256: sourceSha, run_receipt_sha256: runSha,
      score_sha256: request.score_sha256, score_evaluator_sha256: settings.evaluatorSha256,
      score_case_set_sha256: settings.caseSetSha256,
      fresh_verifier_sha256: settings.freshVerifierSha256,
      gate_receipt_sha256: evidence.gate.receipt_sha256,
      fresh_task_set_sha256: evidence.fresh.task_set_sha256,
      baseline_commit: evidence.fresh.baseline_commit,
      baseline_receipt_sha256: evidence.fresh.baseline_receipt_sha256,
      candidate_receipt_sha256: evidence.fresh.candidate_receipt_sha256,
      compute_budget_sha256: evidence.fresh.compute_budget_sha256,
      expected_active_score_sha256: request.expected_active_score_sha256 };
    if (canonical(evidence.binding) !== canonical(binding)) fail('fresh evidence binding differs from accepted artifacts');
    const verifierBytes = await pinned(settings.freshVerifierPath, settings.freshVerifierSha256, 'fresh verifier');
    const verifier = await import(`data:text/javascript;base64,${verifierBytes.toString('base64')}`);
    if (typeof verifier.verifyFreshEvidence !== 'function') fail('fresh verifier export is missing');
    const verdict = await verifier.verifyFreshEvidence({ evidence, binding, evidenceSha,
      privateRoot: journalRoot, archiveRoot, workspaceRoot });
    if (verdict?.ok !== true || verdict?.binding_sha256 !== hash(canonical(binding)) ||
      verdict?.evidence_sha256 !== evidenceSha) fail('host-pinned fresh clone evaluator did not accept evidence');
    return { acceptedHead, candidate, settlement, evidenceSha, sourceSha, runSha,
      bindingSha: hash(canonical(binding)), gateReceiptSha: evidence.gate.receipt_sha256 };
  }

  async function prepare(input) {
    const request = normalize(input);
    const checked = await validate(request);
    const id = hash(canonical(request));
    const intent = { schema: 1, id, request, accepted_head: checked.acceptedHead,
      candidate_event: checked.candidate.event_digest,
      settlement_event: checked.settlement.event_digest,
      evidence_sha256: checked.evidenceSha, binding_sha256: checked.bindingSha,
      gate_receipt_sha256: checked.gateReceiptSha, source_sha256: checked.sourceSha,
      run_receipt_sha256: checked.runSha };
    await fs.mkdir(path.join(journalRoot, 'intents'), { recursive: true, mode: 0o700 });
    await immutable(path.join(journalRoot, 'intents', `${id}.json`), intent);
    return { status: 'prepared', promotion_id: id, accepted_head: checked.acceptedHead };
  }

  async function apply(id) {
    digest(id, 'promotion_id');
    const intentBytes = await fs.readFile(path.join(journalRoot, 'intents', `${id}.json`));
    const intent = plain(JSON.parse(intentBytes), 'intent');
    if (intentBytes.toString('utf8') !== `${canonical(intent)}\n`) fail('promotion intent is not canonical');
    if (intent.schema !== 1 || intent.id !== id || hash(canonical(intent.request)) !== id) fail('promotion intent mismatch');
    const selectedFile = path.join(journalRoot, 'selected', `${id}.json`);
    let marker = null;
    try { marker = JSON.parse(await fs.readFile(selectedFile, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    let active = null;
    try { active = JSON.parse(await fs.readFile(path.join(archiveRoot, 'active.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const request = intent.request;
    const pointerMatchesIntent = active?.score_sha256 === request.score_sha256 &&
      active.source_sha256 === intent.source_sha256 && active.receipt_sha256 === intent.run_receipt_sha256 &&
      active.evaluator_sha256 === settings.evaluatorSha256 && active.case_set_sha256 === settings.caseSetSha256 &&
      active.parent_score_sha256 === request.incumbent_score_sha256;
    const checked = await validate(normalize(request), { requireCurrentHead: !marker && !pointerMatchesIntent });
    if (checked.acceptedHead !== intent.accepted_head || checked.evidenceSha !== intent.evidence_sha256 ||
      checked.bindingSha !== intent.binding_sha256 || checked.gateReceiptSha !== intent.gate_receipt_sha256 ||
      checked.sourceSha !== intent.source_sha256 || checked.runSha !== intent.run_receipt_sha256 ||
      checked.candidate.event_digest !== intent.candidate_event ||
      checked.settlement.event_digest !== intent.settlement_event) fail('promotion intent changed since preparation');
    if (marker) {
      if (marker.schema !== 1 || marker.promotion_id !== id || marker.score_sha256 !== intent.request.score_sha256 ||
        marker.accepted_head !== checked.acceptedHead || marker.evidence_sha256 !== checked.evidenceSha ||
        marker.active?.score_sha256 !== request.score_sha256 ||
        marker.active?.source_sha256 !== checked.sourceSha || marker.active?.receipt_sha256 !== checked.runSha ||
        marker.active?.evaluator_sha256 !== settings.evaluatorSha256 ||
        marker.active?.case_set_sha256 !== settings.caseSetSha256 ||
        marker.active?.parent_score_sha256 !== request.incumbent_score_sha256) fail('selected marker mismatch');
      return { status: 'selected', promotion_id: id, existing: true, active: marker.active };
    }
    const matches = value => value?.score_sha256 === request.score_sha256 && value.source_sha256 === checked.sourceSha &&
      value.receipt_sha256 === checked.runSha && value.parent_score_sha256 === request.incumbent_score_sha256 &&
      value.evaluator_sha256 === settings.evaluatorSha256 && value.case_set_sha256 === settings.caseSetSha256;
    const readActive = async () => {
      try { return JSON.parse(await fs.readFile(path.join(archiveRoot, 'active.json'), 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; return null; }
    };
    const publish = async (selected, existing) => {
      if (!matches(selected)) fail('active pointer changed after selection');
      await fs.mkdir(path.join(journalRoot, 'selected'), { recursive: true, mode: 0o700 });
      await immutable(selectedFile, { schema: 1, promotion_id: id, score_sha256: request.score_sha256,
        accepted_head: checked.acceptedHead, evidence_sha256: checked.evidenceSha, active: selected });
      return { status: 'selected', promotion_id: id, existing, active: selected };
    };
    // A completed CAS without a marker is historical even if the task has
    // advanced. Re-read the exact pointer before publishing its marker.
    if (pointerMatchesIntent) {
      const selected = await readActive();
      if (!matches(selected)) fail('active pointer changed after selection');
      return publish(selected, true);
    }
    // Validation above can take time. Serialize the actual pointer CAS and
    // marker with settlement's task-head CAS, then check the head again.
    return controller.withCurrentHead(request.task_ref, checked.acceptedHead, async () => {
      let selected = await readActive();
      if (matches(selected)) return publish(selected, true);
      if ((selected?.score_sha256 ?? null) !== request.expected_active_score_sha256) fail('active pointer changed before selection');
      try {
        const result = await select({ candidate_score_sha256: request.score_sha256,
          incumbent_score_sha256: request.incumbent_score_sha256,
          expected_active_score_sha256: request.expected_active_score_sha256 }, selectorSettings);
        if (result.status !== 'selected') fail(`candidate rejected by score selector: ${result.reason ?? 'unknown'}`);
      } catch (error) {
        // A process can die after selector CAS and before journaling. Re-read
        // the exact pointer; only the intended candidate/parent may recover.
        selected = await readActive();
        if (!matches(selected)) throw error;
      }
      return publish(await readActive(), false);
    });
  }
  return Object.freeze({ prepare, apply });
}
