/**
 * HTTP client ของ adkcode — FastAPI + Google ADK
 *
 * ยกมาจาก `adkcodeRequest()` ของ v1-final · logic เดียวกับ transport ของ engine อื่น
 * ต่างแค่ base URL กับ prefix ของ error string (ดู current-state.md §4)
 */
export interface AdkcodeConfig {
  url: string
  /** `API_PASSWORD` ฝั่ง server → `Authorization` */
  auth?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

/** server ตอบ 409 เมื่อ session กำลังทำงานอยู่ — เป็นสถานะ ไม่ใช่ความผิดพลาดถาวร */
export class SessionBusyError extends Error {
  constructor(sessionId: string) {
    super(`session ${sessionId} กำลังทำงานอยู่ (409 conflict)`)
    this.name = "SessionBusyError"
  }
}

export class AdkcodeClient {
  readonly #url: string
  readonly #auth: string | undefined
  readonly #timeout: number
  readonly #fetch: typeof fetch

  constructor(config: AdkcodeConfig) {
    this.#url = config.url.replace(/\/$/, "")
    this.#auth = config.auth
    this.#timeout = config.timeoutMs ?? 300_000
    this.#fetch = config.fetchImpl ?? fetch
  }

  async request(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<any> {
    const headers: Record<string, string> = {}
    if (this.#auth) headers["Authorization"] = this.#auth
    if (body !== undefined) headers["Content-Type"] = "application/json"

    const resp = await this.#fetch(`${this.#url}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: signal ?? AbortSignal.timeout(this.#timeout),
    })

    const text = await resp.text()
    if (resp.status === 409) throw new SessionBusyError(path)
    if (!resp.ok) throw new Error(`ADKcode API ${resp.status}: ${text.slice(0, 300)}`)
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }

  /** ADK ผูก session กับ user — ต่างจาก engine อื่นที่ createSession ไม่ต้องรู้จักผู้ใช้ */
  createSession(userId?: string): Promise<{ id: string }> {
    return this.request("POST", "/session", { user_id: userId })
  }

  sessionInfo(sessionId: string): Promise<{ status?: string } | null> {
    return this.request("GET", `/session/${sessionId}`).catch(() => null)
  }

  deleteSession(sessionId: string): Promise<unknown> {
    return this.request("DELETE", `/session/${sessionId}`)
  }

  async abortSession(sessionId: string): Promise<void> {
    await this.request("POST", `/session/${sessionId}/abort`).catch(() => {})
  }

  async waitUntilReady(maxRetries = 30, delayMs = 2000, log: (m: string) => void = () => {}): Promise<boolean> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        const headers: Record<string, string> = {}
        if (this.#auth) headers["Authorization"] = this.#auth
        const resp = await this.#fetch(`${this.#url}/health`, { headers, signal: AbortSignal.timeout(3000) })
        if (resp.ok) { log("adkcode พร้อมแล้ว"); return true }
      } catch { /* ยังไม่พร้อม */ }
      log(`รอ adkcode... (${i + 1}/${maxRetries})`)
      await new Promise((r) => setTimeout(r, delayMs))
    }
    return false
  }
}
