import { test } from "node:test"
import assert from "node:assert/strict"
import { classify, renderThai, toUserMessage, redact, isSessionExpired, CODE_PATTERN } from "./errors.ts"

/**
 * ORACLE — getErrorHint() ฉบับ verbatim จาก v1-final
 *
 * คัดลอกมาทั้งดุ้นจาก templates/bot-service-codex/src/index.ts:219
 * ตรวจแล้วว่า **เหมือนกันทุก byte ทั้ง 8 engine** ที่มีฟังก์ชันนี้
 * (claude-code · copilot-cli · adkcode · gocode · codex · codex-appserver · qwen-code · gemini-cli)
 *
 * ห้ามแก้ไฟล์ส่วนนี้เพื่อให้ test ผ่าน — ถ้า test แดงแปลว่า core เปลี่ยนพฤติกรรม
 */
function getErrorHint_v1(errMsg: string): string {
  const msg = errMsg.toLowerCase()
  if (msg.includes("429") || msg.includes("rate limit")) return "เกิน rate limit ครับ รอสักครู่แล้วลองใหม่"
  if (msg.includes("timeout") || msg.includes("timed out") || msg.includes("abort")) return "AI ใช้เวลานานเกินไปครับ ลองพิมพ์ /new แล้วถามใหม่"
  if (msg.includes("401") || msg.includes("403") || msg.includes("auth") || msg.includes("unauthorized")) return "มีปัญหาเรื่อง authentication ครับ กรุณาแจ้ง admin"
  if (msg.includes("500") || msg.includes("internal server")) return "server มีปัญหาครับ ลองใหม่อีกครั้ง"
  if (msg.includes("context") || msg.includes("too long") || msg.includes("token")) return "บทสนทนายาวเกินไปครับ ลองพิมพ์ /new เพื่อเริ่มใหม่"
  return `เกิดข้อผิดพลาดครับ: ${errMsg.slice(0, 200)}`
}

const CORPUS: string[] = [
  // ตรงแต่ละ branch
  "Server 429: rate limit exceeded",
  "OpenCode API 429",
  "rate limit hit",
  "The operation timed out",
  "AbortError: signal is aborted without reason",
  "fetch timeout after 300000ms",
  "Server 401: unauthorized",
  "Server 403: forbidden",
  "authentication failed",
  "Server 500: internal server error",
  "context length exceeded",
  "prompt is too long",
  "maximum token limit reached",
  // fallback
  "something went completely sideways",
  "",
  "ECONNREFUSED 127.0.0.1:4096",
  // ลำดับต้องชนะ — ทั้งคู่ match หลาย branch
  "429 timeout",                       // rate_limited ต้องชนะ timeout
  "timeout during authentication",     // timeout ต้องชนะ auth
  "401 internal server error",         // auth ต้องชนะ 500
  "500 context too long",              // provider_error ต้องชนะ context
  "unauthorized: token expired",       // auth ต้องชนะ token
  // ตัวพิมพ์ใหญ่ — ของเดิม lowercase ก่อนตรวจ
  "RATE LIMIT",
  "TIMED OUT",
  "Internal Server Error",
  // ยาวเกิน 200 เพื่อทดสอบการตัด
  "x".repeat(500),
  "boom " + "y".repeat(400),
]

test("renderThai(classify(x)) ตรงกับ getErrorHint() ของ v1 ทุกตัวอักษร", () => {
  for (const input of CORPUS) {
    assert.equal(
      toUserMessage(input),
      getErrorHint_v1(input),
      `ต่างกันที่ input: ${JSON.stringify(input.slice(0, 60))}`,
    )
  }
})

test("รับ Error object ได้ผลเท่ากับรับ string", () => {
  for (const input of CORPUS) {
    assert.equal(toUserMessage(new Error(input)), getErrorHint_v1(input))
  }
})

test("code ทุกตัวตรง pattern ของ error/v1", () => {
  for (const input of CORPUS) {
    const e = classify(input)
    assert.match(e.code, CODE_PATTERN, `code ผิด pattern: ${e.code}`)
  }
})

test("category อยู่ในชุดของ error/v1 และ retryable สอดคล้อง", () => {
  const cases: Array<[string, string, boolean]> = [
    ["429 too many", "rate_limited", true],
    ["timed out", "timeout", true],
    ["401 unauthorized", "authentication", false],
    ["500 internal server", "provider_error", true],
    ["context too long", "validation", false],
    ["ระเบิด", "internal", false],
  ]
  for (const [input, category, retryable] of cases) {
    const e = classify(input)
    assert.equal(e.category, category, `input: ${input}`)
    assert.equal(e.retryable, retryable, `input: ${input}`)
  }
})

test("message ของ error/v1 ถูก redact — ห้ามมี credential", () => {
  const leaky = "auth failed for sk-proj-AbCdEf1234567890XyZ and Bearer eyJhbGciOiJIUzI1NiJ9abcdefgh"
  const e = classify(leaky)
  assert.ok(!e.message.includes("sk-proj-AbCdEf1234567890XyZ"), "api key ยังอยู่ใน message")
  assert.ok(!e.message.includes("eyJhbGciOiJIUzI1NiJ9abcdefgh"), "bearer token ยังอยู่ใน message")
  assert.ok(e.message.includes("[redacted]"), "ไม่ได้ redact อะไรเลย")
})

test("redact จัดการรูปแบบที่พบบ่อยได้", () => {
  assert.ok(!redact("ghp_1234567890abcdefghij").includes("1234567890abcdefghij"))
  assert.ok(!redact("token=deadbeefdeadbeefdeadbeefdeadbeef").includes("deadbeefdeadbeefdeadbeefdeadbeef"))
  assert.equal(redact("plain error message"), "plain error message")
})

test("message ถูกตัดที่ 200 ตัวอักษรเท่าของเดิม", () => {
  assert.equal(classify("z".repeat(500)).message.length, 200)
})

test("isSessionExpired แยกจาก RULES และไม่ไปกวนลำดับ", () => {
  assert.equal(isSessionExpired("Server 404: session not found"), true)
  assert.equal(isSessionExpired("not found"), true)
  assert.equal(isSessionExpired("500 internal server"), false)
  // 404 ไม่ได้อยู่ใน RULES จึงตกลง fallback เหมือนของเดิมเป๊ะ
  assert.equal(toUserMessage("Server 404: session not found"), getErrorHint_v1("Server 404: session not found"))
})

test("โควต้าหมดของ OKMD — เพิ่มจาก v1 โดยตั้งใจ", () => {
  // OKMD ตอบ 401 ตอนโควต้ารายวันหมด ข้อความดิบจึงอ่านเหมือน auth error
  const raw = "OpenCode API 401: model has reached daily limit for this key"
  const e = classify(raw)
  assert.equal(e.code, "runtime.quota_exhausted")
  assert.equal(e.category, "budget_exceeded", "ไม่ใช่ authentication แม้ข้อความจะมี 401")
  assert.equal(e.retryable, false)
  assert.ok(toUserMessage(raw).includes("โควต้าของโมเดลนี้หมด"))
  assert.ok(toUserMessage(raw).includes("/model"), "ต้องบอกทางออกให้ผู้ใช้")

  // v1 ของ 8 engine จะได้ authentication เพราะเจอ "401" ก่อน — นี่คือการปรับปรุงโดยตั้งใจ
  // ไม่กระทบ CORPUS เพราะไม่มีตัวไหนมีสตริงนี้ (test equivalence ข้างบนยังผ่าน)
  assert.equal(classify("Server 401: unauthorized").category, "authentication")
})

test("session busy → conflict ไม่ใช่ internal", () => {
  const e = classify("ADKcode API 409: Session is busy")
  assert.equal(e.code, "runtime.session_busy")
  assert.equal(e.category, "conflict")
  assert.equal(e.retryable, true, "รอแล้วส่งใหม่ได้")
  assert.ok(toUserMessage("session line-c1 กำลังทำงานอยู่ (409 conflict)").includes("รอสักครู่"))
  // ไม่ไปทับ rate limit
  assert.equal(classify("Server 429: rate limit").category, "rate_limited")
  // regression — เคยใช้ "409" เป็น needle แล้วไปจับเลข port ของ opencode เข้า
  assert.equal(classify("ECONNREFUSED 127.0.0.1:4096").code, "runtime.unknown",
    "เลข port ที่มี 409 อยู่ข้างในต้องไม่ถูกจับเป็น session busy")
})

test("renderThai รับ error/v1 object ที่ code ไม่รู้จักได้", () => {
  const foreign = { code: "odoo.sale.locked", category: "conflict" as const, message: "record locked", retryable: false }
  assert.equal(renderThai(foreign), "เกิดข้อผิดพลาดครับ: record locked")
})
