/**
 * LINE channel primitives
 *
 * ยกมาจาก v1-final โดยไม่เปลี่ยนพฤติกรรม — ทั้ง 4 ฟังก์ชันในไฟล์นี้
 * **เหมือนกันเชิงความหมายทั้ง 9 engine** ต่างกันแค่ comment กับ logger
 * ยกเว้น isBotMentioned() ที่ trigger ผูกกับชื่อ engine จึงทำเป็น parameter
 *
 * ตรวจความเหมือนแล้วที่ docs/architecture/feature-matrix.md §3 (ครบ 11/11 ทุก engine)
 */
import { createHmac } from "node:crypto"

/** LINE จำกัดข้อความละ 5000 ตัวอักษร */
export const LINE_MAX_TEXT = 5000

/** event ที่ webhook ส่งมา — อ่านเฉพาะ field ที่ core ใช้ ไม่ผูกกับ SDK */
export interface LineEventLike {
  source?: { groupId?: string; roomId?: string; userId?: string }
  message?: {
    text?: string
    mention?: { mentionees?: Array<{ type?: string; userId?: string }> }
  }
}

/** จำนวนตัวอักษรที่ถูกเติมกลับเข้า remaining ตอนเปิด fence ใหม่ — `"```\n"` */
const FENCE_REOPEN_COST = 4

/**
 * แบ่งข้อความยาวให้อยู่ในลิมิตของ LINE พร้อมปิด code fence ที่ค้าง
 *
 * เดิมอยู่ใน 23 ไฟล์ · ตรวจแล้วว่าทั้ง 9 engine ต่างกันแค่ comment บรรทัดเดียว
 *
 * ⚠️ **ต่างจาก v1 หนึ่งจุดโดยตั้งใจ — ดู FENCE_REOPEN_COST ข้างล่าง**
 *
 * v1 วนไม่จบเมื่อ `limit` เล็กพอที่จุดตัดจะสั้นกว่า 4 ตัวอักษร และ chunk นั้นมี
 * code fence เป็นเลขคี่ — เพราะเติม `"```\n"` (4 ตัว) กลับเข้า `remaining`
 * มากกว่าที่ตัดออกไป `remaining` จึงโตขึ้นทุกรอบ
 *
 * ยืนยันแล้ว: limit=10 กับข้อความที่มี fence ค้าง วนเกิน 5,000 รอบโดยไม่จบ
 * ส่วน limit=50 ขึ้นไปจบปกติ
 *
 * production ใช้ limit=5000 ซึ่งจุดตัดสั้นสุดคือ 1,500 ตัว จึงไม่เคยเจอ
 * แต่ `limit` เป็น parameter ที่เรียกด้วยค่าอะไรก็ได้ — และการวนไม่จบ
 * ไม่ใช่พฤติกรรมที่ควรรักษาไว้
 *
 * ผลลัพธ์ **เท่ากับ v1 ทุกตัวอักษรเมื่อ limit >= 14** (จุดที่ limit*0.3 >= 4)
 * มี test ยืนยันบน corpus 13 แบบ × limit 14/50/100/999/5000
 */
export function chunkText(text: string, limit: number = LINE_MAX_TEXT): string[] {
  if (text.length <= limit) return [text]

  const chunks: string[] = []
  let remaining = text

  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining)
      break
    }

    let breakAt = remaining.lastIndexOf("\n", limit)
    if (breakAt < limit * 0.3) {
      breakAt = remaining.lastIndexOf(" ", limit)
    }
    if (breakAt < limit * 0.3) {
      breakAt = limit
    }

    let chunk = remaining.slice(0, breakAt)
    let backtickCount = (chunk.match(/```/g) || []).length

    // จุดที่ต่างจาก v1 — ถ้าจะเปิด fence ใหม่แต่ตัดออกไปน้อยกว่าที่จะเติมกลับ
    // ให้ตัดเต็ม limit แทน เพื่อให้ remaining เล็กลงเสมอ
    if (backtickCount % 2 !== 0 && breakAt <= FENCE_REOPEN_COST) {
      breakAt = limit
      chunk = remaining.slice(0, breakAt)
      backtickCount = (chunk.match(/```/g) || []).length
    }

    remaining = remaining.slice(breakAt).trimStart()

    if (backtickCount % 2 !== 0) {
      chunks.push(chunk + "\n```")
      remaining = "```\n" + remaining
    } else {
      chunks.push(chunk)
    }
  }

  return chunks
}

/**
 * ตรวจ x-line-signature — HMAC SHA256 ของ raw body ด้วย channel secret
 *
 * ⚠️ เทียบด้วย `===` เหมือน v1 ซึ่งไม่ใช่ timing-safe
 *    ยังไม่เปลี่ยนเพราะรอบนี้คือ "ยกมาโดยไม่เปลี่ยนพฤติกรรม"
 *    ดู timingSafeValidateSignature() ข้างล่างสำหรับตัวที่ปลอดภัยกว่า
 */
export function validateSignature(body: string, signature: string, channelSecret: string): boolean {
  const hash = createHmac("SHA256", channelSecret).update(body).digest("base64")
  return hash === signature
}

/**
 * เหมือน validateSignature แต่เทียบแบบ constant-time
 *
 * แยกไว้เป็นคนละฟังก์ชันเพื่อไม่ให้การ refactor รอบนี้เปลี่ยนพฤติกรรมเงียบ ๆ
 * — สลับมาใช้ตัวนี้เป็นการตัดสินใจแยกต่างหาก ไม่ใช่ผลข้างเคียงของการย้ายโค้ด
 */
export function timingSafeValidateSignature(body: string, signature: string, channelSecret: string): boolean {
  const hash = createHmac("SHA256", channelSecret).update(body).digest()
  let given: Buffer
  try {
    given = Buffer.from(signature, "base64")
  } catch {
    return false
  }
  if (given.length !== hash.length) return false
  let diff = 0
  for (let i = 0; i < hash.length; i++) diff |= hash[i]! ^ given[i]!
  return diff === 0
}

/**
 * key ของ session — group และ room ใช้ร่วมกันทั้งห้อง ส่วน 1:1 ใช้ของผู้ใช้
 * คืน **id ดิบของ LINE** เหมือน v1 · แปลงเป็น identity/v1 Id ด้วย toChannelId()
 */
export function getSessionKey(event: LineEventLike): string | null {
  if (event.source?.groupId) return event.source.groupId
  if (event.source?.roomId) return event.source.roomId
  if (event.source?.userId) return event.source.userId
  return null
}

export interface MentionConfig {
  /** userId ของ bot จาก getBotInfo() ตอน startup — ใช้กับ LINE mention API */
  botUserId?: string
  /** คำที่ถือว่าเรียก bot · เทียบแบบ startsWith หลัง lowercase */
  triggers: readonly string[]
}

/**
 * trigger ชุดเดียวกับที่ v1 ใช้ — `@bot` · ชื่อ engine · `@ชื่อ engine`
 *
 * ⚠️ ของจริงใน v1 ไม่ตรงกันทุกตัว: `copilot-cli` ใช้ `claude`/`@claude`
 *    ไม่ใช่ `copilot` — น่าจะเป็นของค้างจากตอน copy template
 *    ยกมาตามจริงก่อน การแก้เป็นการตัดสินใจแยก
 */
export function triggersFor(engineName: string): string[] {
  return ["@bot", engineName, `@${engineName}`]
}

export function isBotMentioned(event: LineEventLike, config: MentionConfig): boolean {
  const mentionees = event.message?.mention?.mentionees
  if (Array.isArray(mentionees)) {
    if (mentionees.some((m) => m.type === "user" && m.userId === config.botUserId)) return true
  }
  const text = (event.message?.text ?? "").toLowerCase()
  if (config.triggers.some((t) => text.startsWith(t))) return true
  // คำสั่งตอบเสมอ ไม่ว่าจะเรียกชื่อหรือไม่
  if (text.startsWith("/")) return true
  return false
}
