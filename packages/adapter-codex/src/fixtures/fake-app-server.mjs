#!/usr/bin/env node
/**
 * app-server ปลอมสำหรับ test — พูด JSON-RPC 2.0 บน stdio เหมือนของจริง
 *
 * จงใจเขียน stdout เป็นก้อนที่ **ไม่ตรงขอบ message** เพื่อพิสูจน์ว่า
 * StdioTransport ต่อเศษบรรทัดถูก · ของจริงก็ไม่รับประกันว่า chunk จะตรงขอบ
 */
let buffer = ""
let turnSeq = 0

function writeChunked(text) {
  // แบ่งเป็นชิ้นละ 7 ตัวอักษร — JSON ขาดกลางแน่นอน
  for (let i = 0; i < text.length; i += 7) process.stdout.write(text.slice(i, i + 7))
}
const send = (obj) => writeChunked(JSON.stringify(obj) + "\n")
const result = (id, r) => send({ jsonrpc: "2.0", id, result: r })
const notify = (method, params) => send({ jsonrpc: "2.0", method, params })

process.stdout.write("app-server starting, not json\n")   // log ปนมาทาง stdout

process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => {
  buffer += chunk
  let i
  while ((i = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, i); buffer = buffer.slice(i + 1)
    if (!line.trim()) continue
    let msg
    try { msg = JSON.parse(line) } catch { continue }
    handle(msg)
  }
})

function handle(msg) {
  const { id, method, params } = msg
  switch (method) {
    case "initialize":
      return result(id, { serverInfo: { name: "fake-app-server", version: "0.0.0" } })
    case "initialized":
      return
    case "thread/start":
      return result(id, { thread: { id: `thr-${params.model}-${++turnSeq}` } })
    case "turn/start": {
      result(id, { accepted: true })
      const turnId = `turn-${turnSeq}`
      const text = params.input?.[0]?.text ?? ""
      setTimeout(() => notify("turn/started", { turn: { id: turnId } }), 1)
      if (text.includes("SLOW")) return                       // ไม่จบเลย → ทดสอบ timeout
      if (text.includes("APPROVAL")) {
        setTimeout(() => notify("item/commandExecution/requestApproval", {
          threadId: params.threadId, itemId: "item-1",
        }), 2)
      }
      setTimeout(() => {
        if (text.includes("NODELTA")) {
          notify("turn/completed", { turn: { id: turnId, status: "completed",
            items: [{ type: "agentMessage", content: [{ type: "output_text", text: "จาก items" }] }] } })
        } else if (text.includes("ERROR")) {
          notify("turn/completed", { turn: { id: turnId, status: "error",
            codexErrorInfo: { message: "429 rate limit exceeded" } } })
        } else {
          notify("item/agentMessage/delta", { text: "สวัสดี" })
          notify("item/agentMessage/delta", { text: "ครับ" })
          notify("turn/completed", { turn: { id: turnId, status: "completed" } })
        }
      }, 5)
      return
    }
    case "item/commandExecution/respondApproval":
      return notify("approval/observed", { decision: params.decision })
    case "turn/interrupt":
      return notify("turn/completed", { turn: { id: params.turnId, status: "aborted" } })
    default:
      if (id !== undefined) send({ jsonrpc: "2.0", id, error: { code: -32601, message: `ไม่รู้จัก method ${method}` } })
  }
}
