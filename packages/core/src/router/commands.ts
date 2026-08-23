/**
 * แยกคำสั่งออกจากข้อความธรรมดา
 *
 * ยกมาจากส่วนหัวของ `handleTextMessage()` ใน v1-final ซึ่งเป็นโซ่ `if` ยาว ๆ
 * ที่เทียบ `text.toLowerCase()` ทีละคำสั่ง
 *
 * v1 เทียบ `text.toLowerCase() === "/new"` แบบตรงตัว แปลว่า `"/new "` ที่มี
 * ช่องว่างต่อท้ายจะ**ไม่ถูกจับเป็นคำสั่ง** — ยกมาตามนั้น เพราะ trim ให้เงียบ ๆ
 * จะเปลี่ยนพฤติกรรมของ bot ที่ใช้งานอยู่
 * (ผู้เรียกทำ `text.trim()` มาก่อนแล้วตาม feature 9.6 ซึ่งตัดแค่หัวท้ายของทั้งข้อความ)
 */
export type CommandName =
  | "new" | "abort" | "sessions" | "model" | "about" | "help" | "cost"

/** alias → ชื่อคำสั่ง · ยกมาจาก v1 ทั้งหมด */
export const COMMAND_ALIASES: Readonly<Record<string, CommandName>> = {
  "/new": "new",
  "/abort": "abort",
  "/sessions": "sessions",
  "/about": "about",
  "/who": "about",
  "/help": "help",
  "/คำสั่ง": "help",
  "/cost": "cost",
}

export interface ParsedCommand {
  name: CommandName
  /** argument ที่ตามหลัง — ปัจจุบันมีแค่ `/model` ที่ใช้ · lowercase + trim แล้ว */
  arg: string
}

/**
 * คืน null ถ้าไม่ใช่คำสั่ง — ให้ผู้เรียกส่งต่อเป็น prompt ตามปกติ
 *
 * `/model` ต่างจากตัวอื่นตรงที่ใช้ `startsWith` เพราะรับ argument
 * ส่วนที่เหลือเทียบเท่ากันทั้งสตริงเหมือน v1
 */
export function parseCommand(text: string): ParsedCommand | null {
  const lower = text.toLowerCase()

  const direct = COMMAND_ALIASES[lower]
  if (direct) return { name: direct, arg: "" }

  if (lower.startsWith("/model")) {
    return { name: "model", arg: text.slice(6).trim().toLowerCase() }
  }

  return null
}

/** ข้อความที่ bot ตอบกลับ — ยกมาจาก v1 ทุกตัวอักษร */
export const REPLIES = {
  newSession: "เริ่ม session ใหม่แล้วครับ ส่งข้อความมาได้เลย!",
  aborted: "ยกเลิกคำสั่งแล้วครับ",
  /** v1 มีสองแบบ — `opencode`/`adkcode`/`gocode` ใช้อันแรก · ที่เหลือใช้อันที่สอง */
  noSessionToAbort: "ไม่มี session ที่ใช้งานอยู่ครับ",
  noPromptRunning: "ไม่มี prompt ที่กำลังทำอยู่ครับ",
  noSession: "ยังไม่มี session ครับ ส่งข้อความมาเพื่อเริ่มใช้งาน!",
  noSessionForCost: "ยังไม่มี session ครับ",
  unknownModel: (arg: string) => `ไม่รู้จัก model "${arg}"\n\nพิมพ์ /model ดูรายการทั้งหมด`,
} as const
