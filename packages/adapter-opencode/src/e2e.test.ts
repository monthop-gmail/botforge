import { test } from "node:test"
import assert from "node:assert/strict"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { OpenCodeAdapter } from "./adapter.ts"
import { runTurn, type TurnDeps } from "@botforge/core/router"
import { SessionQueue } from "@botforge/core/session"
import { ProfileCache, type LineProfileSource } from "@botforge/core/context"
import { EventEmitter, MemorySink, BotforgeEvents, type TurnContext } from "@botforge/core/events"
import { makePrincipal, toChannelId, resolveScope } from "@botforge/core/identity"

/**
 * end-to-end ผ่าน HTTP จริง — ไม่ใช่ mock ของ fetch
 *
 * พิสูจน์ว่า core กับ adapter ประกอบกันได้จริงตั้งแต่ webhook payload
 * จนถึงข้อความที่ส่งกลับ LINE โดยที่ core ไม่รู้จัก OpenCode เลยสักบรรทัด
 */
function fakeOpenCode(reply: (body: any) => unknown): Promise<{ url: string; close: () => Promise<void>; seen: string[] }> {
  const seen: string[] = []
  return new Promise((resolve) => {
    const server: Server = createServer((req, res) => {
      seen.push(`${req.method} ${req.url}`)
      let raw = ""
      req.on("data", (c) => (raw += c))
      req.on("end", () => {
        res.setHeader("content-type", "application/json")
        if (req.url === "/session" && req.method === "POST") {
          res.end(JSON.stringify({ id: "sess-e2e" }))
          return
        }
        if (req.url?.endsWith("/message") && req.method === "POST") {
          res.end(JSON.stringify(reply(raw ? JSON.parse(raw) : {})))
          return
        }
        res.end(JSON.stringify({}))
      })
    })
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo
      resolve({
        url: `http://127.0.0.1:${port}`,
        seen,
        close: () => new Promise((r) => server.close(() => r())),
      })
    })
  })
}

const profileSource: LineProfileSource = {
  async getProfile() { return { displayName: "สมชาย" } },
  async getGroupMemberProfile() { return { displayName: "สมชาย" } },
  async getGroupSummary() { return { groupName: "ทีมกฎหมาย" } },
}

test("e2e — ข้อความจาก LINE ถึง OpenCode แล้วกลับมาที่ LINE", async () => {
  let promptSeen = ""
  const server = await fakeOpenCode((body) => {
    promptSeen = body.parts[0].text
    return { info: { cost: 0.0002 }, parts: [{ type: "text", text: "<think>คิดก่อน</think>สวัสดีครับ ยินดีช่วยเหลือ" }] }
  })

  try {
    const scope = resolveScope({ BOTFORGE_TENANT_ID: "legal", BOTFORGE_WORKSPACE_ID: "legal-opencode" })
    const sink = new MemorySink()
    const sent: string[] = []

    const adapter = new OpenCodeAdapter({ url: server.url, directory: "/workspace" })
    const deps: TurnDeps = {
      runtime: adapter,
      transport: {
        async reply(_t, text) { sent.push(text) },
        async push(_to, text) { sent.push(text) },
      },
      queue: new SessionQueue(),
      profiles: new ProfileCache(profileSource),
      events: new BotforgeEvents(new EventEmitter(scope, { sink })),
      userContextFormat: "verbose",          // รูปแบบของ opencode
      lengthTruncationNotice: false,         // opencode ไม่ใช้กลไกนี้
    }

    // payload แบบที่ LINE webhook ส่งมาจริง
    const rawUserId = "U4af4980629f1b2c3d4e5f6a7b8c9d0e1"
    const rawGroupId = "Ca56f9e2b1c3d4e5f6a7b8c9d0e1f2a3"
    const channelId = toChannelId("line", rawGroupId)
    const ctx: TurnContext = {
      executionId: "exec-e2e-0001",
      channelId,
      channelType: "line",
      actor: makePrincipal("line", rawUserId, "สมชาย"),
      messageId: "m-e2e",
    }

    const out = await runTurn(deps, {
      sessionKey: channelId,
      userId: rawUserId,
      text: "ช่วยอธิบาย docker compose หน่อย",
      replyToken: "REPLY_TOKEN",
      isGroup: true,
      groupId: rawGroupId,
      ctx,
      runtimeName: "opencode",
    })

    // 1. ผู้ใช้ได้คำตอบ และ <think> ถูกตัดออก
    assert.equal(out.kind, "answered")
    assert.deepEqual(sent, ["สวัสดีครับ ยินดีช่วยเหลือ"])

    // 2. prompt ที่ส่งเข้า OpenCode ประกอบครบตามที่ v1 ทำ
    assert.ok(promptSeen.includes("Do NOT use the question tool"))
    assert.ok(promptSeen.includes("[User Info: สมชาย"))
    assert.ok(promptSeen.includes("[Time: "))
    assert.ok(promptSeen.includes("GROUP CHAT"))
    assert.ok(promptSeen.endsWith("ช่วยอธิบาย docker compose หน่อย"))

    // 3. audit event ครบและถูกต้องตาม contract
    assert.deepEqual(sink.events.map((e) => e.event_type),
      ["STATE_TRANSITION", "EXECUTION_STARTED", "STATE_TRANSITION"])
    const done = sink.events.at(-1)!
    assert.equal(done.tenant_id, "legal")
    assert.equal(done.workspace_id, "legal-opencode")
    assert.equal(done.channel_id, "line-ca56f9e2b1c3d4e5f6a7b8c9d0e1f2a3")
    assert.equal(done.actor!.id, "line-u4af4980629f1b2c3d4e5f6a7b8c9d0e1")
    assert.equal(done.usage!.cost_usd, 0.0002)

    // 4. core ไม่เคยเห็น OpenCode — เปลี่ยน runtime ได้โดยไม่แตะ channel
    assert.ok(server.seen.some((r) => r.startsWith("POST /session")))
  } finally {
    await server.close()
  }
})

test("e2e — [SKIP] ในกลุ่มไม่ส่งอะไรกลับ LINE", async () => {
  const server = await fakeOpenCode(() => ({ parts: [{ type: "text", text: "[SKIP]" }] }))
  try {
    const sent: string[] = []
    const out = await runTurn(
      {
        runtime: new OpenCodeAdapter({ url: server.url }),
        transport: { async reply(_t, t) { sent.push(t) }, async push(_to, t) { sent.push(t) } },
        queue: new SessionQueue(),
        profiles: new ProfileCache(profileSource),
      },
      {
        sessionKey: "line-c1", userId: "U1", text: "คุยกันเองในกลุ่ม",
        replyToken: "T", isGroup: true, groupId: "C1",
      },
    )
    assert.equal(out.kind, "skipped")
    assert.deepEqual(sent, [])
  } finally {
    await server.close()
  }
})

test("e2e — OpenCode ตอบ error → ผู้ใช้ได้ข้อความไทย", async () => {
  const server = await fakeOpenCode(() => ({ info: { error: { data: { message: "429 rate limit exceeded" } } } }))
  try {
    const sent: string[] = []
    const out = await runTurn(
      {
        runtime: new OpenCodeAdapter({ url: server.url }),
        transport: { async reply(_t, t) { sent.push(t) }, async push(_to, t) { sent.push(t) } },
        queue: new SessionQueue(),
        profiles: new ProfileCache(profileSource),
      },
      { sessionKey: "line-u1", userId: "U1", text: "สวัสดี", replyToken: "T", isGroup: false },
    )
    assert.equal(out.kind, "answered")
    assert.deepEqual(sent, ["เกิน rate limit ครับ รอสักครู่แล้วลองใหม่"])
  } finally {
    await server.close()
  }
})
