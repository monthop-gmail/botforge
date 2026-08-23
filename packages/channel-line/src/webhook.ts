/**
 * แปลง webhook payload ของ LINE เป็นสิ่งที่ core เข้าใจ
 *
 * แยกออกจาก server เพราะ **ตรรกะการตัดสินใจทั้งหมดอยู่ตรงนี้** และทดสอบได้โดยไม่ต้องมี HTTP
 * ส่วน server เหลือแค่ verify signature · ตอบ 200 · แล้วส่งต่อมาที่นี่
 */
import { getSessionKey, isBotMentioned, type LineEventLike, type MentionConfig } from "@botforge/core/channel"

export type LineWebhookEvent = LineEventLike & {
  type?: string
  replyToken?: string
  message?: { id?: string; type?: string; text?: string; quotedMessageId?: string }
  source?: { type?: string; groupId?: string; roomId?: string; userId?: string }
}

export type Decision =
  | { kind: "text"; sessionKey: string; userId: string; text: string; replyToken?: string; isGroup: boolean; groupId?: string; quotedMessageId?: string }
  | { kind: "image"; sessionKey: string; userId: string; replyToken?: string; isGroup: boolean }
  | { kind: "join"; chatId: string; groupId?: string }
  | { kind: "leave"; chatId: string }
  | { kind: "ignore"; reason: string }

export interface ClassifyOptions {
  mention: MentionConfig
}

/**
 * ลำดับการตัดสินใจ ยกมาจาก v1:
 *   join / leave    จัดการก่อน ไม่ต้องมี session
 *   message.text    ในกลุ่มต้องถูกเรียกถึงก่อน (`isBotMentioned`) · 1:1 ตอบทุกข้อความ
 *   message.image   ตอบเฉพาะ 1:1 · ในกลุ่มเงียบ
 *   อื่น ๆ           ข้าม
 *
 * ⚠️ `text.trim()` ทำที่นี่ ตรงกับ feature 9.6 ของ v1
 */
export function classify(event: LineWebhookEvent, options: ClassifyOptions): Decision {
  const source = event.source ?? {}
  const isGroup = Boolean(source.groupId || source.roomId)
  const chatId = source.groupId || source.roomId

  if (event.type === "join") {
    if (!chatId) return { kind: "ignore", reason: "join ที่ไม่มี group/room" }
    return { kind: "join", chatId, ...(source.groupId ? { groupId: source.groupId } : {}) }
  }
  if (event.type === "leave") {
    if (!chatId) return { kind: "ignore", reason: "leave ที่ไม่มี group/room" }
    return { kind: "leave", chatId }
  }
  if (event.type !== "message") return { kind: "ignore", reason: `event ชนิด ${event.type}` }

  const sessionKey = getSessionKey(event)
  const userId = source.userId
  if (!sessionKey || !userId) return { kind: "ignore", reason: "ไม่มี sessionKey หรือ userId" }

  if (event.message?.type === "image") {
    return { kind: "image", sessionKey, userId, isGroup, ...(event.replyToken ? { replyToken: event.replyToken } : {}) }
  }
  if (event.message?.type !== "text") return { kind: "ignore", reason: `message ชนิด ${event.message?.type}` }

  const text = (event.message.text ?? "").trim()
  if (!text) return { kind: "ignore", reason: "ข้อความว่าง" }

  // ในกลุ่ม ตอบเฉพาะตอนถูกเรียกถึง — 1:1 ตอบทุกข้อความ
  if (isGroup && !isBotMentioned(event, options.mention)) {
    return { kind: "ignore", reason: "ในกลุ่มแต่ไม่ได้เรียกถึง bot" }
  }

  return {
    kind: "text", sessionKey, userId, text, isGroup,
    ...(event.replyToken ? { replyToken: event.replyToken } : {}),
    ...(source.groupId ? { groupId: source.groupId } : {}),
    ...(event.message.quotedMessageId ? { quotedMessageId: event.message.quotedMessageId } : {}),
  }
}
