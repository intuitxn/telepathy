import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const SCRIPT = fileURLToPath(new URL("./telepathy-discover.mjs", import.meta.url))
const NOW = 400_000
const FULL_IDS = {
  canonical: "ses_aaaa11112222",
  legacy: "ses_bbbb11112222",
  colon: "ses_cccc11112222",
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "telepathy-discover-"))
  const peers = {
    [FULL_IDS.canonical]: {
      sessionID: FULL_IDS.canonical,
      agent: "general",
      name: "general:ses_aaaa",
      status: "active",
      firstSeen: 1,
      lastSeen: NOW - 1_000,
    },
    [FULL_IDS.legacy]: {
      sessionID: FULL_IDS.legacy,
      agent: "unknown",
      name: "session-ses_bbbb",
      status: "idle",
      firstSeen: 1,
      lastSeen: 0,
    },
    [FULL_IDS.colon]: {
      sessionID: FULL_IDS.colon,
      agent: "General",
      name: "General:ses_cccc",
      status: "active",
      firstSeen: 1,
      lastSeen: NOW - 1_000,
    },
  }
  writeFileSync(join(dir, "peers.json"), JSON.stringify(peers, null, 2))
  return { dir, peers }
}

function run(dir) {
  return spawnSync(process.execPath, [SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, TELEPATHY_DIR: dir, TELEPATHY_NOW: String(NOW) },
  })
}

function snapshot(dir) {
  const files = readdirSync(dir).sort()
  const hashes = files.map((name) => {
    const bytes = readFileSync(join(dir, name))
    return `${name}:${createHash("sha256").update(bytes).digest("hex")}`
  })
  return hashes.join("\n")
}

test("reports canonical vs legacy shapes without rewriting the store", () => {
  const { dir, peers } = fixture()
  try {
    const before = snapshot(dir)
    const result = run(dir)
    assert.equal(result.status, 0, result.stderr)
    const out = result.stdout

    assert.match(out, /records=3 conforming=1/)
    assert.match(out, /canonical=1/)
    assert.match(out, /legacy-hyphen=1/)
    assert.match(out, /colon-noncanonical=1/)
    assert.match(out, /legacy-hyphen=1 example=session-ses_bbbb/)
    assert.match(out, /general:ses_aaaa/)
    assert.match(out, /stale/)
    assert.match(out, /online/)

    for (const id of Object.values(FULL_IDS)) assert.ok(!out.includes(id), `leaked full id ${id}`)
    assert.equal(snapshot(dir), before, "script must not write to the store")
    assert.deepEqual(JSON.parse(readFileSync(join(dir, "peers.json"), "utf8")), peers)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("output is stable and sorted across runs", () => {
  const { dir } = fixture()
  try {
    const first = run(dir).stdout
    const second = run(dir).stdout
    assert.equal(first, second)
    const rows = first
      .split("\n")
      .filter((l) => l.includes("  ") && !l.startsWith("AGENT") && !l.startsWith("---"))
    const names = rows.map((l) => l.replace(/\s+/g, " ").split(" ")[1])
    assert.deepEqual(names, [...names].sort())
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("handles a missing registry without writing", () => {
  const dir = mkdtempSync(join(tmpdir(), "telepathy-discover-empty-"))
  try {
    const before = snapshot(dir)
    const result = run(dir)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /records=0 conforming=0/)
    assert.equal(snapshot(dir), before)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
