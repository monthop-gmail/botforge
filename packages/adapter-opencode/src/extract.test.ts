import { test } from "node:test"
import assert from "node:assert/strict"
import { extractResponse, stripThinkTags, stripStrayToolCalls, cleanModelText, EMPTY_RESPONSE, STRAY_TOOL_CALL_NOTE } from "./extract.ts"

/**
 * ORACLE — ฉบับ verbatim จาก `v1-final` (5d6d709, 2026-08-11)
 * รวม stripStrayToolCalls / cleanModelText ที่เพิ่มเข้ามาใน commit นั้น
 */
function stripThinkTags_v1(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>\s*/g, "").replace(/<think>[\s\S]*$/g, "").trim()
}
function stripStrayToolCalls_v1(text: string): string {
  return text
    .replace(/<tool_call>\s*\{[\s\S]*?"name"[\s\S]*?(?:<\/tool_call>|<\/think>|$)\s*/g, "")
    .replace(/<\/(?:think|tool_call)>\s*/g, "")
    .trim()
}
function cleanModelText_v1(text: string): { text: string; strayToolCall: boolean } {
  const withoutThink = stripThinkTags_v1(text)
  const cleaned = stripStrayToolCalls_v1(withoutThink)
  return { text: cleaned, strayToolCall: cleaned !== withoutThink }
}
const STRAY_NOTE_V1 = "โมเดลพยายามเรียกใช้เครื่องมือแต่ไม่สำเร็จครับ ลองถามใหม่อีกครั้ง หรือพิมพ์ /model เพื่อเปลี่ยนโมเดล"
function extractResponse_v1(result: any): string {
  if (result?.info?.error) {
    const err = result.info.error
    const errMsg = err.data?.message || err.name || "Unknown error"
    return `❌ API Error: ${errMsg}`
  }
  if (!result?.parts) return "เสร็จแล้วครับ (ไม่มีข้อความตอบกลับ)"
  const parts: string[] = []
  for (const p of result.parts) {
    if (p.type === "text" && p.text) {
      const { text, strayToolCall } = cleanModelText_v1(p.text)
      if (text) parts.push(text)
      else if (strayToolCall) parts.push(STRAY_NOTE_V1)
    }
    if (p.type === "tool" && p.tool === "question" && p.state?.input?.questions) {
      for (const q of p.state.input.questions) {
        let qText = q.question || ""
        if (q.options?.length) {
          qText += "\n" + q.options.map((o: any, i: number) => `${i + 1}. ${o.label}${o.description ? ` - ${o.description}` : ""}`).join("\n")
        }
        if (qText) parts.push(qText)
      }
    }
    if (p.type === "reasoning" && p.text) {
      if (!result.parts.some((x: any) => x.type === "text" && x.text)) {
        parts.push(cleanModelText_v1(p.text).text)
      }
    }
  }
  return parts.join("\n\n") || "เสร็จแล้วครับ (ไม่มีข้อความตอบกลับ)"
}

const CORPUS: unknown[] = [
  null, undefined, {}, { parts: [] },
  { parts: [{ type: "text", text: "สวัสดีครับ" }] },
  { parts: [{ type: "text", text: "  มีช่องว่าง  " }] },
  { parts: [{ type: "text", text: "" }] },
  { parts: [{ type: "text", text: "<think>คิดอยู่</think>คำตอบ" }] },
  { parts: [{ type: "text", text: "<think>คิดไม่จบ..." }] },
  { parts: [{ type: "text", text: "<think>a</think>x<think>b</think>y" }] },
  { parts: [{ type: "text", text: "<think>ทั้งหมดคือการคิด</think>" }] },
  { parts: [{ type: "reasoning", text: "เหตุผล" }] },
  { parts: [{ type: "reasoning", text: "<think>ซ้อน</think>เหตุผล" }] },
  { parts: [{ type: "text", text: "คำตอบ" }, { type: "reasoning", text: "ไม่ควรโผล่" }] },
  { parts: [{ type: "text", text: "ก" }, { type: "text", text: "ข" }] },
  { parts: [{ type: "tool", tool: "question", state: { input: { questions: [{ question: "เลือกอันไหน" }] } } }] },
  { parts: [{ type: "tool", tool: "question", state: { input: { questions: [
      { question: "เลือกอันไหน", options: [{ label: "A", description: "ตัวแรก" }, { label: "B" }] },
  ] } } }] },
  { parts: [{ type: "tool", tool: "bash", state: {} }] },
  { info: { error: { data: { message: "rate limit exceeded" } } } },
  { info: { error: { name: "AuthError" } } },
  { info: { error: {} } },
  { info: { role: "assistant" }, parts: [{ type: "text", text: "จาก partial" }] },
  // stray tool call — Thai 8B ปิดด้วย </think> แทน </tool_call>
  { parts: [{ type: "text", text: '<tool_call>\n{"name": "read", "arguments": {"path": "/a"}}</think>' }] },
  { parts: [{ type: "text", text: 'คำตอบก่อน\n<tool_call>\n{"name": "bash"}</tool_call>\nคำตอบหลัง' }] },
  { parts: [{ type: "text", text: '<tool_call>\n{"name": "read"}' }] },
  { parts: [{ type: "text", text: "พูดถึง <tool_call> เฉย ๆ ไม่มี JSON" }] },
  { parts: [{ type: "text", text: "ปิดเกินมา</think>" }] },
]

test("extractResponse ตรงกับ v1 ทุกกรณีใน corpus", () => {
  for (const input of CORPUS) {
    assert.equal(
      extractResponse(input).text,
      extractResponse_v1(input),
      `ต่างที่: ${JSON.stringify(input)?.slice(0, 90)}`,
    )
  }
})

test("stripThinkTags ตรงกับ v1", () => {
  const texts = [
    "ไม่มี think", "<think>a</think>b", "<think>ไม่ปิด", "a<think>b</think>c<think>d",
    "<think>\nหลายบรรทัด\n</think>  คำตอบ", "", "   ", "<think></think>",
  ]
  for (const t of texts) assert.equal(stripThinkTags(t), stripThinkTags_v1(t), JSON.stringify(t))
})

test("isError ตั้งเมื่อมี info.error เท่านั้น", () => {
  assert.equal(extractResponse({ info: { error: { name: "X" } } }).isError, true)
  assert.equal(extractResponse({ parts: [{ type: "text", text: "ok" }] }).isError, false)
  assert.equal(extractResponse(null).isError, false)
})

test("ไม่มี parts หรือได้ข้อความว่าง → ข้อความมาตรฐาน", () => {
  assert.equal(extractResponse({}).text, EMPTY_RESPONSE)
  assert.equal(extractResponse({ parts: [] }).text, EMPTY_RESPONSE)
  assert.equal(extractResponse({ parts: [{ type: "text", text: "<think>ล้วน ๆ</think>" }] }).text, EMPTY_RESPONSE)
})

test("reasoning ใช้ต่อเมื่อไม่มี text part เลย", () => {
  assert.equal(extractResponse({ parts: [{ type: "reasoning", text: "เหตุผล" }] }).text, "เหตุผล")
  assert.equal(
    extractResponse({ parts: [{ type: "text", text: "คำตอบ" }, { type: "reasoning", text: "ซ่อน" }] }).text,
    "คำตอบ",
  )
})

test("tool question กาง option พร้อมเลข", () => {
  const out = extractResponse({ parts: [{ type: "tool", tool: "question", state: { input: { questions: [
    { question: "เลือกอันไหน", options: [{ label: "A", description: "ตัวแรก" }, { label: "B" }] },
  ] } } }] })
  assert.equal(out.text, "เลือกอันไหน\n1. A - ตัวแรก\n2. B")
})


test("stripStrayToolCalls ตรงกับ v1-final", () => {
  const texts = [
    '<tool_call>\n{"name": "read", "arguments": {}}</tool_call>',
    '<tool_call>\n{"name": "read"}</think>',
    '<tool_call>\n{"name": "read"}',
    "พูดถึง <tool_call> เฉย ๆ",
    "ข้อความปกติ",
    "</think>",
    "",
  ]
  for (const t of texts) assert.equal(stripStrayToolCalls(t), stripStrayToolCalls_v1(t), JSON.stringify(t))
})

test("JSON ดิบของ tool call ที่พังไม่หลุดถึงผู้ใช้", () => {
  const out = extractResponse({ parts: [{ type: "text", text:
    '<tool_call>\n{"name": "read", "arguments": {"path": "/etc/passwd"}}</think>' }] })
  assert.equal(out.text.includes("tool_call"), false)
  assert.equal(out.text.includes('"name"'), false)
  assert.equal(out.text, STRAY_TOOL_CALL_NOTE, "ทั้งก้อนเป็น tool call พัง → ต้องบอกผู้ใช้ ไม่ใช่เงียบ")
})

test("มีทั้งคำตอบและ tool call พัง → เก็บคำตอบไว้ ทิ้งเฉพาะ tool call", () => {
  const out = extractResponse({ parts: [{ type: "text", text:
    'ไฟล์นี้มีอะไรบ้างครับ\n<tool_call>\n{"name": "read"}</tool_call>' }] })
  assert.equal(out.text, "ไฟล์นี้มีอะไรบ้างครับ")
})

test("ข้อความที่พูดถึง <tool_call> เฉย ๆ ไม่ถูกตัด — ต้องมี JSON ที่มี name", () => {
  const out = extractResponse({ parts: [{ type: "text", text: "แท็ก <tool_call> ใช้ยังไงครับ" }] })
  assert.equal(out.text, "แท็ก <tool_call> ใช้ยังไงครับ")
})

test("cleanModelText บอกได้ว่ามีการทิ้ง tool call ไหม", () => {
  assert.deepEqual(cleanModelText("ข้อความปกติ"), { text: "ข้อความปกติ", strayToolCall: false })
  const r = cleanModelText('a<tool_call>\n{"name": "x"}</tool_call>')
  assert.equal(r.strayToolCall, true)
  assert.equal(r.text, "a")
})

test("log ถูกเรียกเมื่อมีการทิ้ง tool call", () => {
  const logs: string[] = []
  extractResponse(
    { parts: [{ type: "text", text: 'ok<tool_call>\n{"name": "x"}</tool_call>' }] },
    { log: (...a) => logs.push(a.map(String).join(" ")) },
  )
  assert.ok(logs.some((l) => l.includes("tool_call")))
})
