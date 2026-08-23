/**
 * LINE channel — webhook server
 *
 * **channel ที่ 14 bot ใช้จริง** และเป็นชิ้นที่หายไปจาก V2 มาตลอด
 * (`channel-web` มี server เต็มตัวตั้งแต่แรก ส่วน LINE มีแค่ primitive ใน core)
 *
 * ไฟล์นี้ไม่ import adapter ตัวไหนเลย — ผู้เรียกส่ง `runtime` เข้ามา
 */
import { createServer, type Server, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { runTurn, type RuntimePort, type TurnDeps } from "@botforge/core/router"
import { SessionQueue } from "@botforge/core/session"
import { ProfileCache, type UserContextFormat } from "@botforge/core/context"
import { validateSignature, timingSafeValidateSignature, triggersFor } from "@botforge/core/channel"
import { toChannelId } from "@botforge/core/identity"
import type { BotforgeEvents, TurnContext } from "@botforge/core/events"
import { createLineApi, type LineApi } from "./api.ts"
import { LineTransport, lineProfileSource } from "./transport.ts"
import { classify, type LineWebhookEvent } from "./webhook.ts"
import { welcomeMessage, NO_VISION_MESSAGE } from "./messages.ts"

export interface LineChannelOptions {
  runtime: RuntimePort
  channelSecret: string
  /** ไม่ส่ง `api` มาก็ต้องมีอันนี้ */
  channelAccessToken?: string
  /** ฉีด LINE API เองได้ — ใช้ตอน test */
  api?: LineApi
  port?: number
  host?: string
  botName?: string
  lineOaUrl?: string
  /** คำที่ถือว่าเรียก bot ในกลุ่ม — ค่าเริ่มต้นมาจากชื่อ runtime */
  mentionTriggers?: string[]
  events?: BotforgeEvents
  runtimeName?: string
  userContextFormat?: UserContextFormat
  lengthTruncationNotice?: boolean
  /** เทียบ signature แบบ constant-time — v1 ใช้ `===` · ค่าเริ่มต้นคือของ v1 */
  timingSafeSignature?: boolean
  log?: (...args: unknown[]) => void
}

export interface LineChannel {
  server: Server
  url: string
  api: LineApi
  /** userId ของ bot จาก `getBotInfo()` — ใช้กับ LINE mention API (feature 9.8) */
  botUserId: string
  close(): Promise<void>
}

export async function createLineChannel(options: LineChannelOptions): Promise<LineChannel> {
  const log = options.log ?? (() => {})
  const api = options.api ?? (await createLineApi(requireToken(options)))

  // v1 ดึง botUserId ตอน startup เพื่อให้ mention detection ใช้ LINE mention API ได้
  let botUserId = ""
  try {
    botUserId = (await api.getBotInfo())?.userId ?? ""
    log("bot userId:", botUserId)
  } catch (err) {
    log("ดึง bot info ไม่ได้:", err instanceof Error ? err.message : err)
  }

  const transport = new LineTransport(api)
  const profiles = new ProfileCache(lineProfileSource(api), { warn: log })
  const verify = options.timingSafeSignature ? timingSafeValidateSignature : validateSignature
  const mention = {
    botUserId,
    triggers: options.mentionTriggers ?? triggersFor(options.runtimeName ?? "bot"),
  }

  const deps: TurnDeps = {
    runtime: options.runtime,
    transport,
    queue: new SessionQueue(),
    profiles,
    ...(options.events ? { events: options.events } : {}),
    ...(options.userContextFormat ? { userContextFormat: options.userContextFormat } : {}),
    ...(options.lengthTruncationNotice === false ? { lengthTruncationNotice: false } : {}),
    showLoading: (chatId) => {
      // fire-and-forget เหมือน v1 — ล้มก็ไม่กระทบการตอบ
      void api.showLoadingAnimation({ chatId, loadingSeconds: 60 }).catch(() => {})
    },
    log,
  }

  let turnSeq = 0

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost")

    if (req.method === "GET" && url.pathname === "/") {
      return text(res, 200, `${options.botName ?? "Botforge"} LINE Bot is running`)
    }
    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, 200, { ok: true, botUserId })
    }
    if (req.method !== "POST" || url.pathname !== "/webhook") {
      return text(res, 404, "Not Found")
    }

    let body = ""
    req.on("data", (c) => { body += c })
    req.on("end", () => {
      const signature = String(req.headers["x-line-signature"] ?? "")
      if (!verify(body, signature, options.channelSecret)) {
        log("signature ไม่ถูกต้อง")
        return text(res, 403, "Invalid signature")
      }
      let parsed: { events?: LineWebhookEvent[] }
      try {
        parsed = JSON.parse(body)
      } catch {
        return text(res, 400, "Invalid JSON")
      }
      // ตอบ 200 ทันทีเพื่อไม่ให้ LINE retry — งานจริงทำต่อเบื้องหลัง (พฤติกรรมของ v1)
      text(res, 200, "OK")
      for (const event of parsed.events ?? []) {
        void handle(event).catch((err) => log("จัดการ event ไม่สำเร็จ:", err))
      }
    })
  })

  async function handle(event: LineWebhookEvent): Promise<void> {
    const decision = classify(event, { mention })

    switch (decision.kind) {
      case "ignore":
        log("ข้าม:", decision.reason)
        return

      case "join": {
        if (!decision.groupId) return   // v1 ส่ง welcome เฉพาะ group ไม่ส่ง room
        const msg = welcomeMessage({
          botName: options.botName ?? "Botforge Bot",
          lineOaUrl: options.lineOaUrl ?? "",
        })
        await api.pushMessage({ to: decision.groupId, messages: [{ type: "text", text: msg }] })
          .catch((err) => log("ส่ง welcome ไม่สำเร็จ:", err?.message ?? err))
        await options.events?.channelJoined("line", toChannelId("line", decision.chatId))
        return
      }

      case "leave": {
        await resetRuntimeSession(decision.chatId)
        await options.events?.channelLeft("line", toChannelId("line", decision.chatId))
        return
      }

      case "image": {
        if (decision.isGroup) return    // ในกลุ่มเงียบ — v1 ทำแบบนี้
        if (decision.replyToken) {
          await transport.reply(decision.replyToken, NO_VISION_MESSAGE).catch(() => {})
        }
        return
      }

      case "text": {
        const ctx: TurnContext | undefined = options.events
          ? {
              executionId: `line-exec-${++turnSeq}`,
              channelId: toChannelId("line", decision.sessionKey),
              channelType: "line",
              actor: { type: "human", id: toChannelId("line", decision.userId) },
              ...(event.message?.id ? { messageId: event.message.id } : {}),
            }
          : undefined

        await runTurn(deps, {
          sessionKey: decision.sessionKey,
          userId: decision.userId,
          text: decision.text,
          isGroup: decision.isGroup,
          ...(decision.replyToken ? { replyToken: decision.replyToken } : {}),
          ...(decision.groupId ? { groupId: decision.groupId } : {}),
          ...(decision.quotedMessageId ? { quotedMessageId: decision.quotedMessageId } : {}),
          ...(ctx ? { ctx } : {}),
          ...(options.runtimeName ? { runtimeName: options.runtimeName } : {}),
        })
        return
      }
    }
  }

  /** adapter แต่ละตัวตั้งชื่อเมธอดต่างกัน — เรียกเท่าที่มี ไม่บังคับให้ทุกตัวต้องมี */
  async function resetRuntimeSession(sessionKey: string): Promise<void> {
    const r = options.runtime as { resetSession?: (k: string) => unknown }
    if (typeof r.resetSession === "function") {
      await Promise.resolve(r.resetSession(sessionKey)).catch(() => {})
    }
  }

  return new Promise((resolve) => {
    server.listen(options.port ?? 0, options.host ?? "0.0.0.0", () => {
      const addr = server.address() as AddressInfo
      resolve({
        server, api, botUserId,
        url: `http://${options.host ?? "0.0.0.0"}:${addr.port}`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      })
    })
  })
}

function requireToken(o: LineChannelOptions): string {
  if (!o.channelAccessToken) {
    throw new Error("ต้องมี channelAccessToken หรือส่ง api เข้ามาเอง")
  }
  return o.channelAccessToken
}

function text(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" })
  res.end(body)
}
function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" })
  res.end(JSON.stringify(body))
}
