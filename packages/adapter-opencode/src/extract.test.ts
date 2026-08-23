import { test } from "node:test"
import assert from "node:assert/strict"
import { extractResponse, stripThinkTags, EMPTY_RESPONSE } from "./extract.ts"

/** ORACLE — extractResponse() + stripThinkTags() ฉบับ verbatim จาก v1-final */
function stripThinkTags_v1(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>\s*/g, "").replace(/<think>[\s\S]*$/g, "").trim()
}
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
      const cleaned = stripThinkTags_v1(p.text)
      if (cleaned) parts.push(cleaned)
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
        parts.push(stripThinkTags_v1(p.text))
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
