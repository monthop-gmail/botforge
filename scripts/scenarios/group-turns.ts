import { OpenCodeAdapter } from "@botforge/adapter-opencode"
import { runTurn, type TurnDeps } from "@botforge/core/router"
import { SessionQueue } from "@botforge/core/session"
import { ProfileCache, type LineProfileSource } from "@botforge/core/context"
import { EventEmitter, MemorySink, BotforgeEvents, type TurnContext } from "@botforge/core/events"
import { makePrincipal, toChannelId, resolveScope } from "@botforge/core/identity"

const scope = resolveScope({ BOTFORGE_TENANT_ID: "smoke", BOTFORGE_WORKSPACE_ID: "smoke-opencode" })
const sink = new MemorySink()
const src: LineProfileSource = {
  async getProfile() { return { displayName: "สมชาย" } },
  async getGroupMemberProfile() { return { displayName: "สมชาย" } },
  async getGroupSummary() { return { groupName: "ทีมกฎหมาย" } },
}
const adapter = new OpenCodeAdapter({ url: "http://127.0.0.1:4096", promptTimeoutMs: 150_000 })
let out = ""
const deps: TurnDeps = {
  runtime: adapter,
  transport: { async reply(_t, t) { out = t }, async push(_to, t) { out = t } },
  queue: new SessionQueue(),
  profiles: new ProfileCache(src),
  events: new BotforgeEvents(new EventEmitter(scope, { sink })),
  userContextFormat: "verbose",
  lengthTruncationNotice: false,
}
const RAW_GROUP = "Ca56f9e2b1c3d4e5f6a7b8c9d0e1f2a3"
const RAW_USER = "U4af4980629f1b2c3d4e5f6a7b8c9d0e1"
const key = toChannelId("line", RAW_GROUP)
const ctx = (n: number): TurnContext => ({
  executionId: `exec-scn-${n}`, channelId: key, channelType: "line",
  actor: makePrincipal("line", RAW_USER, "สมชาย"), messageId: `m-${n}`,
})

const turns: Array<[string, string]> = [
  ["คนอื่นคุยกันเอง", "เออว่าแต่ เมื่อวานไปกินข้าวร้านไหนมา อร่อยไหม"],
  ["เรียก bot ตรง ๆ", "@bot ช่วยบอกหน่อยว่า docker compose up -d ต่างจาก docker compose up ยังไง"],
  ["ถามต่อในหัวข้อเดิม", "แล้วถ้าอยากดู log ของมันต้องพิมพ์อะไร"],
]

let turnNo = 0
for (const [label, text] of turns) {
  turnNo++
  out = ""
  const t0 = performance.now()
  const r = await runTurn(deps, {
    sessionKey: key, userId: RAW_USER, text, replyToken: "T",
    isGroup: true, groupId: RAW_GROUP, ctx: ctx(turnNo), runtimeName: "opencode",
  })
  const ms = Math.round(performance.now() - t0)
  console.log(`\n━━━ ${label} (${ms} ms) ━━━`)
  console.log(`  ผู้ใช้ : ${text}`)
  console.log(`  ผล    : ${r.kind}`)
  if (r.kind === "answered") console.log(`  bot   : ${out.slice(0, 400)}${out.length > 400 ? "…" : ""}`)
  if (r.kind === "skipped") console.log(`  bot   : (เงียบ ไม่ส่งอะไรกลับ LINE)`)
  if (r.kind === "failed") console.log(`  error : ${r.error.code} · ${r.error.message}`)
}

console.log(`\n━━━ session ━━━`)
console.log(`  ${JSON.stringify(adapter.sessionInfo(key))}`)
console.log(`\n━━━ audit event ${sink.events.length} ใบ ━━━`)
for (const e of sink.events) {
  const t = e.transition ? ` ${e.transition.from}→${e.transition.to}` : ""
  console.log(`  ${String(e.sequence).padStart(2)} ${e.event_type.padEnd(18)}${t}`)
}
