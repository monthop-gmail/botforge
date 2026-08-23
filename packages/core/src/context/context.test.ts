import { test } from "node:test"
import assert from "node:assert/strict"
import { getTimeContext, logTimestamp } from "./time.ts"
import {
  ProfileCache, formatUserContext, formatGroupContext, formatQuoteContext,
  PROFILE_TTL_MS, type LineProfileSource,
} from "./profile.ts"

/** ORACLE — getTimeContext() ฉบับ verbatim จาก v1-final (semantically เหมือนทั้ง 9 engine) */
function getTimeContext_v1(now: Date): string {
  const bangkokTime = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Bangkok",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).format(now)
  return `[Time: ${bangkokTime}+07:00]`
}

test("getTimeContext ตรงกับ v1", () => {
  const samples = [
    new Date("2026-08-23T07:30:05Z"),   // 14:30:05 +07
    new Date("2026-01-01T17:00:00Z"),   // ข้ามวัน → 2026-01-02 00:00:00
    new Date("2026-12-31T16:59:59Z"),   // ข้ามปี
    new Date("2026-06-15T00:00:00Z"),
  ]
  for (const d of samples) assert.equal(getTimeContext(d), getTimeContext_v1(d))
})

test("getTimeContext ใช้เวลาไทยจริง ไม่ใช่ UTC", () => {
  assert.equal(getTimeContext(new Date("2026-08-23T07:30:05Z")), "[Time: 2026-08-23 14:30:05+07:00]")
  // 17:00Z = 00:00 วันถัดไปที่กรุงเทพ
  assert.equal(getTimeContext(new Date("2026-01-01T17:00:00Z")), "[Time: 2026-01-02 00:00:00+07:00]")
})

test("logTimestamp รูปแบบเดียวกับ log() ของ v1", () => {
  assert.equal(logTimestamp(new Date("2026-08-23T07:30:05Z")), "[2026-08-23 14:30:05]")
})

test("formatUserContext — standard คือของ 8 engine · verbose คือของ opencode", () => {
  const p = { userId: "U1", displayName: "สมชาย", firstSeen: 0, lastSeen: 0, messageCount: 12 }
  assert.equal(formatUserContext(p), "[User: สมชาย]")
  assert.equal(formatUserContext(p, "verbose"), "[User Info: สมชาย (messages: 12)]")
  assert.equal(formatUserContext(null), "")
  assert.equal(formatUserContext(undefined), "")
})

test("formatGroupContext / formatQuoteContext", () => {
  assert.equal(formatGroupContext("ทีมกฎหมาย"), "[Group: ทีมกฎหมาย]")
  assert.equal(formatGroupContext(null), "")
  assert.equal(formatQuoteContext("m123"), "[Reply to message ID: m123]")
  assert.equal(formatQuoteContext(undefined), "")
})

// ── ProfileCache ──

function fakeSource(over: Partial<LineProfileSource> = {}) {
  const calls: string[] = []
  const src: LineProfileSource = {
    async getProfile(userId) { calls.push(`getProfile:${userId}`); return { displayName: "จากโปรไฟล์" } },
    async getGroupMemberProfile(g, u) { calls.push(`getGroupMemberProfile:${g}:${u}`); return { displayName: "จากสมาชิกกลุ่ม" } },
    async getGroupSummary(g) { calls.push(`getGroupSummary:${g}`); return { groupName: "ทีมกฎหมาย" } },
    ...over,
  }
  return { src, calls }
}

test("getUser 1:1 → getProfile · cache กัน API ซ้ำ", async () => {
  const { src, calls } = fakeSource()
  let t = 1_000_000
  const cache = new ProfileCache(src, { now: () => t })

  const a = await cache.getUser("U1")
  assert.equal(a!.displayName, "จากโปรไฟล์")
  assert.equal(a!.messageCount, 1)

  const b = await cache.getUser("U1")
  assert.equal(b!.messageCount, 2, "cache hit ต้องนับ message เพิ่ม")
  assert.equal(calls.length, 1, "cache hit ต้องไม่ยิง API ซ้ำ")
})

test("getUser ในกลุ่ม → ลอง getGroupMemberProfile ก่อน", async () => {
  const { src, calls } = fakeSource()
  const cache = new ProfileCache(src, { now: () => 1_700_000_000_000 })
  const p = await cache.getUser("U1", "C1")
  assert.equal(p!.displayName, "จากสมาชิกกลุ่ม")
  assert.deepEqual(calls, ["getGroupMemberProfile:C1:U1"])
})

test("getGroupMemberProfile พัง → fallback getProfile", async () => {
  const { src, calls } = fakeSource({
    async getGroupMemberProfile() { throw new Error("ไม่มีสิทธิ์") },
  })
  const cache = new ProfileCache(src, { now: () => 1_700_000_000_000 })
  const p = await cache.getUser("U1", "C1")
  assert.equal(p!.displayName, "จากโปรไฟล์")
  assert.ok(calls.includes("getProfile:U1"))
})

test("displayName ว่าง → Unknown เหมือน v1", async () => {
  const { src } = fakeSource({ async getProfile() { return { displayName: "" } } })
  const cache = new ProfileCache(src, { now: () => 1_700_000_000_000 })
  assert.equal((await cache.getUser("U1"))!.displayName, "Unknown")
})

test("API พังทั้งหมด → คืน cache เก่าแม้หมดอายุ ไม่ใช่ null", async () => {
  let fail = false
  const { src } = fakeSource({
    async getProfile() { if (fail) throw new Error("เน็ตล่ม"); return { displayName: "สมชาย" } },
  })
  let t = 1_700_000_000_000
  const cache = new ProfileCache(src, { now: () => t })
  await cache.getUser("U1")
  fail = true
  t += PROFILE_TTL_MS + 1                        // cache หมดอายุแล้ว
  const p = await cache.getUser("U1")
  assert.equal(p!.displayName, "สมชาย", "ต้องคืนของเก่า ไม่ใช่ null")
})

test("ไม่มี cache และ API พัง → null", async () => {
  const { src } = fakeSource({ async getProfile() { throw new Error("เน็ตล่ม") } })
  const cache = new ProfileCache(src, { now: () => 1_700_000_000_000 })
  assert.equal(await cache.getUser("U1"), null)
})

test("cache หมดอายุ → ยิงใหม่ และ firstSeen ไม่หาย", async () => {
  const { src, calls } = fakeSource()
  // ใช้ timestamp จริง ไม่ใช่ 0 — v1 เขียน `cached?.firstSeen || Date.now()`
  // ซึ่ง firstSeen เป็น 0 จะถูกมองว่า falsy · core ยกมาตามนั้น ไม่แก้เงียบ ๆ
  let t = 1_700_000_000_000
  const cache = new ProfileCache(src, { now: () => t })
  const a = await cache.getUser("U1")
  t += PROFILE_TTL_MS + 1
  const b = await cache.getUser("U1")
  assert.equal(calls.length, 2, "หมดอายุแล้วต้องยิงใหม่")
  assert.equal(b!.firstSeen, a!.firstSeen, "firstSeen ต้องคงเดิม")
  assert.equal(b!.messageCount, 2, "นับต่อจากของเดิม")
})

test("getGroupName cache และ fallback ของเก่าเมื่อพัง", async () => {
  let fail = false
  const calls: string[] = []
  const { src } = fakeSource({
    async getGroupSummary(g) {
      calls.push(`getGroupSummary:${g}`)
      if (fail) throw new Error("พัง")
      return { groupName: "ทีมกฎหมาย" }
    },
  })
  let t = 1_700_000_000_000
  const cache = new ProfileCache(src, { now: () => t })
  assert.equal(await cache.getGroupName("C1"), "ทีมกฎหมาย")
  assert.equal(await cache.getGroupName("C1"), "ทีมกฎหมาย")
  assert.equal(calls.length, 1, "cache hit ต้องไม่ยิงซ้ำ")

  fail = true
  t += PROFILE_TTL_MS + 1
  assert.equal(await cache.getGroupName("C1"), "ทีมกฎหมาย", "พังแล้วคืนของเก่า")
})

test("evictExpired เก็บกวาดของหมดอายุ — v1 ไม่มี", async () => {
  const { src } = fakeSource()
  let t = 1_700_000_000_000
  const cache = new ProfileCache(src, { now: () => t })
  await cache.getUser("U1")
  await cache.getGroupName("C1")
  assert.deepEqual(cache.size, { users: 1, groups: 1 })

  assert.deepEqual(cache.evictExpired(), { users: 0, groups: 0 }, "ยังไม่หมดอายุ ต้องไม่ลบ")
  t += PROFILE_TTL_MS + 1
  assert.deepEqual(cache.evictExpired(), { users: 1, groups: 1 })
  assert.deepEqual(cache.size, { users: 0, groups: 0 })
})

test("peekUser ไม่ยิง API", async () => {
  const { src, calls } = fakeSource()
  const cache = new ProfileCache(src, { now: () => 1_700_000_000_000 })
  assert.equal(cache.peekUser("U1"), undefined)
  await cache.getUser("U1")
  assert.equal(cache.peekUser("U1")!.displayName, "จากโปรไฟล์")
  assert.equal(calls.length, 1)
})
