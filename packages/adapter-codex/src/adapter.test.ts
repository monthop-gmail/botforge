import { test } from "node:test"
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { CodexAdapter } from "./adapter.ts"
import { buildPrefix, GROUP_CHAT_INSTRUCTION } from "./prompt.ts"

/**
 * ทุก test ในไฟล์นี้คุยกับ **child process จริง** ผ่าน stdio
 * `fixtures/fake-app-server.mjs` พูด JSON-RPC เหมือนของจริง และจงใจเขียน stdout
 * เป็นก้อนละ 7 ตัวอักษร เพื่อพิสูจน์ว่า framing ต่อเศษบรรทัดถูก
 */
const FAKE = fileURLToPath(new URL("./fixtures/fake-app-server.mjs", import.meta.url))

function make(over: Record<string, unknown> = {}) {
  return new CodexAdapter({
    command: process.execPath,
    args: [FAKE],
    workspaceDir: "/workspace",
    promptTimeoutMs: 3000,
    ...over,
  })
}

/** รอจนเงื่อนไขเป็นจริง — กัน test เปราะจากเวลา spawn process ที่ไม่แน่นอน */
async function waitUntil(fn: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (fn()) return
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error("รอเงื่อนไขไม่สำเร็จภายในเวลาที่กำหนด")
}

const prompt = (over: Record<string, unknown> = {}) => ({
  sessionKey: "line-c1", userId: "U1", text: "สวัสดี", isGroup: false, ...over,
}) as any

test("คุยกับ app-server จริงผ่าน stdio ได้ — delta ต่อกันเป็นคำตอบ", async () => {
  const a = make()
  try {
    const out = await a.sendPrompt(prompt())
    assert.equal(out.result, "สวัสดีครับ", "delta สองก้อนต้องต่อกัน")
    assert.equal(out.isError, undefined)
  } finally { a.connection.close() }
})

test("framing ถูก แม้ stdout มาเป็นก้อนที่ไม่ตรงขอบ message", async () => {
  // fake เขียนทีละ 7 ตัวอักษร — ถ้า framing ผิด JSON จะ parse ไม่ได้เลย
  const a = make()
  try {
    for (let i = 0; i < 3; i++) {
      assert.equal((await a.sendPrompt(prompt())).result, "สวัสดีครับ")
    }
  } finally { a.connection.close() }
})

test("thread ถูกใช้ซ้ำ ไม่สร้างใหม่ทุกข้อความ — นี่คือจุดต่างจาก v1 ที่ spawn ต่อ request", async () => {
  const a = make()
  try {
    await a.sendPrompt(prompt())
    const first = a.sessionInfo("line-c1")
    await a.sendPrompt(prompt())
    assert.deepEqual(a.sessionInfo("line-c1"), first, "thread id ต้องเท่าเดิม")
  } finally { a.connection.close() }
})

test("sessionKey ต่างกันได้คนละ thread", async () => {
  const a = make()
  try {
    await a.sendPrompt(prompt({ sessionKey: "line-c1" }))
    await a.sendPrompt(prompt({ sessionKey: "line-u9" }))
    assert.notEqual(a.sessionInfo("line-c1")!.threadId, a.sessionInfo("line-u9")!.threadId)
  } finally { a.connection.close() }
})

test("turn/completed ที่ไม่มี delta → ดึงข้อความจาก items", async () => {
  const a = make()
  try {
    assert.equal((await a.sendPrompt(prompt({ text: "NODELTA" }))).result, "จาก items")
  } finally { a.connection.close() }
})

test("turn status error → isError และ core แปลงเป็นไทยได้", async () => {
  const a = make()
  try {
    const out = await a.sendPrompt(prompt({ text: "ERROR" }))
    assert.equal(out.isError, true)
    const { toUserMessage } = await import("@botforge/core/errors")
    assert.equal(toUserMessage(out.result), "เกิน rate limit ครับ รอสักครู่แล้วลองใหม่")
  } finally { a.connection.close() }
})

test("timeout → timedOut ไม่ค้าง และ interrupt ถูกส่ง", async () => {
  const a = make({ promptTimeoutMs: 150 })
  try {
    const out = await a.sendPrompt(prompt({ text: "SLOW" }))
    assert.equal(out.timedOut, true)
    assert.equal(out.result, "")
  } finally { a.connection.close() }
})

test("auto-approve ตอบรับคำขออนุมัติให้อัตโนมัติ", async () => {
  const a = make()
  const seen: string[] = []
  try {
    await a.connection.ensureReady()
    a.connection.rpc.on("approval/observed", (p: any) => seen.push(p.decision))
    await a.sendPrompt(prompt({ text: "APPROVAL" }))
    assert.deepEqual(seen, ["accept"], "v1 ตอบรับทุกคำขอ — ยกมาเหมือนเดิม")
  } finally { a.connection.close() }
})

test("ปิด auto-approve แล้วไม่มีใครตอบ — คำขอค้างจนหมดเวลา", async () => {
  const a = make({ autoApprove: false, promptTimeoutMs: 200 })
  const seen: string[] = []
  try {
    await a.connection.ensureReady()
    a.connection.rpc.on("approval/observed", (p: any) => seen.push(p.decision))
    await a.sendPrompt(prompt({ text: "APPROVAL SLOW" }))
    assert.deepEqual(seen, [], "ไม่มีใครอนุมัติ")
  } finally { a.connection.close() }
})

test("/abort ส่ง turn/interrupt โดยไม่ทำลาย thread", async () => {
  const a = make({ promptTimeoutMs: 2000 })
  try {
    await a.sendPrompt(prompt())
    const before = a.sessionInfo("line-c1")!.threadId
    assert.equal(a.abort("line-c1"), false, "ไม่มี turn เดินอยู่")
    const slow = a.sendPrompt(prompt({ text: "SLOW" }))
    await waitUntil(() => a.abort("line-c1"))
    await slow
    assert.equal(a.sessionInfo("line-c1")!.threadId, before, "thread ต้องยังอยู่")
  } finally { a.connection.close() }
})

test("/new เปิด thread ใหม่ · /model เปลี่ยน model แล้วเปิด thread ใหม่", async () => {
  const a = make()
  try {
    await a.sendPrompt(prompt())
    const first = a.sessionInfo("line-c1")!.threadId
    a.resetSession("line-c1")
    assert.equal(a.sessionInfo("line-c1"), null)
    await a.sendPrompt(prompt())
    assert.notEqual(a.sessionInfo("line-c1")!.threadId, first)

    a.setModel("line-c1", "o3")
    assert.equal(a.modelOf("line-c1"), "o3")
    await a.sendPrompt(prompt())
    const info = a.sessionInfo("line-c1")!
    assert.equal(info.model, "o3")
    assert.ok(info.threadId.includes("o3"), "thread ใหม่ต้องผูกกับ model ใหม่")
  } finally { a.connection.close() }
})

test("prompt prefix ตรงกับ v1 ของ codex — ไม่ใช่ของ opencode", () => {
  const p = buildPrefix({
    userContext: "[User: สมชาย]", groupName: "ทีมกฎหมาย",
    quotedMessageId: "m-1", isGroup: true, now: new Date("2026-08-23T07:30:05Z"),
  })
  assert.ok(p.startsWith("[User: สมชาย] [Group: ทีมกฎหมาย] [Time: 2026-08-23 14:30:05+07:00]"))
  assert.ok(p.includes("[Reply to message ID: m-1]"))
  assert.ok(p.includes(GROUP_CHAT_INSTRUCTION))
  assert.equal(p.includes("question tool"), false, "guard เป็นของ opencode ไม่ใช่ codex")
})

test("1:1 ไม่มี GROUP CHAT และไม่มี [Group:]", () => {
  const p = buildPrefix({ isGroup: false, now: new Date("2026-08-23T07:30:05Z") })
  assert.equal(p, "[Time: 2026-08-23 14:30:05+07:00]\n\n")
})

test("turn/completed ของ turn เก่าไม่ปิดเทิร์นถัดไป — regression", async () => {
  // เจอจริงตอนรัน scripts/scenarios/codex-turns.ts:
  //   เทิร์น SLOW หมดเวลา → ส่ง turn/interrupt → app-server ตอบ turn/completed ของ turn เก่า
  //   ใบนั้นมาถึงตอนเทิร์นถัดไปเริ่มแล้ว ทำให้เทิร์นใหม่จบใน 1 ms ได้ "Done. (no text output)"
  const a = make({ promptTimeoutMs: 120 })
  try {
    const slow = await a.sendPrompt(prompt({ text: "SLOW" }))
    assert.equal(slow.timedOut, true)

    const next = await a.sendPrompt(prompt({ text: "ถามใหม่" }))
    assert.equal(next.result, "สวัสดีครับ", "เทิร์นใหม่ต้องได้คำตอบของตัวเอง ไม่ใช่ผลค้างของเทิร์นเก่า")
    assert.equal(next.timedOut, undefined)
  } finally { a.connection.close() }
})

test("interrupt แล้วยิงต่อได้ทันที ไม่ต้องรอ", async () => {
  const a = make({ promptTimeoutMs: 2000 })
  try {
    const slow = a.sendPrompt(prompt({ text: "SLOW" }))
    // รอจน turn เริ่มจริง — spawn process + handshake + thread/start ใช้เวลาไม่แน่นอน
    // หน่วงตายตัวทำให้ test เปราะ ไม่ใช่เพราะโค้ดผิด
    await waitUntil(() => a.abort("line-c1"))
    await slow
    assert.equal((await a.sendPrompt(prompt())).result, "สวัสดีครับ")
  } finally { a.connection.close() }
})
