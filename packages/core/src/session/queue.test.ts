import { test } from "node:test"
import assert from "node:assert/strict"
import { SessionQueue } from "./queue.ts"

const tick = () => new Promise<void>((r) => setImmediate(r))
const defer = <T>() => {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

test("task ของ key เดียวกันรันทีละตัวตามลำดับ", async () => {
  const q = new SessionQueue()
  const order: string[] = []
  const d1 = defer<void>()

  const p1 = q.enqueue("group-A", async () => { order.push("1-start"); await d1.promise; order.push("1-end") })
  const p2 = q.enqueue("group-A", async () => { order.push("2-start"); order.push("2-end") })

  await tick()
  assert.deepEqual(order, ["1-start"], "ตัวที่ 2 ต้องยังไม่เริ่ม")
  d1.resolve()
  await Promise.all([p1, p2])
  assert.deepEqual(order, ["1-start", "1-end", "2-start", "2-end"])
})

test("key ต่างกันรันขนานกันได้", async () => {
  const q = new SessionQueue()
  const order: string[] = []
  const dA = defer<void>()

  const pA = q.enqueue("A", async () => { order.push("A-start"); await dA.promise; order.push("A-end") })
  const pB = q.enqueue("B", async () => { order.push("B-start"); order.push("B-end") })

  await pB
  assert.deepEqual(order, ["A-start", "B-start", "B-end"], "B ต้องไม่รอ A")
  dA.resolve()
  await pA
})

test("task ที่ล้มไม่บล็อกตัวถัดไป — พฤติกรรมของ prev.then(fn, fn) ใน v1", async () => {
  const q = new SessionQueue()
  const order: string[] = []

  const p1 = q.enqueue("A", async () => { order.push("1"); throw new Error("พัง") })
  const p2 = q.enqueue("A", async () => { order.push("2"); return "ok" })

  await assert.rejects(p1, /พัง/)
  assert.equal(await p2, "ok")
  assert.deepEqual(order, ["1", "2"])
})

test("ผู้เรียกได้ผลของ task ตัวเอง ไม่ใช่ของทั้งคิว", async () => {
  const q = new SessionQueue()
  const p1 = q.enqueue("A", async () => 111)
  const p2 = q.enqueue("A", async () => 222)
  assert.equal(await p1, 111)
  assert.equal(await p2, 222)
})

test("คิวว่างแล้วลบ key ทิ้ง — v1 เก็บไว้ตลอดอายุ process", async () => {
  const q = new SessionQueue()
  assert.equal(q.size, 0)
  await q.enqueue("A", async () => "x")
  await tick()
  assert.equal(q.size, 0, "คิวว่างแล้วต้องไม่เหลือ key")

  // ล้มก็ต้องถูกลบเหมือนกัน
  await assert.rejects(q.enqueue("B", async () => { throw new Error("พัง") }))
  await tick()
  assert.equal(q.size, 0)
})

test("การลบ key ไม่ไปตัดคิวที่ต่อเข้ามาทีหลัง", async () => {
  const q = new SessionQueue()
  const order: number[] = []
  const d = defer<void>()

  const p1 = q.enqueue("A", async () => { await d.promise; order.push(1) })
  const p2 = q.enqueue("A", async () => { order.push(2) })
  assert.equal(q.has("A"), true)
  d.resolve()
  await Promise.all([p1, p2])
  assert.deepEqual(order, [1, 2], "ลำดับต้องไม่เพี้ยนเพราะการเก็บกวาด")
})

test("งานหนัก 50 ตัวใน key เดียวยังเรียงถูก", async () => {
  const q = new SessionQueue()
  const order: number[] = []
  const jobs = Array.from({ length: 50 }, (_, i) =>
    q.enqueue("A", async () => { await tick(); order.push(i) }),
  )
  await Promise.all(jobs)
  assert.deepEqual(order, Array.from({ length: 50 }, (_, i) => i))
})
