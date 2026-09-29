/**
 * ผิวของ adapter ที่กว้างกว่า `RuntimePort` — โดยที่ `RuntimePort` ไม่ต้องเปลี่ยน
 *
 * `RuntimePort` (router/turn.ts:23) มีเมธอดเดียวคือ `sendPrompt()` และ `runTurn()`
 * ต้องการแค่นั้นจริง ๆ · plan-a587bb31 Phase A ขอให้ "evolve RuntimePort without
 * breaking sendPrompt()" — จึงไม่ยัดเมธอดใหม่ลงไปในนั้น แต่ประกาศ `RuntimeAdapter`
 * ที่ **สืบทอด** มันแล้วเติมของที่เป็นทางเลือกไว้ที่นี่
 *
 * ผลที่ได้:
 *   · adapter เดิมทั้ง 4 ตัวยังเป็น RuntimePort ที่ถูกต้องโดยไม่ต้องแก้อะไร
 *   · core/channel ยังรับ RuntimePort ตัวเล็กเหมือนเดิม ไม่ต้องรู้เรื่อง capability
 *   · ใครอยากใช้ของที่กว้างขึ้น ขอ `RuntimeAdapter` แล้วอ่าน `describe()` ก่อนเรียก
 *
 * เลิก duck-type ได้ที่ไหน: `channel-line/src/server.ts:189` วันนี้ทำ
 * `as { resetSession?: (k: string) => unknown }` — ของนั้นยังทำงานได้ต่อไป
 * แต่ของใหม่ควรถาม `describe().capabilities.sessions` แทนการถามว่ามีเมธอดไหม
 */
import type { RuntimePort } from "../router/turn.ts"
import type { RuntimeDescriptor, RuntimeSessionInfo } from "./capabilities.ts"

export interface RuntimeAdapter extends RuntimePort {
  /** ประกาศชื่อ ตระกูล และความสามารถ — เทส conformance บังคับว่าประกาศแล้วต้องมีจริง */
  describe(): RuntimeDescriptor

  // ── capability: sessions ───────────────────────────────────────────
  /** ทิ้ง session ของคีย์นั้นแล้วเริ่มใหม่รอบหน้า (`/new` ของ LINE) */
  resetSession?(sessionKey: string): Promise<void> | void
  /** ดูว่าคีย์นั้นผูกกับ session ของ runtime ตัวไหนอยู่ — `null` ถ้ายังไม่ผูก */
  sessionInfo?(sessionKey: string): { sessionId: string; model?: string } | null

  // ── capability: abort ──────────────────────────────────────────────
  abort?(sessionKey: string): Promise<boolean> | boolean

  // ── capability: model ──────────────────────────────────────────────
  setModel?(sessionKey: string, model: string): Promise<string> | string
  modelOf?(sessionKey: string): string

  // ── capability: persistence ────────────────────────────────────────
  /**
   * คืนของที่พอให้กลับมาคุยต่อได้ — `null` ถ้าคีย์นั้นยังไม่มี session
   *
   * ต้องไม่มีข้อมูลของ channel อยู่ในนี้ (ดูคอมเมนต์ของ RuntimeSessionInfo)
   */
  exportSession?(sessionKey: string): RuntimeSessionInfo | null
  /**
   * รับของจากทะเบียนกลับเข้าไปใช้ต่อ — คืน `false` ถ้า runtime ไม่รับ
   *
   * ⚠️ คืน `true` **ต้องหมายความว่าใช้ต่อได้จริง** ไม่ใช่แค่จำค่าไว้ใน Map
   *    ถ้า runtime ปลายทางลบ session นั้นไปแล้ว ต้องคืน `false` — เทส
   *    conformance ฝั่ง live จะจับข้อนี้ ส่วนฝั่ง static จับได้แค่ว่ามีเมธอด
   */
  restoreSession?(info: RuntimeSessionInfo): Promise<boolean> | boolean
}
