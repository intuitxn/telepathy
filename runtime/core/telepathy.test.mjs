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
