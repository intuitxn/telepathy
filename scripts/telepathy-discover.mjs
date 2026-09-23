#!/usr/bin/env node
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const RECENT_WINDOW_MS = 5 * 60 * 1000
const REQUIRED_FIELDS = ["sessionID", "agent", "name", "status", "firstSeen", "lastSeen"]
const HELP = `Usage: node scripts/telepathy-discover.mjs

Read-only discover view over the local telepathy peers registry.
Reads $TELEPATHY_DIR/peers.json (default ~/.config/opencode/telepathy/peers.json),
prints a sorted table of agent, name, status, presence and a records=N conforming=M
summary. Writes nothing. Prints no raw session IDs or secrets.

Classification compares names against the FULL session ID using the canonical
shape "<agent>:<sessionID>" (a legacy "session-<sessionID>" shape is reported,
never rewritten). Names are shown with an 8-char short id only; when two peers
share an 8-char prefix their short ids get a stable "#N" discriminator so the
rows stay distinguishable.

Presence is an unauthenticated local heuristic derived from the recorded lifecycle
status and lastSeen recency; it is not proof of liveness and asserts no
authenticated session state. Values are "recently-seen" (within the window),
"stale", or the lifecycle status (e.g. "deleted"). A deleted record never reads
as recently-seen.

Environment:
  TELEPATHY_DIR  store directory (default ~/.config/opencode/telepathy)
  TELEPATHY_NOW  current time in epoch ms (test hook; default Date.now())`

function storeDir() {
  return process.env.TELEPATHY_DIR ?? join(homedir(), ".config", "opencode", "telepathy")
}

function peersPath() {
  return join(storeDir(), "peers.json")
}

function nowMs() {
  const raw = process.env.TELEPATHY_NOW
  const override = raw ? Number(raw) : Number.NaN
  return Number.isFinite(override) ? override : Date.now()
}

// Distinguishes absent / unreadable / invalid-shape registries from a genuinely
// empty inventory. Only { kind: "ok" } is a successful read.
function readRegistry() {
  let raw
  try {
    raw = readFileSync(peersPath(), "utf8")
  } catch (err) {
    if (err && err.code === "ENOENT") return { kind: "absent" }
    return { kind: "read-error", message: err && err.message ? err.message : "read failed" }
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { kind: "invalid-json" }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { kind: "invalid-root" }
  return { kind: "ok", peers: parsed }
}

function stringOf(value) {
  return typeof value === "string" ? value : value == null ? "" : String(value)
}

function id8(value) {
  return stringOf(value).slice(0, 8)
}

function canonicalBase(agent) {
  const a = stringOf(agent)
  return (a && a !== "unknown" ? a : "session").toLowerCase()
}

function canonicalName(peer) {
  return `${canonicalBase(peer.agent)}:${stringOf(peer.sessionID)}`
}

function hasRequiredFields(peer) {
  if (!peer || typeof peer !== "object") return false
  return REQUIRED_FIELDS.every((field) => peer[field] !== undefined && peer[field] !== null)
}

// Maps each full session ID to the redacted label shown in the table. The label
// is the 8-char short id; only when two peers collide on that prefix do we add a
// stable discriminator, keeping classification (which uses full IDs) independent.
function shortLabels(entries) {
  const groups = new Map()
  for (const [key, peer] of entries) {
    const safe = peer && typeof peer === "object" ? peer : {}
    const sid = stringOf(safe.sessionID) || stringOf(key)
    const base = id8(sid)
    if (!groups.has(base)) groups.set(base, new Set())
    groups.get(base).add(sid)
  }
  const labels = new Map()
  for (const [base, sids] of groups) {
    const unique = [...sids].sort()
    if (unique.length <= 1) {
      labels.set(unique[0] ?? "", base)
    } else {
      unique.forEach((sid, index) => labels.set(sid, `${base}#${index + 1}`))
    }
  }
  return labels
}

function sanitize(text, sessionID, label) {
  let out = stringOf(text)
  const sid = stringOf(sessionID)
  if (sid) out = out.split(sid).join(label ?? id8(sid))
  out = out.replace(/\s+/g, " ").trim()
  return out.length > 80 ? `${out.slice(0, 77)}...` : out
}

function classifyShape(peer, sessionID) {
  const name = peer && typeof peer.name === "string" ? peer.name : ""
  if (!peer || typeof peer !== "object") return "not-an-object"
  if (!name) return "missing-name"
  if (name === canonicalName(peer)) return "canonical"
  // Legacy records predate the canonical full-ID shape: the older mailbox wrote
  // the 8-char short prefix ("session-ses_aaaa"), later ones the full session ID.
  // Recognize both for diagnosis; neither is rewritten.
  if (name === `session-${stringOf(sessionID)}`) return "legacy-hyphen"
  if (name === `session-${id8(sessionID)}`) return "legacy-hyphen"
  if (/^[^:]+:.+$/.test(name)) return "colon-noncanonical"
  return "other"
}

// Lifecycle first, recency second. Never claims authenticated liveness.
function presenceOf(peer, now) {
  const status = stringOf(peer.status).toLowerCase()
  if (status === "deleted") return "deleted"
  const lastSeen = Number(peer.lastSeen)
  if (!Number.isFinite(lastSeen)) return "stale"
  return now - lastSeen < RECENT_WINDOW_MS ? "recently-seen" : "stale"
}

function pad(value, width) {
  const text = stringOf(value)
  return text.length >= width ? text : text + " ".repeat(width - text.length)
}

function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    process.stdout.write(`${HELP}\n`)
    return 0
  }

  const registry = readRegistry()
  if (registry.kind !== "ok") {
    if (registry.kind === "absent") {
      process.stderr.write(`telepathy-discover: no registry at ${peersPath()}\n`)
      process.stdout.write("registry=absent records=unknown\n")
    } else if (registry.kind === "invalid-json") {
      process.stderr.write(`telepathy-discover: registry at ${peersPath()} is not valid JSON\n`)
      process.stdout.write("registry=unreadable records=unknown\n")
    } else if (registry.kind === "invalid-root") {
      process.stderr.write("telepathy-discover: registry root is not an object\n")
      process.stdout.write("registry=unreadable records=unknown\n")
    } else {
      process.stderr.write(`telepathy-discover: cannot read registry at ${peersPath()}: ${registry.message}\n`)
      process.stdout.write("registry=unreadable records=unknown\n")
    }
    return 1
  }

  const now = nowMs()
  const entries = Object.entries(registry.peers)
  const labels = shortLabels(entries)

  const rows = entries.map(([key, peer]) => {
    const safe = peer && typeof peer === "object" ? peer : {}
    const sessionID = stringOf(safe.sessionID)
    const label = labels.get(sessionID) ?? id8(sessionID)
    const shape = classifyShape(safe, sessionID)
    const conforming = hasRequiredFields(safe) && shape === "canonical"
    return {
      key,
      name: sanitize(safe.name, sessionID, label),
      agent: sanitize(safe.agent, sessionID, label) || "unknown",
      status: sanitize(safe.status, sessionID, label) || "unknown",
      presence: presenceOf(safe, now),
      shape,
      conforming,
      keyOk: stringOf(safe.sessionID) === stringOf(key),
    }
  })

  rows.sort((a, b) => {
    if (a.name !== b.name) return a.name < b.name ? -1 : 1
    if (a.agent !== b.agent) return a.agent < b.agent ? -1 : 1
    if (a.status !== b.status) return a.status < b.status ? -1 : 1
    return a.presence < b.presence ? -1 : a.presence > b.presence ? 1 : 0
  })

  const header = ["AGENT", "NAME", "STATUS", "PRESENCE"]
  const body = rows.map((r) => [r.agent, r.name, r.status, r.presence])
  const widths = header.map((h, i) => Math.max(h.length, ...body.map((row) => stringOf(row[i]).length), 0))
  const line = (cells) => cells.map((c, i) => pad(c, widths[i])).join("  ").trimEnd()

  process.stdout.write(`${line(header)}\n`)
  process.stdout.write(`${line(widths.map((w) => "-".repeat(w)))}\n`)
  for (const row of body) process.stdout.write(`${line(row)}\n`)

  const conforming = rows.filter((r) => r.conforming).length
  const shapes = new Map()
  for (const row of rows) shapes.set(row.shape, (shapes.get(row.shape) ?? 0) + 1)
  const shapeSummary = [...shapes.entries()]
    .sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1))
    .map(([shape, count]) => `${shape}=${count}`)
    .join(" ")

  process.stdout.write(`records=${rows.length} conforming=${conforming}\n`)
  process.stdout.write(`shapes ${shapeSummary || "none"}\n`)
  const keyMismatch = rows.filter((r) => !r.keyOk).length
  if (keyMismatch) process.stdout.write(`key-mismatch=${keyMismatch} (reported only; store not rewritten)\n`)
  const legacy = rows.filter((r) => r.shape === "legacy-hyphen")
  if (legacy.length) {
    const example = legacy[0].name
    process.stdout.write(`legacy-hyphen=${legacy.length} example=${example} (reported only; store not rewritten)\n`)
  }
  return 0
}

try {
  process.exitCode = main()
} catch (err) {
  process.stderr.write(`telepathy-discover: ${err && err.message ? err.message : "failed"}\n`)
  process.exitCode = 1
}
