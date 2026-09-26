import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createTaskControl } from './task-control.mjs';
import { createScopedContextComparison } from './scoped-context.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const root = fileURLToPath(new URL('../..', import.meta.url));
const source = join(root, 'runtime/core/telepathy.bend');
const scratch = mkdtempSync(join(tmpdir(), 'telepathy-context-pilot-'));
const binary = join(scratch, 'kernel');
const build = spawnSync(process.env.BEND ?? 'bend', [source, '-o', binary], {
  cwd: scratch, encoding: 'utf8', timeout: 30_000,
  env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: scratch, BEND_NO_TELEMETRY: '1' },
});
assert.equal(build.error, undefined, build.stderr);
assert.equal(build.status, 0, build.stderr);
const binarySha256 = sha(readFileSync(binary));
test.after(() => rmSync(scratch, { recursive: true, force: true }));

const A = 'a'.repeat(40);
const oracle = '1'.repeat(64);
const budget = () => ({ tokens: 40_000, fuel: 100, children: 0, integrations: 0, evaluations: 0 });
const planSpec = (scope, head) => ({
  id: `plan-${scope}`, kind: 'algorithm', scope, deliverable: `Explore ${scope} context`,
  acceptance: 'Compare fixed source refs', source_refs: [], oracle_sha256: oracle,
  budget: budget(), depends_on: [], parent_plan_ref: null, expected_log_head: head,
});

async function fixture(t) {
  const storeRoot = mkdtempSync(join(tmpdir(), 'telepathy-context-task-'));
  t.after(() => rmSync(storeRoot, { recursive: true, force: true }));
  const controller = createTaskControl({ storeRoot, allowUnsafeStoreRootForTest: true });
  const opened = await controller.open({
    goal: 'Compare bounded scoped context on fixed evidence', acceptance: 'Pick the relevant exact source',
    scopes: ['alpha', 'beta'], integration_owner: 'agent', initial_head: A,
    pinned_versions: { evaluator_sha256: oracle, case_set_sha256: '2'.repeat(64), toolchain: 'bend-2.0.21' },
    limits: { max_tasks: 2, max_branches: 2, max_active_grants: 2, max_depth: 0,
      tokens: 100_000, fuel: 1000, integrations: 1, evaluations: 1 },
    policy_version: 'keyless-context-pilot-v1',
  });
  async function grant(scope) {
    const before = await controller.replay(opened.task_ref);
    const plan = await controller.plan(opened.task_ref, planSpec(scope, before.log_head));
    const current = await controller.replay(opened.task_ref);
    const g = await controller.grant(opened.task_ref, {
      id: `grant-${scope}`, plan_ref: plan.plan_ref, branch: `branch-${scope}`,
      owner: scope === 'alpha' ? 'agent' : 'other', scope,
      deliverable: `Explore ${scope} context`,
      base_refs: { task_commit: A, causal_event: current.log_head }, budget: budget(),
      location: join(scratch, `branch-${scope}`), parent_grant_ref: null,
    });
    return { ...g, scope, owner: scope === 'alpha' ? 'agent' : 'other', last: g.event_digest };
  }
  const alpha = await grant('alpha');
  const beta = await grant('beta');
  const archive = new Map();
  async function admit(g, name, content) {
    const raw = Buffer.from(content);
    const sourceRef = sha(raw);
    archive.set(sourceRef, raw);
    const admitted = await controller.admit(opened.task_ref, {
      id: name, grant_ref: g.grant_ref, actor: g.owner, scope: g.scope,
      base_commit: A, parents: [g.last], kind: 'observation',
      payload: { receipt_sha256: sourceRef },
    });
    g.last = admitted.event_digest;
    return { event_digest: admitted.event_digest, source_ref: sourceRef };
  }
  const a0 = await admit(alpha, 'alpha-anchor', 'anchor evidence');
  const a1 = await admit(alpha, 'alpha-step', 'relevant intermediate');
  const a3 = await admit(alpha, 'alpha-answer', 'held-out relevant target');
  const earlyCut = (await controller.replay(opened.task_ref)).log_head;
  const bridge = await admit(beta, 'beta-bridge', 'duplicate-source');
  const distractor = await admit(alpha, 'alpha-distractor', 'duplicate-source');
  const causalCut = (await controller.replay(opened.task_ref)).log_head;
  assert.equal(bridge.source_ref, distractor.source_ref);
  assert.notEqual(bridge.event_digest, distractor.event_digest);
  return { controller, opened, archive, refs: { a0, a1, a3, bridge, distractor }, causalCut, earlyCut };
}

function adapter(f, relationships = async () => []) {
  return createScopedContextComparison({ controller: f.controller, binaryPath: binary,
    binarySha256, resolveSource: async ({ source_ref }) => f.archive.get(source_ref), relationships });
}
function request(f, overrides = {}) {
  return { task_ref: f.opened.task_ref, causal_cut: f.causalCut, agent: 'agent', scope: 'alpha',
    anchor_event_refs: [f.refs.a0.event_digest], steps: 2, node_budget: 2, k: 1,
    output_bytes: 1024, ...overrides };
}

test('fixed keyless oracle: scoped diffusion finds relevant source; flat recency selects distractor', async t => {
  const f = await fixture(t);
  const r = f.refs;
  const realView = await f.controller.view(f.opened.task_ref, 'agent', f.causalCut, 65_536);
  assert.deepEqual(realView.scopes, ['alpha']);
  assert.equal(realView.context_refs.length, 4);
  // The controller will never give one worker two live scopes. This hostile
  // view is only an adapter-level stress fixture for the kernel's traversal
  // gate; it is not a production controller response.
  const bridgeView = { ...realView, scopes: ['alpha', 'beta'], context_refs: [
    ...realView.context_refs, {
      event_digest: r.bridge.event_digest, kind: 'observation', scope: 'beta',
      causal_parents: [], artifact_sha256: null, claim_sha256: null,
      receipt_sha256: r.bridge.source_ref, evidence_status: 'proposed',
    },
  ] };
  const syntheticController = { view: async () => bridgeView };
  const bridgeEdges = async () => [
    { from_ref: r.a0.event_digest, to_ref: r.bridge.event_digest, weight: 8 },
    { from_ref: r.bridge.event_digest, to_ref: r.distractor.event_digest, weight: 8 },
  ];
  const withBridge = await createScopedContextComparison({ controller: syntheticController,
    binaryPath: binary, binarySha256, relationships: bridgeEdges,
    resolveSource: async ({ source_ref }) => f.archive.get(source_ref),
  }).compare(request(f));
  const withoutBridge = await adapter(f).compare(request(f));
  assert.equal(withBridge.flat.refs[0].event_digest, r.distractor.event_digest);
  assert.equal(withBridge.diffusion.refs[0].event_digest, r.a3.event_digest);
  assert.equal(withoutBridge.flat.refs[0].event_digest, r.distractor.event_digest);
  assert.equal(withoutBridge.diffusion.refs[0].event_digest, r.a3.event_digest);
  assert.deepEqual(withBridge.diffusion.refs, withoutBridge.diffusion.refs);
  assert.equal(withBridge.cost.candidate_events, 5);
  assert.equal(withoutBridge.cost.candidate_events, 4);
  assert.equal(withBridge.cost.scoped_sources, 4);
  assert.equal(withBridge.cost.view_truncated, false);
  assert.equal(withBridge.cost.graph_edges > withoutBridge.cost.graph_edges, true);
  assert.equal(withBridge.flat.output_bytes, withBridge.diffusion.output_bytes);
  for (const selected of [...withBridge.flat.refs, ...withBridge.diffusion.refs])
    assert.equal(selected.scope, 'alpha');
  for (const name of ['view_ms', 'source_ms', 'graph_ms', 'flat_ms', 'native_ms', 'total_ms'])
    assert.ok(Number.isFinite(withBridge.cost[name]) && withBridge.cost[name] >= 0);
  assert.ok(withBridge.cost.total_ms < 5000);
  assert.ok(withBridge.cost.native_input_bytes > 0);
  assert.ok(withBridge.cost.source_bytes_read > 0);
  const relevant = r.a3.event_digest;
  const precisionAtOne = items => Number(items[0]?.event_digest === relevant);
  const score = { flat_precision_at_1: precisionAtOne(withBridge.flat.refs),
    diffusion_precision_at_1: precisionAtOne(withBridge.diffusion.refs),
    cost: withBridge.cost };
  assert.equal(score.flat_precision_at_1, 0);
  assert.equal(score.diffusion_precision_at_1, 1);
  t.diagnostic(`keyless fixed comparison ${JSON.stringify(score)}`);
});

test('older causal cut omits later source; unauthorized agent and scope fail closed', async t => {
  const f = await fixture(t);
  const atEarlierCut = await adapter(f).compare(request(f, { causal_cut: f.earlyCut }));
  assert.equal(atEarlierCut.cost.candidate_events, 3);
  assert.ok(!atEarlierCut.flat.refs.some(row => row.event_digest === f.refs.distractor.event_digest));
  await assert.rejects(adapter(f).compare(request(f, { agent: 'stranger' })), /no grant at causal cut/);
  await assert.rejects(adapter(f).compare(request(f, { scope: 'gamma' })), /authenticated task, cut, or scope/);
  await assert.rejects(adapter(f).compare(request(f, { causal_cut: 'f'.repeat(64) })), /causal cut is not admitted/);
});

test('source, event identity, and native binary pins cannot be confused across scopes', async t => {
  const f = await fixture(t);
  const wrongSource = createScopedContextComparison({ controller: f.controller,
    binaryPath: binary, binarySha256, resolveSource: async () => Buffer.from('wrong'),
  });
  await assert.rejects(wrongSource.compare(request(f)), /source bytes differ/);
  const wrongBinary = createScopedContextComparison({ controller: f.controller,
    binaryPath: binary, binarySha256: 'f'.repeat(64),
    resolveSource: async ({ source_ref }) => f.archive.get(source_ref),
  });
  await assert.rejects(wrongBinary.compare(request(f)), /binary differs from host pin/);
  const unknownEdge = adapter(f, async () => [{
    from_ref: f.refs.a0.event_digest, to_ref: f.refs.bridge.event_digest, weight: 8,
  }]);
  await assert.rejects(unknownEdge.compare(request(f)), /event outside the view/);
  const duplicate = createScopedContextComparison({
    controller: { view: async () => ({ task_ref: f.opened.task_ref, causal_cut: f.causalCut,
      task_head: A, scopes: ['alpha', 'beta'], assignments: [], context_refs: [
        { event_digest: f.refs.a0.event_digest, scope: 'alpha', causal_parents: [],
          evidence_status: 'proposed', receipt_sha256: f.refs.a0.source_ref },
        { event_digest: f.refs.a0.event_digest, scope: 'beta', causal_parents: [],
          evidence_status: 'proposed', receipt_sha256: f.refs.a0.source_ref },
      ] }) },
    binaryPath: binary, binarySha256,
    resolveSource: async ({ source_ref }) => f.archive.get(source_ref),
  });
  await assert.rejects(duplicate.compare(request(f)), /ambiguous or unauthorized event ref/);
});
