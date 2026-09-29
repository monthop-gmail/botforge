import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readFile, stat, writeFile, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { FileSessionRegistry, MemorySessionRegistry, type SessionRegistry } from "./registry.ts"
import type { RuntimeSessionInfo } from "./capabilities.ts"

const info = (key: string, id = "s-" + key): RuntimeSessionInfo => ({
  sessionKey: key,
  runtimeName: "opencode",
  runtimeSessionId: id,
  createdAt: "2026-09-29T00:00:00.000Z",
  lastUsedAt: "2026-09-29T00:00:00.000Z",
  model: "opencode/big-pickle",
})

async function shared(make: () => SessionRegistry, label: string) {
  const r = make()
  assert.equal(await r.get("a"), undefined, `${label}: คีย์ที่ไม่มีต้องได้ undefined`)
  await r.put(info("a"))
  assert.equal((await r.get("a"))?.runtimeSessionId, "s-a", label)
  await r.put(info("a", "s-a2"))
  assert.equal((await r.get("a"))?.runtimeSessionId, "s-a2", `${label}: put ทับของเดิม`)
  await r.put(info("b"))
  assert.equal((await r.list()).length, 2, label)
  await r.delete("a")
  assert.equal(await r.get("a"), undefined, label)
  assert.equal((await r.list()).length, 1, label)
  await r.delete("ไม่มีอยู่")   // ต้องไม่โยน
}

test("SessionRegistry — พฤติกรรมเหมือนกันทั้งสองที่เก็บ", async () => {
  await shared(() => new MemorySessionRegistry(), "memory")
  const dir = await mkdtemp(join(tmpdir(), "bf-reg-"))
  await shared(() => new FileSessionRegistry({ path: join(dir, "sessions.json") }), "file")
})

test("FileSessionRegistry — instance ใหม่อ่านของเดิมได้ (= restart แล้วกู้ได้)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bf-reg-"))
  const path = join(dir, "sessions.json")

  const before = new FileSessionRegistry({ path })
  await before.put(info("line:group:C1"))
  await before.put(info("line:dm:U2"))

  // process ตาย — instance ใหม่ ไม่แชร์หน่วยความจำกับตัวเดิมเลย
  const after = new FileSessionRegistry({ path })
  assert.equal((await after.list()).length, 2, "ต้องกู้ได้ทั้งสองแถว")
  assert.equal((await after.get("line:group:C1"))?.runtimeSessionId, "s-line:group:C1")

  const perms = (await stat(path)).mode & 0o777
  assert.equal(perms, 0o600, "ไฟล์ทะเบียนต้องอ่านได้เฉพาะเจ้าของ")
})

test("FileSessionRegistry — ไฟล์เสียต้องดังและถูกย้ายไปไว้ข้าง ๆ ไม่ใช่หายเงียบ", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bf-reg-"))
  const path = join(dir, "sessions.json")
  await writeFile(path, "{ นี่ไม่ใช่ json", "utf8")

  const logs: string[] = []
  const r = new FileSessionRegistry({ path, log: (...a) => logs.push(a.join(" ")) })
  assert.deepEqual(await r.list(), [], "เริ่มจากทะเบียนว่าง")
  assert.equal(logs.length, 1, "ต้อง log หนึ่งครั้ง — ไม่ใช่เงียบ")
  assert.match(logs[0]!, /corrupt-/, "ต้องบอกว่าย้ายไฟล์ไปไว้ที่ไหน")

  const left = await readdir(dir)
  assert.ok(left.some((f) => f.includes(".corrupt-")), "ไฟล์เดิมต้องยังอยู่ ไม่ถูกลบ")

  await r.put(info("c"))          // ยังเขียนต่อได้หลังของเสีย
  assert.equal((await new FileSessionRegistry({ path }).list()).length, 1)
})

test("FileSessionRegistry — แถวที่รูปไม่ครบถูกทิ้งและนับให้เห็น", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bf-reg-"))
  const path = join(dir, "sessions.json")
  await writeFile(path, JSON.stringify({
    version: 1,
    sessions: [
      info("ok"),
      { sessionKey: "ขาด id", runtimeName: "opencode", createdAt: "x", lastUsedAt: "y" },
      { runtimeSessionId: "ขาดคีย์", runtimeName: "opencode", createdAt: "x", lastUsedAt: "y" },
    ],
  }), "utf8")

  const logs: string[] = []
  const r = new FileSessionRegistry({ path, log: (...a) => logs.push(a.join(" ")) })
  const rows = await r.list()
  assert.equal(rows.length, 1, "เก็บเฉพาะแถวที่รูปครบ")
  assert.equal(rows[0]!.sessionKey, "ok")
  assert.match(logs.join(" "), /ทิ้ง 2 แถว/, "ต้องบอกจำนวนที่ทิ้ง ไม่ใช่ทิ้งเงียบ")
})

test("FileSessionRegistry.fromEnv — ใช้ BOTFORGE_STATE_DIR ถ้ามี", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bf-reg-"))
  const r = FileSessionRegistry.fromEnv({ BOTFORGE_STATE_DIR: dir })
  await r.put(info("d"))
  const raw = JSON.parse(await readFile(join(dir, "sessions.json"), "utf8"))
  assert.equal(raw.version, 1)
  assert.equal(raw.sessions.length, 1)
})
