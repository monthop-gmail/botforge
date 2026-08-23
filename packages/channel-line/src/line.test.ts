import { test } from "node:test"
import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import { createLineChannel } from "./server.ts"
import { classify } from "./webhook.ts"
import { welcomeMessage, NO_VISION_MESSAGE } from "./messages.ts"
import { triggersFor } from "@botforge/core/channel"
import type { LineApi } from "./api.ts"
import type { RuntimePort, PromptInput, RuntimeResult } from "@botforge/core/router"
import { EventEmitter, MemorySink, BotforgeEvents } from "@botforge/core/events"
import { resolveScope } from "@botforge/core/identity"

const SECRET = "test-channel-secret"
const BOT_ID = "Ubot0000000000000000000000000001"
const USER = "U4af4980629f1b2c3d4e5f6a7b8c9d0e1"
const GROUP = "Ca56f9e2b1c3d4e5f6a7b8c9d0e1f2a3"

function fakeApi() {
  const calls: Array<{ m: string; args: unknown }> = []
  const api: LineApi = {
    async replyMessage(a) { calls.push({ m: "reply", args: a }); return {} },
    async pushMessage(a) { calls.push({ m: "push", args: a }); return {} },
    async getProfile() { return { displayName: "สมชาย" } },
    async getGroupMemberProfile() { return { displayName: "สมชาย" } },
    async getGroupSummary() { return { groupName: "ทีมกฎหมาย" } },
    async showLoadingAnimation(a) { calls.push({ m: "loading", args: a }); return {} },
    async getBotInfo() { return { userId: BOT_ID } },
  }
  return { api, calls, texts: () => calls.filter((c) => c.m !== "loading").map((c) => (c.args as any).messages[0].text) }
}

function fakeRuntime(reply: (i: PromptInput) => RuntimeResult | Promise<RuntimeResult> = () => ({ result: "ตอบครับ" })) {
  const seen: PromptInput[] = []
  const reset: string[] = []
  const runtime = {
    async sendPrompt(i: PromptInput) { seen.push(i); return reply(i) },
    resetSession(k: string) { reset.push(k) },
  } satisfies RuntimePort & { resetSession(k: string): void }
  return { runtime, seen, reset }
}

const sign = (body: string) => createHmac("SHA256", SECRET).update(body).digest("base64")

async function webhook(url: string, events: unknown[], badSignature = false) {
  const body = JSON.stringify({ events })
  return fetch(`${url}/webhook`, {
    method: "POST",
    // signature ต้องเป็น ASCII — HTTP header เป็น ByteString ใส่ภาษาไทยไม่ได้
    headers: { "content-type": "application/json", "x-line-signature": badSignature ? "bm90LWEtc2lnbmF0dXJl" : sign(body) },
    body,
  })
}

const textEvent = (over: Record<string, unknown> = {}) => ({
  type: "message", replyToken: "TOKEN",
  message: { id: "m-1", type: "text", text: "สวัสดี" },
  source: { type: "user", userId: USER },
  ...over,
})

const settle = () => new Promise((r) => setTimeout(r, 80))

test("webhook 1:1 → runtime → reply กลับ", async () => {
  const { api, calls, texts } = fakeApi()
  const { runtime, seen } = fakeRuntime()
  const ch = await createLineChannel({ runtime, api, channelSecret: SECRET, host: "127.0.0.1" })
  try {
    assert.equal((await webhook(ch.url, [textEvent()])).status, 200)
    await settle()
    assert.equal(seen.length, 1)
    assert.equal(seen[0]!.text, "สวัสดี")
    assert.deepEqual(texts(), ["ตอบครับ"])
    assert.equal(calls[0]!.m, "loading", "1:1 ต้องโชว์ loading ก่อน")
  } finally { await ch.close() }
})

test("signature ผิด → 403 และไม่เรียก runtime", async () => {
  const { api } = fakeApi()
  const { runtime, seen } = fakeRuntime()
  const ch = await createLineChannel({ runtime, api, channelSecret: SECRET, host: "127.0.0.1" })
  try {
    assert.equal((await webhook(ch.url, [textEvent()], true)).status, 403)
    await settle()
    assert.equal(seen.length, 0)
  } finally { await ch.close() }
})

test("JSON พัง → 400", async () => {
  const { api } = fakeApi()
  const { runtime } = fakeRuntime()
  const ch = await createLineChannel({ runtime, api, channelSecret: SECRET, host: "127.0.0.1" })
  try {
    const body = "{ พัง"
    const res = await fetch(`${ch.url}/webhook`, {
      method: "POST", headers: { "x-line-signature": sign(body) }, body,
    })
    assert.equal(res.status, 400)
  } finally { await ch.close() }
})

test("ตอบ 200 ทันทีไม่รอ runtime — LINE จะได้ไม่ retry", async () => {
  const { api } = fakeApi()
  let release!: () => void
  const gate = new Promise<void>((r) => { release = r })
  const { runtime } = fakeRuntime(async () => { await gate; return { result: "ช้า" } })
  const ch = await createLineChannel({ runtime, api, channelSecret: SECRET, host: "127.0.0.1" })
  try {
    const started = Date.now()
    assert.equal((await webhook(ch.url, [textEvent()])).status, 200)
    assert.ok(Date.now() - started < 500, "ต้องไม่รอ runtime")
    release()
  } finally { await ch.close() }
})

test("ในกลุ่ม: ไม่ได้เรียกถึง → ไม่ตอบ · เรียกถึง → ตอบ", async () => {
  const { api, texts } = fakeApi()
  const { runtime, seen } = fakeRuntime()
  const ch = await createLineChannel({
    runtime, api, channelSecret: SECRET, host: "127.0.0.1", runtimeName: "opencode",
  })
  try {
    const group = { source: { type: "group", groupId: GROUP, userId: USER } }
    await webhook(ch.url, [textEvent({ ...group, message: { id: "m", type: "text", text: "คุยกันเอง" } })])
    await settle()
    assert.equal(seen.length, 0, "ไม่ได้เรียกถึงต้องไม่ยิง runtime เลย")

    await webhook(ch.url, [textEvent({ ...group, message: { id: "m", type: "text", text: "@bot ช่วยหน่อย" } })])
    await settle()
    assert.equal(seen.length, 1)
    assert.equal(seen[0]!.isGroup, true)
    assert.deepEqual(texts(), ["ตอบครับ"])
  } finally { await ch.close() }
})

test("join → welcome เฉพาะ group · leave → เคลียร์ session ของ runtime", async () => {
  const { api, texts } = fakeApi()
  const { runtime, reset } = fakeRuntime()
  const ch = await createLineChannel({
    runtime, api, channelSecret: SECRET, host: "127.0.0.1",
    botName: "OpenCode Bot", lineOaUrl: "https://line.me/ti/p/~x",
  })
  try {
    await webhook(ch.url, [{ type: "join", source: { type: "group", groupId: GROUP } }])
    await settle()
    assert.equal(texts().length, 1)
    assert.ok(texts()[0]!.includes("OpenCode Bot"))
    assert.ok(texts()[0]!.includes("https://line.me/ti/p/~x"))

    await webhook(ch.url, [{ type: "join", source: { type: "room", roomId: "R1" } }])
    await settle()
    assert.equal(texts().length, 1, "room ไม่ส่ง welcome — พฤติกรรมของ v1")

    await webhook(ch.url, [{ type: "leave", source: { type: "group", groupId: GROUP } }])
    await settle()
    assert.deepEqual(reset, [GROUP])
  } finally { await ch.close() }
})

test("รูปภาพ: 1:1 ตอบว่าดูไม่ได้ · ในกลุ่มเงียบ", async () => {
  const { api, texts } = fakeApi()
  const { runtime, seen } = fakeRuntime()
  const ch = await createLineChannel({ runtime, api, channelSecret: SECRET, host: "127.0.0.1" })
  try {
    await webhook(ch.url, [textEvent({ message: { id: "i1", type: "image" } })])
    await settle()
    assert.deepEqual(texts(), [NO_VISION_MESSAGE])

    await webhook(ch.url, [textEvent({
      message: { id: "i2", type: "image" }, source: { type: "group", groupId: GROUP, userId: USER },
    })])
    await settle()
    assert.equal(texts().length, 1, "ในกลุ่มต้องเงียบ")
    assert.equal(seen.length, 0)
  } finally { await ch.close() }
})

test("audit event ใช้ channel_type: line และ id ผ่าน toChannelId", async () => {
  const { api } = fakeApi()
  const { runtime } = fakeRuntime()
  const sink = new MemorySink()
  const scope = resolveScope({ BOTFORGE_TENANT_ID: "legal", BOTFORGE_WORKSPACE_ID: "legal-opencode" })
  const ch = await createLineChannel({
    runtime, api, channelSecret: SECRET, host: "127.0.0.1", runtimeName: "opencode",
    events: new BotforgeEvents(new EventEmitter(scope, { sink })),
  })
  try {
    await webhook(ch.url, [textEvent()])
    await settle()
    assert.deepEqual(sink.events.map((e) => e.event_type),
      ["STATE_TRANSITION", "EXECUTION_STARTED", "STATE_TRANSITION"])
    const e = sink.events[0]!
    assert.equal(e.channel_type, "line")
    assert.equal(e.channel_id, "line-u4af4980629f1b2c3d4e5f6a7b8c9d0e1")
    assert.equal(e.actor!.id, "line-u4af4980629f1b2c3d4e5f6a7b8c9d0e1")
    assert.equal(e.tenant_id, "legal")
  } finally { await ch.close() }
})

test("health และ root", async () => {
  const { api } = fakeApi()
  const { runtime } = fakeRuntime()
  const ch = await createLineChannel({ runtime, api, channelSecret: SECRET, host: "127.0.0.1", botName: "ทดสอบ" })
  try {
    assert.deepEqual(await (await fetch(`${ch.url}/health`)).json(), { ok: true, botUserId: BOT_ID })
    assert.ok((await (await fetch(ch.url)).text()).includes("ทดสอบ"))
    assert.equal((await fetch(`${ch.url}/ไม่มี`)).status, 404)
    assert.equal(ch.botUserId, BOT_ID, "ดึง botUserId ตอน startup — feature 9.8")
  } finally { await ch.close() }
})

// ── classify (ไม่ต้องมี HTTP) ──

const mention = { botUserId: BOT_ID, triggers: triggersFor("claude") }

test("classify — ครบทุกเส้นทาง", () => {
  assert.equal(classify({ type: "join", source: { groupId: GROUP } }, { mention }).kind, "join")
  assert.equal(classify({ type: "leave", source: { roomId: "R1" } }, { mention }).kind, "leave")
  assert.equal(classify({ type: "follow", source: { userId: USER } }, { mention }).kind, "ignore")
  assert.equal(classify({ type: "message", message: { type: "sticker" }, source: { userId: USER } }, { mention }).kind, "ignore")
  assert.equal(classify({ type: "message", message: { type: "text", text: "   " }, source: { userId: USER } }, { mention }).kind, "ignore")
  assert.equal(classify({ type: "message", message: { type: "text", text: "hi" }, source: {} }, { mention }).kind, "ignore")
})

test("classify — trim ข้อความตาม feature 9.6", () => {
  const d = classify({ type: "message", message: { type: "text", text: "  สวัสดี  " }, source: { userId: USER } }, { mention })
  assert.equal(d.kind === "text" && d.text, "สวัสดี")
})

test("classify — group ใช้ groupId เป็น sessionKey ทุกคนแชร์ session เดียว", () => {
  const d = classify({
    type: "message", message: { type: "text", text: "/help" },
    source: { groupId: GROUP, userId: USER },
  }, { mention })
  assert.equal(d.kind === "text" && d.sessionKey, GROUP)
  assert.equal(d.kind === "text" && d.userId, USER)
})

test("classify — LINE mention API ทำให้ตอบในกลุ่มได้แม้ไม่พิมพ์ trigger", () => {
  const d = classify({
    type: "message",
    message: { type: "text", text: "ช่วยดูให้หน่อย", mention: { mentionees: [{ type: "user", userId: BOT_ID }] } } as any,
    source: { groupId: GROUP, userId: USER },
  }, { mention })
  assert.equal(d.kind, "text")
})

test("welcomeMessage ยกมาจาก v1 ทุกตัวอักษร", () => {
  const m = welcomeMessage({ botName: "OpenCode Bot", lineOaUrl: "https://x" })
  assert.ok(m.startsWith("🧑‍💻 สวัสดีครับ! ผม OpenCode Bot"))
  assert.ok(m.includes("📖 พิมพ์ /help ดูคำสั่งทั้งหมด"))
  assert.ok(m.includes("🔒 คุยส่วนตัว: https://x"))
})
