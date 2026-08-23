/**
 * ส่งข้อความออก LINE — reply ก่อน (ฟรี) แล้ว fallback เป็น push พร้อม retry 429
 *
 * ยกมาจาก v1-final โดยไม่เปลี่ยนพฤติกรรม · เดิมอยู่ใน 23 ไฟล์
 * ทั้ง 9 engine ต่างกันแค่ comment และใช้ `console.log` กับ `log()` สลับกัน
 *
 * แยก transport ออกเป็น port เพราะ logic ส่วนที่มีค่า (แบ่ง chunk · reply-first ·
 * retry เฉพาะ 429 · backoff 5s/10s) ทดสอบได้โดยไม่ต้องมี LINE SDK หรือเน็ต
 */
import { chunkText } from "./line.ts"

/** สิ่งที่ core ต้องการจาก LINE SDK — ฝั่ง adapter เป็นคนต่อของจริง */
export interface LineTransport {
  reply(replyToken: string, text: string): Promise<void>
  push(to: string, text: string): Promise<void>
}

export interface SendOptions {
  /** จำนวนครั้งที่ push ได้ต่อ chunk — v1 ใช้ 3 */
  maxAttempts?: number
  /** หน่วง backoff ต่อครั้ง — v1 ใช้ (attempt + 1) * 5000 ms */
  backoffMs?: (attempt: number) => number
  /** inject ได้เพื่อให้ test ไม่ต้องรอจริง */
  sleep?: (ms: number) => Promise<void>
  log?: (...args: unknown[]) => void
  error?: (...args: unknown[]) => void
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function messageOf(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message?: unknown }).message
    if (typeof m === "string") return m
  }
  return String(err)
}

/**
 * ลำดับที่ต้องรักษาไว้จาก v1:
 *   1. แบ่ง chunk ก่อนเสมอ
 *   2. chunk แรก + มี replyToken → ลอง reply · สำเร็จแล้วข้ามไป chunk ถัดไป
 *   3. chunk ที่เหลือ หรือ reply พัง → push โดย retry **เฉพาะ 429** และเฉพาะเมื่อยังไม่ครบครั้ง
 *   4. error อื่น หรือครั้งสุดท้าย → log แล้วเลิก **ไม่ throw**
 *
 * ข้อ 4 คือพฤติกรรมของ v1 — ข้อความหายเงียบ ๆ ได้ · ยกมาตามจริง
 * ผู้เรียกที่อยากรู้ว่าสำเร็จไหมให้ดูค่าที่คืน
 */
export async function sendMessage(
  transport: LineTransport,
  to: string,
  text: string,
  replyToken?: string,
  options: SendOptions = {},
): Promise<{ chunks: number; delivered: number; failed: number }> {
  const maxAttempts = options.maxAttempts ?? 3
  const backoffMs = options.backoffMs ?? ((attempt: number) => (attempt + 1) * 5000)
  const sleep = options.sleep ?? defaultSleep
  const log = options.log ?? (() => {})
  const error = options.error ?? (() => {})

  const chunks = chunkText(text)
  let delivered = 0
  let failed = 0

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!

    if (i === 0 && replyToken) {
      try {
        await transport.reply(replyToken, chunk)
        delivered++
        continue
      } catch (err) {
        log("replyMessage failed, falling back to push:", messageOf(err))
      }
    }

    let sent = false
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        await transport.push(to, chunk)
        sent = true
        break
      } catch (err) {
        const msg = messageOf(err)
        if (msg.includes("429") && attempt < maxAttempts - 1) {
          const delay = backoffMs(attempt)
          log(`Rate limited, retrying in ${delay / 1000}s...`)
          await sleep(delay)
        } else {
          error("Failed to send LINE message:", msg)
          break
        }
      }
    }
    if (sent) delivered++
    else failed++
  }

  return { chunks: chunks.length, delivered, failed }
}
