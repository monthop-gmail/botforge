/**
 * ประกอบ prompt prefix แบบ Codex
 *
 * ยกมาจาก `sendPrompt()` ของ `bot-service-codex` ที่ v1-final ทุกตัวอักษร
 *
 * ⚠️ **ต่างจาก opencode จริง ๆ** ไม่ใช่แค่จัดบรรทัดต่างกัน:
 *   · ไม่มี question-tool guard (เป็นของ opencode ตัวเดียว)
 *   · ใส่ `[Group: ชื่อ]` เข้า prompt — opencode ไม่ใส่ (ไม่มี getGroupName ด้วยซ้ำ)
 *   · reply ใช้ `[Reply to message ID: x]` ส่วน opencode ใช้ประโยคยาวกว่า
 *   · user/group/time อยู่บรรทัดเดียวกันคั่นด้วยช่องว่าง ไม่ใช่ย่อหน้าละบล็อก
 *
 * นี่คือเหตุผลที่ core ส่งแค่วัตถุดิบมาให้ แล้วให้ adapter ประกอบเอง
 */
import { getTimeContext } from "@botforge/core/context"

export const GROUP_CHAT_INSTRUCTION =
  "[GROUP CHAT: You are in a group chat. If this message is clearly NOT directed at you (just people chatting with each other, unrelated conversations), respond with exactly [SKIP] and nothing else. If the message mentions you, asks a question, or could be directed at you, respond normally.]"

export interface PrefixInput {
  userContext?: string
  groupName?: string
  quotedMessageId?: string
  isGroup: boolean
  now?: Date
}

/** ลำดับ: `{user} [Group: x] {time}\n\n[Reply…]\n\n[GROUP CHAT…]\n\n` */
export function buildPrefix(input: PrefixInput): string {
  let out = ""
  if (input.userContext) out += `${input.userContext} `
  if (input.groupName) out += `[Group: ${input.groupName}] `
  out += `${getTimeContext(input.now)}\n\n`
  if (input.quotedMessageId) out += `[Reply to message ID: ${input.quotedMessageId}]\n\n`
  if (input.isGroup) out += `${GROUP_CHAT_INSTRUCTION}\n\n`
  return out
}
