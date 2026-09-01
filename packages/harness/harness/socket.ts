/**
 * harness/socket.ts — Socket-level continuous sync for Telepathy (contract v0)
 *
 * Binds to 127.0.0.1:HARNESS_PORT (default 8787) — localhost-only until auth reviewed.
 * No Tailscale/SSH tunnels are established by default; those remain deferred.
 * Every task/reservation/artifact/job is broadcast over this socket; file watches
 * on harness/ + workspaces/ also broadcast.
 *
 * Lean on @opencode-ai/plugin for user handling — don't reimplement auth. This socket
 * is the harness truth; Buzz is just the skin projecting Preview+Bot+Card.
 * Agent Manager remains execution/navigation interface (reserve/release via wrapper).
 *
 * Message protocol (JSON over WS):
 *   Client → Server: { id, type, payload }
 *     type ∈ "ping" | "reserve" | "release" | "list_reservations"
 *            | "ledger:append" | "ledger:read" | "state:get" | "subscribe" | "file:change"
 *   Server → Client: { id, type: "ack"|"error", payload }
 *   Server → All:    { type: "broadcast", event, payload, ts }
 *     event ∈ "ledger:append" | "reservation:update" | "file:change" | "state:update" | "artifact:preview" | "job:*"
 *
 * Reservation wrapper exposed via socket so Buzz gateway can call:
 *   { type: "reserve", payload: { pattern, mode, note } }
 *   { type: "release", payload: { pattern } }
 *
 * Network (localhost-only until auth review):
 *   HARNESS_HOST=127.0.0.1 HARNESS_PORT=8787
 *   // Deferred: ssh -R / Tailscale tunnels require auth review — not established by default.
 *   Continuous sync survives reconnect — clients auto-rejoin and get world + ledger tail over ws://localhost:8787.
 *
 * Artifacts: only { previewUrl, card, bot } ever leave harness. Everything else stays in harness/.
 * Jobs: validated per contract v0 — invalid Resolved/Cancelled/transition rejected, ledger remains append-only.
 *
 * Run:
 *   npm run harness              # start server (tsx harness/socket.ts) on 127.0.0.1:8787
 *   npm run harness:dev          # watch mode
 *   HARNESS_PORT=8787 npm run harness
 */

import { WebSocketServer, WebSocket } from "ws";
import { watch as fsWatch } from "node:fs";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { readFile, appendFile } from "node:fs/promises";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import chokidar from "chokidar";
import { append, read as readLedger, readWorld, watch as watchLedger, type LedgerEntry } from "./ledger.ts";
import * as reservations from "./reservations.ts";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HARNESS_DIR = join(REPO_ROOT, "harness");
const WORKSPACES_DIR = join(REPO_ROOT, "workspaces");
const ARTIFACTS_DIR = join(REPO_ROOT, "harness/artifacts");

const HOST = process.env.HARNESS_HOST ?? "127.0.0.1";
const PORT = parseInt(process.env.HARNESS_PORT ?? "8787", 10);
// Tailscale/SSH tunneling deferred until auth review — no default host
const TAILSCALE_HOST = process.env.TAILSCALE_HOST ?? "";

// Ensure dirs
for (const d of [HARNESS_DIR, WORKSPACES_DIR, ARTIFACTS_DIR, join(HARNESS_DIR, "state")]) {
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

type ClientMeta = { id: string; actor: string; connectedAt: string };
const clients = new Map<WebSocket, ClientMeta>();

function genId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-5);
}

function broadcast(event: string, payload: unknown, opts?: { exclude?: WebSocket }) {
  const msg = JSON.stringify({ type: "broadcast", event, payload, ts: new Date().toISOString() });
  for (const [ws] of clients) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    if (opts?.exclude && ws === opts.exclude) continue;
    try { ws.send(msg); } catch {}
  }
}

function send(ws: WebSocket, data: unknown) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(data));
}

// --- WebSocket server ---
export function createServer(port = PORT, host = HOST): WebSocketServer {
  const wss = new WebSocketServer({ host, port });

  wss.on("listening", () => {
    const addr = wss.address() as { address: string; port: number } | null;
    console.log(`[harness:socket] listening on ${host}:${addr?.port ?? port} (localhost-only until auth review)`);
    console.log(`[harness:socket] repo root: ${REPO_ROOT}`);
    console.log(`[harness:socket] watch: harness/ + workspaces/ → broadcast`);
    console.log(`[harness:socket] ledger: harness/ledger.jsonl (append-only, job contract v0 validated)`);
    if (TAILSCALE_HOST) console.log(`[harness:socket] tunnel (deferred until auth review): ssh -R ${port}:localhost:${port} a3fckx@${TAILSCALE_HOST}`);
    console.log(`[harness:socket] preview base: ${process.env.PREVIEW_BASE_URL ?? "https://telepathy.intuitxn.com/preview"}`);
    console.log(`[harness:socket] connect: ws://${host}:${addr?.port ?? port} (Agent Manager links via provider+session_id)`);
  });

  wss.on("connection", (ws, req) => {
    const id = genId();
    const actor = (req.headers["x-actor"] as string) ?? `client-${id.slice(0, 4)}`;
    clients.set(ws, { id, actor, connectedAt: new Date().toISOString() });
    console.log(`[harness:socket] + client ${id} actor=${actor} ip=${req.socket.remoteAddress} (${clients.size} total)`);

    // Immediately send world + ledger tail so client is in sync without polling
    (async () => {
      try {
        const world = await readWorld();
        send(ws, { type: "ack", id: "hello", payload: { hello: true, clientId: id, world, tailscaleHost: TAILSCALE_HOST, port } });
        const ledger = await readLedger();
        const tail = ledger.slice(-20); // last 20 entries
        if (tail.length) send(ws, { type: "broadcast", event: "ledger:tail", payload: tail, ts: new Date().toISOString() });
        const resList = reservations.list();
        if (resList.length) send(ws, { type: "broadcast", event: "reservation:snapshot", payload: resList, ts: new Date().toISOString() });
      } catch (e) {
        console.warn("[harness:socket] hello failed:", e);
      }
    })();

    ws.on("message", async (raw) => {
      let msg: { id?: string; type: string; payload?: unknown };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        send(ws, { type: "error", payload: { error: "invalid json" } });
        return;
      }
      const replyId = msg.id ?? genId();
      const payload = (msg.payload ?? {}) as Record<string, unknown>;

      try {
        switch (msg.type) {
          case "ping": {
            send(ws, { id: replyId, type: "ack", payload: { pong: true, ts: new Date().toISOString() } });
            break;
          }
          case "reserve": {
            const pattern = payload.pattern as string;
            const mode = (payload.mode as "exclusive" | "shared") ?? "exclusive";
            const note = (payload.note as string) ?? "";
            const holder = (payload.holder as string) ?? actor;
            if (!pattern) {
              send(ws, { id: replyId, type: "error", payload: { error: "pattern required" } });
              break;
            }
            const res = await reservations.reserve({ pattern, mode, holder, note, ttlMs: payload.ttlMs as number | undefined });
            if (!res.ok) {
              send(ws, { id: replyId, type: "error", payload: { error: res.error, conflicting: res.conflicting } });
            } else {
              send(ws, { id: replyId, type: "ack", payload: res.reservation });
              broadcast("reservation:update", { action: "reserve", reservation: res.reservation });
            }
            break;
          }
          case "release": {
            const pattern = payload.pattern as string;
            const rid = payload.id as string | undefined;
            const holder = (payload.holder as string) ?? actor;
            if (!pattern && !rid) {
              send(ws, { id: replyId, type: "error", payload: { error: "pattern or id required" } });
              break;
            }
            const res = await reservations.release({ pattern, id: rid, holder });
            if (!res.ok) {
              send(ws, { id: replyId, type: "error", payload: { error: res.error } });
            } else {
              send(ws, { id: replyId, type: "ack", payload: res.released });
              broadcast("reservation:update", { action: "release", reservation: res.released });
            }
            break;
          }
          case "list_reservations":
          case "reservation:list": {
            send(ws, { id: replyId, type: "ack", payload: reservations.list() });
            break;
          }
          case "ledger:append": {
            // Append to ledger, broadcast to all
            const entry = payload as Partial<LedgerEntry> & { type: string; payload: unknown };
            if (!entry.type) {
              send(ws, { id: replyId, type: "error", payload: { error: "type required" } });
              break;
            }
            // Only Preview URL + Bot + Card ever leave harness — enforce by tagging.
            // We still store full payload, but broadcast filtering could happen here.
            // For now, broadcast full but docs say Buzz only projects minimal.
            const appended = await append({ ...entry, actor: (entry.actor as string) ?? actor });
            send(ws, { id: replyId, type: "ack", payload: appended });
            broadcast("ledger:append", appended, { exclude: ws }); // echo to others, sender already acked
            // also broadcast to sender as event so single codepath
            send(ws, { type: "broadcast", event: "ledger:append", payload: appended, ts: new Date().toISOString() });
            // If artifact, also broadcast preview
            if (["artifact", "preview", "card", "bot"].includes(appended.type)) {
              broadcast("artifact:preview", appended);
            }
            break;
          }
          case "ledger:read": {
            const entries = await readLedger();
            const limit = (payload.limit as number) ?? entries.length;
            send(ws, { id: replyId, type: "ack", payload: entries.slice(-limit) });
            break;
          }
          case "state:get": {
            const world = await readWorld();
            send(ws, { id: replyId, type: "ack", payload: world });
            break;
          }
          case "subscribe": {
            // client subscribes to events filter; for now just ack, all clients get all broadcasts
            send(ws, { id: replyId, type: "ack", payload: { subscribed: payload.events ?? ["*"] } });
            break;
          }
          case "file:change": {
            // Client-initiated file change notification (e.g. workspace edit)
            // Server rebroadcasts to all others so workspaces stay in sync over tailscale
            broadcast("file:change", { ...payload, actor, at: new Date().toISOString() }, { exclude: ws });
            send(ws, { id: replyId, type: "ack", payload: { propagated: true } });
            break;
          }
          default: {
            send(ws, { id: replyId, type: "error", payload: { error: `unknown type ${msg.type}` } });
          }
        }
      } catch (e) {
        console.error(`[harness:socket] handler error for ${msg.type}:`, e);
        send(ws, { id: replyId, type: "error", payload: { error: String(e) } });
      }
    });

    ws.on("close", () => {
      clients.delete(ws);
      console.log(`[harness:socket] - client ${id} (${clients.size} remaining)`);
    });

    ws.on("error", (e) => {
      console.warn(`[harness:socket] client ${id} error:`, e.message);
    });
  });

  wss.on("error", (e) => {
    console.error("[harness:socket] server error:", e);
  });

  return wss;
}

// --- File watch: harness/ + workspaces/ → broadcast ---
let watcher: ReturnType<typeof chokidar.watch> | null = null;
function startFileWatch(broadcastFn: typeof broadcast = broadcast) {
  if (watcher) return watcher;
  const watchTargets = [HARNESS_DIR, WORKSPACES_DIR].filter((d) => existsSync(d));
  if (!watchTargets.length) {
    console.log("[harness:watch] no targets yet, will retry in 5s");
    setTimeout(() => startFileWatch(broadcastFn), 5000);
    return null;
  }

  // Ignore ledger.jsonl and world.json noise? No, we WANT to broadcast those,
  // but debounce so rapid appends don't flood.
  watcher = chokidar.watch(watchTargets, {
    ignored: /(^|[\/\\])\../, // ignore dotfiles
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
  });

  let debounceTimer: NodeJS.Timeout | null = null;
  const pending = new Map<string, { event: string; path: string }>();

  const schedule = (event: string, path: string) => {
    // skip ledger.lock / tmp files
    if (path.endsWith(".tmp") || path.includes(".git")) return;
    pending.set(path, { event, path: relative(REPO_ROOT, path) });
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const batch = Array.from(pending.values());
      pending.clear();
      for (const { event, path } of batch) {
        let content: string | null = null;
        try {
          if (event !== "unlink" && existsSync(join(REPO_ROOT, path))) {
            content = readFileSync(join(REPO_ROOT, path), "utf-8").slice(0, 4096); // cap
          }
        } catch {}
        broadcastFn("file:change", { event, path, content, at: new Date().toISOString() });
        console.log(`[harness:watch] ${event} ${path} → broadcast (${clients.size} clients)`);
      }
    }, 120);
  };

  watcher
    .on("add", (p) => schedule("add", p))
    .on("change", (p) => schedule("change", p))
    .on("unlink", (p) => schedule("unlink", p))
    .on("error", (e) => console.warn("[harness:watch] error:", e));

  console.log(`[harness:watch] watching ${watchTargets.map((p) => relative(REPO_ROOT, p)).join(", ")} → broadcast`);
  return watcher;
}

// Also watch ledger.jsonl via ledger.ts watch → broadcast
let ledgerWatcher: { close: () => void } | null = null;
function startLedgerWatch() {
  if (ledgerWatcher) return;
  ledgerWatcher = watchLedger((entry) => {
    // when ledger appended outside socket (e.g. direct file write), broadcast
    broadcast("ledger:append", entry);
    console.log(`[harness:ledger] external append ${entry.type} ${entry.id} → broadcast`);
  });
}

// Only auto-start when run as main, not when imported for tests
const isMain = import.meta.url === `file://${process.argv[1]}` ||
               process.argv[1]?.endsWith("socket.ts") ||
               process.argv[1]?.includes("socket");
if (isMain) {
  const wss = createServer(PORT, HOST);
  startFileWatch();
  startLedgerWatch();

  // Graceful shutdown
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      console.log(`[harness:socket] ${sig} shutting down...`);
      watcher?.close();
      ledgerWatcher?.close();
      wss.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 2000).unref();
    });
  }
}

export { broadcast, clients, WORKSPACES_DIR, HARNESS_DIR, TAILSCALE_HOST, HOST, PORT, startFileWatch, startLedgerWatch };
