import { test } from "node:test"
import assert from "node:assert/strict"
import {
  isSkipResponse, applyLengthTruncationNotice, applyPartialNotice,
  LENGTH_TRUNCATION_NOTICE, resolveModel, groupModelsByProvider,
  parseCommand, COMMAND_ALIASES, REPLIES,
} from "./index.ts"
import { LINE_MAX_TEXT } from "../channel/line.ts"

/** ORACLE — เงื่อนไข [SKIP] ฉบับ verbatim จาก v1 (เหมือนกันทั้ง 9 engine) */
function isSkip_v1(responseText: string, isGroup: boolean): boolean {
  const trimmed = responseText.trim()
  return isGroup && (trimmed === "[SKIP]" || trimmed.startsWith("[SKIP]\n") || trimmed.startsWith("[SKIP] "))
}

const SKIP_CORPUS = [
  "[SKIP]", "[SKIP] ", "  [SKIP]  ", "[SKIP]\nเหตุผล", "[SKIP] เพราะไม่ได้ถามผม",
  "[SKIP]abc", "[SKIPPED]", "ไม่ [SKIP]", "สวัสดีครับ", "", "\n\n[SKIP]\n\n",
]

test("isSkipResponse ตรงกับ v1 ทุกกรณี", () => {
  for (const text of SKIP_CORPUS) {
    for (const isGroup of [true, false]) {
      assert.equal(isSkipResponse(text, isGroup), isSkip_v1(text, isGroup), `${JSON.stringify(text)} group=${isGroup}`)
    }
  }
})

test("[SKIP] มีผลเฉพาะในกลุ่ม", () => {
  assert.equal(isSkipResponse("[SKIP]", true), true)
  assert.equal(isSkipResponse("[SKIP]", false), false)
})

test("[SKIP]abc ไม่นับ — ต้องตามด้วยขึ้นบรรทัดหรือช่องว่างเท่านั้น", () => {
  assert.equal(isSkipResponse("[SKIP]abc", true), false)
  assert.equal(isSkipResponse("[SKIPPED]", true), false)
})

test("applyLengthTruncationNotice ใช้เกณฑ์ >= สองเท่าของลิมิตเหมือน v1", () => {
  const under = "x".repeat(LINE_MAX_TEXT * 2 - 1)
  const exact = "x".repeat(LINE_MAX_TEXT * 2)
  assert.equal(applyLengthTruncationNotice(under), under, "ต่ำกว่าเกณฑ์ต้องไม่ต่อท้าย")
  assert.equal(applyLengthTruncationNotice(exact), exact + LENGTH_TRUNCATION_NOTICE)
  assert.ok(applyLengthTruncationNotice("y".repeat(20000)).endsWith(LENGTH_TRUNCATION_NOTICE))
})

test("applyPartialNotice — ข้อความของ opencode เท่านั้น", () => {
  const out = applyPartialNotice("คำตอบครึ่งเดียว")
  assert.ok(out.startsWith("คำตอบครึ่งเดียว"))
  assert.ok(out.includes('พิมพ์ "ต่อ"'))
})

// ── parseCommand ──

test("parseCommand จับคำสั่งและ alias ครบตาม v1", () => {
  const cases: Array<[string, string]> = [
    ["/new", "new"], ["/NEW", "new"], ["/abort", "abort"], ["/sessions", "sessions"],
    ["/about", "about"], ["/who", "about"], ["/help", "help"], ["/คำสั่ง", "help"], ["/cost", "cost"],
  ]
  for (const [text, name] of cases) {
    assert.equal(parseCommand(text)?.name, name, `input: ${text}`)
  }
})

test("ข้อความธรรมดาไม่ใช่คำสั่ง", () => {
  for (const text of ["สวัสดีครับ", "ช่วยเขียน code หน่อย", "", "new", "//new", "/unknown"]) {
    assert.equal(parseCommand(text), null, `input: ${JSON.stringify(text)}`)
  }
})

test('"/new " ที่มีช่องว่างต่อท้ายไม่ใช่คำสั่ง — พฤติกรรมของ v1', () => {
  assert.equal(parseCommand("/new "), null)
  assert.equal(parseCommand(" /new"), null)
})

test("/model รับ argument และ lowercase ให้", () => {
  assert.deepEqual(parseCommand("/model"), { name: "model", arg: "" })
  assert.deepEqual(parseCommand("/model "), { name: "model", arg: "" })
  assert.deepEqual(parseCommand("/model Qwen-Plus"), { name: "model", arg: "qwen-plus" })
  assert.deepEqual(parseCommand("/MODEL  anthropic/claude  "), { name: "model", arg: "anthropic/claude" })
})

test("alias ทุกตัวใน COMMAND_ALIASES parse ได้จริง", () => {
  for (const alias of Object.keys(COMMAND_ALIASES)) {
    assert.equal(parseCommand(alias)?.name, COMMAND_ALIASES[alias])
  }
})

// ── resolveModel ──

const MODELS = ["anthropic/claude-sonnet-4", "openai/gpt-5", "qwen/qwen-plus", "google/gemini-2.5-pro"]

test("resolveModel ตรงเป๊ะ", () => {
  assert.deepEqual(resolveModel(MODELS, "qwen/qwen-plus"), { key: "qwen/qwen-plus", exact: true })
})

test("strategy suffix คือของ opencode — ต้องตรงส่วนท้ายหลัง /", () => {
  assert.equal(resolveModel(MODELS, "qwen-plus", "suffix").key, "qwen/qwen-plus")
  assert.equal(resolveModel(MODELS, "gpt-5", "suffix").key, "openai/gpt-5")
  assert.equal(resolveModel(MODELS, "claude", "suffix").key, null, "suffix ไม่จับ substring")
})

test("strategy substring คือของ claude-code/copilot — ตรงตรงไหนก็ได้", () => {
  assert.equal(resolveModel(MODELS, "claude", "substring").key, "anthropic/claude-sonnet-4")
  assert.equal(resolveModel(MODELS, "qwen-plus", "substring").key, "qwen/qwen-plus")
  assert.equal(resolveModel(MODELS, "ไม่มีจริง", "substring").key, null)
})

test("สองวิธีให้ผลต่างกันจริง — เหตุผลที่ต้องเลือก ไม่ใช่เดา", () => {
  assert.notEqual(
    resolveModel(MODELS, "claude", "suffix").key,
    resolveModel(MODELS, "claude", "substring").key,
  )
})

test("arg ว่างแปลว่าขอดูรายการ ไม่ใช่จะเปลี่ยน", () => {
  assert.deepEqual(resolveModel(MODELS, ""), { key: null, exact: false })
})

test("groupModelsByProvider จัดกลุ่มแบบที่ /model ของ opencode แสดง", () => {
  const g = groupModelsByProvider(MODELS)
  assert.deepEqual(Object.keys(g).sort(), ["anthropic", "google", "openai", "qwen"])
  assert.deepEqual(g.anthropic, ["anthropic/claude-sonnet-4"])
})

test("ข้อความตอบกลับยกมาจาก v1 ทุกตัวอักษร", () => {
  assert.equal(REPLIES.newSession, "เริ่ม session ใหม่แล้วครับ ส่งข้อความมาได้เลย!")
  assert.equal(REPLIES.aborted, "ยกเลิกคำสั่งแล้วครับ")
  assert.equal(REPLIES.unknownModel("foo"), 'ไม่รู้จัก model "foo"\n\nพิมพ์ /model ดูรายการทั้งหมด')
})
