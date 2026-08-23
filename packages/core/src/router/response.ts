/**
 * ตัดสินใจว่าจะทำอะไรกับคำตอบที่ได้จาก runtime
 *
 * ยกมาจากส่วนท้ายของ `handleTextMessage()` ใน v1-final
 */
import { LINE_MAX_TEXT } from "../channel/line.ts"

/**
 * agent ตอบ `[SKIP]` = ข้อความในกลุ่มไม่ได้เรียกถึง bot
 *
 * เงื่อนไข **เหมือนกันทั้ง 9 engine ทุกตัวอักษร** ต่างแค่ชื่อตัวแปร
 * (`trimmed` กับ `trimmedResponse`) · ตรวจแล้วด้วย grep ทั้ง 9 ไฟล์
 *
 * เช็คเฉพาะในกลุ่ม — 1:1 ตอบทุกข้อความอยู่แล้ว
 */
export function isSkipResponse(responseText: string, isGroup: boolean): boolean {
  if (!isGroup) return false
  const trimmed = responseText.trim()
  return (
    trimmed === "[SKIP]" ||
    trimmed.startsWith("[SKIP]\n") ||
    trimmed.startsWith("[SKIP] ")
  )
}

/** ข้อความต่อท้ายเมื่อคำตอบยาวเกิน — ของ 8 engine (ทุกตัวยกเว้น `opencode`) */
export const LENGTH_TRUNCATION_NOTICE = "\n\n--- ข้อความถูกตัดเนื่องจากยาวเกินไป ---"

/** ข้อความต่อท้ายเมื่อ timeout แล้วได้คำตอบมาบางส่วน — ของ `opencode` (feature 2.8) */
export const PARTIAL_RESPONSE_NOTICE =
  '\n\n⏱️ คำตอบยังไม่ครบ รอสัก 1 นาที แล้วพิมพ์ "ต่อ" เพื่อขอส่วนที่เหลือ'

/** ข้อความเมื่อ timeout โดยไม่ได้คำตอบเลย */
export const TIMEOUT_NO_RESPONSE_MESSAGE = "⏱️ AI ใช้เวลานานเกินไป ลองพิมพ์ /new แล้วถามใหม่"

/**
 * ต่อท้ายว่าโดนตัด เมื่อยาวถึงสองเท่าของลิมิต LINE
 * เงื่อนไข `>= LINE_MAX_TEXT * 2` ยกมาจาก v1 ตรง ๆ
 */
export function applyLengthTruncationNotice(text: string, limit: number = LINE_MAX_TEXT): string {
  return text.length >= limit * 2 ? text + LENGTH_TRUNCATION_NOTICE : text
}

/** ต่อท้ายว่าคำตอบยังไม่ครบ — ใช้เมื่อ runtime บอกว่า abort กลางทางแล้วดึงของเดิมมาได้บางส่วน */
export function applyPartialNotice(text: string): string {
  return text + PARTIAL_RESPONSE_NOTICE
}
