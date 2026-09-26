// A deliberately small executable pseudocode surface for bounded state machines.
// Compilation is pure: the caller owns the source file, generated Bend file,
// and all admission, execution, and scoring decisions.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { fileURLToPath } from 'node:url';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const IDENT = '[a-z][a-z0-9_]{0,31}';
const RESERVED = new Set(['algorithm', 'state', 'step', 'return', 'tick', 'add', 'sub', 'if_lt']);
const MAX_BYTES = 16 * 1024;
const MAX_STATES = 8;
const MAX_STEPS = 128;
const MAX_NODES = 64;
const MAX_DEPTH = 8;

function sourceWorkspaceRoot(sourceFile) {
  const sourceDirectory = path.dirname(sourceFile);
  let current = sourceDirectory;
  for (;;) {
    if (existsSync(path.join(current, '.jj'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return sourceDirectory;
    current = parent;
  }
}

function diagnostic(line, start, end, code, message) {
  return { range: { start: { line, character: start }, end: { line, character: Math.max(start + 1, end) } },
    severity: 1, source: 'telepathy-algorithm', code, message };
}

function expression(text, line, base, states) {
  const tokens = [];
  let offset = 0;
  while (offset < text.length) {
    if (/\s/.test(text[offset])) { offset += 1; continue; }
    const start = offset;
    const match = /^(?:[a-z][a-z0-9_]*|[0-9]+|[(),])/.exec(text.slice(offset));
    if (!match) throw diagnostic(line, base + start, base + start + 1,
      'invalid-token', 'Expected a natural, state name, tick, or function call.');
    offset += match[0].length;
    tokens.push({ text: match[0], start: base + start, end: base + offset });
    if (tokens.length > 256) throw diagnostic(line, base, base + text.length,
      'expression-limit', 'Expression exceeds the token limit.');
  }
  let cursor = 0;
  let nodes = 0;
  const current = () => tokens[cursor];
  const fail = (token, code, message) => {
    throw diagnostic(line, token?.start ?? base + text.length,
      token?.end ?? base + text.length + 1, code, message);
  };
  const take = expected => {
    const token = current();
    if (!token || token.text !== expected) fail(token, 'expected-token', `Expected "${expected}".`);
    cursor += 1;
  };
  const parse = depth => {
    if (depth > MAX_DEPTH || ++nodes > MAX_NODES) fail(current(), 'expression-limit',
      `Expression exceeds depth ${MAX_DEPTH} or ${MAX_NODES} nodes.`);
    const token = current();
    if (!token) fail(token, 'expected-expression', 'Expected an expression.');
    cursor += 1;
    if (/^[0-9]+$/.test(token.text)) {
      if (!/^(0|[1-9][0-9]*)$/.test(token.text) || BigInt(token.text) > 65535n) {
        fail(token, 'natural-range', 'Natural literals must be canonical 0..65535 values.');
      }
      return { kind: 'nat', value: BigInt(token.text) };
    }
    if (!/^[a-z]/.test(token.text)) fail(token, 'expected-expression', 'Expected an expression.');
    if (current()?.text === '(') {
      const arity = token.text === 'if_lt' ? 4 : ['add', 'sub'].includes(token.text) ? 2 : 0;
      if (!arity) fail(token, 'unknown-operation', `Unknown operation "${token.text}".`);
      take('(');
      const args = [];
      for (let index = 0; index < arity; index += 1) {
        if (index) take(',');
        args.push(parse(depth + 1));
      }
      take(')');
      return { kind: token.text, args };
    }
    if (token.text !== 'tick' && !states.has(token.text)) {
      fail(token, 'unknown-name', `Unknown state name "${token.text}".`);
    }
    return { kind: 'name', value: token.text };
  };
  const ast = parse(1);
  if (cursor !== tokens.length) fail(current(), 'trailing-token', 'Unexpected token after expression.');
  return ast;
}

function parseProgram(source) {
  const sourceSha256 = typeof source === 'string' ? sha256(source) : null;
  if (typeof source !== 'string' || Buffer.byteLength(source, 'utf8') > MAX_BYTES || source.includes('\0')) {
    return { diagnostics: [diagnostic(0, 0, 1, 'source-limit', 'Source must be UTF-8 text of at most 16 KiB without NUL.')], sourceSha256 };
  }
  const lines = source.split(/\n/);
  const diagnostics = [];
  const states = new Map();
  const steps = new Map();
  let algorithm = null;
  let output = null;
  let stage = 0;
  for (const [lineNumber, raw] of lines.entries()) {
    const content = raw.trim();
    if (!content || content.startsWith('#')) continue;
    const base = raw.indexOf(content);
    const at = (code, message, start = base, end = base + content.length) => {
      diagnostics.push(diagnostic(lineNumber, start, end, code, message));
    };
    if (/[\r\t]/.test(content) || /[^\x20-\x7e]/.test(content)) {
      at('invalid-character', 'Program statements use printable ASCII spaces and characters.');
      continue;
    }
    const header = new RegExp(`^algorithm (${IDENT})$`).exec(content);
    const state = new RegExp(`^state (${IDENT}) = (0|[1-9][0-9]*)$`).exec(content);
    const step = new RegExp(`^step (${IDENT}) = (.+)$`).exec(content);
    const result = new RegExp(`^return (${IDENT})$`).exec(content);
    if (header && stage === 0) {
      algorithm = header[1];
      stage = 1;
    } else if (state && stage === 1) {
      if (RESERVED.has(state[1]) || states.has(state[1])) at('duplicate-name', 'State names must be unique and nonreserved.');
      else if (states.size >= MAX_STATES) at('state-limit', `At most ${MAX_STATES} state fields are allowed.`);
      else if (BigInt(state[2]) > 65535n) at('natural-range', 'Initial values must be at most 65535.');
      else states.set(state[1], BigInt(state[2]));
    } else if (step && (stage === 1 || stage === 2)) {
      stage = 2;
      if (!states.has(step[1])) at('unknown-target', `Unknown step target "${step[1]}".`);
      else if (steps.has(step[1])) at('duplicate-step', `State "${step[1]}" already has a step.`);
      else {
        const expressionBase = base + content.length - step[2].length;
        try { steps.set(step[1], { ast: expression(step[2], lineNumber, expressionBase, states), line: lineNumber }); }
        catch (error) { diagnostics.push(error); }
      }
    } else if (result && stage === 2) {
      output = result[1];
      stage = 3;
      if (!states.has(output)) at('unknown-output', `Unknown return state "${output}".`);
    } else {
      at('statement-order', 'Expected algorithm, state declarations, one step per state, then return.');
    }
    if (diagnostics.length >= 16) break;
  }
  const endLine = Math.max(0, lines.length - 1);
  if (!algorithm) diagnostics.push(diagnostic(0, 0, 1, 'missing-algorithm', 'Missing algorithm declaration.'));
  if (!states.size) diagnostics.push(diagnostic(endLine, 0, 1, 'missing-state', 'Declare at least one state field.'));
  for (const name of states.keys()) {
    if (!steps.has(name)) diagnostics.push(diagnostic(endLine, 0, 1, 'missing-step', `Missing step for state "${name}".`));
  }
  if (!output) diagnostics.push(diagnostic(endLine, 0, 1, 'missing-return', 'Missing return field.'));
  return { program: diagnostics.length ? null : { algorithm, states, steps, output },
    diagnostics: diagnostics.slice(0, 16), sourceSha256 };
}

function bendExpression(node, indices) {
  if (node.kind === 'nat') return `${node.value}n`;
  if (node.kind === 'name') return node.value === 'tick' ? 'tick' : `v${indices.get(node.value)}`;
  if (node.kind === 'add') return `Nat.add(${node.args.map(item => bendExpression(item, indices)).join(', ')})`;
  if (node.kind === 'sub') return `Nat.sub(${node.args.map(item => bendExpression(item, indices)).join(', ')})`;
  const [left, right, yes, no] = node.args.map(item => bendExpression(item, indices));
  return `Bool.pick(Nat, Nat.is_lt(${left}, ${right}), ${yes}, ${no})`;
}

function bendProgram(program, sourceSha256) {
  const names = [...program.states.keys()];
  const indices = new Map(names.map((name, index) => [name, index]));
  const shape = names.map((_, index) => `v${index}: Nat`).join(', ');
  const destructure = names.map((_, index) => `+v${index}`).join(', ');
  const initial = [...program.states.values()].map(value => `${value}n`).join(', ');
  const updates = names.map(name => bendExpression(program.steps.get(name).ast, indices)).join(', ');
  return `import Base\n\n# Generated from ${program.algorithm}; pseudocode SHA-256 ${sourceSha256}.\n` +
    `type AlgorithmState is Data:\n  AlgorithmState{${shape}}\n\n` +
    `def algorithm_step(s: AlgorithmState, +tick: Nat) -> AlgorithmState:\n` +
    `  match s:\n    case AlgorithmState{${destructure}}:\n      AlgorithmState{${updates}}\n\n` +
    `def algorithm_repeat(fuel: Nat, +state: AlgorithmState, +tick: Nat) -> AlgorithmState:\n` +
    `  match fuel:\n    case 0n:\n      state\n    case 1n+rest:\n` +
    `      algorithm_repeat(rest, algorithm_step(state, tick), Nat.add(tick, 1n))\n\n` +
    `def algorithm_result(s: AlgorithmState) -> Nat:\n` +
    `  match s:\n    case AlgorithmState{${destructure}}:\n      v${indices.get(program.output)}\n\n` +
    `def algorithm_checked(valid: Bool, n: Nat) -> IO(Unit):\n` +
    `  match valid:\n    case True{}:\n` +
    `      IO.print(Nat.show(algorithm_result(algorithm_repeat(n, AlgorithmState{${initial}}, 0n))))\n` +
    `    case False{}:\n      IO.die(Unit, 2, "steps must be canonical 0..${MAX_STEPS}")\n\n` +
    `def algorithm_parsed(raw: String, parsed: Maybe<&2, Nat>) -> IO(Unit):\n` +
    `  match parsed:\n    case Some{+n}:\n` +
    `      algorithm_checked(Nat.is_le(n, ${MAX_STEPS}n) && String.eq(raw, Nat.show(n)), n)\n` +
    `    case None{}:\n      IO.die(Unit, 2, "invalid natural steps")\n\n` +
    `def algorithm_args(args: List<String>) -> IO(Unit):\n` +
    `  match args:\n    case Con{+raw, Nil{}}:\n      algorithm_parsed(raw, Nat.read(raw))\n` +
    `    case _:\n      IO.die(Unit, 2, "usage: STEPS")\n\n` +
    `def main() -> IO(Unit):\n  do IO<Unit>:\n    args : List<String> <- IO.args()\n` +
    `    algorithm_args(args)\n`;
}

/** Compile the bounded recurrence language to an exact one-file Bend source. */
export function compileAlgorithmText(source) {
  const parsed = parseProgram(source);
  if (!parsed.program) return { ok: false, source_sha256: parsed.sourceSha256, diagnostics: parsed.diagnostics };
  const bendSource = bendProgram(parsed.program, parsed.sourceSha256);
  return { ok: true, source_sha256: parsed.sourceSha256, bend_sha256: sha256(bendSource),
    bend_source: bendSource, interface: { argv_types: ['nat'], stdout_type: 'nat_line', max_steps: MAX_STEPS },
    diagnostics: [] };
}

function evaluate(node, state, tick) {
  if (node.kind === 'nat') return node.value;
  if (node.kind === 'name') return node.value === 'tick' ? tick : state.get(node.value);
  const args = node.args.map(item => evaluate(item, state, tick));
  if (node.kind === 'add') return args[0] + args[1];
  if (node.kind === 'sub') return args[0] > args[1] ? args[0] - args[1] : 0n;
  return args[0] < args[1] ? args[2] : args[3];
}

/** Parse once, then simulate many bounded probes without another source parse. */
export function prepareAlgorithmText(source) {
  const parsed = parseProgram(source);
  if (!parsed.program) return { ok: false, source_sha256: parsed.sourceSha256, diagnostics: parsed.diagnostics };
  const simulate = steps => {
    if (!Number.isSafeInteger(steps) || steps < 0 || steps > MAX_STEPS) {
      return { ok: false, source_sha256: parsed.sourceSha256,
        diagnostics: [diagnostic(0, 0, 1, 'step-range', `Steps must be an integer 0..${MAX_STEPS}.`)] };
    }
    let state = new Map(parsed.program.states);
    for (let tick = 0; tick < steps; tick += 1) {
      const next = new Map();
      for (const [name, entry] of parsed.program.steps) next.set(name, evaluate(entry.ast, state, BigInt(tick)));
      state = next;
    }
    return { ok: true, source_sha256: parsed.sourceSha256, steps,
      stdout: `${state.get(parsed.program.output)}\n` };
  };
  return { ok: true, source_sha256: parsed.sourceSha256, simulate };
}

/** Fast in-process transition simulation; differential aid, not a task oracle. */
export function simulateAlgorithmText(source, steps) {
  const prepared = prepareAlgorithmText(source);
  return prepared.ok ? prepared.simulate(steps) : prepared;
}

async function cli(args) {
  const [command, sourcePath, count, ...extra] = args;
  if (!['check', 'compile', 'simulate', 'run', 'score'].includes(command) || !sourcePath || extra.length ||
      (['simulate', 'run', 'score'].includes(command) ? count === undefined : count !== undefined)) {
    process.stderr.write('usage: algorithm-language.mjs check|compile FILE | simulate|run FILE STEPS | score RECEIPT_ID RECEIPT_SHA256\n');
    process.exitCode = 2;
    return;
  }
  try {
    if (command === 'score') {
      for (const name of ['TELEPATHY_DSH_EVALUATOR', 'TELEPATHY_DSH_EVALUATOR_SHA256',
        'TELEPATHY_DSH_CASE_SET', 'TELEPATHY_DSH_CASE_SET_SHA256']) {
        if (!process.env[name]) throw new Error(`score requires host-pinned ${name}`);
      }
      const { scoreCandidate } = await import('./core.mjs');
      const scored = await scoreCandidate({ receipt_id: sourcePath, receipt_sha256: count },
        { bendBin: process.env.BEND ?? process.env.BEND_BIN });
      process.stdout.write(`${JSON.stringify(scored)}\n`);
      if (!scored.passed) process.exitCode = 1;
      return;
    }
    const exactSourcePath = await realpath(sourcePath);
    const bytes = await readFile(exactSourcePath);
    if (bytes.length > MAX_BYTES) throw new Error(`source exceeds ${MAX_BYTES} bytes`);
    const source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (command === 'simulate' || command === 'run') {
      const steps = /^(0|[1-9][0-9]*)$/.test(count) ? Number(count) : NaN;
      const result = simulateAlgorithmText(source, steps);
      if (!result.ok) {
        process.stderr.write(`${JSON.stringify(result.diagnostics)}\n`);
        process.exitCode = 1;
        return;
      }
      if (command === 'simulate') {
        process.stdout.write(result.stdout);
        return;
      }
      const compiled = compileAlgorithmText(source);
      const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'telepathy-algorithm-run-'));
      try {
        const generated = 'algorithm.bend';
        await writeFile(path.join(workspaceRoot, generated), compiled.bend_source, { flag: 'wx', mode: 0o600 });
        const { runCandidate } = await import('./core.mjs');
        const receipt = await runCandidate({ source: generated, source_sha256: compiled.bend_sha256,
          predict_check_pass: true, predict_build_pass: true,
          cases: [{ name: `step-${count}`, args: [count], predicted_stdout: result.stdout }],
        }, { workspaceRoot, archiveGuardRoots: [process.cwd(), path.dirname(exactSourcePath),
          sourceWorkspaceRoot(exactSourcePath),
          ...(process.env.TELEPATHY_DSH_WORKSPACE ? [process.env.TELEPATHY_DSH_WORKSPACE] : [])],
        timeoutMs: 60_000, bendBin: process.env.BEND ?? process.env.BEND_BIN });
        const observed = receipt.observation?.cases?.[0];
        process.stdout.write(`${JSON.stringify({ source_sha256: compiled.source_sha256,
          bend_sha256: compiled.bend_sha256, steps, predicted_stdout: result.stdout,
          observed_stdout: observed?.observed?.stdout ?? null,
          prediction_match: observed?.prediction_match ?? false, status: receipt.status,
          receipt_id: receipt.receipt_id, receipt_sha256: receipt.receipt_sha256,
          receipt_path: receipt.receipt_path })}\n`);
        if (receipt.status !== 'executed' || !observed?.prediction_match) process.exitCode = 1;
      } finally {
        await rm(workspaceRoot, { recursive: true, force: true });
      }
      return;
    }
    const result = compileAlgorithmText(source);
    if (command === 'check') {
      process.stdout.write(`${JSON.stringify({ ok: result.ok, source_sha256: result.source_sha256,
        bend_sha256: result.bend_sha256 ?? null, diagnostics: result.diagnostics })}\n`);
    } else if (result.ok) process.stdout.write(result.bend_source);
    else process.stderr.write(`${JSON.stringify(result.diagnostics)}\n`);
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${String(error.message ?? error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await cli(process.argv.slice(2));
}
