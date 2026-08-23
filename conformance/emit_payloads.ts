/**
 * ปล่อย payload จริงที่ @botforge/core ผลิตออกมา แล้วพิมพ์เป็น JSON ทาง stdout
 * payload_check.py เอาไป validate กับ schema ที่ pin ไว้
 *
 * ⚠️ ห้ามเขียน object ขึ้นมาตรง ๆ ในไฟล์นี้ — ต้องมาจาก core เท่านั้น
 *    ADR-0006 ข้อ 2 ต้องการ payload จริง ไม่ใช่ fixture ที่เขียนให้ผ่าน
 */
import { classify } from "../packages/core/src/errors.ts"

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
  "auth failed for sk-proj-AbCdEf1234567890XyZ",
  "Bearer eyJhbGciOiJIUzI1NiJ9abcdefghijklmnop rejected",
]

const payloads = RAW_ERRORS.map((raw) => classify(raw))
process.stdout.write(JSON.stringify({ kind: "error/v1", payloads }, null, 2))
