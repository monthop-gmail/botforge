/**
 * Definition of Done ครึ่งหลัง — เปลี่ยน LINE → Web โดยไม่แก้ Runtime
 *
 *   node --experimental-strip-types scripts/web-demo.ts
 *
 * ใช้ `@botforge/adapter-opencode` **ตัวเดียวกับที่ LINE ใช้** โดยไม่แก้อะไรเลย
 * ต่อ Web channel แทน แล้วเปิดเบราว์เซอร์คุยได้
 *
 * env: OPENCODE_URL (ค่าเริ่มต้น http://127.0.0.1:4096) · PORT · BOTFORGE_MODEL
 */
import { OpenCodeAdapter, FREE_MODELS } from "@botforge/adapter-opencode"
import { createWebChannel } from "@botforge/channel-web"
import { EventEmitter, MemorySink, BotforgeEvents } from "@botforge/core/events"
import { resolveScope } from "@botforge/core/identity"

const url = process.env.OPENCODE_URL ?? "http://127.0.0.1:4096"
const model = process.env.BOTFORGE_MODEL ?? FREE_MODELS[0]

// adapter ตัวเดียวกับที่ LINE ใช้ — ไม่มีอะไรเกี่ยวกับ Web ในนี้เลย
const runtime = new OpenCodeAdapter({
  url,
  password: process.env.OPENCODE_PASSWORD,
  directory: process.env.OPENCODE_DIR ?? "/workspace",
  promptTimeoutMs: Number(process.env.PROMPT_TIMEOUT_MS ?? 150_000),
})

process.stdout.write(`รอ OpenCode ที่ ${url} ... `)
if (!(await runtime.client.waitUntilReady(5, 1000, () => process.stdout.write(".")))) {
  console.error(`\n✗ ต่อไม่ได้ — สตาร์ท server ก่อน (ดู scripts/README.md)`)
  process.exit(1)
}
console.log(" พร้อม")

const sink = new MemorySink()
const scope = resolveScope({
  BOTFORGE_TENANT_ID: process.env.BOTFORGE_TENANT_ID ?? "demo",
  BOTFORGE_WORKSPACE_ID: process.env.BOTFORGE_WORKSPACE_ID ?? "demo-web",
})

const channel = await createWebChannel({
  runtime,
  port: Number(process.env.PORT ?? 8788),
  displayName: `Botforge Web · ${model}`,
  events: new BotforgeEvents(new EventEmitter(scope, { sink })),
  runtimeName: "opencode",
  log: (...a) => console.log("  [core]", ...a),
})

console.log(`\n  เปิด ${channel.url} แล้วพิมพ์คุยได้เลย`)
console.log(`  runtime : opencode (${model}) — adapter ตัวเดียวกับที่ LINE ใช้ ไม่ได้แก้อะไร`)
console.log(`  channel : web (HTTP + SSE)\n  Ctrl-C เพื่อออก\n`)

const report = setInterval(() => {
  if (sink.events.length === 0) return
  const last = sink.events.at(-1)!
  console.log(`  [event] ${sink.events.length} ใบ · ล่าสุด ${last.event_type}${last.transition ? ` ${last.transition.from}→${last.transition.to}` : ""}`)
}, 5000)

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    clearInterval(report)
    console.log(`\nปิด · audit event รวม ${sink.events.length} ใบ`)
    void channel.close().then(() => process.exit(0))
  })
}
