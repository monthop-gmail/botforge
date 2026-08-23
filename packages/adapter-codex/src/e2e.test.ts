import { test } from "node:test"
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { CodexAdapter } from "./adapter.ts"
import { runTurn, type TurnDeps } from "@botforge/core/router"
import { SessionQueue } from "@botforge/core/session"
import { ProfileCache, type LineProfileSource } from "@botforge/core/context"
import { EventEmitter, MemorySink, BotforgeEvents, type TurnContext } from "@botforge/core/events"
import { makePrincipal, toChannelId, resolveScope } from "@botforge/core/identity"

const FAKE = fileURLToPath(new URL("./fixtures/fake-app-server.mjs", import.meta.url))
const source: LineProfileSource = {
  async getProfile() { return { displayName: "สมชาย" } },
  async getGroupMemberProfile() { return { displayName: "สมชาย" } },
  async getGroupSummary() { return { groupName: "ทีมกฎหมาย" } },
}

function harness(adapter: CodexAdapter) {
  const sent: string[] = []
  const sink = new MemorySink()
  const scope = resolveScope({ BOTFORGE_TENANT_ID: "legal", BOTFORGE_WORKSPACE_ID: "legal-codex" })
  const deps: TurnDeps = {
    runtime: adapter,
    transport: { async reply(_t, x) { sent.push(x) }, async push(_to, x) { sent.push(x) } },
    queue: new SessionQueue(),
    profiles: new ProfileCache(source),
    events: new BotforgeEvents(new EventEmitter(scope, { sink })),
  }
  return { deps, sent, sink }
}

const newAdapter = () => new CodexAdapter({
  command: process.execPath, args: [FAKE], workspaceDir: "/workspace", promptTimeoutMs: 3000,
})

const RAW_GROUP = "Ca56f9e2b1c3d4e5f6a7b8c9d0e1f2a3"
const RAW_USER = "U4af4980629f1b2c3d4e5f6a7b8c9d0e1"

test("e2e — LINE → codex app-server → LINE ผ่าน core ตัวเดียวกับ opencode", async () => {
  const adapter = newAdapter()
  const { deps, sent, sink } = harness(adapter)
  try {
    const channelId = toChannelId("line", RAW_GROUP)
    const ctx: TurnContext = {
      executionId: "exec-codex-1", channelId, channelType: "line",
      actor: makePrincipal("line", RAW_USER, "สมชาย"),
    }
    const out = await runTurn(deps, {
      sessionKey: channelId, userId: RAW_USER, text: "ช่วยดู docker compose หน่อย",
      replyToken: "T", isGroup: true, groupId: RAW_GROUP, ctx, runtimeName: "codex",
    })
    assert.equal(out.kind, "answered")
    assert.deepEqual(sent, ["สวัสดีครับ"])

    // audit event ชุดเดียวกับ opencode — core ไม่รู้ว่า runtime เป็นตัวไหน
    assert.deepEqual(sink.events.map((e) => e.event_type),
      ["STATE_TRANSITION", "EXECUTION_STARTED", "STATE_TRANSITION"])
    assert.equal(sink.events.at(-1)!.channel_id, "line-ca56f9e2b1c3d4e5f6a7b8c9d0e1f2a3")
  } finally { adapter.connection.close() }
})

test("e2e — error ของ codex ถูกแปลงเป็นไทยด้วย error/v1 ตัวเดียวกัน", async () => {
  const adapter = newAdapter()
  const { deps, sent } = harness(adapter)
  try {
    const out = await runTurn(deps, {
      sessionKey: "line-u1", userId: RAW_USER, text: "ERROR", replyToken: "T", isGroup: false,
    })
    assert.equal(out.kind, "answered")
    assert.deepEqual(sent, ["เกิน rate limit ครับ รอสักครู่แล้วลองใหม่"])
  } finally { adapter.connection.close() }
})

test("e2e — คิวของ core บังคับให้เทิร์นเดียวกันรันทีละตัว", async () => {
  const adapter = newAdapter()
  const { deps } = harness(adapter)
  try {
    const key = "line-u2"
    const results = await Promise.all([
      runTurn(deps, { sessionKey: key, userId: RAW_USER, text: "หนึ่ง", isGroup: false }),
      runTurn(deps, { sessionKey: key, userId: RAW_USER, text: "สอง", isGroup: false }),
    ])
    assert.deepEqual(results.map((r) => r.kind), ["answered", "answered"])
    // ทั้งสองเทิร์นใช้ thread เดียวกัน = ไม่ได้แข่งกันสร้าง thread
    assert.ok(adapter.sessionInfo(key))
  } finally { adapter.connection.close() }
})
