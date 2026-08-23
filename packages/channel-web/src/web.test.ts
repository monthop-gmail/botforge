import { test } from "node:test"
import assert from "node:assert/strict"
import { createWebChannel } from "./server.ts"
import { ChannelHub } from "./hub.ts"
import { WebTransport } from "./transport.ts"
import type { RuntimePort, PromptInput, RuntimeResult } from "@botforge/core/router"
import { EventEmitter, MemorySink, BotforgeEvents } from "@botforge/core/events"
import { resolveScope } from "@botforge/core/identity"

/** runtime ปลอม — บันทึกสิ่งที่ core ส่งมาให้ */
function fakeRuntime(reply: (i: PromptInput) => RuntimeResult | Promise<RuntimeResult>) {
  const seen: PromptInput[] = []
  const runtime: RuntimePort = { async sendPrompt(i) { seen.push(i); return reply(i) } }
  return { runtime, seen }
}

/** อ่าน SSE จนกว่าจะเจอ event ที่รอ */
async function collectSse(url: string, want: string, timeoutMs = 4000): Promise<any[]> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  const res = await fetch(url, { signal: ac.signal })
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  const events: any[] = []
  let buf = ""
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let i
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, i); buf = buf.slice(i + 2)
        const ev = /^event: (.+)$/m.exec(frame)?.[1]
        const data = /^data: (.+)$/m.exec(frame)?.[1]
        if (ev && data) events.push({ event: ev, data: JSON.parse(data) })
      }
      if (events.some((e) => e.event === want)) break
    }
  } finally { clearTimeout(timer); ac.abort() }
  return events
}

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${url}/message`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) })

test("ข้อความจากเว็บถึง runtime แล้วกลับมาทาง SSE", async () => {
  const { runtime, seen } = fakeRuntime(() => ({ result: "สวัสดีจากบอท" }))
  const ch = await createWebChannel({ runtime })
  try {
    const sse = collectSse(`${ch.url}/events?c=room-1`, "done")
    await new Promise((r) => setTimeout(r, 50))
    const res = await post(ch.url, { conversationId: "room-1", text: "สวัสดี" })
    assert.equal(res.status, 202)

    const events = await sse
    assert.deepEqual(events.map((e) => e.event), ["ready", "message", "message", "done"])
    assert.deepEqual(events[1]!.data, { role: "user", text: "สวัสดี" })
    assert.deepEqual(events[2]!.data, { role: "assistant", text: "สวัสดีจากบอท" })
    assert.deepEqual(events[3]!.data, { kind: "answered" })

    // runtime ได้รับ sessionKey เป็น id ที่ผ่าน toChannelId แล้ว
    assert.equal(seen.length, 1)
    assert.equal(seen[0]!.text, "สวัสดี")
    assert.equal(seen[0]!.isGroup, false)
  } finally { await ch.close() }
})

test("หลายแท็บในห้องเดียวกันได้รับเหมือนกัน", async () => {
  const { runtime } = fakeRuntime(() => ({ result: "ตอบ" }))
  const ch = await createWebChannel({ runtime })
  try {
    const a = collectSse(`${ch.url}/events?c=room-2`, "done")
    const b = collectSse(`${ch.url}/events?c=room-2`, "done")
    await new Promise((r) => setTimeout(r, 80))
    await post(ch.url, { conversationId: "room-2", text: "ถาม" })
    const [ea, eb] = await Promise.all([a, b])
    for (const events of [ea, eb]) {
      assert.ok(events.some((e) => e.event === "message" && e.data.role === "assistant"))
    }
  } finally { await ch.close() }
})

test("ห้องต่างกันไม่ได้ยินกัน", async () => {
  const { runtime } = fakeRuntime((i) => ({ result: `ตอบ:${i.text}` }))
  const ch = await createWebChannel({ runtime })
  try {
    const a = collectSse(`${ch.url}/events?c=room-a`, "done")
    await new Promise((r) => setTimeout(r, 50))
    await post(ch.url, { conversationId: "room-b", text: "ของห้อง b" })
    await post(ch.url, { conversationId: "room-a", text: "ของห้อง a" })
    const events = await a
    const texts = events.filter((e) => e.event === "message").map((e) => e.data.text)
    assert.ok(texts.includes("ของห้อง a"))
    assert.equal(texts.some((t) => String(t).includes("ห้อง b")), false)
  } finally { await ch.close() }
})

test("ตอบตอนยังไม่มีใครฟัง → เก็บไว้ให้ client ที่ต่อทีหลัง", async () => {
  const { runtime } = fakeRuntime(() => ({ result: "ตอบตอนไม่มีคนฟัง" }))
  const ch = await createWebChannel({ runtime })
  try {
    await post(ch.url, { conversationId: "room-late", text: "ถามก่อนเปิดแท็บ" })
    await new Promise((r) => setTimeout(r, 120))
    const events = await collectSse(`${ch.url}/events?c=room-late`, "message")
    assert.ok(events.some((e) => e.event === "message" && e.data.text === "ตอบตอนไม่มีคนฟัง"))
  } finally { await ch.close() }
})

test("payload ไม่ครบ → 400 · conversationId ที่ใช้เป็น id ไม่ได้ → 400", async () => {
  const { runtime } = fakeRuntime(() => ({ result: "x" }))
  const ch = await createWebChannel({ runtime })
  try {
    assert.equal((await post(ch.url, { text: "ไม่มี id" })).status, 400)
    assert.equal((await post(ch.url, { conversationId: "r" })).status, 400)
    assert.equal((await post(ch.url, { conversationId: "มีไทย ไม่ได้", text: "hi" })).status, 400)
    assert.equal((await fetch(`${ch.url}/events`)).status, 400, "ไม่มี ?c=")
  } finally { await ch.close() }
})

test("token ปิดกั้นได้ และหน้าเว็บยังเปิดได้", async () => {
  const { runtime } = fakeRuntime(() => ({ result: "x" }))
  const ch = await createWebChannel({ runtime, token: "s3cret" })
  try {
    assert.equal((await post(ch.url, { conversationId: "r1", text: "hi" })).status, 401)
    assert.equal((await post(ch.url, { conversationId: "r1", text: "hi" }, { "x-botforge-token": "s3cret" })).status, 202)
    assert.equal((await fetch(ch.url)).status, 200, "หน้าเว็บต้องเปิดได้เพื่อให้ผู้ใช้ใส่ token")
  } finally { await ch.close() }
})

test("runtime ล้ม → ผู้ใช้ได้ข้อความไทยจาก core และ done: answered", async () => {
  const { runtime } = fakeRuntime(() => { throw new Error("Server 429: rate limit exceeded") })
  const ch = await createWebChannel({ runtime })
  try {
    const sse = collectSse(`${ch.url}/events?c=room-err`, "done")
    await new Promise((r) => setTimeout(r, 50))
    await post(ch.url, { conversationId: "room-err", text: "ถาม" })
    const events = await sse
    const bot = events.find((e) => e.event === "message" && e.data.role === "assistant")
    assert.equal(bot!.data.text, "เกิน rate limit ครับ รอสักครู่แล้วลองใหม่")
    assert.deepEqual(events.at(-1)!.data, { kind: "failed" })
  } finally { await ch.close() }
})

test("audit event ใช้ channel_type: web — schema เดียวกับ LINE", async () => {
  const { runtime } = fakeRuntime(() => ({ result: "ตอบ" }))
  const sink = new MemorySink()
  const scope = resolveScope({ BOTFORGE_TENANT_ID: "demo", BOTFORGE_WORKSPACE_ID: "demo-web" })
  const ch = await createWebChannel({
    runtime, runtimeName: "fake",
    events: new BotforgeEvents(new EventEmitter(scope, { sink })),
  })
  try {
    const sse = collectSse(`${ch.url}/events?c=room-ev`, "done")
    await new Promise((r) => setTimeout(r, 50))
    await post(ch.url, { conversationId: "room-ev", text: "ถาม" })
    await sse
    assert.deepEqual(sink.events.map((e) => e.event_type),
      ["STATE_TRANSITION", "EXECUTION_STARTED", "STATE_TRANSITION"])
    assert.equal(sink.events[0]!.channel_type, "web")
    assert.equal(sink.events[0]!.channel_id, "web-room-ev")
  } finally { await ch.close() }
})

test("health และหน้าเว็บ", async () => {
  const { runtime } = fakeRuntime(() => ({ result: "x" }))
  const ch = await createWebChannel({ runtime, displayName: "ทดสอบ" })
  try {
    assert.deepEqual(await (await fetch(`${ch.url}/health`)).json(), { ok: true })
    const html = await (await fetch(ch.url)).text()
    assert.ok(html.includes("ทดสอบ"))
    assert.ok(html.includes("EventSource"))
    assert.equal((await fetch(`${ch.url}/ไม่มี`)).status, 404)
  } finally { await ch.close() }
})

// ── hub / transport ──

test("hub เก็บกวาดห้องที่ว่างแล้ว", () => {
  const hub = new ChannelHub()
  const client = { write: () => true, close: () => {} }
  const off = hub.subscribe("r", client)
  assert.equal(hub.roomCount, 1)
  off()
  assert.equal(hub.roomCount, 0, "ห้องว่างต้องถูกลบ ไม่งั้น Map โตตามจำนวนห้องที่เคยมีคนเข้า")
})

test("client ที่เขียนไม่ได้ถูกถอดออกเอง", () => {
  const hub = new ChannelHub()
  hub.subscribe("r", { write: () => false, close: () => {} })
  hub.subscribe("r", { write: () => true, close: () => {} })
  assert.equal(hub.broadcast("r", "message", {}), 1)
  assert.equal(hub.clientCount("r"), 1)
})

test("backlog จำกัดจำนวน ไม่โตไม่หยุด", async () => {
  const hub = new ChannelHub()
  const t = new WebTransport(hub, { backlogLimit: 3 })
  for (let i = 0; i < 10; i++) await t.push("r", `ข้อความ ${i}`)
  const drained = t.drain("r")
  assert.equal(drained.length, 3)
  assert.deepEqual(drained, ["ข้อความ 7", "ข้อความ 8", "ข้อความ 9"], "เก็บอันล่าสุด")
  assert.deepEqual(t.drain("r"), [], "drain แล้วต้องว่าง")
})
