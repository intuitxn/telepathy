// Opt-in, host-only comparison of flat task context with the one-file Bend
// diffusion kernel. This module never selects live model context. The trusted
// controller authenticates the agent's grants at the requested causal cut;
// the host owns the source archive, relationship graph, and native build pin.
// Wall time and graph counts are host diagnostics, not model-visible evidence.
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { runIsolatedNative } from './core.mjs';

const SHA = /^[a-f0-9]{64}$/;
const MAX_SOURCE_BYTES = 16 * 1024;
const MAX_VIEW_BYTES = 65_536;
const MAX_ITEMS = 64;
const MAX_EDGES = 128;
const MAX_ANCHORS = 16;
const MAX_CONTEXT = 16;
const MAX_OUTPUT_BYTES = 4096;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(`scoped context: ${message}`); };
const isSha = value => typeof value === 'string' && SHA.test(value);
const bytes = value => Buffer.byteLength(JSON.stringify(value));
const lines = values => values.map(String).join('\n');

function boundedInt(value, label, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(`${label} must be ${min}..${max}`);
  return value;
}

function validateView(view, request) {
  if (!view || view.task_ref !== request.task_ref || view.causal_cut !== request.causal_cut ||
      !Array.isArray(view.scopes) || !view.scopes.includes(request.scope) ||
      !Array.isArray(view.context_refs) || view.context_refs.length > MAX_ITEMS ||
      !Array.isArray(view.assignments)) fail('controller view differs from authenticated task, cut, or scope');
  const seen = new Set();
  for (const row of view.context_refs) {
    if (!row || !isSha(row.event_digest) || seen.has(row.event_digest) ||
        !view.scopes.includes(row.scope) || !Array.isArray(row.causal_parents) ||
        row.causal_parents.length > 16 ||
        row.causal_parents.some(parent => !isSha(parent)) ||
        !['verified', 'accepted', 'rejected', 'proposed'].includes(row.evidence_status))
      fail('controller view contains an ambiguous or unauthorized event ref');
    if (row.artifact_sha256 !== null && row.artifact_sha256 !== undefined && !isSha(row.artifact_sha256))
      fail('controller view has invalid artifact digest');
    if (row.claim_sha256 !== null && row.claim_sha256 !== undefined && !isSha(row.claim_sha256))
      fail('controller view has invalid claim digest');
    if (row.receipt_sha256 !== null && row.receipt_sha256 !== undefined && !isSha(row.receipt_sha256))
      fail('controller view has invalid receipt digest');
    seen.add(row.event_digest);
  }
}

function normalizeEdges(rows, ids) {
  if (!Array.isArray(rows) || rows.length > MAX_EDGES) fail('host relationships exceed 128 edges');
  const map = new Map();
  for (const row of rows) {
    if (!row || !isSha(row.from_ref) || !isSha(row.to_ref) ||
        !ids.has(row.from_ref) || !ids.has(row.to_ref)) fail('host relationship names an event outside the view');
    const weight = boundedInt(row.weight, 'relationship weight', 0, 8);
    const from = ids.get(row.from_ref);
    const to = ids.get(row.to_ref);
    const key = `${from}:${to}`;
    map.set(key, { from, to, weight: Math.max(weight, map.get(key)?.weight ?? 0) });
  }
  if (map.size > MAX_EDGES) fail('diffusion graph exceeds 128 edges');
  return [...map.values()].sort((a, b) => a.from - b.from || a.to - b.to);
}

function selectWithinBudget(rows, k, byteBudget) {
  const selected = [];
  let used = 0;
  for (const row of rows) {
    if (selected.length >= k) break;
    const cost = bytes(row);
    if (used + cost > byteBudget) continue;
    selected.push(row);
    used += cost;
  }
  return { refs: selected, output_bytes: used };
}

function parseKernelResult(stdout, count, steps, budget, k, authorized) {
  let parsed;
  try { parsed = JSON.parse(stdout); } catch { fail('native diffusion returned invalid JSON'); }
  if (!parsed || parsed.schema !== 'telepathy.diffusion/v1' ||
      parsed.scope_source !== 'host_supplied_unauthed' ||
      parsed.steps !== steps || parsed.budget !== budget || !Array.isArray(parsed.context) ||
      parsed.context.length > Math.min(budget, k)) fail('native diffusion returned an invalid contract');
  const seen = new Set();
  let lastScore = 33;
  let lastId = -1;
  for (const cell of parsed.context) {
    if (!cell || !Number.isSafeInteger(cell.id) || cell.id < 0 || cell.id >= count ||
        !authorized.has(cell.id) || seen.has(cell.id) ||
        !Number.isSafeInteger(cell.activation) || cell.activation < 1 || cell.activation > 32 ||
        cell.activation > lastScore ||
        (cell.activation === lastScore && cell.id <= lastId))
      fail('native diffusion returned an out-of-scope, duplicate, or unsorted cell');
    seen.add(cell.id);
    lastScore = cell.activation;
    lastId = cell.id;
  }
  return parsed.context;
}

/**
 * Compare at one immutable task causal cut. `controller` must be a trusted
 * createTaskControl instance. `resolveSource` reads host-owned archived bytes
 * by digest. `relationships` supplies host-authored graph edges at that cut.
 * The binary digest pins the private executable copy, while its source/build provenance remains a
 * separate release gate; this adapter is not mounted as a DSH tool.
 */
export function createScopedContextComparison({ controller, resolveSource, relationships = async () => [], binaryPath, binarySha256 }) {
  if (typeof controller?.view !== 'function' || typeof resolveSource !== 'function' ||
      typeof relationships !== 'function' || !isSha(binarySha256) ||
      typeof binaryPath !== 'string') fail('trusted controller, source archive, graph, and binary pin are required');
  const binary = realpathSync(binaryPath);

  return Object.freeze({
    async compare(request) {
      if (!request || !isSha(request.task_ref) || !isSha(request.causal_cut) ||
          typeof request.agent !== 'string' || !request.agent ||
          typeof request.scope !== 'string' || !request.scope)
        fail('task, agent, scope, and exact causal cut are required');
      const steps = boundedInt(request.steps, 'steps', 0, 16);
      const nodeBudget = boundedInt(request.node_budget, 'node budget', 0, MAX_ITEMS);
      const k = boundedInt(request.k, 'K', 1, MAX_CONTEXT);
      const byteBudget = boundedInt(request.output_bytes, 'output bytes', 1, MAX_OUTPUT_BYTES);
      if (!Array.isArray(request.anchor_event_refs) || !request.anchor_event_refs.length ||
          request.anchor_event_refs.length > MAX_ANCHORS ||
          request.anchor_event_refs.some(ref => !isSha(ref)) ||
          new Set(request.anchor_event_refs).size !== request.anchor_event_refs.length)
        fail('1..16 unique host anchor event refs are required');

      const started = performance.now();
      const view = await controller.view(request.task_ref, request.agent, request.causal_cut, MAX_VIEW_BYTES);
      validateView(view, request);
      const viewMs = performance.now() - started;

      // Keep controller event identity separate from artifact digest: the same
      // bytes can occur in multiple scopes without merging those events.
      const sourceCache = new Map();
      const eligible = new Map();
      let sourceBytesRead = 0;
      for (const row of view.context_refs) {
        if (row.scope !== request.scope) continue;
        const sourceRef = row.artifact_sha256 ?? row.claim_sha256 ?? row.receipt_sha256;
        if (!sourceRef) continue;
        let raw = sourceCache.get(sourceRef);
        if (!raw) {
          const returned = await resolveSource({ task_ref: request.task_ref,
            causal_cut: request.causal_cut, event_digest: row.event_digest,
            scope: row.scope, source_ref: sourceRef });
          if (!(returned instanceof Uint8Array) || returned.byteLength > MAX_SOURCE_BYTES)
            fail('host source is absent or exceeds 16 KiB');
          raw = Buffer.from(returned);
          if (hash(raw) !== sourceRef) fail('host source bytes differ from admitted digest');
          sourceCache.set(sourceRef, raw);
          sourceBytesRead += raw.byteLength;
        }
        eligible.set(row.event_digest, Object.freeze({
          event_digest: row.event_digest, source_ref: sourceRef,
          scope: row.scope, evidence_status: row.evidence_status,
        }));
      }
      for (const ref of request.anchor_event_refs) if (!eligible.has(ref))
        fail('anchor is absent, out of scope, or has no verified source bytes');
      const resolvedMs = performance.now() - started - viewMs;

      const orderedEvents = [...view.context_refs].sort((a, b) =>
        a.event_digest < b.event_digest ? -1 : a.event_digest > b.event_digest ? 1 : 0);
      const ids = new Map(orderedEvents.map((row, index) => [row.event_digest, index]));
      const authorized = new Set([...eligible.keys()].map(ref => ids.get(ref)));
      const scopeIds = [...authorized].sort((a, b) => a - b);
      const rawRelations = await relationships({ task_ref: request.task_ref,
        causal_cut: request.causal_cut, scope: request.scope,
        event_refs: orderedEvents.map(row => ({ event_digest: row.event_digest, scope: row.scope })) });
      const causal = orderedEvents.flatMap(row => row.causal_parents
        .filter(ref => ids.has(ref)).map(ref => ({ from_ref: ref, to_ref: row.event_digest, weight: 8 })));
      const edges = normalizeEdges([...causal, ...rawRelations], ids);
      const graphMs = performance.now() - started - viewMs - resolvedMs;

      const flatStart = performance.now();
      const flat = selectWithinBudget(view.context_refs
        .filter(row => eligible.has(row.event_digest)).map(row => eligible.get(row.event_digest)), k, byteBudget);
      const flatMs = performance.now() - flatStart;

      const executableBytes = readFileSync(binary);
      if (hash(executableBytes) !== binarySha256) fail('native diffusion binary differs from host pin');
      const args = ['diffuse', String(steps), String(nodeBudget), String(k),
        lines(orderedEvents.map((_, index) => index)),
        lines(edges.flatMap(edge => [edge.from, edge.to, edge.weight])),
        lines(request.anchor_event_refs.map(ref => ids.get(ref))), lines(scopeIds)];
      const inputBytes = args.reduce((sum, arg) => sum + Buffer.byteLength(arg), 0);
      const scratch = mkdtempSync(join(tmpdir(), 'telepathy-scoped-context-'));
      let observed;
      try {
        // Execute the bytes just measured, not the caller's path: that path
        // may be a model-writable build output replaced after the digest check.
        const pinnedExecutable = join(scratch, 'diffuse');
        writeFileSync(pinnedExecutable, executableBytes, { flag: 'wx', mode: 0o500 });
        if (hash(readFileSync(pinnedExecutable)) !== binarySha256)
          fail('private native diffusion copy differs from host pin');
        observed = await runIsolatedNative(pinnedExecutable, args, {
          cwd: scratch, env: { PATH: process.env.PATH ?? '/usr/bin:/bin' }, timeoutMs: 5000,
          outputLimit: 16 * 1024,
        });
      } finally { rmSync(scratch, { recursive: true, force: true }); }
      if (!observed.ok || observed.exit_code !== 0 || observed.timed_out || observed.stderr)
        fail(`native diffusion failed at cut: ${String(observed.stderr || observed.error || observed.exit_code).slice(0, 256)}`);
      const cells = parseKernelResult(observed.stdout, orderedEvents.length, steps, nodeBudget, k, authorized);
      const diffusion = selectWithinBudget(cells.map(cell => eligible.get(orderedEvents[cell.id].event_digest)), k, byteBudget);
      const finished = performance.now();
      return Object.freeze({ schema: 'telepathy.scoped-context-comparison/v1',
        task_ref: request.task_ref, causal_cut: request.causal_cut, task_head: view.task_head,
        scope: request.scope, flat, diffusion,
        // These diagnostics must stay host-only: timing/graph size can reveal
        // the presence of out-of-scope records even when ranked refs cannot.
        cost: { view_ms: viewMs, source_ms: resolvedMs, graph_ms: graphMs,
          flat_ms: flatMs, native_ms: observed.elapsed_ms,
          total_ms: finished - started, source_bytes_read: sourceBytesRead,
          native_input_bytes: inputBytes, native_output_bytes: Buffer.byteLength(observed.stdout),
          native_binary_bytes: executableBytes.byteLength,
          candidate_events: orderedEvents.length, scoped_sources: eligible.size,
          view_truncated: view.truncated === true, view_used_bytes: view.used,
          graph_edges: edges.length, flat_output_bytes: flat.output_bytes,
          diffusion_output_bytes: diffusion.output_bytes },
      });
    },
  });
}
