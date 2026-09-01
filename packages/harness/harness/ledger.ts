/**
 * harness/ledger.ts — Append-only ledger for Telepathy
 *
 * Every artifact appends to ledger.jsonl before projecting to Buzz.
 * The ledger is the truth; Buzz is the skin. Only Preview URL + Bot + Card
 * ever leave harness — everything else stays in harness/.
 *
 * Ledger entry protocol:
 *   { id, ts, type, actor, payload }
 *   type ∈ ledger entries including Job contract v0 typed timeline:
 *     job.proposed | job.ready | job.activated | job.waiting | job.review_requested |
 *     job.next_actor_changed | run.linked | artifact.candidate | artifact.accepted |
 *     job.resolved | job.cancelled | plus generic reservation/task/artifact
 *
 * Append is atomic (appendFile) and immediately broadcast via socket.
 * World state (harness/state/world.json) is a projection of ledger — recomputed on append.
 * Job events are validated against contract v0 (from-state fold check, invariants) before append.
 *
 * Usage:
 *   import { append, read, watch, projectWorld } from "./ledger.ts"
 *   await append({ type: "artifact", actor: "telepathy-harness", payload: { previewUrl } })
 *
 * CLI:
 *   npx tsx harness/ledger.ts read              # cat ledger
 *   npx tsx harness/ledger.ts append '{"type":"artifact","payload":{}}'
 */

import { appendFile, readFile, mkdir, stat } from "node:fs/promises";
import { createReadStream, existsSync, readFileSync, watch as fsWatch } from "node:fs";
import { createInterface } from "node:readline";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve repo root as parent of harness/
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LEDGER_PATH = process.env.HARNESS_LEDGER_PATH
  ? join(REPO_ROOT, process.env.HARNESS_LEDGER_PATH)
  : join(REPO_ROOT, "harness/ledger.jsonl");
const WORLD_PATH = process.env.HARNESS_STATE_PATH
  ? join(REPO_ROOT, process.env.HARNESS_STATE_PATH)
  : join(REPO_ROOT, "harness/state/world.json");

export interface LedgerEntry {
  id: string;          // uuid or nanoid
  ts: string;          // ISO 8601
  type: string;        // e.g. "artifact", "reservation", "task", "preview", "card"
  actor: string;       // session or agent name, e.g. "telepathy-harness", "buzz-gateway"
  payload: unknown;    // opaque, validated by consumer
  seq?: number;        // monotonic, assigned on read
}

export interface WorldState {
  version: number;
  updatedAt: string;
  ledgerSeq: number;
  // minimal derived state — everything else is in ledger
  reservations: Record<string, unknown>;
  tasks: Record<string, unknown>;
  artifacts: Record<string, unknown>; // only preview+card leaves, full stays here
  jobs?: Record<string, unknown>; // Job fold projection (contract v0)
  lastBroadcast?: LedgerEntry;
}

function genId(): string {
  // nanoid-like without dep: 12 chars
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-6);
}

export async function ensureLedger(): Promise<void> {
  await mkdir(dirname(LEDGER_PATH), { recursive: true });
  await mkdir(dirname(WORLD_PATH), { recursive: true });
  if (!existsSync(LEDGER_PATH)) {
    await appendFile(LEDGER_PATH, "", "utf-8");
  }
  if (!existsSync(WORLD_PATH)) {
    const init: WorldState = {
      version: 0,
      updatedAt: new Date().toISOString(),
      ledgerSeq: 0,
      reservations: {},
      tasks: {},
      artifacts: {},
      jobs: {},
    };
    await mkdir(dirname(WORLD_PATH), { recursive: true });
    await appendFile(WORLD_PATH, JSON.stringify(init, null, 2), "utf-8").catch(async () => {
      // if file exists but empty, write
      const { writeFile } = await import("node:fs/promises");
      await writeFile(WORLD_PATH, JSON.stringify(init, null, 2), "utf-8");
    });
    // ensure valid JSON
    try {
      JSON.parse(readFileSync(WORLD_PATH, "utf-8"));
    } catch {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(WORLD_PATH, JSON.stringify(init, null, 2), "utf-8");
    }
  }
}

/**
 * Append an entry to ledger.jsonl atomically.
 * Assigns id/ts if missing, validates Job contract v0 events before append,
 * then appends and projects world.
 * Throws on invalid Job transition (caller should surface error, not append).
 */
export async function append(entry: Partial<LedgerEntry> & { type: string; payload: unknown }): Promise<LedgerEntry> {
  await ensureLedger();
  const full: LedgerEntry = {
    id: entry.id ?? genId(),
    ts: entry.ts ?? new Date().toISOString(),
    type: entry.type,
    actor: entry.actor ?? process.env.HARNESS_ACTOR ?? "harness",
    payload: entry.payload,
  };

  // ── Job contract v0 validation (from-state fold check) ──
  // Only typed Job timeline events are validated; generic reservation/task/artifact bypass.
  const jobTypes = new Set([
    "job.proposed",
    "job.ready",
    "job.activated",
    "job.waiting",
    "job.review_requested",
    "job.next_actor_changed",
    "run.linked",
    "artifact.candidate",
    "artifact.accepted",
    "job.resolved",
    "job.cancelled",
  ]);
  if (jobTypes.has(full.type)) {
    // Lazy import to avoid circular deps — jobs.ts has no ledger import that would cycle?
    // It does import LedgerEntry type only, so safe to import dynamically.
    const { validateJobEvent } = await import("./jobs.ts");
    const all = await read();
    const result = validateJobEvent(full, all);
    if (!result.ok) {
      throw new Error(result.error);
    }
  }

  const line = JSON.stringify(full) + "\n";
  await appendFile(LEDGER_PATH, line, "utf-8");
  // project world async (best-effort, non-blocking error)
  projectWorld(full).catch((e) => console.error("[ledger] projectWorld failed:", e));
  return full;
}

/**
 * Read all entries sequentially. Large ledger: streams, not loads all in memory naively.
 */
export async function read(): Promise<LedgerEntry[]> {
  await ensureLedger();
  const content = await readFile(LEDGER_PATH, "utf-8").catch(() => "");
  if (!content.trim()) return [];
  const lines = content.trim().split("\n");
  const entries: LedgerEntry[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      const e = JSON.parse(line) as LedgerEntry;
      e.seq = i;
      entries.push(e);
    } catch (e) {
      console.warn(`[ledger] skip malformed line ${i}:`, line.slice(0, 200));
    }
  }
  return entries;
}

/**
 * Stream read — calls onEntry for each entry without loading all.
 */
export async function streamRead(onEntry: (e: LedgerEntry, seq: number) => void): Promise<void> {
  await ensureLedger();
  if (!existsSync(LEDGER_PATH)) return;
  const rl = createInterface({ input: createReadStream(LEDGER_PATH, "utf-8"), crlfDelay: Infinity });
  let seq = 0;
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const e = JSON.parse(trimmed) as LedgerEntry;
      e.seq = seq;
      onEntry(e, seq);
    } catch {}
    seq++;
  }
}

/**
 * Watch ledger file for changes — calls cb when new entries appended.
 * Uses fsWatch with debounce.
 */
export function watch(cb: (entry: LedgerEntry) => void): { close: () => void } {
  let lastSize = 0;
  try {
    lastSize = existsSync(LEDGER_PATH) ? readFileSync(LEDGER_PATH, "utf-8").length : 0;
  } catch { lastSize = 0; }

  let debounce: NodeJS.Timeout | null = null;
  const schedule = async () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(async () => {
      try {
        const content = readFileSync(LEDGER_PATH, "utf-8");
        if (content.length <= lastSize) return;
        const newContent = content.slice(lastSize);
        lastSize = content.length;
        const lines = newContent.trim().split("\n").filter(Boolean);
        for (const line of lines) {
          try {
            const e = JSON.parse(line) as LedgerEntry;
            cb(e);
          } catch {}
        }
      } catch {}
    }, 50);
  };

  // Use fs.watch (node:fs) with callback; fallback to polling
  let watcher: { close: () => void } | null = null;
  try {
    const fw = fsWatch(LEDGER_PATH, () => schedule());
    watcher = { close: () => fw.close() };
  } catch {
    const interval = setInterval(schedule, 500);
    watcher = { close: () => clearInterval(interval) };
  }

  // also poll every 1s as safety net for editors that replace file
  const poll = setInterval(schedule, 1000);

  return {
    close: () => {
      if (debounce) clearTimeout(debounce);
      clearInterval(poll);
      watcher?.close();
    },
  };
}

/**
 * Project ledger → world.json.
 * Minimal: bump version, update ledgerSeq, store last entry by type.
 * Includes Job fold projection (contract v0) into world.jobs.
 */
export async function projectWorld(lastEntry?: LedgerEntry): Promise<WorldState> {
  await ensureLedger();
  let world: WorldState;
  try {
    const raw = await readFile(WORLD_PATH, "utf-8");
    world = JSON.parse(raw) as WorldState;
  } catch {
    world = { version: 0, updatedAt: new Date().toISOString(), ledgerSeq: 0, reservations: {}, tasks: {}, artifacts: {}, jobs: {} };
  }
  // ensure jobs map exists
  if (!world.jobs) world.jobs = {};
  const entries = lastEntry ? [lastEntry] : await read();
  const seq = entries.length ? (await read()).length : world.ledgerSeq;
  world.version += 1;
  world.updatedAt = new Date().toISOString();
  world.ledgerSeq = seq;
  if (lastEntry) {
    world.lastBroadcast = lastEntry;
    // categorize
    if (lastEntry.type === "reservation" || lastEntry.type === "reservation:update") {
      const payload = lastEntry.payload as Record<string, unknown>;
      const key = (payload?.pattern as string) ?? lastEntry.id;
      world.reservations[key] = lastEntry;
    } else if (lastEntry.type === "task") {
      const payload = lastEntry.payload as Record<string, unknown>;
      const key = (payload?.id as string) ?? lastEntry.id;
      world.tasks[key] = lastEntry;
    } else if (lastEntry.type === "artifact" || lastEntry.type === "preview" || lastEntry.type === "card") {
      const payload = lastEntry.payload as Record<string, unknown>;
      const key = (payload?.id as string) ?? lastEntry.id;
      world.artifacts[key] = lastEntry;
    }
    // Job timeline projection
    const jobTypes = new Set([
      "job.proposed",
      "job.ready",
      "job.activated",
      "job.waiting",
      "job.review_requested",
      "job.next_actor_changed",
      "run.linked",
      "artifact.candidate",
      "artifact.accepted",
      "job.resolved",
      "job.cancelled",
    ]);
    if (jobTypes.has(lastEntry.type)) {
      const payload = lastEntry.payload as Record<string, unknown>;
      const jobId = (payload?.job_id as string) ?? (payload?.jobId as string);
      if (jobId) {
        try {
          const { foldJob } = await import("./jobs.ts");
          const all = await read();
          const job = foldJob(String(jobId), all);
          if (job) {
            world.jobs[String(jobId)] = job;
          }
        } catch (e) {
          console.warn("[ledger] job fold failed:", e);
        }
      }
    }
  } else {
    // full rebuild: recompute all jobs from ledger when no lastEntry
    try {
      const { listJobs } = await import("./jobs.ts");
      const all = await read();
      const jobs = listJobs(all);
      world.jobs = {};
      for (const j of jobs) world.jobs[j.id] = j;
    } catch {}
  }
  const { writeFile } = await import("node:fs/promises");
  await writeFile(WORLD_PATH, JSON.stringify(world, null, 2), "utf-8");
  return world;
}

export async function readWorld(): Promise<WorldState> {
  await ensureLedger();
  try {
    const raw = await readFile(WORLD_PATH, "utf-8");
    return JSON.parse(raw) as WorldState;
  } catch {
    return { version: 0, updatedAt: new Date().toISOString(), ledgerSeq: 0, reservations: {}, tasks: {}, artifacts: {}, jobs: {} };
  }
}

// CLI entry when run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2];
  if (cmd === "read") {
    const entries = await read();
    console.log(JSON.stringify(entries, null, 2));
  } else if (cmd === "append") {
    const json = process.argv[3];
    if (!json) {
      console.error("usage: tsx harness/ledger.ts append '{\"type\":\"artifact\",\"payload\":{}}'");
      process.exit(1);
    }
    const obj = JSON.parse(json);
    const e = await append(obj);
    console.log(JSON.stringify(e, null, 2));
  } else if (cmd === "world") {
    const w = await readWorld();
    console.log(JSON.stringify(w, null, 2));
  } else {
    console.log("harness/ledger.ts — append-only ledger");
    console.log("  read   — cat ledger.jsonl as JSON");
    console.log("  world  — cat state/world.json");
    console.log("  append '<json>' — append entry");
  }
}
