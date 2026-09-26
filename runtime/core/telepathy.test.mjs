import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runIsolatedNative } from '../dsh/core.mjs';

const source = fileURLToPath(new URL('./telepathy.bend', import.meta.url));
const bend = process.env.BEND ?? 'bend';
const scratch = mkdtempSync(join(tmpdir(), 'telepathy-kernel-test-'));
const binary = join(scratch, 'program');
const sourceText = readFileSync(source, 'utf8');
for (const match of sourceText.matchAll(/^\s*import\s+([^\s#]+)/gm)) {
  assert.equal(match[1], 'Base', 'kernel tests only compile a Base-only source');
}
const safeEnvironment = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: scratch, BEND_NO_TELEMETRY: '1' };
const build = spawnSync(bend, [source, '-o', binary], {
  cwd: scratch, encoding: 'utf8', env: safeEnvironment, timeout: 30_000,
});
assert.equal(build.error, undefined, build.stderr);
assert.equal(build.status, 0, build.stderr);
test.after(() => rmSync(scratch, { recursive: true, force: true }));

function invoke(...args) {
  return runIsolatedNative(binary, args, { cwd: scratch, env: safeEnvironment, timeoutMs: 15_000 });
}

function batch({ eventScan = 3, candidateScan = 3, docScan = 3, scope = 1, k = 2, events = '', candidates = '', docs = '' } = {}) {
  return invoke('batch', String(eventScan), String(candidateScan), String(docScan), String(scope), String(k), events, candidates, docs);
}

function diffuse({ steps = 1, budget = 2, k = 2, nodes = [], edges = [], anchors = [], scope = [] } = {}) {
  const block = rows => rows.map(String).join('\n');
  return invoke('diffuse', String(steps), String(budget), String(k), block(nodes), block(edges), block(anchors), block(scope));
}

function report(result) {
  assert.equal(result.error, undefined);
  assert.equal(result.exit_code, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('default fixture is a complete, scoped report', async () => {
  const result = report(await invoke());
  assert.equal(result.schema, 'telepathy.kernel/v4');
  assert.equal(result.verdict_source, 'host_supplied_unauthed');
  assert.deepEqual(result.events.quality, { success: 1, failure: 1, unknown: 0 });
  assert.equal(result.events.rejected, 1);
  assert.deepEqual(result.retrieval.docs, [
    { id: 0, scope: 1, value: 5 },
    { id: 2, scope: 1, value: 7 },
  ]);
});

test('varied input keeps host verdict, calibration, scan, and scope separate', async () => {
  const result = report(await batch({
    events: '0\n5\n5\n1\n0\n1\n7\n3\n1\n1\n3\n9\n9\n0\n2',
    candidates: '10\n0\n2\n99\n11\n1\n0\n8\n12\n1\n2\n7',
    docs: '7\n2\n10\n7\n1\n20\n8\n1\n30',
  }));

  assert.deepEqual(result.events.quality, { success: 1, failure: 1, unknown: 0 });
  assert.deepEqual(result.events.calibration, { match: 1, mismatch: 1, unknown: 0 });
  assert.equal(result.events.cursor, 2);
  assert.equal(result.events.accepted, 2);
  assert.equal(result.events.rejected, 1);
  assert.deepEqual(result.choice, { selected: true, action: 12, remaining_fuel: 1, estimate: 7, scanned: 3, scan_exhausted: false });
  assert.deepEqual(result.retrieval.docs, [
    { id: 7, scope: 1, value: 20 },
    { id: 8, scope: 1, value: 30 },
  ]);
});

test('each scan limit bounds inspected records and reports uninspected work', async () => {
  const result = report(await batch({
    eventScan: 0,
    candidateScan: 1,
    docScan: 1,
    events: '0\n1\n1\n1\n1',
    candidates: '4\n0\n1\n0\n5\n1\n1\n0',
    docs: '9\n2\n5\n8\n1\n7',
  }));

  assert.deepEqual(result.events.quality, { success: 0, failure: 0, unknown: 0 });
  assert.equal(result.events.scanned, 0);
  assert.equal(result.events.scan_exhausted, true);
  assert.deepEqual(result.choice, { selected: false, scanned: 1, scan_exhausted: true });
  assert.deepEqual(result.retrieval, { docs: [], scanned: 1, scan_exhausted: true });
});

test('the highest positive estimate in the scanned prefix wins', async () => {
  const candidates = '7\n1\n2\n1\n8\n1\n3\n9\n9\n1\n4\n4';
  const full = report(await batch({ candidateScan: 3, candidates }));
  assert.deepEqual(full.choice, {
    selected: true, action: 8, remaining_fuel: 2, estimate: 9,
    scanned: 3, scan_exhausted: false,
  });

  const capped = report(await batch({ candidateScan: 1, candidates }));
  assert.deepEqual(capped.choice, {
    selected: true, action: 7, remaining_fuel: 1, estimate: 1,
    scanned: 1, scan_exhausted: true,
  });
});

test('ties prefer lower action ID then more available action fuel, independent of order', async () => {
  const rows = [
    [9, 1, 2, 8], [4, 1, 1, 8], [4, 1, 3, 8], [2, 0, 5, 99],
  ];
  for (const ordered of [rows, [...rows].reverse()]) {
    const candidates = ordered.flat().join('\n');
    const result = report(await batch({ candidateScan: 4, candidates }));
    assert.deepEqual(result.choice, {
      selected: true, action: 4, remaining_fuel: 2, estimate: 8,
      scanned: 4, scan_exhausted: false,
    });
  }
});

test('zero estimate abstains and inadmissible or unfunded high estimates do not win', async () => {
  const emptyValue = report(await batch({ candidateScan: 1, candidates: '7\n1\n2\n0' }));
  assert.deepEqual(emptyValue.choice, { selected: false, scanned: 1, scan_exhausted: false });

  const result = report(await batch({
    candidateScan: 3,
    candidates: '1\n1\n0\n65535\n2\n0\n2\n65535\n3\n1\n1\n5',
  }));
  assert.deepEqual(result.choice, {
    selected: true, action: 3, remaining_fuel: 0, estimate: 5,
    scanned: 3, scan_exhausted: false,
  });
});

test('unknown verdict is not scored as success; absent calibration is separate', async () => {
  const result = report(await batch({ events: '0\n4\n4\n0\n2' }));
  assert.deepEqual(result.events.quality, { success: 0, failure: 0, unknown: 1 });
  assert.deepEqual(result.events.calibration, { match: 0, mismatch: 0, unknown: 1 });
});

test('malformed and oversized input fails closed', async () => {
  for (const input of [
    { events: '0\n1\n1\n1\n3' },
    { events: '00\n1\n1\n1\n1' },
    { events: '0\n1\n1\n1' },
    { eventScan: 129 },
    { docs: '1'.repeat(4097) },
    { candidates: '9\n1\n1\n01' },
  ]) {
    const result = await batch(input);
    assert.equal(result.error, undefined);
    assert.notEqual(result.exit_code, 0, `accepted ${JSON.stringify(input)}`);
  }
});

test('context diffusion ranks a scoped graph with deterministic ties and a node budget', async () => {
  const graph = { nodes: [3, 2, 1], edges: [1, 3, 8, 1, 2, 8], anchors: [1], scope: [1, 2, 3] };
  const full = report(await diffuse(graph));
  assert.deepEqual(full, {
    schema: 'telepathy.diffusion/v1', scope_source: 'host_supplied_unauthed',
    steps: 1, budget: 2, context: [
      { id: 2, activation: 4 }, { id: 3, activation: 4 },
    ],
  });
  assert.deepEqual(report(await diffuse({ ...graph, budget: 1 })).context, [{ id: 2, activation: 4 }]);
  assert.deepEqual(report(await diffuse({ ...graph, k: 1 })).context, [{ id: 2, activation: 4 }]);
  assert.deepEqual(report(await diffuse({ ...graph, steps: 0 })).context, [{ id: 1, activation: 8 }]);
  assert.deepEqual(report(await diffuse({ ...graph, anchors: [] })).context, []);
});

test('out-of-scope nodes and edges cannot change an in-scope context score', async () => {
  const base = { steps: 2, budget: 2, k: 2, nodes: [0, 1, 3], edges: [0, 1, 8, 1, 3, 8], anchors: [0], scope: [0, 1, 3] };
  const baseline = report(await diffuse(base));
  const withHub = report(await diffuse({ ...base,
    nodes: [0, 1, 2, 3], edges: [...base.edges, 0, 2, 8, 2, 1, 8],
  }));
  assert.deepEqual(baseline.context, [{ id: 3, activation: 2 }]);
  assert.deepEqual(withHub.context, baseline.context);
  assert.deepEqual(report(await diffuse({ ...base, anchors: [2], nodes: [0, 1, 2, 3] })).context, []);
});

test('a bounded 32-edge fanout keeps only four context cells', async () => {
  const ids = Array.from({ length: 33 }, (_, id) => id);
  const edges = Array.from({ length: 32 }, (_, index) => [0, index + 1, 8]).flat();
  const result = report(await diffuse({ nodes: ids, edges, anchors: [0], scope: ids, budget: 4, k: 4 }));
  assert.deepEqual(result.context, [1, 2, 3, 4].map(id => ({ id, activation: 4 })));
  const saturated = report(await diffuse({
    nodes: [0, 1], edges: Array.from({ length: 16 }, () => [0, 1, 8]).flat(),
    anchors: [0], scope: [0, 1], budget: 1, k: 1,
  }));
  assert.deepEqual(saturated.context, [{ id: 1, activation: 32 }]);
});

test('diffusion rejects ambiguous IDs, invalid edges, and malformed or excessive input', async () => {
  const base = { nodes: [0, 1], edges: [0, 1, 8], anchors: [0], scope: [0, 1] };
  const invalid = [
    { ...base, nodes: [0, 0, 1] },
    { ...base, edges: [0, 9, 8] },
    { ...base, edges: [0, 1, 9] },
    { ...base, edges: [0, 1] },
    { ...base, nodes: ['00', 1] },
    { ...base, steps: 17 },
    { ...base, budget: 129 },
    { ...base, k: 129 },
    { ...base, nodes: Array.from({ length: 129 }, (_, id) => id) },
    { ...base, edges: Array.from({ length: 129 }, () => [0, 1, 8]).flat() },
    { ...base, scope: [1, ...Array.from({ length: 4097 }, () => 1)] },
  ];
  for (const input of invalid) {
    const result = await diffuse(input);
    assert.equal(result.error, undefined);
    assert.notEqual(result.exit_code, 0, `accepted ${JSON.stringify(input)}`);
  }
});
