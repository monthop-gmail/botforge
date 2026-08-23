/**
 * client ของ `codex app-server` — thread/turn API บน JSON-RPC 2.0
 *
 * โครง protocol ถอดมาจาก `bot-service-codex-appserver` ที่ v1-final ซึ่งพูดกับ
 * app-server ตัวจริงได้ · ต่างกันที่ transport: ของเดิมใช้ WebSocket
 * ส่วนตัวนี้ใช้ stdio ซึ่งเป็นทางที่ upstream รับประกัน
 */
import { JsonRpcClient, type LineTransport } from "./jsonrpc.ts"
import { StdioTransport, type StdioOptions } from "./stdio.ts"

/**
 * ⚠️ **ค่าเริ่มต้นเปิดกว้างมาก — ยกมาจาก v1 ตามจริง ไม่ได้ตั้งใหม่**
 *
 * `bot-service-codex-appserver` ส่ง `approvalPolicy: "never"` +
 * `sandboxPolicy: { type: "dangerFullAccess" }` และ auto-accept ทุกคำขออนุมัติ
 * แปลว่า **ใครก็ตามที่พิมพ์ในกลุ่ม LINE สั่งให้ agent อ่าน/เขียนไฟล์อะไรก็ได้ใน workspace**
 *
 * ยกมาเหมือนเดิมเพื่อไม่เปลี่ยนพฤติกรรมเงียบ ๆ แต่เปิดให้ตั้งค่าได้
 * และควรพิจารณาบีบให้แคบลงก่อนเอาไปใช้กับ bot ที่คนนอกเข้าถึงได้
 */
export const DEFAULT_APPROVAL_POLICY = "never"
export const DEFAULT_SANDBOX_POLICY = { type: "dangerFullAccess" } as const

export interface AppServerOptions extends StdioOptions {
  /** ใส่ transport เองได้ — ใช้ตอน test หรือถ้าจะลอง ws (ซึ่ง upstream ไม่ซัพพอร์ต) */
  transport?: LineTransport
  requestTimeoutMs?: number
  clientName?: string
  clientVersion?: string
  log?: (...args: unknown[]) => void
}

export class AppServerConnection {
  readonly rpc: JsonRpcClient
  readonly #log: (...args: unknown[]) => void
  #ready: Promise<void> | undefined
  #transport: LineTransport

  constructor(options: AppServerOptions = {}) {
    this.#log = options.log ?? (() => {})
    this.#transport = options.transport ?? new StdioTransport(options)
    this.rpc = new JsonRpcClient(this.#transport, {
      requestTimeoutMs: options.requestTimeoutMs,
      log: this.#log,
    })
    this.#name = options.clientName ?? "botforge-adapter-codex"
    this.#version = options.clientVersion ?? "0.0.1"
  }

  readonly #name: string
  readonly #version: string

  /** handshake ครั้งเดียวต่อ connection — เรียกซ้ำได้ จะได้ promise เดิม */
  ensureReady(): Promise<void> {
    this.#ready ??= this.#handshake()
    return this.#ready
  }

  async #handshake(): Promise<void> {
    await this.rpc.request("initialize", {
      clientInfo: { name: this.#name, title: "Botforge", version: this.#version },
      capabilities: { experimentalApi: true },
    })
    this.rpc.notify("initialized")
    this.#log("app-server พร้อมแล้ว")
  }

  get closed(): boolean {
    return this.rpc.closed
  }

  close(): void {
    this.rpc.close()
  }
}
