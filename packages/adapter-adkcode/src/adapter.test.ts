import { test } from "node:test"
import assert from "node:assert/strict"
import { AdkcodeAdapter } from "./adapter.ts"
import { SessionBusyError } from "./client.ts"
import { buildPrefix, QUESTION_GUARD, GROUP_CHAT_INSTRUCTION } from "./prompt.ts"

interface Req { method: string; path: string; body?: any }

function fakeServer(handler: (r: Req) => { status?: number; body?: unknown } | Promise<{ status?: number; body?: unknown }>) {
  const seen: Req[] = []
  const abortError = () => { const e = new Error("The operation was aborted"); e.name = "AbortError"; return e }
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input))
    const req: Req = { method: init?.method ?? "GET", path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : undefined }
    seen.push(req)
    const settled = await Promise.race([
      Promise.resolve(handler(req)),
      new Promise<never>((_, reject) => {
        const s = init?.signal
        if (!s) return
        if (s.aborted) return reject(abortError())
        s.addEventListener("abort", () => reject(abortError()), { once: true })
      }),
    ])
    const { status = 200, body = {} } = settled
    return new Response(JSON.stringify(body), { status }) as any
  }
  return { seen, fetchImpl }
}

const make = (fetchImpl: typeof fetch, over = {}) =>
  new AdkcodeAdapter({ url: "http://server:8000", fetchImpl, promptTimeoutMs: 800, ...over })

const prompt = (over = {}) => ({
  sessionKey: "line-c1", userId: "U4af4980629f1b2c3", text: "สวัสดี", isGroup: false, ...over,
}) as any

test("สร้าง session พร้อม user_id — ADK ผูก session กับผู้ใช้", async () => {
  const { seen, fetchImpl } = fakeServer((r) =>
    r.path === "/session" ? { body: { id: "s1" } } : { body: { result: "ตอบ" } })
  const out = await make(fetchImpl).sendPrompt(prompt())
  assert.equal(out.result, "ตอบ")
  assert.deepEqual(seen[0]!.body, { user_id: "U4af4980629f1b2c3" },
    "engine อื่น createSession ไม่ต้องรู้จักผู้ใช้ ADK ต้องรู้")
})

test("session ถูกใช้ซ้ำ ไม่สร้างใหม่ทุกข้อความ", async () => {
  let made = 0
  const { fetchImpl } = fakeServer((r) =>
    r.path === "/session" && r.method === "POST" ? { body: { id: `s${++made}` } } : { body: { result: "ตอบ" } })
  const a = make(fetchImpl)
  await a.sendPrompt(prompt())
  await a.sendPrompt(prompt())
  assert.equal(made, 1)
  assert.deepEqual(a.sessionInfo("line-c1"), { sessionId: "s1" })
})

test("409 → SessionBusyError และ core แปลงเป็น conflict ไม่ใช่ internal", async () => {
  const { fetchImpl } = fakeServer((r) =>
    r.path === "/session" && r.method === "POST"
      ? { body: { id: "s1" } }
      : { status: 409, body: { detail: "Session is busy" } })
  await assert.rejects(make(fetchImpl).sendPrompt(prompt()), SessionBusyError)

  const { classify, toUserMessage } = await import("@botforge/core/errors")
  const err = new SessionBusyError("line-c1")
  assert.equal(classify(err).category, "conflict")
  assert.equal(classify(err).retryable, true)
  assert.ok(toUserMessage(err).includes("รอสักครู่"))
})

test("404 → สร้าง session ใหม่แล้วลองอีกครั้ง (feature 2.6)", async () => {
  let made = 0, first = true
  const { seen, fetchImpl } = fakeServer((r) => {
    if (r.path === "/session" && r.method === "POST") return { body: { id: `s${++made}` } }
    if (first) { first = false; return { status: 404, body: { detail: "Session not found" } } }
    return { body: { result: "ตอบหลัง retry" } }
  })
  assert.equal((await make(fetchImpl).sendPrompt(prompt())).result, "ตอบหลัง retry")
  assert.equal(made, 2)
  assert.equal(seen.filter((r) => r.path.endsWith("/message")).length, 2)
})

test("timeout → timedOut และ abort ถูกส่ง · ไม่มีคำตอบบางส่วนให้ดึง", async () => {
  const { seen, fetchImpl } = fakeServer(async (r) => {
    if (r.path === "/session" && r.method === "POST") return { body: { id: "s1" } }
    if (r.path === "/session/s1/abort") return { body: {} }
    await new Promise((res) => setTimeout(res, 3000))
    return { body: {} }
  })
  const out = await make(fetchImpl, { promptTimeoutMs: 80 }).sendPrompt(prompt())
  assert.equal(out.timedOut, true)
  assert.equal(out.result, "", "adkcode ไม่มี fetchLastAssistantMessage แบบ opencode")
  assert.ok(seen.some((r) => r.path === "/session/s1/abort"))
})

test("is_error จาก server ไหลผ่านมาให้ core แปลง", async () => {
  const { fetchImpl } = fakeServer((r) =>
    r.path === "/session" && r.method === "POST"
      ? { body: { id: "s1" } }
      : { body: { result: "Server 429: rate limit exceeded", is_error: true } })
  const out = await make(fetchImpl).sendPrompt(prompt())
  assert.equal(out.isError, true)
  const { toUserMessage } = await import("@botforge/core/errors")
  assert.equal(toUserMessage(out.result), "เกิน rate limit ครับ รอสักครู่แล้วลองใหม่")
})

test("result ว่าง → ข้อความมาตรฐาน", async () => {
  const { fetchImpl } = fakeServer((r) =>
    r.path === "/session" && r.method === "POST" ? { body: { id: "s1" } } : { body: {} })
  assert.equal((await make(fetchImpl).sendPrompt(prompt())).result, "เสร็จแล้วครับ (ไม่มีข้อความตอบกลับ)")
})

test("/new ลบ session ฝั่ง server · /abort เรียก endpoint", async () => {
  const { seen, fetchImpl } = fakeServer((r) =>
    r.path === "/session" && r.method === "POST" ? { body: { id: "s1" } } : { body: { result: "ok" } })
  const a = make(fetchImpl)
  assert.equal(await a.abort("line-c1"), false)
  await a.sendPrompt(prompt())
  assert.equal(await a.abort("line-c1"), true)
  await a.resetSession("line-c1")
  assert.equal(a.sessionInfo("line-c1"), null)
  assert.ok(seen.some((r) => r.method === "DELETE" && r.path === "/session/s1"))
})

test("ประกาศ observabilityDepth: turn ตามความจริง", () => {
  const { fetchImpl } = fakeServer(() => ({ body: {} }))
  const a = make(fetchImpl)
  assert.equal(a.observabilityDepth, "turn",
    "sub-agent มองไม่เห็นจากภายนอก — execution/v1 บอกว่าห้ามถือว่า execution ที่ไม่มี step คือไม่ได้ทำอะไร")
  assert.equal(a.cancellation, "graceful")
})

// ── prompt ──

test("prefix ของ adkcode — question guard คนละแบบกับ opencode", () => {
  const p = buildPrefix({ userContext: "[User: สมชาย]", groupName: "ทีมกฎหมาย",
    quotedMessageId: "m-1", isGroup: true, now: new Date("2026-08-23T07:30:05Z") })
  assert.ok(p.startsWith(QUESTION_GUARD))
  assert.ok(p.includes("Do NOT ask clarifying questions"))
  assert.equal(p.includes("question tool"), false, "ของ opencode ระบุเจาะจงว่า question tool")
  assert.ok(p.includes("[User: สมชาย] [Group: ทีมกฎหมาย] [Time: 2026-08-23 14:30:05+07:00]"))
  assert.ok(p.includes("[Reply to message ID: m-1]"))
})

test("v1 ไม่มี GROUP CHAT instruction — [SKIP] จึงยิงได้แค่บังเอิญ", () => {
  const v1 = buildPrefix({ isGroup: true, now: new Date("2026-08-23T07:30:05Z") })
  assert.equal(v1.includes(GROUP_CHAT_INSTRUCTION), false,
    "ยกมาตามจริง — adkcode เป็น engine เดียวใน 9 ที่ไม่มีข้อนี้ (feature 4.7)")

  const opted = buildPrefix({ isGroup: true, groupChatInstruction: true, now: new Date("2026-08-23T07:30:05Z") })
  assert.ok(opted.includes(GROUP_CHAT_INSTRUCTION), "เปิดได้ถ้าอยากให้ [SKIP] ทำงานจริง")
})

test("1:1 ไม่มี GROUP CHAT แม้เปิด option", () => {
  const p = buildPrefix({ isGroup: false, groupChatInstruction: true, now: new Date("2026-08-23T07:30:05Z") })
  assert.equal(p.includes(GROUP_CHAT_INSTRUCTION), false)
})
