/**
 * ยิง `codex app-server` จริงผ่าน @botforge/core + @botforge/adapter-codex
 *
 *   node --experimental-strip-types scripts/smoke-codex.ts "คำถามของคุณ"
 *
 * ต้องมี codex CLI ในเครื่อง (`npm i -g @openai/codex`) และล็อกอินแล้ว
 * ไม่ต้องมี LINE — transport พิมพ์ลง stdout แทน
 *
 * ใส่ BOTFORGE_CODEX_FAKE=1 เพื่อใช้ app-server ปลอมใน fixtures (ไม่ต้องมี codex)
 */
import { fileURLToPath } from "node:url"
import { CodexAdapter } from "@botforge/adapter-codex"
import { runTurn, type TurnDeps } from "@botforge/core/router"
import { SessionQueue } from "@botforge/core/session"
import { ProfileCache, type LineProfileSource } from "@botforge/core/context"
import { EventEmitter, MemorySink, BotforgeEvents, type TurnContext } from "@botforge/core/events"
import { makePrincipal, toChannelId, resolveScope } from "@botforge/core/identity"

const useFake = process.env.BOTFORGE_CODEX_FAKE === "1"
const model = process.env.CODEX_MODEL ?? "o4-mini"
const text = process.argv.slice(2).join(" ") || "สวัสดีครับ ช่วยแนะนำตัวสั้น ๆ หน่อย"
const fakePath = fileURLToPath(new URL("../packages/adapter-codex/src/fixtures/fake-app-server.mjs", import.meta.url))

console.log(`transport : stdio (codex app-server)${useFake ? "  [FAKE]" : ""}`)
console.log(`model     : ${model}`)
console.log(`workspace : ${process.env.WORKSPACE_DIR ?? "/workspace"}`)
console.log(`prompt    : ${text}\n`)

const adapter = new CodexAdapter({
  command: useFake ? process.execPath : (process.env.CODEX_BIN ?? "codex"),
  args: useFake ? [fakePath] : ["app-server"],
  model,
  workspaceDir: process.env.WORKSPACE_DIR ?? "/workspace",
  promptTimeoutMs: Number(process.env.PROMPT_TIMEOUT_MS ?? 300_000),
  log: (...a) => console.log("  [adapter]", ...a),
  onStderr: (c) => process.stderr.write(`  [app-server] ${c}`),
})

const scope = resolveScope({
  BOTFORGE_TENANT_ID: process.env.BOTFORGE_TENANT_ID ?? "smoke",
  BOTFORGE_WORKSPACE_ID: process.env.BOTFORGE_WORKSPACE_ID ?? "smoke-codex",
})
const sink = new MemorySink()
const profileSource: LineProfileSource = {
  async getProfile() { return { displayName: "ผู้ทดสอบ" } },
  async getGroupMemberProfile() { return { displayName: "ผู้ทดสอบ" } },
  async getGroupSummary() { return { groupName: "smoke test" } },
}

const rawUserId = "U0000000000000000000000000smoke1"
const channelId = toChannelId("line", rawUserId)
const deps: TurnDeps = {
  runtime: adapter,
  transport: {
    async reply(_t, t) { console.log("─── ตอบกลับ (reply) ───\n" + t + "\n") },
    async push(_to, t) { console.log("─── ตอบกลับ (push) ───\n" + t + "\n") },
  },
  queue: new SessionQueue(),
  profiles: new ProfileCache(profileSource),
  events: new BotforgeEvents(new EventEmitter(scope, { sink })),
  log: (...a) => console.log("  [core]", ...a),
}
const ctx: TurnContext = {
  executionId: "exec-smoke-codex-1", channelId, channelType: "line",
  actor: makePrincipal("line", rawUserId, "ผู้ทดสอบ"),
}

const started = performance.now()
const out = await runTurn(deps, {
  sessionKey: channelId, userId: rawUserId, text,
  replyToken: "SMOKE_TOKEN", isGroup: false, ctx, runtimeName: "codex",
})
const ms = Math.round(performance.now() - started)

console.log(`ผลลัพธ์  : ${out.kind}  (${ms} ms)`)
if (out.kind === "failed") console.log(`error   : ${out.error.code} · ${out.error.message}`)
console.log(`thread  : ${JSON.stringify(adapter.sessionInfo(channelId))}`)
console.log(`\naudit event ${sink.events.length} ใบ:`)
for (const e of sink.events) {
  const t = e.transition ? ` ${e.transition.from} → ${e.transition.to}` : ""
  console.log(`  ${String(e.sequence).padStart(2)} ${e.event_type}${t}`)
}
adapter.connection.close()
process.exit(out.kind === "answered" ? 0 : 1)
