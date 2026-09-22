#!/usr/bin/env node
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const ONLINE_WINDOW_MS = 5 * 60 * 1000
const REQUIRED_FIELDS = ["sessionID", "agent", "name", "status", "firstSeen", "lastSeen"]
const HELP = `Usage: node scripts/telepathy-discover.mjs

Read-only discover view over the local telepathy peers registry.
Reads $TELEPATHY_DIR/peers.json (default ~/.config/opencode/telepathy/peers.json),
prints a sorted table of agent, name, status, presence and a records=N conforming=M
summary. Writes nothing. Prints no raw session IDs or secrets.

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

function readPeers() {
  let raw
  try {
    raw = readFileSync(peersPath(), "utf8")
  } catch (err) {
    if (err && err.code === "ENOENT") return { peers: {}, missing: true }
    throw err
  }
  try {
    return { peers: JSON.parse(raw), missing: false }
  } catch {
    return { peers: {}, missing: false, unreadable: true }
  }
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
  return `${canonicalBase(peer.agent)}:${id8(peer.sessionID)}`
}

function hasRequiredFields(peer) {
  if (!peer || typeof peer !== "object") return false
  return REQUIRED_FIELDS.every((field) => peer[field] !== undefined && peer[field] !== null)
}

function sanitize(text, sessionID) {
  let out = stringOf(text)
  const sid = stringOf(sessionID)
  if (sid) out = out.split(sid).join(id8(sid))
  out = out.replace(/\s+/g, " ").trim()
  return out.length > 80 ? `${out.slice(0, 77)}...` : out
}

function classifyShape(peer, sessionID) {
  const name = peer && typeof peer.name === "string" ? peer.name : ""
  if (!peer || typeof peer !== "object") return "not-an-object"
  if (!name) return "missing-name"
  if (name === canonicalName(peer)) return "canonical"
  if (name === `session-${id8(sessionID)}`) return "legacy-hyphen"
  if (/^[^:]+:.+$/.test(name)) return "colon-noncanonical"
  return "other"
}

function presenceOf(peer, now) {
  return now - Number(peer.lastSeen) < ONLINE_WINDOW_MS ? "online" : "stale"
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

  const now = nowMs()
  const { peers, missing, unreadable } = readPeers()
  const entries = Object.entries(peers)

  const rows = entries.map(([key, peer]) => {
    const safe = peer && typeof peer === "object" ? peer : {}
    const sessionID = stringOf(safe.sessionID)
    const shape = classifyShape(safe, sessionID)
    const conforming = hasRequiredFields(safe) && shape === "canonical"
    return {
      key,
      name: sanitize(safe.name, sessionID),
      agent: sanitize(safe.agent, sessionID) || "unknown",
      status: sanitize(safe.status, sessionID) || "unknown",
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

  if (missing) process.stderr.write(`telepathy-discover: no registry at ${peersPath()}\n`)
  if (unreadable) process.stderr.write(`telepathy-discover: registry at ${peersPath()} is not valid JSON\n`)

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
