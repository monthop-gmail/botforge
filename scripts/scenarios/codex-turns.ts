/**
 * เดินทุกเส้นทางของ adapter-codex ให้เห็นด้วยตา — ใช้ app-server ปลอม
 *
 *   node --experimental-strip-types scripts/scenarios/codex-turns.ts
 *
 * ใช้ของจริงได้ด้วยถ้ามี codex CLI:  CODEX_REAL=1 node --experimental-strip-types …
 *
 * fake ตอบตามคำที่อยู่ใน prompt — SLOW / ERROR / NODELTA / APPROVAL
 * จึงบังคับให้เดินเส้นทางที่หายากได้โดยไม่ต้องรอให้ model ทำท่านั้นเอง
 */
import { fileURLToPath } from "node:url"
import { CodexAdapter } from "@botforge/adapter-codex"
import { runTurn, type TurnDeps } from "@botforge/core/router"
import { SessionQueue } from "@botforge/core/session"
import { ProfileCache, type LineProfileSource } from "@botforge/core/context"
import { EventEmitter, MemorySink, BotforgeEvents, type TurnContext } from "@botforge/core/events"
import { makePrincipal, toChannelId, resolveScope } from "@botforge/core/identity"

const real = process.env.CODEX_REAL === "1"
const fakePath = fileURLToPath(new URL("../../packages/adapter-codex/src/fixtures/fake-app-server.mjs", import.meta.url))

const adapter = new CodexAdapter({
  command: real ? (process.env.CODEX_BIN ?? "codex") : process.execPath,
  args: real ? ["app-server"] : [fakePath],
  workspaceDir: process.env.WORKSPACE_DIR ?? "/workspace",
  promptTimeoutMs: real ? 300_000 : 400,
})

const src: LineProfileSource = {
  async getProfile() { return { displayName: "สมชาย" } },
  async getGroupMemberProfile() { return { displayName: "สมชาย" } },
  async getGroupSummary() { return { groupName: "ทีมกฎหมาย" } },
}
const scope = resolveScope({ BOTFORGE_TENANT_ID: "smoke", BOTFORGE_WORKSPACE_ID: "smoke-codex" })
const sink = new MemorySink()
let out = ""
const deps: TurnDeps = {
  runtime: adapter,
  transport: { async reply(_t, t) { out = t }, async push(_to, t) { out = t } },
  queue: new SessionQueue(),
  profiles: new ProfileCache(src),
  events: new BotforgeEvents(new EventEmitter(scope, { sink })),
}

const RAW_GROUP = "Ca56f9e2b1c3d4e5f6a7b8c9d0e1f2a3"
const RAW_USER = "U4af4980629f1b2c3d4e5f6a7b8c9d0e1"
const key = toChannelId("line", RAW_GROUP)
let n = 0
const ctx = (): TurnContext => ({
  executionId: `exec-codex-${++n}`, channelId: key, channelType: "line",
  actor: makePrincipal("line", RAW_USER, "สมชาย"), messageId: `m-${n}`,
})

console.log(`app-server : ${real ? "ของจริง" : "ปลอม (fixtures)"}\n`)

const turns: Array<[string, string]> = [
  ["ถามปกติ", "ช่วยดู docker compose หน่อย"],
  ["ถามต่อ — thread เดิม", "แล้ว log ดูยังไง"],
  ["ตอบผ่าน items ไม่ผ่าน delta", "NODELTA ขอสรุปสั้น ๆ"],
  ["runtime ตอบ error", "ERROR ทดสอบ"],
  ["ค้างจนหมดเวลา", "SLOW ทดสอบ"],
  ["ขออนุมัติรันคำสั่ง", "APPROVAL ลบไฟล์ให้หน่อย"],
]

for (const [label, text] of turns) {
  out = ""
  const before = adapter.sessionInfo(key)?.threadId
  const t0 = performance.now()
  const r = await runTurn(deps, {
    sessionKey: key, userId: RAW_USER, text, replyToken: "T",
    isGroup: true, groupId: RAW_GROUP, ctx: ctx(), runtimeName: "codex",
  })
  const after = adapter.sessionInfo(key)?.threadId
  console.log(`━━━ ${label} (${Math.round(performance.now() - t0)} ms) ━━━`)
  console.log(`  ผู้ใช้  : ${text}`)
  console.log(`  ผล     : ${r.kind}`)
  if (r.kind === "answered") console.log(`  bot    : ${out.slice(0, 200)}`)
  if (r.kind === "failed") console.log(`  error  : ${r.error.code}`)
  console.log(`  thread : ${after === before ? "ใช้ตัวเดิม ✓" : `ใหม่ ${after}`}`)
  console.log()
}

console.log(`━━━ audit event ${sink.events.length} ใบ ━━━`)
const byType: Record<string, number> = {}
for (const e of sink.events) byType[e.event_type] = (byType[e.event_type] ?? 0) + 1
for (const [k, v] of Object.entries(byType)) console.log(`  ${k.padEnd(20)} ${v}`)

adapter.connection.close()
