import { test } from "node:test"
import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import {
  chunkText, LINE_MAX_TEXT, validateSignature, timingSafeValidateSignature,
  getSessionKey, isBotMentioned, triggersFor,
} from "./line.ts"

/**
 * ORACLE — chunkText() ฉบับ verbatim จาก v1-final
 * templates/bot-service-opencode/src/index.ts:401
 * ตรวจแล้วว่าทั้ง 9 engine ต่างกันแค่ comment บรรทัดเดียว (semantically identical)
 */
function chunkText_v1(text: string, limit: number = 5000): string[] {
  if (text.length <= limit) return [text]
  const chunks: string[] = []
  let remaining = text
  while (remaining.length > 0) {
    if (remaining.length <= limit) { chunks.push(remaining); break }
    let breakAt = remaining.lastIndexOf("\n", limit)
    if (breakAt < limit * 0.3) breakAt = remaining.lastIndexOf(" ", limit)
    if (breakAt < limit * 0.3) breakAt = limit
    const chunk = remaining.slice(0, breakAt)
    remaining = remaining.slice(breakAt).trimStart()
    const backtickCount = (chunk.match(/```/g) || []).length
    if (backtickCount % 2 !== 0) { chunks.push(chunk + "\n```"); remaining = "```\n" + remaining }
    else chunks.push(chunk)
  }
  return chunks
}

const CORPUS: string[] = [
  "",
  "สั้น ๆ",
  "x".repeat(4999),
  "x".repeat(5000),
  "x".repeat(5001),
  "x".repeat(12345),
  // มี newline ให้ตัด
  ("บรรทัด\n".repeat(2000)),
  // มี space ให้ตัดแต่ไม่มี newline
  ("word ".repeat(3000)),
  // ไม่มีทั้ง newline และ space — ต้องตัดตรง limit
  "ก".repeat(9000),
  // code fence ที่ค้างข้าม chunk
  "```ts\n" + "const a = 1\n".repeat(600) + "```",
  "ข้อความนำ\n```\n" + "y".repeat(6000) + "\n```\nปิดท้าย",
  // fence คู่กันพอดี
  "```\nสั้น\n```",
  // newline อยู่ต้น ๆ (breakAt < limit*0.3 → ต้องถอยไปใช้ space)
  "หัว\n" + "z".repeat(8000),
]

test("chunkText ตรงกับ v1 ที่ limit ของ production", () => {
  for (const input of CORPUS) {
    assert.deepEqual(
      chunkText(input),
      chunkText_v1(input),
      `ต่างกันที่ input ยาว ${input.length}: ${JSON.stringify(input.slice(0, 40))}`,
    )
  }
})

/**
 * limit >= 14 คือช่วงที่ v1 จบแน่นอน (limit*0.3 >= 4 = ความยาวของ "```\n")
 * ต่ำกว่านั้น v1 วนไม่จบเมื่อมี fence ค้าง — ทดสอบแยกที่ test ถัดไป
 */
test("chunkText ตรงกับ v1 ทุก limit ที่ v1 จบ", () => {
  for (const limit of [14, 20, 50, 100, 999, 5000]) {
    for (const input of CORPUS) {
      assert.deepEqual(chunkText(input, limit), chunkText_v1(input, limit), `limit=${limit}`)
    }
  }
})

test("chunkText จบเสมอแม้ limit เล็ก — จุดที่ v1 วนไม่จบ", () => {
  const withFence = "```ts\n" + "const a = 1\n".repeat(600) + "```"
  const fenceMiddle = "ข้อความนำ\n```\n" + "y".repeat(6000) + "\n```\nปิดท้าย"
  for (const limit of [5, 8, 10, 13]) {
    for (const input of [withFence, fenceMiddle]) {
      const chunks = chunkText(input, limit)   // v1 ค้างตรงนี้
      assert.ok(chunks.length > 0)
      assert.equal(chunks.join("").length > 0, true)
      // ทุก chunk มีเนื้อจริง ไม่มี chunk ว่างที่แปลว่าไม่คืบหน้า
      assert.ok(chunks.every((c) => c.length > 0), `limit=${limit} มี chunk ว่าง`)
    }
  }
})

test("ทุก chunk ไม่เกิน limit เว้นตอนต่อ fence ปิด", () => {
  for (const input of CORPUS) {
    for (const c of chunkText(input)) {
      assert.ok(c.length <= LINE_MAX_TEXT + 4, `chunk ยาว ${c.length}`)
    }
  }
})

test("chunkText ปิด code fence ที่ค้าง", () => {
  const withFence = "```ts\n" + "const a = 1\n".repeat(600) + "```"
  const chunks = chunkText(withFence)
  assert.ok(chunks.length > 1, "ควรถูกแบ่งหลาย chunk")
  for (const c of chunks) {
    const n = (c.match(/```/g) || []).length
    assert.equal(n % 2, 0, `chunk มี fence เป็นเลขคี่: ${n}`)
  }
})

test("validateSignature ตรงกับ HMAC SHA256 base64", () => {
  const secret = "test-channel-secret"
  const body = '{"events":[{"type":"message"}]}'
  const sig = createHmac("SHA256", secret).update(body).digest("base64")
  assert.equal(validateSignature(body, sig, secret), true)
  assert.equal(validateSignature(body, "ผิด", secret), false)
  assert.equal(validateSignature(body + " ", sig, secret), false)
  assert.equal(validateSignature(body, sig, "secret-อื่น"), false)
})

test("timingSafeValidateSignature ให้ผลเหมือน validateSignature", () => {
  const secret = "test-channel-secret"
  for (const body of ['{"a":1}', "", "ข้อความไทย", "x".repeat(1000)]) {
    const sig = createHmac("SHA256", secret).update(body).digest("base64")
    assert.equal(timingSafeValidateSignature(body, sig, secret), validateSignature(body, sig, secret))
    assert.equal(timingSafeValidateSignature(body, "AAAA", secret), false)
  }
})

test("getSessionKey เรียงลำดับ group > room > user เหมือน v1", () => {
  assert.equal(getSessionKey({ source: { groupId: "C1", roomId: "R1", userId: "U1" } }), "C1")
  assert.equal(getSessionKey({ source: { roomId: "R1", userId: "U1" } }), "R1")
  assert.equal(getSessionKey({ source: { userId: "U1" } }), "U1")
  assert.equal(getSessionKey({ source: {} }), null)
  assert.equal(getSessionKey({}), null)
})

test("triggersFor สร้างชุดเดียวกับ v1", () => {
  assert.deepEqual(triggersFor("claude"), ["@bot", "claude", "@claude"])
  assert.deepEqual(triggersFor("gemini"), ["@bot", "gemini", "@gemini"])
})

test("isBotMentioned — LINE mention API", () => {
  const cfg = { botUserId: "Ubot123", triggers: triggersFor("claude") }
  const ev = { message: { text: "สวัสดี", mention: { mentionees: [{ type: "user", userId: "Ubot123" }] } } }
  assert.equal(isBotMentioned(ev, cfg), true)
  const other = { message: { text: "สวัสดี", mention: { mentionees: [{ type: "user", userId: "Uคนอื่น" }] } } }
  assert.equal(isBotMentioned(other, cfg), false)
})

test("isBotMentioned — text trigger และคำสั่ง", () => {
  const cfg = { botUserId: "Ubot123", triggers: triggersFor("claude") }
  for (const text of ["@bot ช่วยหน่อย", "claude ทำอะไรได้บ้าง", "@claude hi", "CLAUDE ตัวใหญ่", "/new", "/model"]) {
    assert.equal(isBotMentioned({ message: { text } }, cfg), true, `ควร true: ${text}`)
  }
  for (const text of ["สวัสดีครับ", "ถามเพื่อนในกลุ่ม", "not claude at the start", ""]) {
    assert.equal(isBotMentioned({ message: { text } }, cfg), false, `ควร false: ${text}`)
  }
  assert.equal(isBotMentioned({}, cfg), false)
})

test("trigger ของแต่ละ engine แยกกันจริง", () => {
  const gemini = { botUserId: "U0", triggers: triggersFor("gemini") }
  assert.equal(isBotMentioned({ message: { text: "gemini ช่วยหน่อย" } }, gemini), true)
  assert.equal(isBotMentioned({ message: { text: "claude ช่วยหน่อย" } }, gemini), false)
})
