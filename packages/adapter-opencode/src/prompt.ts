/**
 * ประกอบ prompt prefix แบบ OpenCode
 *
 * ยกมาจากส่วนหัวของ `sendPrompt()` ใน v1-final ทุกตัวอักษร
 * การประกอบ prompt เป็นเรื่องของ runtime แต่ละตัว core จึงส่งแค่วัตถุดิบมาให้
 * (`userContext` · `quotedMessageId` · `isGroup`) แล้ว adapter ตัดสินว่าวางตรงไหน
 */
import { getTimeContext } from "@botforge/core/context"

export const QUESTION_TOOL_GUARD =
  "[IMPORTANT: Always respond directly with text. Do NOT use the question tool to ask clarifying questions. If unsure, make your best guess and explain your assumptions.]"

export const GROUP_CHAT_INSTRUCTION =
  "[GROUP CHAT: You are in a group chat. If this message is clearly NOT directed at you (just people chatting with each other, unrelated conversations), respond with exactly [SKIP] and nothing else. If the message mentions you, asks a question, or could be directed at you, respond normally.]"

export interface PrefixInput {
  userContext?: string
  quotedMessageId?: string
  isGroup: boolean
  now?: Date
}

/** ลำดับ: guard → user → reply → time → group · แต่ละบล็อกคั่นด้วย `\n\n` */
export function buildPrefix(input: PrefixInput): string {
  let prefixed = `${QUESTION_TOOL_GUARD}\n\n`
  if (input.userContext) prefixed += `${input.userContext}\n\n`
  if (input.quotedMessageId) {
    prefixed += `[This is a reply to a previous message (quoted message ID: ${input.quotedMessageId})]\n\n`
  }
  prefixed += `${getTimeContext(input.now)}\n\n`
  if (input.isGroup) prefixed += `${GROUP_CHAT_INSTRUCTION}\n\n`
  return prefixed
}
