// A bounded, attributed translation seam. Source prose is a task input; only
// exact Bend bytes are executable. The host scorer remains the correctness oracle.
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { runCandidate } from './core.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = /^[a-f0-9]{64}$/;
const name = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const canonicalNat = /^(0|[1-9][0-9]*)$/;
const own = (value, keys, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !keys.includes(key))) throw new Error(`invalid ${label}`);
};
const bounded = (value, limit, label, allowEmpty = false) => {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > limit || value.includes('\0') ||
      (!allowEmpty && !value.trim())) throw new Error(`invalid ${label}`);
  return value;
};
const unique = (items, label) => {
  const ids = new Set();
  for (const item of items) {
    if (ids.has(item.name)) throw new Error(`duplicate ${label} name`);
    ids.add(item.name);
  }
};

function validateArgs(args, types, label) {
  if (!Array.isArray(args) || args.length !== types.length) throw new Error(`${label} args do not match interface`);
  return args.map((arg, index) => {
    bounded(arg, 256, `${label} arg ${index}`, true);
    if (types[index] === 'nat' && (!canonicalNat.test(arg) || Number(arg) > 65535)) {
      throw new Error(`${label} arg ${index} must be a canonical 0..65535 natural`);
    }
    return arg;
  });
}

function validateTaskFields(input) {
  own(input, ['material', 'claim', 'assumptions', 'interface', 'probes', 'counterexample_requests'], 'algorithm task');
  own(input.material, ['kind', 'reference', 'text'], 'source material');
  if (!['paper', 'pseudocode', 'code'].includes(input.material.kind)) throw new Error('invalid material kind');
  const material = { kind: input.material.kind,
    reference: bounded(input.material.reference, 2048, 'material reference'),
    text: bounded(input.material.text, 16384, 'material text') };
  const claim = bounded(input.claim, 1024, 'claim');
  if (!Array.isArray(input.assumptions) || input.assumptions.length > 16) throw new Error('invalid assumptions');
  const assumptions = input.assumptions.map(item => bounded(item, 512, 'assumption'));
  own(input.interface, ['argv_types', 'stdout_type'], 'interface');
  const argvTypes = input.interface.argv_types;
  if (!Array.isArray(argvTypes) || argvTypes.length > 16 ||
      argvTypes.some(type => !['nat', 'text'].includes(type))) throw new Error('invalid argv types');
  if (!['text', 'nat_line'].includes(input.interface.stdout_type)) throw new Error('invalid stdout type');
  const interfaceSpec = { argv_types: [...argvTypes], stdout_type: input.interface.stdout_type };
  if (!Array.isArray(input.probes) || input.probes.length < 1 || input.probes.length > 16) {
    throw new Error('probes must contain 1..16 cases');
  }
  const probes = input.probes.map(probe => {
    own(probe, ['name', 'args'], 'probe');
    if (!name.test(probe.name)) throw new Error('invalid probe name');
    return { name: probe.name, args: validateArgs(probe.args, argvTypes, `probe ${probe.name}`) };
  });
  unique(probes, 'probe');
  if (!Array.isArray(input.counterexample_requests) || input.counterexample_requests.length > 16) {
    throw new Error('invalid counterexample requests');
  }
  const requests = input.counterexample_requests.map(request => {
    own(request, ['name', 'args', 'reason'], 'counterexample request');
    if (!name.test(request.name)) throw new Error('invalid counterexample name');
    return { name: request.name, args: validateArgs(request.args, argvTypes, `counterexample ${request.name}`),
      reason: bounded(request.reason, 512, 'counterexample reason') };
  });
  unique(requests, 'counterexample');
  if (requests.some(request => probes.some(probe => probe.name === request.name))) {
    throw new Error('probe and counterexample names overlap');
  }
  return { material, claim, assumptions, interface: interfaceSpec,
    probes, counterexample_requests: requests };
}

/** Freeze a small, falsifiable algorithm task from an attributed text excerpt. */
export function defineAlgorithmTask(input) {
  const fields = validateTaskFields(input);
  const body = { schema: 1, ...fields, material_sha256: sha256(fields.material.text) };
  return { ...body, task_sha256: sha256(JSON.stringify(body)) };
}

function checkedTask(task) {
  own(task, ['schema', 'material', 'claim', 'assumptions', 'interface', 'probes',
    'counterexample_requests', 'material_sha256', 'task_sha256'], 'frozen task');
  const { material, claim, assumptions, interface: algorithmInterface, probes,
    counterexample_requests } = task;
  const rebuilt = defineAlgorithmTask({ material, claim, assumptions,
    interface: algorithmInterface, probes, counterexample_requests });
  if (task.schema !== 1 || task.material_sha256 !== rebuilt.material_sha256 ||
      task.task_sha256 !== rebuilt.task_sha256 || !digest.test(task.task_sha256)) {
    throw new Error('algorithm task digest mismatch');
  }
  return rebuilt;
}

function checkedPredictions(candidate, task) {
  own(candidate, ['source', 'predict_check_pass', 'predict_build_pass', 'case_predictions'], 'candidate');
  if (typeof candidate.source !== 'string' || !candidate.source.endsWith('.bend') ||
      Buffer.byteLength(candidate.source, 'utf8') > 1024 || candidate.source.includes('\0') || path.isAbsolute(candidate.source) ||
      candidate.source.split(/[\\/]/).some(part => !part || part === '.' || part === '..')) {
    throw new Error('source must be a relative one-file .bend path');
  }
  if (typeof candidate.predict_check_pass !== 'boolean' || typeof candidate.predict_build_pass !== 'boolean') {
    throw new Error('checker and build predictions must be boolean');
  }
  if (!Array.isArray(candidate.case_predictions) || candidate.case_predictions.length !== task.probes.length) {
    throw new Error('one prediction is required for each probe');
  }
  const values = new Map();
  for (const item of candidate.case_predictions) {
    own(item, ['name', 'predicted_stdout'], 'case prediction');
    if (!name.test(item.name) || values.has(item.name) || !task.probes.some(probe => probe.name === item.name)) {
      throw new Error('invalid case prediction name');
    }
    const stdout = bounded(item.predicted_stdout, 4096, 'predicted stdout', true);
    if (task.interface.stdout_type === 'nat_line' && !canonicalNat.test(stdout.replace(/\n$/, ''))) {
      throw new Error('nat_line prediction must be a canonical natural and newline');
    }
    if (task.interface.stdout_type === 'nat_line' && !stdout.endsWith('\n')) {
      throw new Error('nat_line prediction must end with newline');
    }
    values.set(item.name, stdout);
  }
  return values;
}

/** Bind a task to exact workspace bytes and produce algorithm_run's native input. */
export async function prepareBendExperiment(taskInput, candidate, { workspaceRoot }) {
  const task = checkedTask(taskInput);
  const predictions = checkedPredictions(candidate, task);
  const root = await realpath(workspaceRoot);
  const sourcePath = await realpath(path.join(root, candidate.source));
  const relative = path.relative(root, sourcePath);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('source escapes workspace');
  }
  const bytes = await readFile(sourcePath);
  if (bytes.length > 512 * 1024) throw new Error('Bend source exceeds algorithm_run limit');
  const request = {
    source: candidate.source, source_sha256: sha256(bytes),
    predict_check_pass: candidate.predict_check_pass, predict_build_pass: candidate.predict_build_pass,
    cases: task.probes.map(probe => ({ ...probe, predicted_stdout: predictions.get(probe.name) })),
  };
  return { schema: 1, task_sha256: task.task_sha256, source_sha256: request.source_sha256, request };
}

/** Classify a receipt without treating prediction agreement as correctness. */
export function inspectBendReceipt(taskInput, experiment, receipt) {
  const task = checkedTask(taskInput);
  if (experiment?.task_sha256 !== task.task_sha256 || !digest.test(experiment?.source_sha256 ?? '') ||
      receipt?.source_sha256 !== experiment.source_sha256) throw new Error('receipt binding mismatch');
  const request = experiment.request;
  if (!request || request.source_sha256 !== experiment.source_sha256 ||
      receipt.source !== request.source ||
      receipt.prediction?.check_pass !== request.predict_check_pass ||
      receipt.prediction?.build_pass !== request.predict_build_pass) {
    throw new Error('receipt experiment mismatch');
  }
  if (!['executed', 'check-failed', 'build-failed', 'run-failed', 'rejected'].includes(receipt.status)) {
    throw new Error('invalid receipt status');
  }
  const observation = receipt.observation ?? {};
  const diagnostic = item => item ? {
    ok: item.ok === true, exit_code: item.exit_code ?? null,
    timed_out: item.timed_out === true, stdout: String(item.stdout ?? '').slice(0, 2048),
    stderr: String(item.stderr ?? '').slice(0, 2048),
  } : null;
  const predictions = [];
  if (!Array.isArray(observation.cases ?? []) || observation.cases.length > request.cases.length) {
    throw new Error('invalid receipt cases');
  }
  for (const [index, item] of (observation.cases ?? []).entries()) {
    const probe = request.cases[index];
    if (probe.name !== item.name || JSON.stringify(probe.args) !== JSON.stringify(item.args) ||
        probe.predicted_stdout !== item.predicted_stdout) throw new Error('receipt case binding mismatch');
    predictions.push({ name: item.name, matched: item.prediction_match === true,
      predicted_stdout: item.predicted_stdout, observed_stdout: String(item.observed?.stdout ?? '').slice(0, 4096),
      observed_ok: item.observed?.ok === true });
  }
  return {
    task_sha256: task.task_sha256, source_sha256: experiment.source_sha256,
    receipt_id: receipt.receipt_id ?? null, status: receipt.status,
    checker: diagnostic(observation.check), build: diagnostic(observation.build),
    rejection: receipt.status === 'rejected' ? String(receipt.error ?? '').slice(0, 512) : null,
    predictions,
    prediction_counterexamples: predictions.filter(item => !item.matched).map(item => ({
      name: item.name, predicted_stdout: item.predicted_stdout, observed_stdout: item.observed_stdout,
    })),
    counterexample_requests: task.counterexample_requests,
    correctness: 'unscored',
  };
}

/** Execute the prepared contract through the existing source-pinned Bend runner. */
export async function runAlgorithmTask(task, candidate, settings) {
  const experiment = await prepareBendExperiment(task, candidate, settings);
  const receipt = await runCandidate(experiment.request, settings);
  return { experiment, receipt, assessment: inspectBendReceipt(task, experiment, receipt) };
}
