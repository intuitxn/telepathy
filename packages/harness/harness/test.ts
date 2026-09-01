/**
 * harness/test.ts — 2-client sync test for harness socket
 *
 * Spins ephemeral server on random free port, connects 2 WS clients,
 * verifies: ledger:append broadcast, reservation wrapper via socket,
 * and file:change broadcast via chokidar watch.
 *
 * Run: npm run test:harness
 *      npm run test:harness -- --port 8787   # against live server
 *      npx tsx harness/test.ts --verbose --port 8787
 */

import { WebSocket } from "ws";
import { createServer, startFileWatch, startLedgerWatch } from "./socket.ts";
import { appendFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomInt } from "node:crypto";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const verbose = process.argv.includes("--verbose") || process.argv.includes("-v");
const externalPortArg = process.argv.find((a) => a.startsWith("--port"));
const externalPort = externalPortArg ? parseInt(externalPortArg.split("=")[1] ?? process.argv[process.argv.indexOf(externalPortArg) + 1], 10) : null;

function log(...args: unknown[]) {
  if (verbose) console.log("[test]", ...args);
}
function info(...args: unknown[]) {
  console.log(...args);
}

function waitForMessage(ws: WebSocket, predicate: (msg: any) => boolean, timeoutMs = 3000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", handler);
      reject(new Error(`timeout waiting for message after ${timeoutMs}ms`));
    }, timeoutMs);
    const handler = (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (predicate(msg)) {
          clearTimeout(timer);
          ws.off("message", handler);
          resolve(msg);
        }
      } catch {}
    };
    ws.on("message", handler);
  });
}

function onceOpen(ws: WebSocket, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve();
    const timer = setTimeout(() => reject(new Error("ws open timeout")), timeoutMs);
    ws.once("open", () => { clearTimeout(timer); resolve(); });
    ws.once("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

async function getFreePort(): Promise<number> {
  // ephemral: bind 0 and read, or random high
  // simpler: random in 18000-28000 and retry
  return 18000 + randomInt(10000);
}

async function run() {
  let wss: ReturnType<typeof createServer> | null = null;
  let port = externalPort;

  if (!port) {
    // find free port by trying
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = await getFreePort();
      try {
        wss = createServer(candidate, "127.0.0.1");
        await new Promise<void>((resolve, reject) => {
          wss!.once("listening", () => resolve());
          wss!.once("error", reject);
          setTimeout(() => reject(new Error("listen timeout")), 2000);
        });
        port = candidate;
        break;
      } catch (e: any) {
        log(`port ${candidate} busy, retry:`, e.message);
        try { wss?.close(); } catch {}
        wss = null;
      }
    }
    if (!port || !wss) {
      console.error("failed to start ephemeral harness server after 10 attempts");
      process.exit(1);
    }
    // start watchers explicitly for ephemeral server (auto-start only when run as main)
    const fw = startFileWatch();
    startLedgerWatch();
    // wait for chokidar ready + debounce settle
    if (fw) {
      await new Promise<void>((resolve) => {
        let done = false;
        const to = setTimeout(() => { if (!done) { done = true; resolve(); } }, 2500);
        (fw as any).once?.("ready", () => {
          if (!done) { done = true; clearTimeout(to); log("file watcher ready"); setTimeout(resolve, 350); }
        });
      });
    } else {
      await new Promise((r) => setTimeout(r, 800));
    }
  }

  info(`[test] harness ${externalPort ? "external" : "ephemeral"} ws://127.0.0.1:${port} ${verbose ? "(verbose)" : ""}`);

  const url = `ws://127.0.0.1:${port}`;
  const wsA = new WebSocket(url, { headers: { "x-actor": "test-client-A" } });
  const wsB = new WebSocket(url, { headers: { "x-actor": "test-client-B" } });
  // avoid MaxListeners warning from many waiters
  wsA.setMaxListeners(50);
  wsB.setMaxListeners(50);

  const messagesA: any[] = [];
  const messagesB: any[] = [];
  wsA.on("message", (raw) => { try { messagesA.push(JSON.parse(raw.toString())); } catch {} });
  wsB.on("message", (raw) => { try { messagesB.push(JSON.parse(raw.toString())); } catch {} });

  await Promise.all([onceOpen(wsA), onceOpen(wsB)]);
  log("both clients connected, waiting for hello");
  await new Promise((r) => setTimeout(r, 350)); // hello + tail

  // check hello received
  const helloA = messagesA.find((m) => m.payload?.hello);
  const helloB = messagesB.find((m) => m.payload?.hello);
  if (!helloA || !helloB) {
    console.error("FAIL: hello not received", { helloA, helloB });
    process.exit(1);
  }
  info("✓ hello + world sync (both clients got hello)");

  // --- Test 1: ledger:append from A → B receives broadcast ---
  const testArtifactId = `test-${Date.now()}`;
  const appendPayload = { type: "artifact", payload: { id: testArtifactId, previewUrl: `https://telepathy.intuitxn.com/preview/${testArtifactId}`, note: "test sync" } };

  // Prepare waiters BEFORE send to avoid race
  const bWaitsLedger = waitForMessage(wsB, (m) => m.type === "broadcast" && m.event === "ledger:append" && m.payload?.payload?.id === testArtifactId, 4000);
  const aWaitsAck = waitForMessage(wsA, (m) => m.type === "ack" && m.payload?.payload?.id === testArtifactId, 3000);
  const aWaitsBroadcast = waitForMessage(wsA, (m) => m.type === "broadcast" && m.event === "ledger:append" && m.payload?.payload?.id === testArtifactId, 4000);

  wsA.send(JSON.stringify({ id: "test-ledger-1", type: "ledger:append", payload: appendPayload }));

  const ack = await aWaitsAck.catch((e) => { console.error("FAIL: A ack timeout", e); process.exit(1); });
  log("A ack:", ack.payload?.id);
  const bcB = await bWaitsLedger.catch((e) => { console.error("FAIL: B ledger broadcast timeout", e, "messagesB tail:", messagesB.slice(-5)); process.exit(1); });
  log("B broadcast:", bcB.payload?.id);
  const bcA = await aWaitsBroadcast.catch((e) => { console.error("FAIL: A ledger broadcast timeout", e); process.exit(1); });
  info(`✓ ledger:append sync (A appended ${testArtifactId} → B received broadcast in ${messagesB.length} msgs)`);

  // also verify ledger:read works
  wsA.send(JSON.stringify({ id: "test-read-1", type: "ledger:read", payload: { limit: 5 } }));
  const readAck = await waitForMessage(wsA, (m) => m.id === "test-read-1" && m.type === "ack", 3000);
  if (!Array.isArray(readAck.payload)) {
    console.error("FAIL: ledger:read not array", readAck);
    process.exit(1);
  }
  info(`✓ ledger:read (${readAck.payload.length} entries)`);

  // --- Test 2: reservation wrapper via socket ---
  const pattern = `workspaces/_test-reserve-${Date.now()}`;
  const reserveBWait = waitForMessage(wsB, (m) => m.type === "broadcast" && m.event === "reservation:update" && m.payload?.reservation?.pattern === pattern, 4000);
  wsA.send(JSON.stringify({ id: "test-reserve-1", type: "reserve", payload: { pattern, mode: "exclusive", note: "test harness" } }));
  const reserveAck = await waitForMessage(wsA, (m) => m.id === "test-reserve-1" && m.type === "ack", 3000).catch((e) => { console.error("FAIL: reserve ack timeout", e); process.exit(1); });
  log("reserve ack:", reserveAck.payload);
  const reserveBroadcast = await reserveBWait.catch((e) => { console.error("FAIL: reservation broadcast timeout", e); process.exit(1); });
  info(`✓ reservation wrapper (A reserved ${pattern} → B got update, holder=${reserveAck.payload?.holder})`);

  // B trying to reserve same exclusive should conflict
  wsB.send(JSON.stringify({ id: "test-reserve-conflict", type: "reserve", payload: { pattern, mode: "exclusive", note: "conflict attempt" } }));
  const conflict = await waitForMessage(wsB, (m) => m.id === "test-reserve-conflict" && m.type === "error", 3000).catch((e) => { console.error("FAIL: expected conflict error not received", e); process.exit(1); });
  if (!String(conflict.payload?.error).includes("conflict")) {
    console.error("FAIL: conflict error not containing conflict", conflict);
    process.exit(1);
  }
  info(`✓ reservation conflict detected (B exclusive on same pattern correctly rejected)`);

  // list_reservations
  wsB.send(JSON.stringify({ id: "test-list-1", type: "list_reservations", payload: {} }));
  const listAck = await waitForMessage(wsB, (m) => m.id === "test-list-1" && m.type === "ack", 3000);
  if (!Array.isArray(listAck.payload) || !listAck.payload.some((r: any) => r.pattern === pattern)) {
    console.error("FAIL: list_reservations missing", listAck);
    process.exit(1);
  }
  info(`✓ list_reservations (${listAck.payload.length} active)`);

  // release from A → B gets update
  const releaseBWait = waitForMessage(wsB, (m) => m.type === "broadcast" && m.event === "reservation:update" && m.payload?.action === "release" && m.payload?.reservation?.pattern === pattern, 4000);
  wsA.send(JSON.stringify({ id: "test-release-1", type: "release", payload: { pattern } }));
  await waitForMessage(wsA, (m) => m.id === "test-release-1" && m.type === "ack", 3000).catch((e) => { console.error("FAIL: release ack", e); process.exit(1); });
  await releaseBWait.catch((e) => { console.error("FAIL: release broadcast", e); process.exit(1); });
  info(`✓ release + broadcast (A released ${pattern} → B notified)`);

  // --- Test 3: file watch → broadcast ---
  // Only runs when we own the server (ephemeral). External server may not watch same path, skip.
  if (!externalPort) {
    const testFile = join(REPO_ROOT, "workspaces", "_test-sync.json");
    await mkdir(dirname(testFile), { recursive: true });
    const fileBWait = waitForMessage(wsB, (m) => m.type === "broadcast" && m.event === "file:change" && String(m.payload?.path).includes("_test-sync.json"), 5000);
    const fileAWait = waitForMessage(wsA, (m) => m.type === "broadcast" && m.event === "file:change" && String(m.payload?.path).includes("_test-sync.json"), 5000);
    await writeFile(testFile, JSON.stringify({ ping: Date.now(), from: "test" }, null, 2), "utf-8");
    log("wrote", testFile);
    const fb = await fileBWait.catch((e) => { console.error("FAIL: file:change B timeout", e, "recent B:", messagesB.slice(-3)); process.exit(1); });
    const fa = await fileAWait.catch((e) => { console.error("FAIL: file:change A timeout", e); process.exit(1); });
    info(`✓ file watch sync (workspaces/_test-sync.json → both clients got file:change)`);
    log("file broadcasts:", fa.payload?.path, fb.payload?.path);
    // cleanup
    try { await unlink(testFile); } catch {}
    await new Promise((r) => setTimeout(r, 300)); // let unlink broadcast settle
  } else {
    info(`⊘ file watch test skipped (--port external, watcher owned by external process)`);
  }

  // --- Test 4: state:get ---
  wsA.send(JSON.stringify({ id: "test-state-1", type: "state:get", payload: {} }));
  const stateAck = await waitForMessage(wsA, (m) => m.id === "test-state-1" && m.type === "ack", 3000);
  if (typeof stateAck.payload?.ledgerSeq !== "number") {
    console.error("FAIL: state:get malformed", stateAck);
    process.exit(1);
  }
  info(`✓ state:get (ledgerSeq=${stateAck.payload.ledgerSeq}, version=${stateAck.payload.version})`);

  // ──────────────────────────────────────────────────────────────────────────
  // Job contract v0 tests — valid trace + invalid rejections
  // ──────────────────────────────────────────────────────────────────────────

  // Helpers for Job validation via socket ledger:append
  const nowIso = () => new Date().toISOString();
  async function jobAppend(ws: WebSocket, id: string, entryType: string, payload: any): Promise<{ ok: boolean; ack?: any; error?: any }> {
    const msgId = id;
    const waiterAck = waitForMessage(ws, (m) => m.id === msgId && m.type === "ack", 4000).then((m) => ({ ok: true as const, ack: m })).catch(() => null);
    const waiterErr = waitForMessage(ws, (m) => m.id === msgId && m.type === "error", 4000).then((m) => ({ ok: false as const, error: m })).catch(() => null);
    ws.send(JSON.stringify({ id: msgId, type: "ledger:append", payload: { type: entryType, payload } }));
    // race ack vs error
    const result = await Promise.race([
      waiterAck.then((v) => v ?? new Promise(() => {})),
      waiterErr.then((v) => v ?? new Promise(() => {})),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timeout waiting for ${entryType} ${id}`)), 4200)),
    ]) as any;
    // ensure the other waiter is cleaned up by waiting a tick
    await new Promise((r) => setTimeout(r, 80));
    if (result && result.ok !== undefined) return result;
    throw new Error(`no ack/error for ${entryType} ${id}`);
  }

  function assertOk(res: any, label: string) {
    if (!res.ok) {
      console.error(`FAIL: ${label} expected ack but got error:`, res.error?.payload);
      process.exit(1);
    }
    return res.ack;
  }
  function assertError(res: any, label: string, mustContain?: string) {
    if (res.ok) {
      console.error(`FAIL: ${label} expected error but got ack:`, res.ack?.payload);
      process.exit(1);
    }
    if (mustContain && !String(res.error?.payload?.error ?? "").includes(mustContain)) {
      console.error(`FAIL: ${label} error mismatch, expected to contain "${mustContain}" got:`, res.error?.payload);
      process.exit(1);
    }
    return res.error;
  }

  const Shubham = { kind: "human", id: "shubham", label: "Shubham" } as const;
  const Om = { kind: "human", id: "om", label: "Om" } as const;
  const Kush = { kind: "human", id: "kush", label: "Kush" } as const;
  const workspaceSyncActor = { kind: "agent", id: "workspace-sync", label: "workspace-sync" } as const;
  const harnessAgent = { kind: "agent", id: "telepathy-harness", label: "telepathy-harness" } as const;

  // --- Valid trace: Shubham–Om–Kush–agents example end-to-end ---
  const jobId = `ex-telepathy-preview-${Date.now()}`;
  info(`\n[Job v0] valid trace ${jobId} — Proposed→Ready→Active→Waiting→Active→Candidate→Review→Accepted→Resolved`);

  let res: any;
  res = await jobAppend(wsA, `job-${jobId}-proposed`, "job.proposed", {
    job_id: jobId,
    to: "Proposed",
    title: "Validate Telepathy preview flow",
    objective: "localhost-only socket; typed events; tests pass",
    next_actor: Om,
    project_id: "telepathy",
  });
  assertOk(res, "job.proposed");
  info("  ✓ job.proposed → Proposed next_actor=Om");

  res = await jobAppend(wsA, `job-${jobId}-ready`, "job.ready", {
    job_id: jobId,
    from: "Proposed",
    to: "Ready",
    acceptance: ["localhost-only socket", "typed events", "tests pass"],
    owner: workspaceSyncActor,
    reviewer: Om,
    next_actor: workspaceSyncActor,
    title: "Validate Telepathy preview flow",
    objective: "localhost-only socket; typed events; tests pass",
  });
  assertOk(res, "job.ready");
  info("  ✓ job.ready → Ready owner=workspace-sync reviewer=Om");

  res = await jobAppend(wsA, `job-${jobId}-run-worker`, "run.linked", {
    job_id: jobId,
    run: { provider: "agent-manager", session_id: "f5d1145f", role: "worker", linked_at: nowIso(), session_name_snapshot: "workspace-sync" },
  });
  assertOk(res, "run.linked worker");
  info("  ✓ run.linked worker f5d1145f");

  res = await jobAppend(wsA, `job-${jobId}-activated1`, "job.activated", {
    job_id: jobId,
    from: "Ready",
    to: "Active",
    next_actor: workspaceSyncActor,
    reason: "start work",
  });
  assertOk(res, "job.activated Ready→Active");
  info("  ✓ job.activated Ready→Active");

  res = await jobAppend(wsA, `job-${jobId}-waiting`, "job.waiting", {
    job_id: jobId,
    from: "Active",
    to: "Waiting",
    waiting_reason: { kind: "decision", detail: "Kush must confirm localhost-only scope", blocked_on: ["decision:kush-scope"], resume_to: "Active" },
    next_actor: Kush,
  });
  assertOk(res, "job.waiting Active→Waiting");
  info("  ✓ job.waiting → Waiting resume_to Active next_actor=Kush");

  res = await jobAppend(wsA, `job-${jobId}-activated2`, "job.activated", {
    job_id: jobId,
    from: "Waiting",
    to: "Active",
    next_actor: workspaceSyncActor,
    reason: "Kush confirmed localhost only; tailnet deferred",
  });
  assertOk(res, "job.activated Waiting→Active");
  info("  ✓ job.activated Waiting→Active (resume_to enforced)");

  const artId = "preview-v1";
  const artRev = "v1";
  res = await jobAppend(wsA, `job-${jobId}-candidate`, "artifact.candidate", {
    job_id: jobId,
    artifact: {
      id: artId,
      kind: "preview",
      ref: `harness/artifacts/${jobId}-${artId}-${artRev}.json`,
      revision: artRev,
      state: "Candidate",
      produced_by: workspaceSyncActor,
      proposed_at: nowIso(),
      run_session_id: "f5d1145f",
    },
  });
  assertOk(res, "artifact.candidate");
  info("  ✓ artifact.candidate preview-v1 v1");

  res = await jobAppend(wsA, `job-${jobId}-run-reviewer`, "run.linked", {
    job_id: jobId,
    run: { provider: "agent-manager", session_id: "8bda7e6d", role: "reviewer", linked_at: nowIso(), session_name_snapshot: "telepathy-harness" },
  });
  assertOk(res, "run.linked reviewer");
  info("  ✓ run.linked reviewer 8bda7e6d");

  res = await jobAppend(wsA, `job-${jobId}-review`, "job.review_requested", {
    job_id: jobId,
    from: "Active",
    to: "Review",
    candidate_artifact_ids: [artId],
    next_actor: Om,
  });
  assertOk(res, "job.review_requested Active→Review");
  info("  ✓ job.review_requested → Review next_actor=Om");

  res = await jobAppend(wsA, `job-${jobId}-accepted`, "artifact.accepted", {
    job_id: jobId,
    artifact_id: artId,
    revision: artRev,
    accepted_by: Om,
    accepted_at: nowIso(),
    evidence: "preview validated localhost-only",
  });
  assertOk(res, "artifact.accepted");
  info("  ✓ artifact.accepted preview-v1/v1 by Om (append-only id+revision)");

  res = await jobAppend(wsA, `job-${jobId}-next-actor`, "job.next_actor_changed", {
    job_id: jobId,
    state: "Review",
    from_actor: Om,
    to_actor: Shubham,
    reason: "Om approved, Shubham to close",
  });
  assertOk(res, "job.next_actor_changed");
  info("  ✓ job.next_actor_changed Review Om→Shubham");

  res = await jobAppend(wsA, `job-${jobId}-resolved`, "job.resolved", {
    job_id: jobId,
    from: "Review",
    to: "Resolved",
    resolution: {
      outcome: "completed",
      summary: "Local preview flow validated; tailnet remains out of scope",
      accepted_artifact_ids: [artId],
      resolved_by: Shubham,
      resolved_at: nowIso(),
    },
    next_actor: null,
  });
  assertOk(res, "job.resolved");
  info("  ✓ job.resolved Review→Resolved (accepted artifact + ResolutionRecord)");

  // Verify fold via state:get world.jobs
  wsA.send(JSON.stringify({ id: "test-job-state", type: "state:get", payload: {} }));
  const jobWorld = await waitForMessage(wsA, (m) => m.id === "test-job-state" && m.type === "ack", 3000);
  const jobFold = jobWorld.payload?.jobs?.[jobId] as any;
  if (!jobFold || jobFold.state !== "Resolved" || jobFold.next_actor !== null) {
    console.error("FAIL: job fold after resolved not Resolved/null", jobFold);
    process.exit(1);
  }
  if (!Array.isArray(jobFold.artifacts) || !jobFold.artifacts.some((a: any) => a.id === artId && a.state === "Accepted")) {
    console.error("FAIL: job fold missing Accepted artifact", jobFold);
    process.exit(1);
  }
  info(`  ✓ fold verified Resolved next_actor=null artifacts Accepted`);

  // --- Invalid rejections (all must return error, not appended) ---
  info(`\n[Job v0] invalid rejections — all must be rejected before append`);

  // Helper to create a fresh job for invalid tests in Proposed
  async function createProposed(jobId: string) {
    const r = await jobAppend(wsA, `job-${jobId}-proposed`, "job.proposed", {
      job_id: jobId,
      to: "Proposed",
      title: `Invalid test ${jobId}`,
      objective: "test invalid",
      next_actor: Om,
    });
    assertOk(r, `proposed ${jobId}`);
  }

  // 1) job.resolved without Accepted artifact
  const inv1 = `inv-no-accepted-${Date.now()}-1`;
  await createProposed(inv1);
  let r2: any;
  r2 = await jobAppend(wsA, `job-${inv1}-ready`, "job.ready", {
    job_id: inv1,
    from: "Proposed",
    to: "Ready",
    acceptance: ["a"],
    owner: workspaceSyncActor,
    reviewer: Om,
    next_actor: workspaceSyncActor,
  });
  assertOk(r2, "ready inv1");
  r2 = await jobAppend(wsA, `job-${inv1}-activated`, "job.activated", {
    job_id: inv1,
    from: "Ready",
    to: "Active",
    next_actor: workspaceSyncActor,
  });
  assertOk(r2, "activated inv1");
  r2 = await jobAppend(wsA, `job-${inv1}-candidate`, "artifact.candidate", {
    job_id: inv1,
    artifact: { id: "art-x", kind: "doc", ref: "ref/x", revision: "v1", state: "Candidate", produced_by: workspaceSyncActor, proposed_at: nowIso() },
  });
  assertOk(r2, "candidate inv1");
  r2 = await jobAppend(wsA, `job-${inv1}-review`, "job.review_requested", {
    job_id: inv1,
    from: "Active",
    to: "Review",
    candidate_artifact_ids: ["art-x"],
    next_actor: Om,
  });
  assertOk(r2, "review inv1");
  // Now try resolved without accepted -> must fail (accepted_artifact_ids not Accepted)
  res = await jobAppend(wsA, `job-${inv1}-resolved-fail`, "job.resolved", {
    job_id: inv1,
    from: "Review",
    to: "Resolved",
    resolution: {
      outcome: "completed",
      summary: "try without accepted",
      accepted_artifact_ids: ["art-x"],
      resolved_by: Shubham,
      resolved_at: nowIso(),
    },
    next_actor: null,
  });
  assertError(res, "resolved without Accepted should fail", "Accepted");
  info("  ✓ rejected job.resolved without Accepted artifact");

  // 2) wrong from-state: job.activated from Proposed when current is Ready
  const inv2 = `inv-wrong-from-${Date.now()}-2`;
  await createProposed(inv2);
  r2 = await jobAppend(wsA, `job-${inv2}-ready`, "job.ready", {
    job_id: inv2,
    from: "Proposed",
    to: "Ready",
    acceptance: ["a"],
    owner: workspaceSyncActor,
    reviewer: Om,
    next_actor: workspaceSyncActor,
  });
  assertOk(r2, "ready inv2");
  res = await jobAppend(wsA, `job-${inv2}-activated-wrong`, "job.activated", {
    job_id: inv2,
    from: "Proposed",
    to: "Active",
    next_actor: workspaceSyncActor,
  });
  assertError(res, "wrong from-state should fail", "from");
  info("  ✓ rejected wrong from-state (Proposed vs Ready)");

  // 3) job.waiting without waiting_reason
  const inv3 = `inv-wait-reason-${Date.now()}-3`;
  await createProposed(inv3);
  r2 = await jobAppend(wsA, `job-${inv3}-ready`, "job.ready", {
    job_id: inv3,
    from: "Proposed",
    to: "Ready",
    acceptance: ["a"],
    owner: workspaceSyncActor,
    reviewer: Om,
    next_actor: workspaceSyncActor,
  });
  assertOk(r2, "ready inv3");
  res = await jobAppend(wsA, `job-${inv3}-waiting-noreason`, "job.waiting", {
    job_id: inv3,
    from: "Ready",
    to: "Waiting",
    next_actor: Kush,
    // missing waiting_reason
  });
  assertError(res, "waiting without reason should fail", "waiting_reason");
  info("  ✓ rejected job.waiting without waiting_reason");

  // 4) job.review_requested without Candidate
  const inv4 = `inv-review-no-candidate-${Date.now()}-4`;
  await createProposed(inv4);
  r2 = await jobAppend(wsA, `job-${inv4}-ready`, "job.ready", {
    job_id: inv4,
    from: "Proposed",
    to: "Ready",
    acceptance: ["a"],
    owner: workspaceSyncActor,
    reviewer: Om,
    next_actor: workspaceSyncActor,
  });
  assertOk(r2, "ready inv4");
  r2 = await jobAppend(wsA, `job-${inv4}-activated`, "job.activated", {
    job_id: inv4,
    from: "Ready",
    to: "Active",
    next_actor: workspaceSyncActor,
  });
  assertOk(r2, "activated inv4");
  res = await jobAppend(wsA, `job-${inv4}-review-nocandidate`, "job.review_requested", {
    job_id: inv4,
    from: "Active",
    to: "Review",
    candidate_artifact_ids: ["missing-art"],
    next_actor: Om,
  });
  assertError(res, "Review without Candidate should fail", "Candidate");
  info("  ✓ rejected job.review_requested without Candidate");

  // 5) job.resolved from non-Review (Active)
  const inv5 = `inv-resolved-not-review-${Date.now()}-5`;
  await createProposed(inv5);
  r2 = await jobAppend(wsA, `job-${inv5}-ready`, "job.ready", {
    job_id: inv5,
    from: "Proposed",
    to: "Ready",
    acceptance: ["a"],
    owner: workspaceSyncActor,
    reviewer: Om,
    next_actor: workspaceSyncActor,
  });
  assertOk(r2, "ready inv5");
  r2 = await jobAppend(wsA, `job-${inv5}-activated`, "job.activated", {
    job_id: inv5,
    from: "Ready",
    to: "Active",
    next_actor: workspaceSyncActor,
  });
  assertOk(r2, "activated inv5");
  res = await jobAppend(wsA, `job-${inv5}-resolved-active`, "job.resolved", {
    job_id: inv5,
    from: "Active",
    to: "Resolved",
    resolution: {
      outcome: "completed",
      summary: "invalid from Active",
      accepted_artifact_ids: ["any"],
      resolved_by: Shubham,
      resolved_at: nowIso(),
    },
    next_actor: null,
  });
  assertError(res, "resolved from non-Review should fail", "transition");
  info("  ✓ rejected job.resolved from non-Review");

  // 6) job.cancelled without reason
  const inv6 = `inv-cancel-noreason-${Date.now()}-6`;
  await createProposed(inv6);
  res = await jobAppend(wsA, `job-${inv6}-cancel-noreason`, "job.cancelled", {
    job_id: inv6,
    from: "Proposed",
    to: "Cancelled",
    next_actor: null,
    cancelled_by: Shubham,
    // missing reason
  });
  assertError(res, "cancel without reason should fail", "reason");
  info("  ✓ rejected job.cancelled without reason");

  // 7) job.ready leaving Waiting to wrong resume_to
  const inv7 = `inv-resume-wrong-${Date.now()}-7`;
  await createProposed(inv7);
  r2 = await jobAppend(wsA, `job-${inv7}-ready1`, "job.ready", {
    job_id: inv7,
    from: "Proposed",
    to: "Ready",
    acceptance: ["a"],
    owner: workspaceSyncActor,
    reviewer: Om,
    next_actor: workspaceSyncActor,
  });
  assertOk(r2, "ready1 inv7");
  r2 = await jobAppend(wsA, `job-${inv7}-waiting`, "job.waiting", {
    job_id: inv7,
    from: "Ready",
    to: "Waiting",
    waiting_reason: { kind: "decision", detail: "need decision", resume_to: "Active" },
    next_actor: Kush,
  });
  assertOk(r2, "waiting inv7");
  res = await jobAppend(wsA, `job-${inv7}-ready-wrong`, "job.ready", {
    job_id: inv7,
    from: "Waiting",
    to: "Ready",
    acceptance: ["a"],
    owner: workspaceSyncActor,
    reviewer: Om,
    next_actor: workspaceSyncActor,
  });
  assertError(res, "wrong resume_to should fail", "leaving Waiting");
  info("  ✓ rejected leaving Waiting to wrong resume_to (was Active, tried Ready)");

  // Also verify valid cancelled works (positive)
  const validCancel = `valid-cancel-${Date.now()}`;
  await createProposed(validCancel);
  res = await jobAppend(wsA, `job-${validCancel}-cancel`, "job.cancelled", {
    job_id: validCancel,
    from: "Proposed",
    to: "Cancelled",
    reason: "out of scope",
    cancelled_by: Shubham,
    next_actor: null,
  });
  assertOk(res, "valid cancelled");
  info("  ✓ valid job.cancelled accepted");

  info("");
  info("All harness tests passed — 2 clients synced via socket ✓");
  info(`  ledger:append  → broadcast`);
  info(`  reservation    → wrapper + broadcast + conflict`);
  info(`  list + release → ok`);
  if (!externalPort) info(`  file:change  → chokidar → broadcast`);
  info(`  state:get      → world.json`);
  info(`  Job v0 valid trace → Resolved (Shubham-Om-Kush-agents) ✓`);
  info(`  Job v0 invalid rejections → all correctly rejected ✓`);

  // cleanup
  wsA.close();
  wsB.close();
  await new Promise((r) => setTimeout(r, 200));
  if (wss) {
    await new Promise<void>((resolve) => (wss as any).close(() => resolve()));
    // close watchers — socket.ts watchers are per-process; closing wss doesn't close chokidar
    // process will exit anyway
  }
  // small delay to let close propagate
  await new Promise((r) => setTimeout(r, 150));
  process.exit(0);
}

run().catch((e) => {
  console.error("harness test failed:", e);
  process.exit(1);
});
