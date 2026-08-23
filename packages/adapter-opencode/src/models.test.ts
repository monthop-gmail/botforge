import { test } from "node:test"
import assert from "node:assert/strict"
import { MODELS, DEFAULT_MODEL, FREE_MODELS, isNoTools, modelSwitchedMessage, NO_TOOLS_NOTE } from "./models.ts"

test("ทะเบียนตรงกับ v1-final — 18 model ครบทุก provider", () => {
  const byProvider: Record<string, number> = {}
  for (const spec of Object.values(MODELS)) byProvider[spec.providerID] = (byProvider[spec.providerID] ?? 0) + 1
  assert.equal(Object.keys(MODELS).length, 18)
  assert.deepEqual(byProvider, {
    opencode: 2,          // ฟรีผ่าน Zen
    deepseek: 2,
    qwen: 1,
    groq: 1,
    okmd: 8,              // OKMD AI Playground — key เดียว โควต้าแยกต่อ model
    openthaigpt: 1,       // thaillm.or.th ใช้ providerID แยกต่อโมเดล
    pathumma: 1,
    "typhoon-thai": 1,
    thalle: 1,
  })
})

test("DEFAULT_MODEL และ FREE_MODELS มีอยู่จริงในทะเบียน", () => {
  assert.ok(MODELS[DEFAULT_MODEL], DEFAULT_MODEL)
  for (const k of FREE_MODELS) assert.ok(MODELS[k], k)
  assert.equal(FREE_MODELS.includes(DEFAULT_MODEL as any), true, "ค่าเริ่มต้นต้องเป็นตัวฟรี")
})

test("noTools ติดเฉพาะสองตัวที่ v1-final ระบุ", () => {
  const flagged = Object.entries(MODELS).filter(([, s]) => s.noTools).map(([k]) => k).sort()
  assert.deepEqual(flagged, ["thaillm/openthaigpt-8b", "thaillm/pathumma-8b"])
  assert.equal(isNoTools("thaillm/pathumma-8b"), true)
  assert.equal(isNoTools("okmd/gpt-5.4"), false)
  assert.equal(isNoTools("ไม่มีจริง"), false)
})

test("modelSwitchedMessage ต่อคำเตือนเฉพาะตัวที่ไม่มี tool", () => {
  assert.ok(modelSwitchedMessage("thaillm/pathumma-8b").endsWith(NO_TOOLS_NOTE))
  assert.equal(modelSwitchedMessage("okmd/gpt-5.4").includes(NO_TOOLS_NOTE), false)
  assert.ok(modelSwitchedMessage("okmd/gpt-5.4").includes("Session ใหม่พร้อมใช้งาน"))
  assert.ok(modelSwitchedMessage("ไม่มีจริง").includes("ไม่รู้จัก model"))
})

test("key ทุกตัวเป็นรูป provider/model และ modelID ไม่ว่าง", () => {
  for (const [key, spec] of Object.entries(MODELS)) {
    assert.match(key, /^[a-z0-9.-]+\/[a-z0-9./-]+$/, key)
    assert.ok(spec.modelID.length > 0, key)
    assert.ok(spec.label.length > 0, key)
  }
})
