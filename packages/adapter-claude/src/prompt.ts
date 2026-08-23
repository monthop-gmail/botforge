/**
 * ประกอบ prompt prefix แบบ claude-code
 *
 * ยกมาจาก `sendPrompt()` ของ `bot-service-claude-code` ที่ v1-final ทุกตัวอักษร
 *
 * เหมือน codex ทุกอย่าง **ยกเว้นบล็อก `[Group Memory]`** ซึ่งเป็นของ
 * `claude-code` กับ `copilot-cli` เท่านั้น (feature 4.4)
 *
 * ⚠️ `[Group Memory]` inject **เฉพาะตอนเปิด session ใหม่** ไม่ใช่ทุกข้อความ
 *    v1 เขียนเป็น `if (!session && options?.groupMemory)` — คือ feature 4.5
 *    ที่ audit รอบแรกของเราสรุปผิดว่าไม่มีใครทำ (ดู feature-matrix.md §4)
 */
import { getTimeContext } from "@botforge/core/context"

export const GROUP_CHAT_INSTRUCTION =
  "[GROUP CHAT: You are in a group chat. If this message is clearly NOT directed at you (just people chatting with each other, unrelated conversations), respond with exactly [SKIP] and nothing else. If the message mentions you, asks a question, or could be directed at you, respond normally.]"

export interface PrefixInput {
  userContext?: string
  groupName?: string
  quotedMessageId?: string
  groupMemory?: string
  /** มี session อยู่แล้วหรือยัง — ตัวตัดสินว่าจะ inject group memory ไหม */
  hasSession: boolean
  isGroup: boolean
  now?: Date
}

export function buildPrefix(input: PrefixInput): string {
  let out = ""
  if (input.userContext) out += `${input.userContext} `
  if (input.groupName) out += `[Group: ${input.groupName}] `
  out += `${getTimeContext(input.now)}\n\n`
  if (input.quotedMessageId) out += `[Reply to message ID: ${input.quotedMessageId}]\n\n`
  // เฉพาะ session ใหม่ — session เดิม model จำบริบทได้เองอยู่แล้ว
  if (!input.hasSession && input.groupMemory) {
    out += `[Group Memory]\n${input.groupMemory}\n[/Group Memory]\n\n`
  }
  if (input.isGroup) out += `${GROUP_CHAT_INSTRUCTION}\n\n`
  return out
}
