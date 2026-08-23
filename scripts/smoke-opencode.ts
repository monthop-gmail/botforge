/**
 * ยิง OpenCode server จริงผ่าน @botforge/core + @botforge/adapter-opencode
 *
 * ใช้ model ฟรีผ่าน Zen เป็นค่าเริ่มต้น — ไม่ต้องมี API key ของ provider ไหน
 *
 *   OPENCODE_URL=http://localhost:4096 node --experimental-strip-types scripts/smoke-opencode.ts
 *   OPENCODE_URL=... BOTFORGE_MODEL=opencode/nemotron-3-super ... "อธิบาย docker compose สั้น ๆ"
 *
 * ไม่ต้องมี LINE — ใช้ transport ที่พิมพ์ลง stdout แทน
 */
import { OpenCodeAdapter, FREE_MODELS, MODELS } from "@botforge/adapter-opencode"
import { runTurn, type TurnDeps } from "@botforge/core/router"
import { SessionQueue } from "@botforge/core/session"
import { ProfileCache, type LineProfileSource } from "@botforge/core/context"
import { EventEmitter, MemorySink, BotforgeEvents, type TurnContext } from "@botforge/core/events"
import { makePrincipal, toChannelId, resolveScope } from "@botforge/core/identity"

const url = process.env.OPENCODE_URL ?? "http://localhost:4096"
const model = process.env.BOTFORGE_MODEL ?? FREE_MODELS[0]
const text = process.argv.slice(2).join(" ") || "สวัสดีครับ ช่วยแนะนำตัวสั้น ๆ หน่อย"

if (!MODELS[model]) {
  console.error(`ไม่รู้จัก model "${model}" — เลือกจาก:\n  ${Object.keys(MODELS).join("\n  ")}`)
  process.exit(2)
}

console.log(`OpenCode : ${url}`)
console.log(`model    : ${model} (${MODELS[model]!.label})`)
console.log(`prompt   : ${text}\n`)

const adapter = new OpenCodeAdapter({
  url,
  password: process.env.OPENCODE_PASSWORD,
  directory: process.env.OPENCODE_DIR ?? "/workspace",
  promptTimeoutMs: Number(process.env.PROMPT_TIMEOUT_MS ?? 120_000),
  log: (...a) => console.log("  [adapter]", ...a),
})

process.stdout.write("รอ server พร้อม... ")
const ready = await adapter.client.waitUntilReady(
  Number(process.env.SMOKE_RETRIES ?? 5),
  1000,
  (m) => process.stdout.write("."),
)
if (!ready) {
  console.error(`\n\n✗ ต่อ OpenCode ที่ ${url} ไม่ได้`)
  console.error(`  ตั้ง OPENCODE_URL ให้ถูก หรือสตาร์ท server ก่อน:`)
  console.error(`    docker run --rm -p 4096:4096 -v "$PWD/workspace:/workspace" \\`)
  console.error(`      <opencode-image> serve --hostname=0.0.0.0 --port=4096`)
  process.exit(1)
}
console.log(" พร้อม\n")

// ประกอบ bot ทั้งตัวจาก core + adapter — เหมือนที่ LINE bot ทำ ต่างแค่ transport
const scope = resolveScope({
  BOTFORGE_TENANT_ID: process.env.BOTFORGE_TENANT_ID ?? "smoke",
  BOTFORGE_WORKSPACE_ID: process.env.BOTFORGE_WORKSPACE_ID ?? "smoke-opencode",
})
const sink = new MemorySink()
const profileSource: LineProfileSource = {
  async getProfile() { return { displayName: "ผู้ทดสอบ" } },
  async getGroupMemberProfile() { return { displayName: "ผู้ทดสอบ" } },
  async getGroupSummary() { return { groupName: "smoke test" } },
}

const rawUserId = "U0000000000000000000000000smoke1"
const channelId = toChannelId("line", rawUserId)
await adapter.setModel(channelId, model)

const deps: TurnDeps = {
  runtime: adapter,
  transport: {
    async reply(_token, t) { console.log("─── ตอบกลับ (reply) ───\n" + t + "\n") },
    async push(_to, t) { console.log("─── ตอบกลับ (push) ───\n" + t + "\n") },
  },
  queue: new SessionQueue(),
  profiles: new ProfileCache(profileSource),
  events: new BotforgeEvents(new EventEmitter(scope, { sink })),
  userContextFormat: "verbose",
  lengthTruncationNotice: false,
  log: (...a) => console.log("  [core]", ...a),
}

const ctx: TurnContext = {
  executionId: "exec-smoke-0001",
  channelId,
  channelType: "line",
  actor: makePrincipal("line", rawUserId, "ผู้ทดสอบ"),
}

const started = performance.now()
const out = await runTurn(deps, {
  sessionKey: channelId,
  userId: rawUserId,
  text,
  replyToken: "SMOKE_TOKEN",
  isGroup: false,
  ctx,
  runtimeName: "opencode",
})
const ms = Math.round(performance.now() - started)

console.log(`ผลลัพธ์  : ${out.kind}  (${ms} ms)`)
if (out.kind === "failed") console.log(`error   : ${out.error.code} · ${out.error.message}`)
console.log(`\naudit event ที่ปล่อยออกมา ${sink.events.length} ใบ:`)
for (const e of sink.events) {
  const extra = e.transition ? ` ${e.transition.from} → ${e.transition.to}` : ""
  const cost = e.usage?.cost_usd !== undefined ? ` · $${e.usage.cost_usd}` : ""
  console.log(`  ${String(e.sequence).padStart(2)} ${e.event_type}${extra}${cost}`)
}
process.exit(out.kind === "answered" ? 0 : 1)
