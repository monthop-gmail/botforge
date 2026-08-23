/**
 * ประกอบ prompt prefix แบบ adkcode
 *
 * ยกมาจาก `sendPrompt()` ของ `bot-service-adkcode` ที่ v1-final ทุกตัวอักษร
 *
 * ⚠️ **ไม่มี GROUP CHAT instruction** — ต่างจาก opencode · codex · claude-code
 *    แต่ฝั่ง bot ของ adkcode **ยังเช็ค `[SKIP]`** อยู่
 *    แปลว่า v1 ตรวจหาคำตอบที่ไม่เคยบอก model ให้ตอบ — เส้นทางนั้นยิงได้แค่โดยบังเอิญ
 *    (ตรงกับ feature-matrix ข้อ 4.7 ที่ adkcode เป็น ❌ ตัวเดียว)
 *
 *    ยกมาเหมือนเดิมเพื่อไม่เปลี่ยนพฤติกรรมเงียบ ๆ · เปิดผ่าน `groupChatInstruction` ได้
 *
 * question guard ก็ต่างจาก opencode — ของ adkcode ห้าม "ถามกลับ" เฉย ๆ
 * ส่วนของ opencode ระบุเจาะจงว่าห้ามใช้ question **tool**
 */
import { getTimeContext } from "@botforge/core/context"

export const QUESTION_GUARD =
  "[IMPORTANT: Always respond directly with text. Do NOT ask clarifying questions. If unsure, make your best guess and explain your assumptions.]"

export const GROUP_CHAT_INSTRUCTION =
  "[GROUP CHAT: You are in a group chat. If this message is clearly NOT directed at you (just people chatting with each other, unrelated conversations), respond with exactly [SKIP] and nothing else. If the message mentions you, asks a question, or could be directed at you, respond normally.]"

export interface PrefixInput {
  userContext?: string
  groupName?: string
  quotedMessageId?: string
  isGroup: boolean
  /** เปิดเพื่อให้ `[SKIP]` ทำงานจริง — v1 ปิดอยู่ (ค่าเริ่มต้นคือของ v1) */
  groupChatInstruction?: boolean
  now?: Date
}

export function buildPrefix(input: PrefixInput): string {
  let out = `${QUESTION_GUARD}\n\n`
  if (input.userContext) out += `${input.userContext} `
  if (input.groupName) out += `[Group: ${input.groupName}] `
  out += `${getTimeContext(input.now)}\n\n`
  if (input.quotedMessageId) out += `[Reply to message ID: ${input.quotedMessageId}]\n\n`
  if (input.isGroup && input.groupChatInstruction) out += `${GROUP_CHAT_INSTRUCTION}\n\n`
  return out
}
