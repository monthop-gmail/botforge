/**
 * error/v1 — error taxonomy ร่วมของ ecosystem
 *
 * ผูกกับ agent-platform `contracts/error/v1/error.schema.yaml`
 * ดู docs/architecture/contract-mapping.md §4.1
 *
 * แทนที่ `getErrorHint()` ที่เคยถูก copy อยู่ใน 23 ไฟล์ (8 template + 15 project)
 * โดยแยกสองหน้าที่ที่เดิมปนกันอยู่ในฟังก์ชันเดียว:
 *
 *   classify()    err ดิบ → error/v1 object       ← ไปที่ audit event
 *   renderThai()  error/v1 object → ข้อความไทย     ← ไปที่ผู้ใช้ผ่าน channel
 *
 * ข้อความไทยที่ renderThai() คืน **ตรงกับของเดิมทุกตัวอักษร** — มี test พิสูจน์
 * เทียบกับ getErrorHint() ฉบับ verbatim ใน errors.test.ts
 */

/** error/v1#/$defs/Category */
export type ErrorCategory =
  | "validation"
  | "authentication"
  | "authorization"
  | "policy_denied"
  | "approval_required"
  | "rate_limited"
  | "budget_exceeded"
  | "timeout"
  | "conflict"
  | "provider_error"
  | "external_dependency"
  | "internal"

/** error/v1 — required: [code, category, message, retryable] */
export interface PlatformError {
  code: string
  category: ErrorCategory
  message: string
  retryable: boolean
  retry_after_seconds?: number
  details?: Record<string, unknown>
  correlation_id?: string
}

/** error/v1 code pattern — ต้องมีจุดอย่างน้อยหนึ่งจุด */
export const CODE_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/

/**
 * ลำดับการตรวจ **ต้องตรงกับ getErrorHint() เดิมเป๊ะ**
 * สลับลำดับแล้วผลเปลี่ยน เช่น "abort" ติดที่ timeout ก่อนถึง auth
 * และ "authentication timeout" จะได้ timeout ไม่ใช่ auth
 */
const RULES: ReadonlyArray<{
  needles: readonly string[]
  code: string
  category: ErrorCategory
  retryable: boolean
  thai: string
}> = [
  {
    // ⚠️ ต้องอยู่ก่อน authentication — OKMD ตอบ 401 ไม่ใช่ 429 ตอนโควต้ารายวันหมด
    //    ข้อความดิบจึงอ่านเหมือน auth error ทั้งที่เปลี่ยนโมเดลแล้วใช้ได้ต่อ
    //
    //    v1 มีเฉพาะใน extractResponse() ของ opencode (opencode ไม่มี getErrorHint เลย)
    //    ย้ายมา core เพื่อให้ทุก engine ได้เหมือนกัน แบบเดียวกับ request queue และ error hints
    needles: ["reached daily limit"],
    code: "runtime.quota_exhausted",
    category: "budget_exceeded",
    retryable: false,
    thai:
      "🪫 โควต้าของโมเดลนี้หมดสำหรับวันนี้ครับ\n" +
      "พิมพ์ /model เพื่อเปลี่ยนไปโมเดลอื่น (โควต้าแยกกันแต่ละโมเดล) หรือรอรีเซ็ตวันถัดไป",
  },
  {
    needles: ["429", "rate limit"],
    code: "runtime.rate_limited",
    category: "rate_limited",
    retryable: true,
    thai: "เกิน rate limit ครับ รอสักครู่แล้วลองใหม่",
  },
  {
    needles: ["timeout", "timed out", "abort"],
    code: "runtime.timeout",
    category: "timeout",
    retryable: true,
    thai: "AI ใช้เวลานานเกินไปครับ ลองพิมพ์ /new แล้วถามใหม่",
  },
  {
    needles: ["401", "403", "auth", "unauthorized"],
    code: "runtime.unauthenticated",
    category: "authentication",
    retryable: false,
    thai: "มีปัญหาเรื่อง authentication ครับ กรุณาแจ้ง admin",
  },
  {
    needles: ["500", "internal server"],
    code: "runtime.provider_error",
    category: "provider_error",
    retryable: true,
    thai: "server มีปัญหาครับ ลองใหม่อีกครั้ง",
  },
  {
    // error/v1 ยังไม่มี category ที่หมายถึง "context window เต็ม" โดยตรง
    // validation ใกล้ที่สุดเพราะ retry ไม่ช่วยเหมือนกัน — ดู contract-mapping.md §4.1
    needles: ["context", "too long", "token"],
    code: "runtime.context_exhausted",
    category: "validation",
    retryable: false,
    thai: "บทสนทนายาวเกินไปครับ ลองพิมพ์ /new เพื่อเริ่มใหม่",
  },
]

const FALLBACK = {
  code: "runtime.unknown",
  category: "internal" as ErrorCategory,
  retryable: false,
}

/** ตัดสิ่งที่ไม่ควรเข้า audit ออกจากข้อความ — error/v1 ห้าม message มี credential/PII */
export function redact(text: string): string {
  return text
    .replace(/\b(sk|pk|ghp|gho|ghs|ghu|xox[baprs])[-_][A-Za-z0-9_-]{8,}/g, "$1-[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi, "Bearer [redacted]")
    .replace(/\b[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/g, "[redacted-jwt]")
    .replace(/\b[0-9a-f]{32,}\b/gi, "[redacted-hex]")
}

function messageOf(err: unknown): string {
  if (typeof err === "string") return err
  if (err instanceof Error) return err.message
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message: unknown }).message
    if (typeof m === "string") return m
  }
  return String(err)
}

/**
 * err ดิบ → error/v1
 *
 * `message` ถูก redact แล้วและตัดที่ 200 ตัวอักษรเท่าของเดิม — ตัวนี้ไปที่ audit
 * ข้อความที่ผู้ใช้เห็นมาจาก renderThai() ไม่ใช่จาก field นี้
 */
export function classify(err: unknown): PlatformError {
  const raw = messageOf(err)
  const msg = raw.toLowerCase()
  const hit = RULES.find((r) => r.needles.some((n) => msg.includes(n)))
  const base = hit ?? FALLBACK
  return {
    code: base.code,
    category: base.category,
    message: redact(raw).slice(0, 200),
    retryable: base.retryable,
  }
}

/**
 * error/v1 → ข้อความไทยที่ผู้ใช้เห็น
 *
 * ต้องรับ err ดิบด้วย เพราะ fallback ของเดิมเอา errMsg ดิบมาต่อท้าย
 * ซึ่งเป็นพฤติกรรมที่ preserve ไว้ — ดู test เทียบกับ getErrorHint() เดิม
 */
export function renderThai(error: PlatformError, rawMessage?: string): string {
  const hit = RULES.find((r) => r.code === error.code)
  if (hit) return hit.thai
  const tail = (rawMessage ?? error.message).slice(0, 200)
  return `เกิดข้อผิดพลาดครับ: ${tail}`
}

/** ทางลัดที่ใช้แทน getErrorHint(errMsg) เดิมได้ตรง ๆ */
export function toUserMessage(err: unknown): string {
  return renderThai(classify(err), messageOf(err))
}

/**
 * session หมดอายุฝั่ง provider — ของเดิมตรวจแยกจาก getErrorHint()
 * (`err?.message?.includes("404")`) แล้วสร้าง session ใหม่อัตโนมัติ
 * feature 2.6 มีครบทั้ง 9 engine · แยกไว้เหมือนเดิมเพื่อไม่ให้ไปกวนลำดับของ RULES
 */
export function isSessionExpired(err: unknown): boolean {
  const msg = messageOf(err).toLowerCase()
  return msg.includes("404") || msg.includes("not found")
}
