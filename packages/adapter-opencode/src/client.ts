/**
 * HTTP client ของ OpenCode serve
 *
 * ยกมาจาก `opencodeRequest()` ของ v1-final — ตรวจแล้วว่า logic เหมือนกันทั้ง 9 engine
 * ต่างแค่ base URL, prefix ของ error string, timeout literal และ header
 * `x-opencode-directory` ที่มีเฉพาะตัวนี้ (ดู current-state.md §4)
 */
export interface OpenCodeConfig {
  url: string
  /** `OPENCODE_PASSWORD` → Authorization header */
  password?: string
  /** working directory ที่ฝั่ง server — `OPENCODE_DIR` */
  directory?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export class OpenCodeClient {
  readonly #url: string
  readonly #auth: string | undefined
  readonly #dir: string
  readonly #timeout: number
  readonly #fetch: typeof fetch

  constructor(config: OpenCodeConfig) {
    this.#url = config.url.replace(/\/$/, "")
    this.#auth = config.password ? `Basic ${Buffer.from(`opencode:${config.password}`).toString("base64")}` : undefined
    this.#dir = config.directory ?? "/workspace"
    this.#timeout = config.timeoutMs ?? 300_000
    this.#fetch = config.fetchImpl ?? fetch
  }

  async request(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<any> {
    const headers: Record<string, string> = {
      "x-opencode-directory": encodeURIComponent(this.#dir),
    }
    if (this.#auth) headers["Authorization"] = this.#auth
    if (body !== undefined) headers["Content-Type"] = "application/json"

    const resp = await this.#fetch(`${this.#url}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: signal ?? AbortSignal.timeout(this.#timeout),
    })

    const text = await resp.text()
    if (!resp.ok) throw new Error(`OpenCode API ${resp.status}: ${text.slice(0, 300)}`)
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }

  createSession(title: string): Promise<{ id: string }> {
    return this.request("POST", "/session", { title })
  }

  deleteSession(sessionId: string): Promise<unknown> {
    return this.request("DELETE", `/session/${sessionId}`)
  }

  async abortSession(sessionId: string): Promise<void> {
    await this.request("POST", `/session/${sessionId}/abort`).catch(() => {})
  }

  /** คำตอบล่าสุดของ assistant — ใช้ดึงคำตอบบางส่วนหลัง timeout (feature 2.8) */
  async lastAssistantMessage(sessionId: string): Promise<any | null> {
    try {
      const messages = await this.request("GET", `/session/${sessionId}/message`)
      if (!Array.isArray(messages)) return null
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i]?.info?.role === "assistant") return messages[i]
      }
    } catch {
      // เงียบเหมือน v1 — ดึงไม่ได้ก็ถือว่าไม่มีคำตอบบางส่วน
    }
    return null
  }

  /** รอจน server พร้อม — feature 9.3 · Gen 2 ไม่มีขั้นนี้ พึ่ง depends_on อย่างเดียว */
  async waitUntilReady(maxRetries = 30, delayMs = 2000, log: (m: string) => void = () => {}): Promise<boolean> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        const headers: Record<string, string> = {}
        if (this.#auth) headers["Authorization"] = this.#auth
        const resp = await this.#fetch(`${this.#url}/global/health`, {
          headers,
          signal: AbortSignal.timeout(3000),
        })
        if (resp.ok) {
          log("OpenCode server is ready")
          return true
        }
      } catch {
        // ยังไม่พร้อม
      }
      log(`Waiting for OpenCode server... (${i + 1}/${maxRetries})`)
      await new Promise((r) => setTimeout(r, delayMs))
    }
    return false
  }
}
