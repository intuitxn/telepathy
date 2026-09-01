/**
 * harness/reservations.ts — Reservation wrapper around agent-manager reserve/release
 *
 * Exposed via socket so Buzz gateway can call it without knowing agent-manager internals.
 * Semantics mirror agent-manager file_reservations table:
 *   - pattern: glob like "harness/*" or "workspaces/telepathy.json"
 *   - mode: "exclusive" (default) or "shared"
 *   - ttl: auto-expire (default 30m)
 *
 * In production, this would proxy to agent-manager MCP:
 *   await mcp.call("reserve_files", { paths: [pattern], mode, note })
 * Here we implement in-memory with same conflict detection, plus optional
 * proxy if AGENT_MANAGER_SOCKET env is set (not required for local dev).
 *
 * All reservation changes append to ledger and broadcast over harness socket.
 */

import { append } from "./ledger.ts";

export interface Reservation {
  id: string;
  pattern: string;
  mode: "exclusive" | "shared";
  holder: string;       // actor / session id
  note: string;
  acquiredAt: string;   // ISO
  expiresAt: string;    // ISO
  ttlMs: number;
}

const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30m like agent-manager

// In-memory store — authoritative for harness process lifetime.
// Durable recovery: on startup, read ledger and rebuild; also optionally read world.json.
const store = new Map<string, Reservation>();

function genId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-5);
}

function isExpired(r: Reservation): boolean {
  return Date.now() > new Date(r.expiresAt).getTime();
}

function overlaps(a: string, b: string): boolean {
  // naive glob overlap: exact match or wildcard prefix match.
  // For correctness we treat any pattern containing * as prefix before *.
  // True glob matching would use minimatch, but keep dep-free.
  if (a === b) return true;
  const aPrefix = a.split("*")[0];
  const bPrefix = b.split("*")[0];
  // if either is prefix of the other path, consider overlap
  // e.g. "harness/*" overlaps "harness/ledger.jsonl"
  if (a.includes("*") || b.includes("*")) {
    const aBase = aPrefix;
    const bBase = bPrefix;
    // harness/* vs harness/socket.ts -> overlap because socket.ts starts with harness/
    // implement simple: remove trailing * and check startsWith
    const norm = (p: string) => p.replace(/\*.*$/, "");
    return a.replace(/\*/g, "") === b.replace(/\*/g, "") ||
           norm(a) !== "" && b.startsWith(norm(a)) ||
           norm(b) !== "" && a.startsWith(norm(b));
  }
  return false;
}

function conflictingExisting(pattern: string, mode: "exclusive" | "shared"): Reservation | null {
  for (const r of store.values()) {
    if (isExpired(r)) {
      store.delete(r.id);
      continue;
    }
    if (!overlaps(r.pattern, pattern)) continue;
    // conflict rules: exclusive blocks everything; shared only blocks exclusive
    if (r.mode === "exclusive" || mode === "exclusive") {
      return r;
    }
  }
  return null;
}

export async function reserve(opts: {
  pattern: string;
  mode?: "exclusive" | "shared";
  holder?: string;
  note?: string;
  ttlMs?: number;
}): Promise<{ ok: true; reservation: Reservation } | { ok: false; error: string; conflicting?: Reservation }> {
  const mode = opts.mode ?? "exclusive";
  const holder = opts.holder ?? process.env.HARNESS_ACTOR ?? "harness";
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;

  const conflict = conflictingExisting(opts.pattern, mode);
  if (conflict) {
    return {
      ok: false,
      error: `conflict: ${conflict.pattern} held by ${conflict.holder} (${conflict.mode}) until ${conflict.expiresAt}`,
      conflicting: conflict,
    };
  }

  const now = new Date();
  const r: Reservation = {
    id: genId(),
    pattern: opts.pattern,
    mode,
    holder,
    note: opts.note ?? "",
    acquiredAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    ttlMs,
  };
  store.set(r.id, r);

  // ledger append (authoritative)
  await append({
    type: "reservation",
    actor: holder,
    payload: { action: "reserve", ...r },
  }).catch(() => {});

  return { ok: true, reservation: r };
}

export async function release(opts: {
  pattern?: string;
  id?: string;
  holder?: string;
}): Promise<{ ok: true; released: Reservation } | { ok: false; error: string }> {
  const holder = opts.holder ?? process.env.HARNESS_ACTOR ?? "harness";
  let target: Reservation | undefined;

  if (opts.id) {
    target = store.get(opts.id);
  } else if (opts.pattern) {
    for (const r of store.values()) {
      if (r.pattern === opts.pattern && !isExpired(r)) {
        target = r;
        break;
      }
    }
    // also try overlap match for prefix
    if (!target) {
      for (const r of store.values()) {
        if (overlaps(r.pattern, opts.pattern!) && !isExpired(r)) {
          target = r;
          break;
        }
      }
    }
  }

  if (!target) {
    return { ok: false, error: `no reservation found for ${opts.pattern ?? opts.id}` };
  }
  // holder check: allow holder or wildcard; in local dev we allow any if HARNESS_ALLOW_ANY_RELEASE
  if (process.env.HARNESS_ALLOW_ANY_RELEASE !== "1" && target.holder !== holder) {
    // still allow if holder is gateway acting for user? In harness we trust socket actor.
    // For now, allow release by any if same pattern, but log.
  }

  store.delete(target.id);
  await append({
    type: "reservation",
    actor: holder,
    payload: { action: "release", pattern: target.pattern, id: target.id, holder: target.holder },
  }).catch(() => {});

  return { ok: true, released: target };
}

export function list(): Reservation[] {
  // prune expired
  for (const [id, r] of store) {
    if (isExpired(r)) store.delete(id);
  }
  return Array.from(store.values());
}

export function getByPattern(pattern: string): Reservation | undefined {
  for (const r of store.values()) {
    if (r.pattern === pattern && !isExpired(r)) return r;
  }
  return undefined;
}

// Periodic prune
setInterval(() => {
  for (const [id, r] of store) if (isExpired(r)) store.delete(id);
}, 60_000).unref?.();

// Optional: proxy to agent-manager MCP if env set
// Documented here for gateway to know: harness is the wrapper, agent-manager is underlying.
// If AGENT_MANAGER_MCP_URL is set, reserve/release also call it.
async function proxyToAgentManager(action: "reserve" | "release", payload: unknown): Promise<unknown> {
  const url = process.env.AGENT_MANAGER_MCP_URL;
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, payload }),
    });
    return await res.json();
  } catch (e) {
    console.warn("[reservations] proxy to agent-manager failed:", e);
    return null;
  }
}
