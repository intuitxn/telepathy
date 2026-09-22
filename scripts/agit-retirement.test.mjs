// Regression guard for the Desk retirement in `scripts/agit.py`.
//
// Desk was retired 2026-09-22 and its SQLite ledger is no longer written. The
// old best-effort SQLite "divergence" projection could block a Git-only job
// against a stale pre-retirement cache. These tests prove that a conflicting
// `.local/desk.sqlite` can no longer block the real `agit` flow, and that the
// projection API is gone while the genuine Git review-note gate stays.
//
// Pure Node standard library, temp dirs only. Runs the real `python3
// scripts/agit.py` CLI and imports the real module for the API check.

import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const AGIT = fileURLToPath(new URL("./agit.py", import.meta.url))
const PYTHON = process.env.PYTHON || "python3"

// Deterministic identity so `git commit` never depends on host config.
const GIT_ENV = {
  GIT_AUTHOR_NAME: "agit-retirement-test",
  GIT_AUTHOR_EMAIL: "agit-retirement-test@example.invalid",
  GIT_COMMITTER_NAME: "agit-retirement-test",
  GIT_COMMITTER_EMAIL: "agit-retirement-test@example.invalid",
}

function tmpRepo() {
  return mkdtempSync(join(tmpdir(), "agit-retirement-"))
}

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, {
    encoding: "utf8",
    env: { ...process.env, ...GIT_ENV, ...(opts.env || {}) },
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  })
}

function git(repo, args) {
  return run("git", ["-C", repo, ...args])
}

function agit(repo, args) {
  return run(PYTHON, [AGIT, "--repo", repo, ...args])
}

function initRepo(repo) {
  assert.equal(git(repo, ["init", "-q", "-b", "main"]).status, 0)
  const commit = git(repo, ["commit", "-q", "--allow-empty", "-m", "init"])
  assert.equal(commit.status, 0, commit.stderr)
}

// Write a stale Desk cache whose `jobs` row conflicts with the Git stage.
function writeStaleDeskCache(repo, job, state) {
  mkdirSync(join(repo, ".local"), { recursive: true })
  const db = join(repo, ".local", "desk.sqlite")
  const script = [
    "import sqlite3, sys",
    "db = sqlite3.connect(sys.argv[1])",
    "db.execute('CREATE TABLE jobs(id TEXT PRIMARY KEY, state TEXT)')",
    "db.execute('INSERT INTO jobs(id, state) VALUES(?, ?)', (sys.argv[2], sys.argv[3]))",
    "db.commit(); db.close()",
  ].join("; ")
  const result = run(PYTHON, ["-c", script, db, job, state])
  assert.equal(result.status, 0, result.stderr)
  return db
}

// Read back the stale cache so a test can prove the conflict is real.
function readDeskState(db, job) {
  const script = [
    "import sqlite3, sys",
    "db = sqlite3.connect(sys.argv[1])",
    "row = db.execute('SELECT state FROM jobs WHERE id=?', (sys.argv[2],)).fetchone()",
    "print(row[0] if row else '')",
  ].join("; ")
  const result = run(PYTHON, ["-c", script, db, job])
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}

test("removed SQLite projection API and preserved Git review-note gate", () => {
  const script = [
    "import importlib.util, sys",
    "spec = importlib.util.spec_from_file_location('agit', sys.argv[1])",
    "m = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(m)",
    "gone = [n for n in ('sqlite_projection', 'check_divergence', 'SQLITE_STAGE_MAP') if hasattr(m, n)]",
    "assert not gone, 'still present: ' + ','.join(gone)",
    "assert hasattr(m, 'cmd_accept'), 'cmd_accept missing'",
    "print('ok')",
  ].join("\n")
  const result = run(PYTHON, ["-c", script, AGIT])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /ok/)

  // The genuine Git-blocking review gate must stay in the source: it fires when
  // a different existing review note records the same candidate. The message is
  // split across two Python string literals, so match the contiguous anchors.
  const source = readFileSync(AGIT, "utf8")
  assert.ok(source.includes("a different review note already records this"),
    "the Git review-note gate message must remain")
  assert.ok(source.includes('raise AgitError("divergence"'),
    'AgitError("divergence") must remain the used Git review gate')
})

test("python3 scripts/agit.py --help works", () => {
  const result = run(PYTHON, [AGIT, "--help"])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /propose/)
  assert.match(result.stdout, /accept/)
})

test("a stale conflicting Desk cache cannot block the Git-only propose -> ready flow", () => {
  const repo = tmpRepo()
  try {
    initRepo(repo)
    const job = "job-stale"
    const db = writeStaleDeskCache(repo, job, "resolved")
    // Sanity: the stale row really conflicts with the Git-only flow, which is
    // at Proposed/Ready; the removed check used to block here.
    assert.equal(readDeskState(db, job), "resolved")

    const propose = agit(repo, ["propose", "--job", job, "--program", "demo"])
    assert.equal(propose.status, 0, propose.stderr)

    const ready = agit(repo, ["ready", "--job", job])
    assert.equal(ready.status, 0, ready.stderr)
    assert.ok(!`${ready.stdout}${ready.stderr}`.includes("agit: divergence"),
      "ready must not be blocked by the stale Desk cache")
    assert.match(ready.stdout, /ready /)

    // The cache must not be deleted by the flow.
    assert.ok(existsSync(db), "the .local Desk cache file must be left in place")

    // `agit state --json` no longer carries a "sqlite" projection key.
    const stateJson = agit(repo, ["state", job, "--json"])
    assert.equal(stateJson.status, 0, stateJson.stderr)
    const info = JSON.parse(stateJson.stdout)
    assert.ok(!Object.prototype.hasOwnProperty.call(info, "sqlite"),
      "state --json must not expose a sqlite projection")
    assert.equal(info.stage, "ready")

    // Human-readable `agit state` no longer prints a sqlite reconciliation line.
    const stateText = agit(repo, ["state", job])
    assert.equal(stateText.status, 0, stateText.stderr)
    assert.ok(!/^sqlite:/m.test(stateText.stdout),
      "state must not print a sqlite reconciliation line")
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test("no stale cache is also unblocked (control flow)", () => {
  const repo = tmpRepo()
  try {
    initRepo(repo)
    const job = "job-clean"
    assert.equal(agit(repo, ["propose", "--job", job, "--program", "demo"]).status, 0)
    const ready = agit(repo, ["ready", "--job", job])
    assert.equal(ready.status, 0, ready.stderr)
    assert.match(ready.stdout, /ready /)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})
