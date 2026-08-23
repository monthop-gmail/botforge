/**
 * JSON-RPC 2.0 client แบบ line-delimited — ไม่ผูกกับ transport
 *
 * `codex app-server` พูด JSON-RPC 2.0 หนึ่ง message ต่อบรรทัด
 * แยก transport ออกมาเพราะ upstream มีสองทาง และคุณภาพต่างกันมาก:
 *
 *   stdio                      ✅ stable · production-ready
 *   --listen ws://…            ⚠️ upstream ระบุเองว่า "Experimental, unsupported"
 *
 * v1 (`bot-service-codex-appserver`) ใช้ ws · adapter นี้ใช้ stdio เป็นค่าเริ่มต้น
 */

/**
 * สิ่งที่ client ต้องการจากช่องทางสื่อสาร — หนึ่งบรรทัดคือหนึ่ง message
 *
 * ⚠️ "Line" ที่นี่คือ **บรรทัด** ไม่ใช่ LINE แชท — คนละเรื่องกับ
 *    `ChannelTransport` ของ core ที่เป็นทางออกของข้อความไปหาผู้ใช้
 */
export interface LineDelimitedTransport {
  send(line: string): void
  onLine(handler: (line: string) => void): void
  onClose(handler: (reason?: string) => void): void
  close(): void
}

export class RpcError extends Error {
  readonly code: number
  readonly data: unknown
  constructor(code: number, message: string, data?: unknown) {
    super(message)
    this.name = "RpcError"
    this.code = code
    this.data = data
  }
}

export class RpcClosedError extends Error {
  constructor(reason?: string) {
    super(reason ? `การเชื่อมต่อปิดลง: ${reason}` : "การเชื่อมต่อปิดลง")
    this.name = "RpcClosedError"
  }
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer?: ReturnType<typeof setTimeout> }

export interface RpcOptions {
  /** timeout ต่อ request — 0 = ไม่ตั้ง */
  requestTimeoutMs?: number
  log?: (...args: unknown[]) => void
}

export class JsonRpcClient {
  readonly #transport: LineDelimitedTransport
  readonly #pending = new Map<number, Pending>()
  readonly #handlers = new Map<string, Set<(params: any) => void>>()
  readonly #timeout: number
  readonly #log: (...args: unknown[]) => void
  #nextId = 0
  #closed = false

  constructor(transport: LineDelimitedTransport, options: RpcOptions = {}) {
    this.#transport = transport
    this.#timeout = options.requestTimeoutMs ?? 300_000
    this.#log = options.log ?? (() => {})
    transport.onLine((line) => this.#onLine(line))
    transport.onClose((reason) => this.#onClose(reason))
  }

  get closed(): boolean {
    return this.#closed
  }

  /** ฟัง notification ที่ server ส่งมาเอง · คืนฟังก์ชันสำหรับเลิกฟัง */
  on(method: string, handler: (params: any) => void): () => void {
    let set = this.#handlers.get(method)
    if (!set) this.#handlers.set(method, (set = new Set()))
    set.add(handler)
    return () => { set!.delete(handler) }
  }

  request(method: string, params: Record<string, unknown> = {}): Promise<any> {
    if (this.#closed) return Promise.reject(new RpcClosedError())
    const id = ++this.#nextId
    return new Promise((resolve, reject) => {
      const entry: Pending = { resolve, reject }
      if (this.#timeout > 0) {
        entry.timer = setTimeout(() => {
          if (this.#pending.delete(id)) reject(new Error(`request ${method} หมดเวลา`))
        }, this.#timeout)
      }
      this.#pending.set(id, entry)
      try {
        this.#transport.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }))
      } catch (err) {
        this.#settle(id, undefined, err instanceof Error ? err : new Error(String(err)))
      }
    })
  }

  notify(method: string, params: Record<string, unknown> = {}): void {
    if (this.#closed) return
    this.#transport.send(JSON.stringify({ jsonrpc: "2.0", method, params }))
  }

  close(): void {
    this.#transport.close()
    this.#onClose("ปิดโดยผู้เรียก")
  }

  #settle(id: number, result?: unknown, error?: Error): void {
    const entry = this.#pending.get(id)
    if (!entry) return
    this.#pending.delete(id)
    if (entry.timer) clearTimeout(entry.timer)
    if (error) entry.reject(error)
    else entry.resolve(result)
  }

  #onLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return
    let msg: any
    try {
      msg = JSON.parse(trimmed)
    } catch {
      // app-server เขียน log ปนมาทาง stdout ได้ — บรรทัดที่ไม่ใช่ JSON ไม่ใช่ error
      this.#log("ข้ามบรรทัดที่ไม่ใช่ JSON:", trimmed.slice(0, 120))
      return
    }

    if (msg.id !== undefined && this.#pending.has(msg.id)) {
      if (msg.error) {
        const e = msg.error
        this.#settle(msg.id, undefined, new RpcError(e.code ?? -1, e.message ?? JSON.stringify(e), e.data))
      } else {
        this.#settle(msg.id, msg.result)
      }
      return
    }

    if (typeof msg.method === "string") {
      const handlers = this.#handlers.get(msg.method)
      if (!handlers) return
      for (const h of [...handlers]) {
        // handler ตัวหนึ่งพังต้องไม่ทำให้ตัวอื่นไม่ได้รับ
        try { h(msg.params) } catch (err) { this.#log("notification handler พัง:", err) }
      }
    }
  }

  #onClose(reason?: string): void {
    if (this.#closed) return
    this.#closed = true
    for (const [id] of this.#pending) this.#settle(id, undefined, new RpcClosedError(reason))
    this.#handlers.clear()
  }
}
