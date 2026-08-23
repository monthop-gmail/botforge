import { test } from "node:test"
import assert from "node:assert/strict"
import {
  ID_PATTERN, isId, assertId, toChannelId, parseChannelId,
  makePrincipal, resolveScope, InvalidIdError, MissingScopeError,
} from "./identity.ts"

/** id จริงที่ LINE ออกให้ — ขึ้นต้นด้วย U (user) · C (group) · R (room) เสมอ */
const LINE_USER = "U4af4980629f1b2c3d4e5f6a7b8c9d0e1"
const LINE_GROUP = "Ca56f9e2b1c3d4e5f6a7b8c9d0e1f2a3"
const LINE_ROOM = "R1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"

test("LINE id ดิบใช้เป็น identity/v1 Id ไม่ได้ — เหตุผลที่ต้องมี toChannelId", () => {
  for (const raw of [LINE_USER, LINE_GROUP, LINE_ROOM]) {
    assert.equal(isId(raw), false, `${raw} ไม่ควรผ่าน ID_PATTERN`)
  }
})

test("toChannelId ทำให้ผ่าน ID_PATTERN", () => {
  for (const raw of [LINE_USER, LINE_GROUP, LINE_ROOM]) {
    const id = toChannelId("line", raw)
    assert.match(id, ID_PATTERN)
    assert.ok(id.startsWith("line-"))
    assert.ok(id.length <= 63, `ยาว ${id.length} เกิน 63`)
  }
})

test("toChannelId เป็น deterministic และย้อนกลับได้", () => {
  const id = toChannelId("line", LINE_USER)
  assert.equal(id, toChannelId("line", LINE_USER))
  assert.equal(id, "line-u4af4980629f1b2c3d4e5f6a7b8c9d0e1")
  assert.deepEqual(parseChannelId(id), { channel: "line", rawId: LINE_USER.toLowerCase() })
})

test("channel ต่างกันไม่ชนกัน — รองรับ Phase 5 multi-channel", () => {
  const same = "abc123"
  assert.notEqual(toChannelId("line", same), toChannelId("telegram", same))
  assert.notEqual(toChannelId("web", same), toChannelId("discord", same))
})

test("toChannelId ปฏิเสธ id ที่ยังผิดหลังใส่ prefix", () => {
  assert.throws(() => toChannelId("line", ""), InvalidIdError)
  assert.throws(() => toChannelId("line", "has space"), InvalidIdError)
  assert.throws(() => toChannelId("line", "มีไทย"), InvalidIdError)
  assert.throws(() => toChannelId("line", "x".repeat(60)), InvalidIdError)  // 5 + 60 = 65 > 63
})

test("assertId ผ่านเฉพาะที่ตรง pattern", () => {
  assert.equal(assertId("legal-opencode"), "legal-opencode")
  assert.equal(assertId("cowork"), "cowork")
  assert.equal(assertId("vithisa-49m"), "vithisa-49m")
  assert.throws(() => assertId("Legal"), InvalidIdError)
  assert.throws(() => assertId("-leading-dash"), InvalidIdError)
  assert.throws(() => assertId("has.dot"), InvalidIdError)
})

test("makePrincipal สร้าง Principal ตาม identity/v1", () => {
  const p = makePrincipal("line", LINE_USER, "สมชาย")
  assert.deepEqual(p, { type: "human", id: "line-u4af4980629f1b2c3d4e5f6a7b8c9d0e1", display_name: "สมชาย" })
  // ไม่มีชื่อ = ไม่ใส่ field ไม่ใช่ใส่ค่าว่าง
  assert.deepEqual(makePrincipal("line", LINE_USER), { type: "human", id: "line-u4af4980629f1b2c3d4e5f6a7b8c9d0e1" })
  assert.deepEqual(makePrincipal("line", LINE_USER, ""), { type: "human", id: "line-u4af4980629f1b2c3d4e5f6a7b8c9d0e1" })
})

test("resolveScope บังคับให้ประกาศ tenant/workspace ห้ามเดา", () => {
  assert.deepEqual(
    resolveScope({ BOTFORGE_TENANT_ID: "legal", BOTFORGE_WORKSPACE_ID: "legal-opencode" }),
    { tenant_id: "legal", workspace_id: "legal-opencode" },
  )
  assert.throws(() => resolveScope({}), MissingScopeError)
  assert.throws(() => resolveScope({ BOTFORGE_TENANT_ID: "legal" }), MissingScopeError)
  assert.throws(() => resolveScope({ BOTFORGE_WORKSPACE_ID: "legal-opencode" }), MissingScopeError)
})

test("resolveScope ปฏิเสธ id ที่ผิด pattern", () => {
  assert.throws(
    () => resolveScope({ BOTFORGE_TENANT_ID: "Legal Corp", BOTFORGE_WORKSPACE_ID: "legal-opencode" }),
    InvalidIdError,
  )
})

test("ชื่อ project จริงทุกตัวใช้เป็น workspace_id ได้", () => {
  // จาก projects/ ที่ v1-final — รวมสองตัวที่ไม่ตามรูปแบบ {tenant}-{engine}
  const projects = [
    "cowork-claudecode", "cowork-opencode", "dede-opencode", "hct-opencode",
    "legal-adkcode", "legal-claudecode", "legal-copilot", "legal-opencode",
    "legal-services", "mtr-opencode", "nst-opencode", "onboard-opencode",
    "vithisa-49m", "willpower-opencode",
  ]
  for (const p of projects) assert.match(p, ID_PATTERN, `${p} ใช้เป็น workspace_id ไม่ได้`)
})
