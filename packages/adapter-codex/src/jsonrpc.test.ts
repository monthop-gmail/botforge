import { test } from "node:test"
import assert from "node:assert/strict"
import { JsonRpcClient, RpcError, RpcClosedError, type LineDelimitedTransport } from "./jsonrpc.ts"

function fake() {
  const sent: any[] = []
  let onLine: (l: string) => void = () => {}
  let onClose: (r?: string) => void = () => {}
  const t: LineDelimitedTransport = {
    send: (line) => sent.push(JSON.parse(line)),
    onLine: (h) => { onLine = h },
    onClose: (h) => { onClose = h },
    close: () => {},
  }
  return {
    transport: t, sent,
    reply: (id: number, result: unknown) => onLine(JSON.stringify({ jsonrpc: "2.0", id, result })),
    fail: (id: number, code: number, message: string) => onLine(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })),
    notify: (method: string, params: unknown) => onLine(JSON.stringify({ jsonrpc: "2.0", method, params })),
    raw: (line: string) => onLine(line),
    kill: (reason?: string) => onClose(reason),
  }
}

test("request ได้ผลกลับตาม id", async () => {
  const f = fake()
  const c = new JsonRpcClient(f.transport)
  const p = c.request("thread/start", { model: "o4-mini" })
  assert.deepEqual(f.sent[0], { jsonrpc: "2.0", id: 1, method: "thread/start", params: { model: "o4-mini" } })
  f.reply(1, { thread: { id: "t1" } })
  assert.deepEqual(await p, { thread: { id: "t1" } })
})

test("หลาย request พร้อมกันจับคู่ id ถูก ไม่สลับ", async () => {
  const f = fake()
  const c = new JsonRpcClient(f.transport)
  const a = c.request("a"), b = c.request("b")
  f.reply(2, "ผลของ b")          // ตอบสลับลำดับ
  f.reply(1, "ผลของ a")
  assert.equal(await a, "ผลของ a")
  assert.equal(await b, "ผลของ b")
})

test("error จาก server กลายเป็น RpcError พร้อม code", async () => {
  const f = fake()
  const c = new JsonRpcClient(f.transport)
  const p = c.request("nope")
  f.fail(1, -32601, "ไม่รู้จัก method")
  await assert.rejects(p, (e: any) => e instanceof RpcError && e.code === -32601)
})

test("notification เรียก handler ที่ subscribe ไว้", () => {
  const f = fake()
  const c = new JsonRpcClient(f.transport)
  const got: string[] = []
  const off = c.on("item/agentMessage/delta", (p) => got.push(p.text))
  f.notify("item/agentMessage/delta", { text: "ก" })
  f.notify("item/agentMessage/delta", { text: "ข" })
  off()
  f.notify("item/agentMessage/delta", { text: "ค" })
  assert.deepEqual(got, ["ก", "ข"], "หลัง off ต้องไม่ได้รับอีก")
})

test("handler ตัวหนึ่งพังไม่ทำให้ตัวอื่นไม่ได้รับ", () => {
  const f = fake()
  const c = new JsonRpcClient(f.transport)
  const got: string[] = []
  c.on("x", () => { throw new Error("พัง") })
  c.on("x", () => got.push("ได้รับ"))
  f.notify("x", {})
  assert.deepEqual(got, ["ได้รับ"])
})

test("บรรทัดที่ไม่ใช่ JSON ถูกข้าม ไม่ทำให้พัง — app-server เขียน log ปน stdout ได้", () => {
  const f = fake()
  const logs: string[] = []
  const c = new JsonRpcClient(f.transport, { log: (...a) => logs.push(a.map(String).join(" ")) })
  const got: unknown[] = []
  c.on("ping", (p) => got.push(p))
  assert.doesNotThrow(() => f.raw("app-server starting, not json"))
  assert.doesNotThrow(() => f.raw(""))
  f.notify("ping", { ok: true })
  assert.deepEqual(got, [{ ok: true }])
  assert.ok(logs.some((l) => l.includes("ไม่ใช่ JSON")))
})

test("transport ปิด → pending ทุกตัวถูก reject ไม่ค้าง", async () => {
  const f = fake()
  const c = new JsonRpcClient(f.transport)
  const a = c.request("a"), b = c.request("b")
  f.kill("app-server ตาย")
  await assert.rejects(a, RpcClosedError)
  await assert.rejects(b, RpcClosedError)
  assert.equal(c.closed, true)
  await assert.rejects(c.request("c"), RpcClosedError)
})

test("timeout ของ request แยกจาก timeout ของ turn", async () => {
  const f = fake()
  const c = new JsonRpcClient(f.transport, { requestTimeoutMs: 20 })
  await assert.rejects(c.request("ช้า"), /หมดเวลา/)
})

test("notify ไม่สร้าง id และไม่รอผล", () => {
  const f = fake()
  const c = new JsonRpcClient(f.transport)
  c.notify("initialized")
  assert.deepEqual(f.sent[0], { jsonrpc: "2.0", method: "initialized", params: {} })
  assert.equal("id" in f.sent[0], false, "notification ต้องไม่มี id")
})
