/**
 * LINE bot ที่ deploy ได้ — ชิ้นที่ทำให้ V2 ส่งมอบอะไรได้เป็นครั้งแรก
 *
 *   npm start --prefix apps/line-bot
 *
 * ประกอบ `@botforge/core` + `@botforge/channel-line` + adapter ตาม `BOTFORGE_RUNTIME`
 * ไฟล์นี้ไม่มี logic ของ LINE หรือของ runtime อยู่เลย — เป็นแค่ตัวต่อสาย
 */
import { createLineChannel } from "@botforge/channel-line"
import { EventEmitter, BotforgeEvents, type EventSink } from "@botforge/core/events"
import { readConfig, createRuntime, ConfigError } from "./config.ts"

const stamp = () => new Date().toISOString()
const log = (...args: unknown[]) => console.log(`[${stamp()}]`, ...args)

let config
try {
  config = readConfig(process.env)
} catch (err) {
  if (err instanceof ConfigError || (err as Error)?.name === "MissingScopeError") {
    console.error(`✗ config ไม่ครบ: ${(err as Error).message}`)
    process.exit(2)
  }
  throw err
}

/**
 * sink ปลายทางของ audit event
 *
 * ตอนนี้เขียนลง stdout เป็น JSON บรรทัดละใบ — ยังไม่ได้ส่งเข้า ecosystem
 * แต่ผลิตครบตาม `event/v1` แล้ว เปลี่ยนปลายทางทีหลังได้โดยไม่แตะที่อื่น
 */
const sink: EventSink = {
  emit(event) { console.log(JSON.stringify(event)) },
}

const runtime = await createRuntime(config, process.env)
const events = new BotforgeEvents(new EventEmitter(config.scope, { sink }))

const channel = await createLineChannel({
  runtime,
  events,
  channelSecret: config.channelSecret,
  channelAccessToken: config.channelAccessToken,
  port: config.port,
  botName: config.botName,
  lineOaUrl: config.lineOaUrl,
  runtimeName: config.runtimeName,
  userContextFormat: config.userContextFormat,
  lengthTruncationNotice: config.lengthTruncationNotice,
  log,
})

log(`พร้อมแล้ว`)
log(`  runtime   : ${config.runtimeName}`)
log(`  tenant    : ${config.scope.tenant_id} · workspace ${config.scope.workspace_id}`)
log(`  webhook   : ${channel.url}/webhook`)
log(`  bot userId: ${channel.botUserId || "(ดึงไม่ได้)"}`)

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    log(`ได้รับ ${sig} — กำลังปิด`)
    void channel.close().then(() => process.exit(0))
  })
}
