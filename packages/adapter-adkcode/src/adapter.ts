/**
 * AdkcodeAdapter — RuntimePort สำหรับ Google ADK หลัง FastAPI
 *
 * เป็น engine **ตัวเดียวใน 9 ที่เป็น multi-agent จริง**
 * `root_agent` มี `sub_agents=[coder, reviewer, tester]` — หนึ่ง prompt แตกเป็นหลาย agent
 *
 * ## ทำไมยังปล่อย execution เดียว ไม่ใช่ tree
 *
 * `execution/v1` มี `parent_execution_id` กับกฎ `parallel_substates` รองรับ sub-agent อยู่แล้ว
 * แต่ **API ของ adkcode มองไม่เห็น sub-agent จากภายนอก** — `api.py` วน `runner.run_async()`
 * แล้วเก็บเฉพาะ `event.is_final_response()` ส่วน event ระหว่างทาง (ซึ่ง ADK ใส่ `author`
 * เป็นชื่อ agent มาด้วย) ถูกทิ้ง · HTTP จึงคืนแค่ข้อความสุดท้ายก้อนเดียว
 *
 * `execution/v1` เขียนกรณีนี้ไว้แล้วที่ `observability_depth`:
 *
 *   > external provider มักให้ได้แค่ turn — consumer ต้องยอมรับ trace ที่ไม่มี step ย่อย
 *   > **ห้ามถือว่า execution ที่ไม่มี step คือ execution ที่ไม่ได้ทำอะไร**
 *
 * adapter จึงประกาศ `observabilityDepth: "turn"` ตามความจริง **ไม่แต่ง event ปลอมขึ้นมา**
 * ทางไป `step` มีอยู่ชัด (ให้ `api.py` ส่ง `author` ของ event ออกมา) แต่ต้องแก้ฝั่ง server
 * ซึ่งอยู่บน `main` ที่ freeze แล้ว — บันทึกไว้ที่ README
 */
import type { PromptInput, RuntimeResult, RuntimePort } from "@botforge/core/router"
import { AdkcodeClient, SessionBusyError, type AdkcodeConfig } from "./client.ts"
import { buildPrefix } from "./prompt.ts"

export interface AdkcodeAdapterOptions extends AdkcodeConfig {
  promptTimeoutMs?: number
  /** เปิด GROUP CHAT instruction ให้ `[SKIP]` ทำงานจริง — v1 ปิดอยู่ */
  groupChatInstruction?: boolean
  log?: (...args: unknown[]) => void
}

export class AdkcodeAdapter implements RuntimePort {
  readonly client: AdkcodeClient
  readonly #sessions = new Map<string, string>()
  readonly #timeout: number
  readonly #groupChat: boolean
  readonly #log: (...args: unknown[]) => void

  constructor(options: AdkcodeAdapterOptions) {
    this.client = new AdkcodeClient(options)
    this.#timeout = options.promptTimeoutMs ?? 120_000
    this.#groupChat = options.groupChatInstruction ?? false
    this.#log = options.log ?? (() => {})
  }

  /**
   * สิ่งที่ประกาศได้ตาม `provider/v1/agent-provider`
   * `turn` เพราะ sub-agent มองไม่เห็นจากภายนอก — ดู comment บนหัวไฟล์
   */
  readonly observabilityDepth = "turn" as const
  readonly cancellation = "graceful" as const

  sessionInfo(sessionKey: string): { sessionId: string } | null {
    const id = this.#sessions.get(sessionKey)
    return id ? { sessionId: id } : null
  }

  async resetSession(sessionKey: string): Promise<void> {
    const id = this.#sessions.get(sessionKey)
    if (id) await this.client.deleteSession(id).catch(() => {})
    this.#sessions.delete(sessionKey)
  }

  async abort(sessionKey: string): Promise<boolean> {
    const id = this.#sessions.get(sessionKey)
    if (!id) return false
    await this.client.abortSession(id)
    return true
  }

  async #ensureSession(sessionKey: string, userId: string): Promise<string> {
    const existing = this.#sessions.get(sessionKey)
    if (existing) return existing
    const created = await this.client.createSession(userId)
    if (!created?.id) throw new Error("createSession ไม่คืน id")
    this.#sessions.set(sessionKey, created.id)
    return created.id
  }

  async sendPrompt(input: PromptInput): Promise<RuntimeResult> {
    let sessionId = await this.#ensureSession(input.sessionKey, input.userId)
    const prefix = buildPrefix({
      userContext: input.userContext,
      groupName: input.groupName,
      quotedMessageId: input.quotedMessageId,
      isGroup: input.isGroup,
      groupChatInstruction: this.#groupChat,
    })

    try {
      return await this.#send(sessionId, prefix + input.text)
    } catch (err) {
      // session หายฝั่ง server → สร้างใหม่แล้วลองอีกครั้ง (feature 2.6 มีครบทั้ง 9 engine)
      if (isSessionGone(err)) {
        this.#log("session หายฝั่ง server สร้างใหม่")
        this.#sessions.delete(input.sessionKey)
        sessionId = await this.#ensureSession(input.sessionKey, input.userId)
        return await this.#send(sessionId, prefix + input.text)
      }
      throw err
    }
  }

  async #send(sessionId: string, text: string): Promise<RuntimeResult> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.#timeout)
    try {
      const raw = await this.client.request(
        "POST", `/session/${sessionId}/message`, { content: text }, controller.signal,
      )
      clearTimeout(timer)
      return {
        result: typeof raw?.result === "string" ? raw.result : "เสร็จแล้วครับ (ไม่มีข้อความตอบกลับ)",
        ...(raw?.is_error ? { isError: true } : {}),
      }
    } catch (err) {
      clearTimeout(timer)
      if (err instanceof SessionBusyError) {
        // 409 เป็นสถานะไม่ใช่ error ถาวร — ส่งต่อให้ core map เป็น error/v1 category `conflict`
        // core ยังไม่มี rule สำหรับ conflict จึงตกเป็น internal · ดู README
        throw err
      }
      if (isAbort(err)) {
        // adkcode ไม่มีทางดึงคำตอบบางส่วน ต่างจาก opencode ที่มี fetchLastAssistantMessage
        await this.client.abortSession(sessionId)
        return { result: "", timedOut: true }
      }
      throw err
    }
  }
}

function isAbort(err: unknown): boolean {
  const e = err as { name?: string; message?: string }
  return e?.name === "AbortError" || (e?.message ?? "").includes("abort")
}

function isSessionGone(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.includes("404") || msg.toLowerCase().includes("session not found")
}
