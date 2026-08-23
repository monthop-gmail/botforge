/**
 * ปล่อย payload จริงที่ @botforge/core ผลิตออกมา แล้วพิมพ์เป็น JSON ทาง stdout
 * payload_check.py เอาไป validate กับ schema ที่ pin ไว้
 *
 * ⚠️ ห้ามเขียน object ตรง ๆ ในไฟล์นี้ — ต้องมาจาก core เท่านั้น
 *    ADR-0006 ข้อ 2 ต้องการ payload จริง ไม่ใช่ fixture ที่เขียนให้ผ่าน
 */
import { classify } from "../packages/core/src/errors.ts"
import { makePrincipal, resolveScope } from "../packages/core/src/identity.ts"
import { EventEmitter, MemorySink, BotforgeEvents } from "../packages/core/src/events/index.ts"
import type { TurnContext } from "../packages/core/src/events/index.ts"

// ── error/v1 ──────────────────────────────────────────────────────────
// error ดิบที่ระบบเจอจริงจาก runtime — ถอดมาจากเงื่อนไขใน getErrorHint() ของ v1
const RAW_ERRORS: string[] = [
  "OpenCode API 429: rate limit exceeded",
  "Server 429: Too Many Requests",
  "The operation was aborted due to timeout",
  "AbortError: signal is aborted without reason",
  "Server 401: unauthorized",
  "Server 403: forbidden — check ANTHROPIC_API_KEY",
  "Gocode API 500: internal server error",
  "ADKcode API 500: upstream failure",
  "context length exceeded: 16384 tokens",
  "prompt is too long for this model",
  "ECONNREFUSED 127.0.0.1:4096",
  "Unexpected end of JSON input",
  "401 model has reached daily limit for this key",
  "auth failed for sk-proj-AbCdEf1234567890XyZ",
  "Bearer eyJhbGciOiJIUzI1NiJ9abcdefghijklmnop rejected",
]
const errors = RAW_ERRORS.map((raw) => classify(raw))

// ── event/v1 + channel-event/v1 ───────────────────────────────────────
// เดิน scenario ของ LINE webhook จริง แล้วเก็บ event ที่ core ปล่อยออกมา
const scope = resolveScope({
  BOTFORGE_TENANT_ID: process.env.BOTFORGE_TENANT_ID ?? "legal",
  BOTFORGE_WORKSPACE_ID: process.env.BOTFORGE_WORKSPACE_ID ?? "legal-opencode",
})
const sink = new MemorySink()
const events = new BotforgeEvents(new EventEmitter(scope, { sink }))

const GROUP = "line-ca56f9e2b1c3d4e5f6a7b8c9d0e1f2a3"
const ctx = (execId: string, msgId: string): TurnContext => ({
  executionId: execId,
  channelId: GROUP,
  channelType: "line",
  actor: makePrincipal("line", "U4af4980629f1b2c3d4e5f6a7b8c9d0e1", "สมชาย"),
  messageId: msgId,
})

// 1. bot ถูกเชิญเข้ากลุ่ม
await events.channelJoined("line", GROUP)

// 2. เทิร์นที่ตอบสำเร็จ พร้อม cost (แบบ claude-code / copilot-cli)
const t1 = ctx("exec-0001", "m-0001")
await events.sessionStarted(t1, "opencode")
await events.queued(t1)
await events.started(t1, "opencode", "anthropic/claude-sonnet-4")
await events.succeeded(t1, { cost_usd: 0.0123, input_tokens: 1200, output_tokens: 340 })

// 3. เทิร์นที่ตอบสำเร็จ แบบ runtime ที่ไม่รายงาน cost
const t2 = ctx("exec-0002", "m-0002")
await events.queued(t2)
await events.started(t2, "codex")
await events.succeeded(t2)

// 4. เทิร์นที่ล้มเพราะ provider
const t3 = ctx("exec-0003", "m-0003")
await events.started(t3, "gocode")
await events.failed(t3, classify("Gocode API 500: internal server error"))

// 5. เทิร์นที่ timeout
const t4 = ctx("exec-0004", "m-0004")
await events.started(t4, "adkcode")
await events.failed(t4, classify("The operation timed out"))

// 6. ผู้ใช้สั่ง /abort
const t5 = ctx("exec-0005", "m-0005")
await events.started(t5, "opencode")
await events.cancelled(t5)

// 7. ข้อความในกลุ่มที่ agent ตัดสินว่าไม่ได้เรียกถึง bot
await events.messageSkipped(ctx("exec-0006", "m-0006"))

// 8. /new ปิด session
await events.sessionClosed(ctx("exec-0001", "m-0007"), "ผู้ใช้สั่ง /new")

// 9. bot ออกจากกลุ่ม
await events.channelLeft("line", GROUP)

process.stdout.write(
  JSON.stringify({ errors, events: sink.events }, null, 2),
)
