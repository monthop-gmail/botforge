import { test } from "node:test"
import assert from "node:assert/strict"
import { OpenCodeAdapter } from "./adapter.ts"
import { buildPrefix, QUESTION_TOOL_GUARD, GROUP_CHAT_INSTRUCTION } from "./prompt.ts"
import { DEFAULT_MODEL, MODELS } from "./models.ts"

interface Req { method: string; path: string; body?: any }

/** fake OpenCode serve — บันทึกทุก request แล้วตอบตามที่กำหนด */
function fakeServer(handler: (r: Req) => { status?: number; body?: unknown } | Promise<{ status?: number; body?: unknown }>) {
  const seen: Req[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input))
    const req: Req = {
      method: init?.method ?? "GET",
      path: url.pathname,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    }
    seen.push(req)
    // เคารพ AbortSignal เหมือน fetch จริง — ไม่งั้นทดสอบ timeout ไม่ได้
    const signal = init?.signal
    const result = handler(req)
    const settled = await Promise.race([
      Promise.resolve(result),
      new Promise<never>((_, reject) => {
        if (!signal) return
        if (signal.aborted) return reject(abortError())
        signal.addEventListener("abort", () => reject(abortError()), { once: true })
      }),
    ])
    const { status = 200, body = {} } = settled
    return new Response(JSON.stringify(body), { status }) as any
  }

  function abortError() {
    const e = new Error("The operation was aborted")
    e.name = "AbortError"
    return e
  }
  return { seen, fetchImpl }
}

const make = (fetchImpl: typeof fetch, over = {}) =>
  new OpenCodeAdapter({ url: "http://opencode:4096", password: "pw", fetchImpl, ...over })

const prompt = (over = {}) => ({
  sessionKey: "line-c1", userId: "U4af4980629f1b2c3", text: "สวัสดี",
  isGroup: false, ...over,
})

test("สร้าง session อัตโนมัติครั้งแรก แล้วใช้ซ้ำครั้งถัดไป", async () => {
  const { seen, fetchImpl } = fakeServer((r) =>
    r.path === "/session" ? { body: { id: "sess-1" } } : { body: { parts: [{ type: "text", text: "ตอบ" }] } },
  )
  const a = make(fetchImpl)
  assert.equal((await a.sendPrompt(prompt())).result, "ตอบ")
  assert.equal((await a.sendPrompt(prompt())).result, "ตอบ")
  assert.equal(seen.filter((r) => r.path === "/session" && r.method === "POST").length, 1, "ต้องสร้าง session ครั้งเดียว")
  assert.equal(seen.filter((r) => r.path === "/session/sess-1/message").length, 2)
})

test("ส่ง header และ model ตามที่ v1 ส่ง", async () => {
  let sentBody: any
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input))
    if (url.pathname === "/session") return new Response(JSON.stringify({ id: "s1" })) as any
    sentBody = JSON.parse(String(init!.body))
    const h = new Headers(init!.headers)
    assert.equal(h.get("x-opencode-directory"), encodeURIComponent("/workspace"))
    assert.ok(h.get("Authorization")?.startsWith("Basic "))
    return new Response(JSON.stringify({ parts: [{ type: "text", text: "ok" }] })) as any
  }
  await make(fetchImpl).sendPrompt(prompt())
  assert.deepEqual(sentBody.model, {
    providerID: MODELS[DEFAULT_MODEL]!.providerID,
    modelID: MODELS[DEFAULT_MODEL]!.modelID,
  })
  assert.ok(sentBody.parts[0].text.startsWith(QUESTION_TOOL_GUARD))
  assert.ok(sentBody.parts[0].text.endsWith("สวัสดี"))
})

test("prompt prefix ประกอบตามลำดับของ v1", () => {
  const p = buildPrefix({
    userContext: "[User Info: สมชาย (messages: 3)]",
    quotedMessageId: "m-1",
    isGroup: true,
    now: new Date("2026-08-23T07:30:05Z"),
  })
  const blocks = p.trimEnd().split("\n\n")
  assert.equal(blocks[0], QUESTION_TOOL_GUARD)
  assert.equal(blocks[1], "[User Info: สมชาย (messages: 3)]")
  assert.equal(blocks[2], "[This is a reply to a previous message (quoted message ID: m-1)]")
  assert.equal(blocks[3], "[Time: 2026-08-23 14:30:05+07:00]")
  assert.equal(blocks[4], GROUP_CHAT_INSTRUCTION)
})

test("ไม่อยู่ในกลุ่ม → ไม่มี GROUP CHAT instruction", () => {
  const p = buildPrefix({ isGroup: false, now: new Date("2026-08-23T07:30:05Z") })
  assert.equal(p.includes("GROUP CHAT"), false)
  assert.equal(p.includes("quoted message ID"), false)
})

test("session หมดอายุ (404) → สร้างใหม่แล้วลองอีกครั้ง (feature 2.6)", async () => {
  let sessionsMade = 0
  let firstMessage = true
  const { seen, fetchImpl } = fakeServer((r) => {
    if (r.path === "/session" && r.method === "POST") return { body: { id: `sess-${++sessionsMade}` } }
    if (firstMessage) { firstMessage = false; return { status: 404, body: { error: "session not found" } } }
    return { body: { parts: [{ type: "text", text: "ตอบหลัง retry" }] } }
  })
  const a = make(fetchImpl)
  assert.equal((await a.sendPrompt(prompt())).result, "ตอบหลัง retry")
  assert.equal(sessionsMade, 2, "ต้องสร้าง session ใหม่หลังเจอ 404")
  assert.equal(seen.filter((r) => r.path.endsWith("/message")).length, 2)
})

test("error ที่ไม่ใช่ 404 ไม่ retry — โยนต่อให้ core แปลงเป็นไทย", async () => {
  let attempts = 0
  const { fetchImpl } = fakeServer((r) => {
    if (r.path === "/session" && r.method === "POST") return { body: { id: "s1" } }
    attempts++
    return { status: 500, body: { error: "internal server error" } }
  })
  await assert.rejects(make(fetchImpl).sendPrompt(prompt()), /OpenCode API 500/)
  assert.equal(attempts, 1, "ต้องไม่ retry")
})

test("timeout แล้วได้คำตอบบางส่วน → truncated (feature 2.8)", async () => {
  const { seen, fetchImpl } = fakeServer(async (r) => {
    if (r.path === "/session" && r.method === "POST") return { body: { id: "s1" } }
    if (r.path === "/session/s1/message" && r.method === "POST") {
      await new Promise((res) => setTimeout(res, 50))
      return { body: {} }
    }
    if (r.path === "/session/s1/message" && r.method === "GET") {
      return { body: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "เขียนไปได้ครึ่ง" }] }] }
    }
    return { body: {} }
  })
  const out = await make(fetchImpl, { promptTimeoutMs: 10 }).sendPrompt(prompt())
  assert.equal(out.truncated, true)
  assert.equal(out.result, "เขียนไปได้ครึ่ง")
  assert.ok(seen.some((r) => r.path === "/session/s1/abort"), "ต้อง abort ก่อนดึงของบางส่วน")
})

test("timeout แล้วไม่มีอะไรเลย → timedOut", async () => {
  const { fetchImpl } = fakeServer(async (r) => {
    if (r.path === "/session" && r.method === "POST") return { body: { id: "s1" } }
    if (r.method === "GET") return { body: [] }
    await new Promise((res) => setTimeout(res, 50))
    return { body: {} }
  })
  const out = await make(fetchImpl, { promptTimeoutMs: 10 }).sendPrompt(prompt())
  assert.equal(out.timedOut, true)
  assert.equal(out.result, "")
})

test("/new ปิด session เดิม ครั้งถัดไปสร้างใหม่", async () => {
  let made = 0
  const { seen, fetchImpl } = fakeServer((r) => {
    if (r.path === "/session" && r.method === "POST") return { body: { id: `s${++made}` } }
    return { body: { parts: [{ type: "text", text: "ok" }] } }
  })
  const a = make(fetchImpl)
  await a.sendPrompt(prompt())
  await a.resetSession("line-c1")
  await a.sendPrompt(prompt())
  assert.equal(made, 2)
  assert.ok(seen.some((r) => r.method === "DELETE" && r.path === "/session/s1"))
})

test("/model เปลี่ยนแล้ว session ใหม่ใช้ model ใหม่ (feature 2.12)", async () => {
  let lastModel: any
  const { fetchImpl } = fakeServer((r) => {
    if (r.path === "/session" && r.method === "POST") return { body: { id: "s" + Math.random() } }
    if (r.body?.model) lastModel = r.body.model
    return { body: { parts: [{ type: "text", text: "ok" }] } }
  })
  const a = make(fetchImpl)
  await a.sendPrompt(prompt())
  assert.equal(lastModel.modelID, MODELS[DEFAULT_MODEL]!.modelID)

  await a.setModel("line-c1", "opencode/nemotron-3-super")
  assert.equal(a.modelOf("line-c1"), "opencode/nemotron-3-super")
  await a.sendPrompt(prompt())
  assert.equal(lastModel.modelID, "nemotron-3-super-free")
})

test("/model ที่ไม่รู้จักถูกปฏิเสธ", async () => {
  const { fetchImpl } = fakeServer(() => ({ body: {} }))
  await assert.rejects(make(fetchImpl).setModel("line-c1", "ไม่มีจริง"), /ไม่รู้จัก model/)
})

test("/abort เรียก endpoint ของ opencode — cancellation: graceful", async () => {
  const { seen, fetchImpl } = fakeServer((r) =>
    r.path === "/session" && r.method === "POST" ? { body: { id: "s1" } } : { body: { parts: [] } },
  )
  const a = make(fetchImpl)
  assert.equal(await a.abort("line-c1"), false, "ยังไม่มี session")
  await a.sendPrompt(prompt())
  assert.equal(await a.abort("line-c1"), true)
  assert.ok(seen.some((r) => r.path === "/session/s1/abort" && r.method === "POST"))
})

test("/sessions คืนข้อมูล session ปัจจุบัน", async () => {
  const { fetchImpl } = fakeServer((r) =>
    r.path === "/session" && r.method === "POST" ? { body: { id: "sess-abc" } } : { body: { parts: [] } },
  )
  const a = make(fetchImpl)
  assert.equal(a.sessionInfo("line-c1"), null)
  await a.sendPrompt(prompt())
  assert.deepEqual(a.sessionInfo("line-c1"), { sessionId: "sess-abc", model: DEFAULT_MODEL })
})

test("usage ถูกดึงเมื่อ payload มี cost/tokens", async () => {
  const { fetchImpl } = fakeServer((r) =>
    r.path === "/session" && r.method === "POST"
      ? { body: { id: "s1" } }
      : { body: { info: { cost: 0.0042, tokens: { input: 120, output: 45 } }, parts: [{ type: "text", text: "ok" }] } },
  )
  const out = await make(fetchImpl).sendPrompt(prompt())
  assert.deepEqual(out.usage, { cost_usd: 0.0042, input_tokens: 120, output_tokens: 45 })
})

test("กลุ่มกับ 1:1 ใช้ session คนละตัว", async () => {
  let made = 0
  const { fetchImpl } = fakeServer((r) =>
    r.path === "/session" && r.method === "POST" ? { body: { id: `s${++made}` } } : { body: { parts: [] } },
  )
  const a = make(fetchImpl)
  await a.sendPrompt(prompt({ sessionKey: "line-c1", isGroup: true }))
  await a.sendPrompt(prompt({ sessionKey: "line-u1", isGroup: false }))
  assert.equal(made, 2)
})
