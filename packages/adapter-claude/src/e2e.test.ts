import { test } from "node:test"
import assert from "node:assert/strict"
import { ClaudeAdapter } from "./adapter.ts"
import type { ClaudeQuery, ClaudeQueryOptions, SdkMessage } from "./sdk.ts"
import { runTurn, type TurnDeps } from "@botforge/core/router"
import { SessionQueue } from "@botforge/core/session"
import { ProfileCache, type LineProfileSource } from "@botforge/core/context"
import { EventEmitter, MemorySink, BotforgeEvents, type TurnContext } from "@botforge/core/events"
import { makePrincipal, toChannelId, resolveScope } from "@botforge/core/identity"

function fakeSdk(script: (p: string, o?: ClaudeQueryOptions) => SdkMessage[]) {
  const calls: string[] = []
  const query: ClaudeQuery = ({ prompt, options }) => {
    calls.push(prompt)
    return (async function* () { for (const m of script(prompt, options)) yield m })()
  }
  return { query, calls }
}
const ok = (text: string, cost = 0.0181): SdkMessage[] => [
  { type: "system", session_id: "sdk-e2e" },
  { type: "result", subtype: "success", session_id: "sdk-e2e", result: text, total_cost_usd: cost },
]

const source: LineProfileSource = {
  async getProfile() { return { displayName: "สมชาย" } },
  async getGroupMemberProfile() { return { displayName: "สมชาย" } },
  async getGroupSummary() { return { groupName: "ทีมกฎหมาย" } },
}
const RAW_GROUP = "Ca56f9e2b1c3d4e5f6a7b8c9d0e1f2a3"
const RAW_USER = "U4af4980629f1b2c3d4e5f6a7b8c9d0e1"

function harness(adapter: ClaudeAdapter, over: Partial<TurnDeps> = {}) {
  const sent: string[] = []
  const sink = new MemorySink()
  const scope = resolveScope({ BOTFORGE_TENANT_ID: "legal", BOTFORGE_WORKSPACE_ID: "legal-claudecode" })
  const deps: TurnDeps = {
    runtime: adapter,
    transport: { async reply(_t, x) { sent.push(x) }, async push(_to, x) { sent.push(x) } },
    queue: new SessionQueue(),
    profiles: new ProfileCache(source),
    events: new BotforgeEvents(new EventEmitter(scope, { sink })),
    ...over,
  }
  return { deps, sent, sink }
}

test("e2e — core ตัวเดียวกับ opencode/codex ใช้กับ Claude Agent SDK ได้", async () => {
  const { query, calls } = fakeSdk(() => ok("นี่คือคำตอบครับ"))
  const adapter = new ClaudeAdapter({ query, workspaceDir: "/nope" })
  const { deps, sent, sink } = harness(adapter)
  const channelId = toChannelId("line", RAW_GROUP)
  const ctx: TurnContext = {
    executionId: "exec-claude-1", channelId, channelType: "line",
    actor: makePrincipal("line", RAW_USER, "สมชาย"),
  }
  const out = await runTurn(deps, {
    sessionKey: channelId, userId: RAW_USER, text: "ช่วยดูโค้ดหน่อย",
    replyToken: "T", isGroup: true, groupId: RAW_GROUP, ctx, runtimeName: "claude-code",
  })
  assert.equal(out.kind, "answered")
  assert.deepEqual(sent, ["นี่คือคำตอบครับ"])
  assert.ok(calls[0]!.includes("[User: สมชาย]"))
  assert.ok(calls[0]!.includes("[Group: ทีมกฎหมาย]"))

  // cost จริงตัวแรกที่ไหลเข้า event/v1 usage
  const done = sink.events.at(-1)!
  assert.equal(done.usage!.cost_usd, 0.0181)
  assert.deepEqual(sink.events.map((e) => e.event_type),
    ["STATE_TRANSITION", "EXECUTION_STARTED", "STATE_TRANSITION"])
})

test("e2e — deps.groupMemory ของ core ไหลถึง prompt และ inject แค่เทิร์นแรก", async () => {
  const { query, calls } = fakeSdk(() => ok("ตอบ"))
  const adapter = new ClaudeAdapter({ query, workspaceDir: "/nope" })
  let reads = 0
  const { deps } = harness(adapter, {
    groupMemory: async () => { reads++; return "ลูกค้าชื่อ ก · เคยคุยเรื่องสัญญาเช่า" },
  })
  const channelId = toChannelId("line", RAW_GROUP)
  const turn = {
    sessionKey: channelId, userId: RAW_USER, text: "ถามต่อ",
    replyToken: "T", isGroup: true, groupId: RAW_GROUP,
  }
  await runTurn(deps, turn)
  await runTurn(deps, turn)

  assert.ok(calls[0]!.includes("[Group Memory]"), "เทิร์นแรกต้อง inject")
  assert.equal(calls[1]!.includes("[Group Memory]"), false, "เทิร์นสองต้องไม่ inject ซ้ำ")
  // v1 อ่านไฟล์ทุกข้อความแม้จะ inject เฉพาะ session ใหม่ — ยกมาตามจริง
  assert.equal(reads, 2, "core อ่านทุกเทิร์นเหมือน v1 · adapter เป็นคนตัดสินว่าจะใช้ไหม")
})

test("e2e — ไม่ใส่ deps.groupMemory ก็ไม่ดึงและไม่พัง", async () => {
  const { query, calls } = fakeSdk(() => ok("ตอบ"))
  const { deps } = harness(new ClaudeAdapter({ query, workspaceDir: "/nope" }))
  const out = await runTurn(deps, {
    sessionKey: "line-c9", userId: RAW_USER, text: "สวัสดี",
    replyToken: "T", isGroup: true, groupId: "C9",
  })
  assert.equal(out.kind, "answered")
  assert.equal(calls[0]!.includes("[Group Memory]"), false)
})

test("e2e — [SKIP] ในกลุ่มยังทำงานเหมือน adapter อื่น", async () => {
  const { query } = fakeSdk(() => ok("[SKIP]"))
  const { deps, sent } = harness(new ClaudeAdapter({ query, workspaceDir: "/nope" }))
  const out = await runTurn(deps, {
    sessionKey: "line-c2", userId: RAW_USER, text: "คุยกันเอง",
    replyToken: "T", isGroup: true, groupId: "C2",
  })
  assert.equal(out.kind, "skipped")
  assert.deepEqual(sent, [])
})
