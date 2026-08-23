import { test } from "node:test"
import assert from "node:assert/strict"
import { sendMessage, type LineTransport } from "./send.ts"
import { LINE_MAX_TEXT } from "./line.ts"

interface Call { kind: "reply" | "push"; target: string; text: string }

function fakeTransport(opts: {
  replyFails?: boolean
  pushErrors?: (string | null)[]   // error ต่อครั้ง · null = สำเร็จ
} = {}) {
  const calls: Call[] = []
  let pushCount = 0
  const transport: LineTransport = {
    async reply(replyToken, text) {
      calls.push({ kind: "reply", target: replyToken, text })
      if (opts.replyFails) throw new Error("Invalid reply token")
    },
    async push(to, text) {
      calls.push({ kind: "push", target: to, text })
      const err = opts.pushErrors?.[pushCount++]
      if (err) throw new Error(err)
    },
  }
  return { transport, calls }
}

const slept: number[] = []
const opts = { sleep: async (ms: number) => { slept.push(ms) } }
const fresh = () => { slept.length = 0; return { ...opts } }

test("ข้อความสั้น + มี replyToken → reply อย่างเดียว ไม่ push", async () => {
  const { transport, calls } = fakeTransport()
  const r = await sendMessage(transport, "U1", "สวัสดีครับ", "TOKEN", fresh())
  assert.deepEqual(r, { chunks: 1, delivered: 1, failed: 0 })
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], { kind: "reply", target: "TOKEN", text: "สวัสดีครับ" })
})

test("ไม่มี replyToken → push ทั้งหมด", async () => {
  const { transport, calls } = fakeTransport()
  const r = await sendMessage(transport, "U1", "สวัสดีครับ", undefined, fresh())
  assert.deepEqual(r, { chunks: 1, delivered: 1, failed: 0 })
  assert.equal(calls[0]!.kind, "push")
  assert.equal(calls[0]!.target, "U1")
})

test("ข้อความยาว → chunk แรก reply ที่เหลือ push", async () => {
  const { transport, calls } = fakeTransport()
  const long = "x".repeat(LINE_MAX_TEXT * 2 + 100)
  const r = await sendMessage(transport, "U1", long, "TOKEN", fresh())
  assert.equal(r.chunks, 3)
  assert.equal(r.delivered, 3)
  assert.equal(calls[0]!.kind, "reply")
  assert.equal(calls[1]!.kind, "push")
  assert.equal(calls[2]!.kind, "push")
  // เนื้อหาครบ ไม่หาย
  assert.equal(calls.map((c) => c.text).join("").length, long.length)
})

test("reply พัง → fallback เป็น push ทันที ไม่หาย chunk", async () => {
  const { transport, calls } = fakeTransport({ replyFails: true })
  const r = await sendMessage(transport, "U1", "สวัสดี", "TOKEN", fresh())
  assert.deepEqual(r, { chunks: 1, delivered: 1, failed: 0 })
  assert.equal(calls.length, 2)
  assert.equal(calls[0]!.kind, "reply")
  assert.equal(calls[1]!.kind, "push")
  assert.equal(calls[1]!.text, "สวัสดี")
})

test("push เจอ 429 → retry พร้อม backoff 5s แล้ว 10s", async () => {
  const { transport, calls } = fakeTransport({ pushErrors: ["Server 429", "Server 429", null] })
  const o = fresh()
  const r = await sendMessage(transport, "U1", "สวัสดี", undefined, o)
  assert.deepEqual(r, { chunks: 1, delivered: 1, failed: 0 })
  assert.equal(calls.filter((c) => c.kind === "push").length, 3)
  assert.deepEqual(slept, [5000, 10000])
})

test("429 ตลอด → เลิกหลังครบ 3 ครั้ง ไม่ throw และไม่หน่วงเกินจำเป็น", async () => {
  const { transport, calls } = fakeTransport({ pushErrors: ["429", "429", "429"] })
  const o = fresh()
  const r = await sendMessage(transport, "U1", "สวัสดี", undefined, o)
  assert.deepEqual(r, { chunks: 1, delivered: 0, failed: 1 })
  assert.equal(calls.length, 3)
  // ครั้งสุดท้ายไม่หน่วงต่อ — v1 ก็ไม่หน่วง
  assert.deepEqual(slept, [5000, 10000])
})

test("error ที่ไม่ใช่ 429 → ไม่ retry เลย", async () => {
  const { transport, calls } = fakeTransport({ pushErrors: ["Server 500 internal"] })
  const o = fresh()
  const r = await sendMessage(transport, "U1", "สวัสดี", undefined, o)
  assert.deepEqual(r, { chunks: 1, delivered: 0, failed: 1 })
  assert.equal(calls.length, 1)
  assert.deepEqual(slept, [])
})

test("chunk หนึ่งพังไม่ทำให้ chunk อื่นหยุดส่ง", async () => {
  // chunk1 reply สำเร็จ · chunk2 push พังถาวร · chunk3 push สำเร็จ
  const { transport } = fakeTransport({ pushErrors: ["Server 500", null] })
  const long = "x".repeat(LINE_MAX_TEXT * 2 + 100)
  const r = await sendMessage(transport, "U1", long, "TOKEN", fresh())
  assert.deepEqual(r, { chunks: 3, delivered: 2, failed: 1 })
})

test("log กับ error ถูกเรียกตามเหตุการณ์", async () => {
  const logs: string[] = []
  const errs: string[] = []
  const { transport } = fakeTransport({ replyFails: true, pushErrors: ["429", "Server 500"] })
  await sendMessage(transport, "U1", "สวัสดี", "TOKEN", {
    ...fresh(),
    log: (...a) => logs.push(a.map(String).join(" ")),
    error: (...a) => errs.push(a.map(String).join(" ")),
  })
  assert.ok(logs.some((l) => l.includes("replyMessage failed")), "ควร log ตอน reply พัง")
  assert.ok(logs.some((l) => l.includes("Rate limited")), "ควร log ตอนโดน 429")
  assert.ok(errs.some((e) => e.includes("Failed to send LINE message")), "ควร error ตอนยอมแพ้")
})
