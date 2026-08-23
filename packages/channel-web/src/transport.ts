/**
 * ChannelTransport ของ Web — ทุกอย่างออกทาง SSE
 *
 * ⚠️ ไม่มีแนวคิด reply token · `reply()` จึงทำงานเหมือน `push()`
 *    ซึ่งเป็นเหตุผลที่ `ChannelTransport` ต้องยอมให้ `reply` ทำแบบนี้ได้
 *    (`sendMessage()` ของ core ลอง reply ก่อนแล้ว fallback เป็น push อยู่แล้ว)
 *
 * `to` คือ conversationId — ตรงกับ `sessionKey` ที่ core ใช้
 */
import type { ChannelTransport } from "@botforge/core/channel"
import type { ChannelHub } from "./hub.ts"

export class WebTransport implements ChannelTransport {
  readonly #hub: ChannelHub
  /** ข้อความที่ส่งตอนไม่มีใครฟัง — เก็บไว้ให้ client ที่ต่อทีหลัง */
  readonly #backlog = new Map<string, string[]>()
  readonly #backlogLimit: number

  constructor(hub: ChannelHub, options: { backlogLimit?: number } = {}) {
    this.#hub = hub
    this.#backlogLimit = options.backlogLimit ?? 50
  }

  async reply(conversationId: string, text: string): Promise<void> {
    await this.push(conversationId, text)
  }

  async push(conversationId: string, text: string): Promise<void> {
    const sent = this.#hub.broadcast(conversationId, "message", { role: "assistant", text })
    if (sent === 0) this.#remember(conversationId, text)
  }

  #remember(conversationId: string, text: string): void {
    const list = this.#backlog.get(conversationId) ?? []
    list.push(text)
    while (list.length > this.#backlogLimit) list.shift()
    this.#backlog.set(conversationId, list)
  }

  /** ข้อความที่ค้างอยู่ · อ่านแล้วล้าง — ใช้ตอน client เพิ่งต่อเข้ามา */
  drain(conversationId: string): string[] {
    const list = this.#backlog.get(conversationId) ?? []
    this.#backlog.delete(conversationId)
    return list
  }
}
