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

// Full session-ID shaped values, like the mailbox plugin's `ses_...` ids.
const CANONICAL = "ses_f3782a646ffeXYGRgszvTpOEJ0"
const LEGACY = "ses_9c1d2e3f4a5b6c7d8e9f0a1b"
// Older legacy records carry the 8-char short prefix ("session-ses_cccc").
const SHORT_LEGACY = "ses_cccc1234abcd"
const COLON = "ses_1a2b3c4d5e6f7a8b9c0d1e2f"
// Deliberately share the first 8 chars ("ses_aaaa").
const COLLIDE_A = "ses_aaaa1111bbbb2222cccc3333"
const COLLIDE_B = "ses_aaaa9999dddd4444eeee5555"

function tmp() {
  return mkdtempSync(join(tmpdir(), "telepathy-discover-"))
}

function writeRegistry(dir, value) {
  writeFileSync(join(dir, "peers.json"), typeof value === "string" ? value : JSON.stringify(value, null, 2))
}

function run(dir, args = []) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, TELEPATHY_DIR: dir, TELEPATHY_NOW: String(NOW) },
  })
}

function snapshot(dir) {
  const files = readdirSync(dir).sort()
  return files
    .map((name) => {
      const bytes = readFileSync(join(dir, name))
      return `${name}:${createHash("sha256").update(bytes).digest("hex")}`
    })
    .join("\n")
}

function dataRows(stdout) {
  return stdout
    .split("\n")
    .filter((l) => l.includes("  ") && !l.startsWith("AGENT") && !l.startsWith("---"))
}

test("current canonical shape <agent>:<FULL_ID> classifies canonical and conforming", () => {
  const dir = tmp()
  try {
    writeRegistry(dir, {
      [CANONICAL]: {
        sessionID: CANONICAL,
        agent: "build",
        name: `build:${CANONICAL}`,
        status: "active",
        firstSeen: 1,
        lastSeen: NOW - 1_000,
      },
    })
    const result = run(dir)
    assert.equal(result.status, 0, result.stderr)
    const out = result.stdout
    assert.match(out, /records=1 conforming=1/)
    assert.match(out, /canonical=1/)
    assert.ok(!out.includes("colon-noncanonical"), "full-ID canonical name must not be colon-noncanonical")
    assert.match(out, /build:ses_f378/, "presentation should show the 8-char short id")
    assert.ok(!out.includes(CANONICAL), "must not leak the full session id")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("reports canonical vs legacy vs colon shapes without rewriting the store", () => {
  const dir = tmp()
  try {
    const peers = {
      [CANONICAL]: {
        sessionID: CANONICAL,
        agent: "build",
        name: `build:${CANONICAL}`,
        status: "active",
        firstSeen: 1,
        lastSeen: NOW - 1_000,
      },
      [LEGACY]: {
        sessionID: LEGACY,
        agent: "unknown",
        name: `session-${LEGACY}`,
        status: "idle",
        firstSeen: 1,
        lastSeen: 0,
      },
      [COLON]: {
        sessionID: COLON,
        agent: "General",
        name: "General:ses_1a2b",
        status: "active",
        firstSeen: 1,
        lastSeen: NOW - 1_000,
      },
    }
    writeRegistry(dir, peers)
    const before = snapshot(dir)
    const result = run(dir)
    assert.equal(result.status, 0, result.stderr)
    const out = result.stdout

    assert.match(out, /records=3 conforming=1/)
    assert.match(out, /canonical=1/)
    assert.match(out, /legacy-hyphen=1/)
    assert.match(out, /colon-noncanonical=1/)
    assert.match(out, /legacy-hyphen=1 example=session-ses_9c1d/)
    assert.match(out, /build:ses_f378/)
    assert.match(out, /stale/)
    assert.match(out, /recently-seen/)

    for (const id of [CANONICAL, LEGACY, COLON]) assert.ok(!out.includes(id), `leaked full id ${id}`)
    assert.equal(snapshot(dir), before, "script must not write to the store")
    assert.deepEqual(JSON.parse(readFileSync(join(dir, "peers.json"), "utf8")), peers)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("recognizes both legacy-hyphen forms: full ID and 8-char prefix", () => {
  const dir = tmp()
  try {
    writeRegistry(dir, {
      [LEGACY]: {
        sessionID: LEGACY,
        agent: "unknown",
        name: `session-${LEGACY}`,
        status: "idle",
        firstSeen: 1,
        lastSeen: 0,
      },
      [SHORT_LEGACY]: {
        sessionID: SHORT_LEGACY,
        agent: "unknown",
        name: `session-${SHORT_LEGACY.slice(0, 8)}`,
        status: "idle",
        firstSeen: 1,
        lastSeen: 0,
      },
    })
    const result = run(dir)
    assert.equal(result.status, 0, result.stderr)
    const out = result.stdout
    assert.match(out, /records=2 conforming=0/)
    assert.match(out, /legacy-hyphen=2/)
    assert.match(out, /session-ses_9c1d/, "full-ID legacy form")
    assert.match(out, /session-ses_cccc/, "8-char-prefix legacy form")
    assert.ok(!out.includes("colon-noncanonical"))
    for (const id of [LEGACY, SHORT_LEGACY]) assert.ok(!out.includes(id), `leaked full id ${id}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("colliding 8-char prefixes classify independently and stay distinguishable", () => {
  const dir = tmp()
  try {
    writeRegistry(dir, {
      [COLLIDE_A]: {
        sessionID: COLLIDE_A,
        agent: "build",
        name: `build:${COLLIDE_A}`,
        status: "active",
        firstSeen: 1,
        lastSeen: NOW - 1_000,
      },
      [COLLIDE_B]: {
        sessionID: COLLIDE_B,
        agent: "build",
        name: `build:${COLLIDE_B}`,
        status: "active",
        firstSeen: 1,
        lastSeen: NOW - 1_000,
      },
    })
    const result = run(dir)
    assert.equal(result.status, 0, result.stderr)
    const out = result.stdout
    assert.match(out, /records=2 conforming=2/)
    assert.match(out, /canonical=2/)

    const rows = dataRows(out)
    assert.equal(rows.length, 2)
    assert.notEqual(rows[0], rows[1], "colliding short ids must be distinguishable")

    for (const id of [COLLIDE_A, COLLIDE_B]) assert.ok(!out.includes(id), `leaked full id ${id}`)
    assert.match(out, /build:ses_aaaa/, "both rows keep the 8-char short id")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("a deleted record with a recent lastSeen never prints as recently-seen/online", () => {
  const dir = tmp()
  try {
    writeRegistry(dir, {
      [CANONICAL]: {
        sessionID: CANONICAL,
        agent: "build",
        name: `build:${CANONICAL}`,
        status: "deleted",
        firstSeen: 1,
        lastSeen: NOW - 1_000,
      },
    })
    const result = run(dir)
    assert.equal(result.status, 0, result.stderr)
    const out = result.stdout
    assert.ok(!out.includes("online"), "must never print 'online'")
    assert.ok(!out.includes("recently-seen"), "deleted must not read as recently-seen")
    assert.match(out, /deleted/, "lifecycle state must be shown")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("corrupt JSON is a read failure, not an empty inventory", () => {
  const dir = tmp()
  try {
    writeRegistry(dir, "{ this is not json")
    const before = snapshot(dir)
    const result = run(dir)
    assert.notEqual(result.status, 0, "corrupt registry must exit nonzero")
    assert.ok(!result.stdout.includes("records=0"), "must not report records=0")
    assert.match(result.stdout, /registry=unreadable records=unknown/)
    assert.match(result.stderr, /is not valid JSON/)
    assert.equal(snapshot(dir), before, "script must not write")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("a non-object root is a read failure, not an empty inventory", () => {
  const dir = tmp()
  try {
    for (const bad of ["[1, 2, 3]", '"nope"', "null"]) {
      writeRegistry(dir, bad)
      const result = run(dir)
      assert.notEqual(result.status, 0, `root ${bad} must exit nonzero`)
      assert.ok(!result.stdout.includes("records=0"), `root ${bad} must not report records=0`)
      assert.match(result.stdout, /records=unknown/)
      assert.match(result.stderr, /registry root is not an object/)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("a missing registry is a read failure, not a successful empty inventory", () => {
  const dir = tmp()
  try {
    const before = snapshot(dir)
    const result = run(dir)
    assert.notEqual(result.status, 0, "missing registry must exit nonzero")
    assert.match(result.stdout, /registry=absent records=unknown/)
    assert.ok(!result.stdout.includes("records=0"))
    assert.match(result.stderr, /no registry at/)
    assert.equal(snapshot(dir), before, "script must not write")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("a valid empty object is a successful empty inventory", () => {
  const dir = tmp()
  try {
    writeRegistry(dir, {})
    const result = run(dir)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /records=0 conforming=0/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("presentation never contains a full session ID", () => {
  const dir = tmp()
  try {
    writeRegistry(dir, {
      [CANONICAL]: {
        sessionID: CANONICAL,
        agent: "build",
        name: `build:${CANONICAL}`,
        status: "active",
        firstSeen: 1,
        lastSeen: NOW - 1_000,
      },
      [LEGACY]: {
        sessionID: LEGACY,
        agent: "unknown",
        name: `session-${LEGACY}`,
        status: "idle",
        firstSeen: 1,
        lastSeen: 0,
      },
    })
    const result = run(dir)
    assert.equal(result.status, 0, result.stderr)
    for (const id of [CANONICAL, LEGACY]) {
      assert.ok(!result.stdout.includes(id), `stdout leaked full id ${id}`)
      assert.ok(!result.stderr.includes(id), `stderr leaked full id ${id}`)
    }
    assert.match(result.stdout, /ses_f378/)
    assert.match(result.stdout, /ses_9c1d/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("output is stable and sorted across runs", () => {
  const dir = tmp()
  try {
    writeRegistry(dir, {
      [CANONICAL]: {
        sessionID: CANONICAL,
        agent: "build",
        name: `build:${CANONICAL}`,
        status: "active",
        firstSeen: 1,
        lastSeen: NOW - 1_000,
      },
      [LEGACY]: {
        sessionID: LEGACY,
        agent: "general",
        name: `general:${LEGACY}`,
        status: "idle",
        firstSeen: 1,
        lastSeen: 0,
      },
    })
    const first = run(dir).stdout
    const second = run(dir).stdout
    assert.equal(first, second)
    const names = dataRows(first).map((l) => l.replace(/\s+/g, " ").split(" ")[1])
    assert.deepEqual(names, [...names].sort())
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("--help exits 0", () => {
  const dir = tmp()
  try {
    const result = run(dir, ["--help"])
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Usage: node scripts\/telepathy-discover\.mjs/)
    assert.match(result.stdout, /unauthenticated local heuristic/)
    assert.ok(!result.stdout.includes("online"))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
