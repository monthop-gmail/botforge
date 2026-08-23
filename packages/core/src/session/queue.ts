/**
 * คิวต่อ session — กันไม่ให้ prompt ของคนหลายคนในกลุ่มเดียวกันชนกัน
 *
 * ยกมาจาก `enqueueForSession()` ของ v1-final ซึ่งมีใน **6 จาก 9 engine**
 * ที่ไม่มีคือ `opencode` `adkcode` `gocode` — และ `opencode` คือ engine ของ
 * **9 ใน 14 bot ที่รันจริง** (ดู feature-matrix.md ข้อ 2.11)
 *
 * พอย้ายมาอยู่ core มันจึงกลายเป็นค่าเริ่มต้นของทุก engine ไม่ใช่ของบางตัว
 */

/**
 * ต่อ task เข้าท้ายคิวของ key นั้น
 *
 * พฤติกรรมที่ยกมาจาก v1 ทั้งหมด:
 *   · task ของ key เดียวกันรันทีละตัวตามลำดับที่เรียก
 *   · task ที่ล้มไม่บล็อกตัวถัดไป (v1 ใช้ `prev.then(fn, fn)` — รัน fn ทั้งสองทาง)
 *   · ผู้เรียกได้ผลของ task ตัวเอง ไม่ใช่ของทั้งคิว
 *   · key ต่างกันรันขนานกันได้
 *
 * เพิ่มจาก v1: ลบ key ออกเมื่อคิวว่าง — v1 เก็บ Map ไว้ตลอดอายุ process
 * ทุก group/user ที่เคยคุยจะค้างใน memory ไม่มีวันถูกเก็บกวาด
 */
export class SessionQueue {
  readonly #tails = new Map<string, Promise<void>>()

  enqueue<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.#tails.get(key) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    const settled = next.then(
      () => {},
      () => {},
    )
    this.#tails.set(key, settled)
    void settled.then(() => {
      // ลบเฉพาะตอนที่ยังเป็นตัวท้ายคิวจริง ๆ ไม่งั้นจะไปตัดคิวที่ต่อเข้ามาทีหลัง
      if (this.#tails.get(key) === settled) this.#tails.delete(key)
    })
    return next
  }

  /** จำนวน key ที่ยังมีงานค้าง — ใช้ดูว่ามี leak ไหม */
  get size(): number {
    return this.#tails.size
  }

  /** มีงานค้างของ key นี้อยู่ไหม */
  has(key: string): boolean {
    return this.#tails.has(key)
  }
}
