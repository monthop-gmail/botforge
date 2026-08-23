/**
 * Web channel — HTTP + SSE
 *
 * เป็น channel ที่สองของ V2 · มีอยู่เพื่อพิสูจน์ครึ่งหลังของ Definition of Done:
 *
 *   > เปลี่ยน LINE → Web โดยไม่แก้ Runtime
 *
 * ไฟล์นี้ไม่ import adapter ตัวไหนเลย · ผู้เรียกส่ง `runtime` เข้ามา
 * adapter ตัวเดียวกับที่ LINE ใช้เสียบตรงนี้ได้โดยไม่แก้อะไร
 *
 * เส้นทาง
 *   GET  /                  หน้าเว็บเล็ก ๆ ไว้พิมพ์คุย
 *   GET  /events?c=<id>     SSE — ข้อความจาก bot
 *   POST /message           `{ conversationId, text }`
 *   GET  /health
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { runTurn, type RuntimePort, type TurnDeps } from "@botforge/core/router"
import { SessionQueue } from "@botforge/core/session"
import { ProfileCache, type LineProfileSource } from "@botforge/core/context"
import { toChannelId } from "@botforge/core/identity"
import type { BotforgeEvents, TurnContext } from "@botforge/core/events"
import { ChannelHub } from "./hub.ts"
import { WebTransport } from "./transport.ts"
import { PAGE } from "./page.ts"

export interface WebChannelOptions {
  runtime: RuntimePort
  port?: number
  host?: string
  /** ชื่อที่โชว์ให้ผู้ใช้เห็น */
  displayName?: string
  events?: BotforgeEvents
  /** ต้องส่ง header `x-botforge-token` ให้ตรง — ไม่ตั้ง = เปิดให้ทุกคน */
  token?: string
  runtimeName?: string
  log?: (...args: unknown[]) => void
}

export interface WebChannel {
  server: Server
  hub: ChannelHub
  transport: WebTransport
  url: string
  close(): Promise<void>
}

/**
 * Web ไม่มี profile API — ผู้ใช้คือใครก็ได้ที่เปิดหน้าเว็บ
 * คืนชื่อคงที่เพื่อให้ `ProfileCache` ของ core ทำงานได้โดยไม่ต้องมี special case
 */
const anonymousProfiles: LineProfileSource = {
  async getProfile() { return { displayName: "ผู้ใช้เว็บ" } },
  async getGroupMemberProfile() { return { displayName: "ผู้ใช้เว็บ" } },
  async getGroupSummary() { return { groupName: "web" } },
}

export function createWebChannel(options: WebChannelOptions): Promise<WebChannel> {
  const log = options.log ?? (() => {})
  const hub = new ChannelHub()
  const transport = new WebTransport(hub)
  const deps: TurnDeps = {
    runtime: options.runtime,
    transport,
    queue: new SessionQueue(),
    profiles: new ProfileCache(anonymousProfiles),
    ...(options.events ? { events: options.events } : {}),
    // Web ไม่มีลิมิตความยาวแบบ LINE — ไม่ต้องหั่นที่ 5000
    log,
  }
  let turnSeq = 0

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost")

    if (options.token && url.pathname !== "/" && req.headers["x-botforge-token"] !== options.token) {
      return json(res, 401, { error: "token ไม่ถูกต้อง" })
    }

    if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true })

    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
      return res.end(PAGE(options.displayName ?? "Botforge Web"))
    }

    if (req.method === "GET" && url.pathname === "/events") {
      const conversationId = url.searchParams.get("c")
      if (!conversationId) return json(res, 400, { error: "ต้องมี ?c=<conversationId>" })
      return openStream(req, res, conversationId)
    }

    if (req.method === "POST" && url.pathname === "/message") {
      let body = ""
      req.on("data", (c) => { body += c })
      req.on("end", () => {
        void handleMessage(body, res)
      })
      return
    }

    json(res, 404, { error: "ไม่พบเส้นทางนี้" })
  })

  function openStream(req: IncomingMessage, res: ServerResponse, conversationId: string): void {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    })
    const client = {
      write(event: string, data: unknown): boolean {
        if (res.writableEnded) return false
        return res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      },
      close(): void { if (!res.writableEnded) res.end() },
    }
    const unsubscribe = hub.subscribe(conversationId, client)
    client.write("ready", { conversationId })
    // ข้อความที่ตอบไปตอนยังไม่มีใครฟัง — ส่งตามให้
    for (const text of transport.drain(conversationId)) {
      client.write("message", { role: "assistant", text })
    }
    req.on("close", unsubscribe)
  }

  async function handleMessage(raw: string, res: ServerResponse): Promise<void> {
    let payload: { conversationId?: string; text?: string }
    try {
      payload = JSON.parse(raw || "{}")
    } catch {
      return json(res, 400, { error: "JSON ไม่ถูกต้อง" })
    }
    const { conversationId, text } = payload
    if (!conversationId || !text) return json(res, 400, { error: "ต้องมี conversationId และ text" })

    let sessionKey: string
    try {
      sessionKey = toChannelId("web", conversationId)
    } catch {
      return json(res, 400, { error: "conversationId ใช้เป็น id ไม่ได้" })
    }

    // ตอบ HTTP ทันที — คำตอบของ bot ไปทาง SSE ไม่ใช่ response ของ POST นี้
    json(res, 202, { accepted: true, sessionKey })
    hub.broadcast(conversationId, "message", { role: "user", text })

    const ctx: TurnContext | undefined = options.events
      ? {
          executionId: `web-exec-${++turnSeq}`,
          channelId: sessionKey,
          channelType: "web",
        }
      : undefined

    try {
      const outcome = await runTurn(deps, {
        sessionKey: conversationId,   // transport ใช้ค่านี้เป็นห้อง SSE
        userId: conversationId,
        text,
        isGroup: false,
        ...(ctx ? { ctx } : {}),
        ...(options.runtimeName ? { runtimeName: options.runtimeName } : {}),
      })
      hub.broadcast(conversationId, "done", { kind: outcome.kind })
    } catch (err) {
      log("เทิร์นล้ม:", err)
      hub.broadcast(conversationId, "done", { kind: "failed" })
    }
  }

  return new Promise((resolve) => {
    server.listen(options.port ?? 0, options.host ?? "127.0.0.1", () => {
      const addr = server.address() as AddressInfo
      resolve({
        server, hub, transport,
        url: `http://${options.host ?? "127.0.0.1"}:${addr.port}`,
        close: () => new Promise<void>((done) => {
          hub.closeAll()
          server.close(() => done())
        }),
      })
    })
  })
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" })
  res.end(JSON.stringify(body))
}
