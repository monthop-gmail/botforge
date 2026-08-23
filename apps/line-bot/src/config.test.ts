import { test } from "node:test"
import assert from "node:assert/strict"
import { readConfig, createRuntime, ConfigError, RUNTIMES } from "./config.ts"

const base = {
  BOTFORGE_TENANT_ID: "legal",
  BOTFORGE_WORKSPACE_ID: "legal-opencode",
  LINE_CHANNEL_SECRET: "secret",
  LINE_CHANNEL_ACCESS_TOKEN: "token",
}

test("อ่าน config ครบและตั้งค่าเริ่มต้นถูก", () => {
  const c = readConfig(base)
  assert.equal(c.runtimeName, "opencode", "ค่าเริ่มต้นคือ engine ของ 9 ใน 14 bot")
  assert.equal(c.port, 3000)
  assert.deepEqual(c.scope, { tenant_id: "legal", workspace_id: "legal-opencode" })
})

test("ขาด env ที่จำเป็น → ConfigError พร้อมบอกว่าขาดอะไร", () => {
  for (const key of ["LINE_CHANNEL_SECRET", "LINE_CHANNEL_ACCESS_TOKEN"]) {
    const env = { ...base }
    delete (env as any)[key]
    assert.throws(() => readConfig(env), (e: any) => e instanceof ConfigError && e.message.includes(key))
  }
})

test("ขาด tenant/workspace → MissingScopeError ของ core ไม่ใช่เดาให้", () => {
  const env = { ...base }
  delete (env as any).BOTFORGE_TENANT_ID
  assert.throws(() => readConfig(env), /BOTFORGE_TENANT_ID/)
})

test("BOTFORGE_RUNTIME ที่ไม่รองรับ → บอกตัวเลือกที่มี", () => {
  assert.throws(
    () => readConfig({ ...base, BOTFORGE_RUNTIME: "ไม่มีจริง" }),
    (e: any) => e instanceof ConfigError && RUNTIMES.every((r) => e.message.includes(r)),
  )
})

test("ค่าเริ่มต้นต่อ engine ยกมาจาก v1 ตามจริง", () => {
  const oc = readConfig({ ...base, BOTFORGE_RUNTIME: "opencode" })
  assert.equal(oc.userContextFormat, "verbose", "opencode ใช้ [User Info: …]")
  assert.equal(oc.lengthTruncationNotice, false, "opencode ไม่ใช้กลไกนี้")

  for (const r of ["codex", "claude", "adkcode"] as const) {
    const c = readConfig({ ...base, BOTFORGE_RUNTIME: r })
    assert.equal(c.userContextFormat, "standard", r)
    assert.equal(c.lengthTruncationNotice, true, r)
  }
})

test("createRuntime สร้าง adapter ได้ทุกตัวโดยไม่ต้องมี server จริง", async () => {
  for (const r of RUNTIMES) {
    // claude ต้องมี SDK ตอน sendPrompt แต่ตอน construct ยังไม่โหลด
    const runtime = await createRuntime(readConfig({ ...base, BOTFORGE_RUNTIME: r }), {
      ...base, CODEX_BIN: "/bin/true",
    })
    assert.equal(typeof runtime.sendPrompt, "function", r)
  }
})

test("BOT_NAME และ PORT override ได้", () => {
  const c = readConfig({ ...base, BOT_NAME: "ทีมกฎหมาย Bot", PORT: "8080" })
  assert.equal(c.botName, "ทีมกฎหมาย Bot")
  assert.equal(c.port, 8080)
})
