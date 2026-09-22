import { afterAll, beforeEach, expect, test } from "bun:test"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const store = await mkdtemp(join(tmpdir(), "telepathy-test-"))
process.env.TELEPATHY_DIR = store
const { default: plugin } = await import("./telepathy.ts")
let hooks: any
let metadata: Record<string, any> = {}
const peers = async () => JSON.parse(await readFile(join(store, "peers.json"), "utf8"))
const event = (type: string, properties: any) => hooks.event({ event: { type, properties } })
const created = (id: string, agent?: string) => event("session.created", { info: { id, agent } })
const context = { sessionID: "ses_sender", agent: "build" }
const send = (to: string) => hooks.tool.telepathy_send.execute({ to, subject: "test", body: "fixture" }, context)

beforeEach(async () => {
  for (const file of await readdir(store)) await rm(join(store, file), { recursive: true, force: true })
  metadata = {}
  hooks = await plugin({ directory: "/fixture/work", client: {
    app: { log: async () => ({}) },
    session: { get: async ({ path }: any) => ({ data: metadata[path.id] }) },
  } } as any)
})
afterAll(async () => { await rm(store, { recursive: true, force: true }) })

test("full session IDs avoid short-prefix collisions; authoritative metadata enriches unknown roles", async () => {
  await created("ses_f381_aaa")
  await created("ses_f381_bbb")
  let p = await peers()
  expect(p.ses_f381_aaa.name).not.toBe(p.ses_f381_bbb.name)
  expect(p.ses_f381_aaa.agent).toBe("unknown")
  expect(p.ses_f381_aaa.host).toBe("opencode")
  expect(p.ses_f381_aaa.hostname).toBeString()
  expect(p.ses_f381_aaa.directory).toBe("/fixture/work")
  await event("message.updated", { info: { id: "msg_not_a_peer", sessionID: "ses_f381_aaa", agent: "reviewer" } })
  await event("message.updated", { info: { id: "msg_second", sessionID: "ses_f381_aaa", agent: "unknown" } })
  p = await peers()
  expect(Object.keys(p)).toHaveLength(2)
  expect(p.ses_f381_aaa.role).toBe("reviewer")
  expect(p.ses_f381_aaa.name).toBe("reviewer:ses_f381_aaa")
  metadata.ses_f381_bbb = { id: "ses_f381_bbb", agent: "meta", title: "Fixture worker", directory: "/fixture/native" }
  await event("session.updated", { info: { id: "ses_f381_bbb" } })
  p = await peers()
  expect(p.ses_f381_bbb).toMatchObject({ role: "meta", title: "Fixture worker", directory: "/fixture/native" })
})

test("lifecycle follows idle, busy, retry, error and deletion; metadata does not revive peers", async () => {
  await created("ses_state")
  for (const [state, expected] of [["idle", "idle"], ["busy", "active"], ["retry", "retry"]]) {
    await event("session.status", { sessionID: "ses_state", status: { type: state } })
    expect((await peers()).ses_state.status).toBe(expected)
  }
  await event("session.error", { sessionID: "ses_state" })
  await event("session.updated", { info: { id: "ses_state", title: "Changed title" } })
  expect((await peers()).ses_state.status).toBe("error")
  await event("session.deleted", { info: { id: "ses_state" } })
  await event("session.status", { sessionID: "ses_state", status: { type: "busy" } })
  expect((await peers()).ses_state.status).toBe("deleted")
  expect(await send("ses_state")).toContain("No peer matched")
})

test("ambiguous roles and prefixes never deliver; explicit ID delivers once", async () => {
  await created("ses_shared_aaa", "reviewer")
  await created("ses_shared_bbb", "reviewer")
  for (const target of ["reviewer", "ses_shared", "unknown", "session", ""]) {
    await expect(send(target)).rejects.toThrow()
  }
  expect(await readdir(join(store, "mailboxes"))).toEqual([])
  expect(await send("ses_shared_aaa")).toContain("Delivered to 1")
  expect(await readdir(join(store, "mailboxes"))).toEqual(["ses_shared_aaa.jsonl"])
})

test("concurrent local upserts preserve every peer and existing extension data", async () => {
  await writeFile(join(store, "peers.json"), JSON.stringify({ ses_old: {
    sessionID: "ses_old", agent: "meta", name: "legacy-short-name", status: "idle", firstSeen: 1, lastSeen: 1,
    extension: { retained: true },
  } }))
  await Promise.all(Array.from({ length: 40 }, (_, i) => created(`ses_parallel_${i}`)))
  await event("session.updated", { info: { id: "ses_old", title: "Enriched" } })
  const p = await peers()
  expect(Object.keys(p)).toHaveLength(41)
  expect(p.ses_old.extension).toEqual({ retained: true })
  expect(p.ses_old.firstSeen).toBe(1)
  expect(p.ses_old.agent).toBe("meta")
})

test("independent Bun processes cannot overwrite one another's registry updates", async () => {
  const source = new URL("./telepathy.ts", import.meta.url).pathname
  const children = Array.from({ length: 3 }, (_, worker) => {
    const code = `import plugin from ${JSON.stringify(source)};
      const h = await plugin({ directory: '/fixture/child', client: { app: { log: async()=>({}) } } });
      await Promise.all(Array.from({length:15},(_,i)=>h.event({event:{type:'session.created',properties:{info:{id:'ses_child_${worker}_'+i,agent:'meta',title:'fixture',directory:'/fixture/child'}}}})));
    `
    return Bun.spawn([process.execPath, "-e", code], { env: { ...process.env, TELEPATHY_DIR: store }, stdout: "pipe", stderr: "pipe" })
  })
  for (const child of children) {
    expect(await child.exited).toBe(0)
    expect(await new Response(child.stderr).text()).toBe("")
  }
  expect(Object.keys(await peers())).toHaveLength(45)
})

test("malformed registry is preserved, not silently reset", async () => {
  await writeFile(join(store, "peers.json"), "{broken")
  await created("ses_no_reset")
  expect(await readFile(join(store, "peers.json"), "utf8")).toBe("{broken")
  expect((await readdir(store)).includes(".peers.lock")).toBe(false)
})
