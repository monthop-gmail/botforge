import { test } from "node:test"
import assert from "node:assert/strict"
import { runRuntimeConformance } from "./conformance.ts"
import { declareCapabilities, type RuntimeCapabilities } from "./capabilities.ts"
import type { RuntimeAdapter } from "./port.ts"

function fake(
  caps: Partial<RuntimeCapabilities>,
  extra: Record<string, unknown> = {},
): RuntimeAdapter {
  return {
    sendPrompt: async () => ({ result: "ok" }),
    describe: () => ({ name: "fake", family: "rest", capabilities: declareCapabilities(caps) }),
    ...extra,
  } as RuntimeAdapter
}

test("ไม่ประกาศอะไรเลยและไม่มีเมธอดพิเศษ = ผ่าน", async () => {
  assert.deepEqual(await runRuntimeConformance(fake({})), [])
})

test("ประกาศแล้วไม่มีของ = แดงทุก capability", async () => {
  const p = await runRuntimeConformance(
    fake({ sessions: true, abort: true, model: true, persistence: true }),
  )
  for (const m of ["resetSession", "sessionInfo", "abort", "setModel", "modelOf",
                   "exportSession", "restoreSession"]) {
    assert.ok(p.some((x) => x.includes(`${m}()`)), `ต้องฟ้องว่าไม่มี ${m}()`)
  }
})

test("มีของแต่ไม่ประกาศ = แดงด้วย — ความสามารถที่ไม่มีใครรับผิดชอบ", async () => {
  const p = await runRuntimeConformance(fake({}, { abort: () => true }))
  assert.equal(p.length, 1)
  assert.match(p[0]!, /มีเมธอด abort\(\) แต่ประกาศ abort: false/)
})

test("ไม่มี describe() = หยุดตรงนั้น", async () => {
  // ตั้งใจส่งของที่ไม่มี describe() เข้าไป — ผ่าน unknown เพราะ TS รู้ว่ามันไม่ใช่ RuntimeAdapter
  const noDescribe = { sendPrompt: async () => ({ result: "" }) } as unknown as RuntimeAdapter
  const p = await runRuntimeConformance(noDescribe)
  assert.deepEqual(p, ["ไม่มี describe() — adapter ต้องประกาศความสามารถของตัวเอง"])
})

test("capability ที่เป็น undefined = แดง (ต้องเขียน false ไม่ใช่เว้นว่าง)", async () => {
  const bad = {
    sendPrompt: async () => ({ result: "" }),
    describe: () => ({ name: "x", family: "rest", capabilities: { sessions: true } as any }),
  } as RuntimeAdapter
  const p = await runRuntimeConformance(bad)
  assert.ok(p.some((x) => x.includes("capabilities.abort ไม่ใช่ boolean")))
})

test("ชั้น live — usage ที่ประกาศไว้แต่ยิงจริงไม่มี = แดง", async () => {
  const p = await runRuntimeConformance(fake({ usage: true }), {
    probe: { sessionKey: "k", send: async () => ({}) },
  })
  assert.ok(p.some((x) => x.includes("ประกาศ usage: true แต่ยิงจริง")))
})

test("ชั้น live — persistence ที่ export ไม่ออก = แดง", async () => {
  const p = await runRuntimeConformance(
    fake({ persistence: true }, {
      exportSession: () => null,
      restoreSession: () => false,
    }),
    { probe: { sessionKey: "k", send: async () => ({}) } },
  )
  assert.ok(p.some((x) => x.includes("exportSession() คืน null")))
})

test("ชั้น live — ครบทุกอย่างแล้วผ่าน", async () => {
  const p = await runRuntimeConformance(
    fake({ usage: true, persistence: true }, {
      exportSession: (k: string) => ({
        sessionKey: k, runtimeName: "fake", runtimeSessionId: "s1",
        createdAt: "t", lastUsedAt: "t",
      }),
      restoreSession: () => true,
    }),
    { probe: { sessionKey: "k", send: async () => ({ usage: { input_tokens: 1 } }) } },
  )
  assert.deepEqual(p, [])
})
