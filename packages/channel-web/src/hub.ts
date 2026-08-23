/**
 * ทะเบียน client ที่เปิด SSE ค้างไว้ แยกตามห้องสนทนา
 *
 * Web ไม่มี reply token แบบ LINE — ทุกข้อความออกทาง stream ที่ client เปิดค้าง
 * ห้องหนึ่งมีได้หลาย client (หลายแท็บ) และต้องได้รับเหมือนกันทุกตัว
 */
export interface SseClient {
  /** เขียนหนึ่ง event ลง stream · คืน false ถ้าเขียนไม่ได้แล้ว */
  write(event: string, data: unknown): boolean
  close(): void
}

export class ChannelHub {
  readonly #rooms = new Map<string, Set<SseClient>>()

  subscribe(conversationId: string, client: SseClient): () => void {
    let set = this.#rooms.get(conversationId)
    if (!set) this.#rooms.set(conversationId, (set = new Set()))
    set.add(client)
    return () => {
      set!.delete(client)
      // ห้องว่างแล้วเก็บกวาด — ไม่งั้น Map โตตามจำนวนห้องที่เคยมีคนเข้า
      if (set!.size === 0) this.#rooms.delete(conversationId)
    }
  }

  /** ส่งให้ทุก client ในห้อง · คืนจำนวนที่ส่งสำเร็จ · ตัวที่เขียนไม่ได้ถูกถอดออก */
  broadcast(conversationId: string, event: string, data: unknown): number {
    const set = this.#rooms.get(conversationId)
    if (!set) return 0
    let sent = 0
    for (const client of [...set]) {
      if (client.write(event, data)) sent++
      else set.delete(client)
    }
    if (set.size === 0) this.#rooms.delete(conversationId)
    return sent
  }

  clientCount(conversationId: string): number {
    return this.#rooms.get(conversationId)?.size ?? 0
  }

  get roomCount(): number {
    return this.#rooms.size
  }

  closeAll(): void {
    for (const set of this.#rooms.values()) for (const c of set) c.close()
    this.#rooms.clear()
  }
}
