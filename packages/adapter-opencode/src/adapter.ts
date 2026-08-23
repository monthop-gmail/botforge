/**
 * OpenCodeAdapter — RuntimePort ตัวแรกของ V2
 *
 * `opencode` เป็น engine ของ **9 ใน 14 bot ที่รันอยู่จริง** และมี feature
 * มากที่สุดในบรรดา 9 engine (multi-provider · `parts[]` parsing · partial
 * response on timeout) ถ้า port รองรับตัวนี้ได้ ที่เหลือง่ายกว่า
 *
 * session state อยู่ที่นี่ ไม่ใช่ที่ core — เพราะ sessionId เป็นของ runtime
 * core รู้จักแค่ `sessionKey` ซึ่งเป็นห้องสนทนา
 */
import type { PromptInput, RuntimeResult, RuntimePort } from "@botforge/core/router"
import { isSessionExpired } from "@botforge/core/errors"
import { OpenCodeClient, type OpenCodeConfig } from "./client.ts"
import { extractResponse } from "./extract.ts"
import { buildPrefix } from "./prompt.ts"
import { MODELS, DEFAULT_MODEL, modelSwitchedMessage, type ModelSpec } from "./models.ts"

export interface OpenCodeAdapterOptions extends OpenCodeConfig {
  /** timeout ต่อ prompt — v1 ใช้ `PROMPT_TIMEOUT_MS` default 120,000 */
  promptTimeoutMs?: number
  log?: (...args: unknown[]) => void
}

interface SessionState {
  sessionId: string
  model: string
}

export class OpenCodeAdapter implements RuntimePort {
  readonly client: OpenCodeClient
  readonly #sessions = new Map<string, SessionState>()
  readonly #promptTimeout: number
  readonly #log: (...args: unknown[]) => void

  constructor(options: OpenCodeAdapterOptions) {
    this.client = new OpenCodeClient(options)
    this.#promptTimeout = options.promptTimeoutMs ?? 120_000
    this.#log = options.log ?? (() => {})
  }

  // ── session ─────────────────────────────────────────────────────────

  modelOf(sessionKey: string): string {
    return this.#sessions.get(sessionKey)?.model ?? this.#pendingModel.get(sessionKey) ?? DEFAULT_MODEL
  }

  readonly #pendingModel = new Map<string, string>()

  /**
   * `/model` — เปลี่ยนแล้วปิด session เดิม เพื่อให้ session ใหม่ใช้ model ใหม่ (feature 2.12)
   * model ที่เลือกถูกพักไว้จนกว่าจะมีข้อความถัดไป ตอนนั้นค่อยสร้าง session ใหม่
   */
  async setModel(sessionKey: string, modelKey: string): Promise<string> {
    if (!MODELS[modelKey]) throw new Error(`ไม่รู้จัก model "${modelKey}"`)
    const prev = this.#sessions.get(sessionKey)
    if (prev?.sessionId) await this.client.deleteSession(prev.sessionId).catch(() => {})
    this.#sessions.delete(sessionKey)
    this.#pendingModel.set(sessionKey, modelKey)
    // คืนข้อความยืนยันให้ผู้เรียกส่งต่อ — ต่อ NO_TOOLS_NOTE ให้อัตโนมัติถ้าโมเดลนั้นไม่มี tool
    return modelSwitchedMessage(modelKey)
  }

  /** `/new` — ปิด session แล้วเริ่มใหม่ครั้งถัดไปที่มีข้อความ */
  async resetSession(sessionKey: string): Promise<void> {
    const s = this.#sessions.get(sessionKey)
    if (s?.sessionId) await this.client.deleteSession(s.sessionId).catch(() => {})
    this.#sessions.delete(sessionKey)
  }

  /** `/abort` — `cancellation: graceful` ตาม `provider/v1/agent-provider` */
  async abort(sessionKey: string): Promise<boolean> {
    const s = this.#sessions.get(sessionKey)
    if (!s?.sessionId) return false
    await this.client.abortSession(s.sessionId)
    return true
  }

  /** `/sessions` */
  sessionInfo(sessionKey: string): { sessionId: string; model: string } | null {
    const s = this.#sessions.get(sessionKey)
    return s?.sessionId ? { sessionId: s.sessionId, model: s.model } : null
  }

  async #ensureSession(sessionKey: string, userId: string, isGroup: boolean): Promise<SessionState> {
    const existing = this.#sessions.get(sessionKey)
    if (existing?.sessionId) return existing
    const title = `LINE: ${userId.slice(-8)}${isGroup ? " (group)" : ""}`
    const created = await this.client.createSession(title)
    const state: SessionState = {
      sessionId: created.id,
      model: this.#pendingModel.get(sessionKey) ?? existing?.model ?? DEFAULT_MODEL,
    }
    this.#pendingModel.delete(sessionKey)
    this.#sessions.set(sessionKey, state)
    return state
  }

  // ── RuntimePort ─────────────────────────────────────────────────────

  async sendPrompt(input: PromptInput): Promise<RuntimeResult> {
    try {
      return await this.#attempt(input)
    } catch (err) {
      // feature 2.6 — session หมดอายุฝั่ง server แล้วสร้างใหม่อัตโนมัติ (มีครบทั้ง 9 engine)
      if (isSessionExpired(err)) {
        this.#log("session expired, creating a new one")
        this.#sessions.delete(input.sessionKey)
        return await this.#attempt(input)
      }
      throw err
    }
  }

  async #attempt(input: PromptInput): Promise<RuntimeResult> {
    const session = await this.#ensureSession(input.sessionKey, input.userId, input.isGroup)
    const spec: ModelSpec | undefined = MODELS[session.model]

    const prefix = buildPrefix({
      userContext: input.userContext,
      quotedMessageId: input.quotedMessageId,
      isGroup: input.isGroup,
    })
    const body: Record<string, unknown> = {
      parts: [{ type: "text", text: prefix + input.text }],
    }
    if (spec) body.model = { providerID: spec.providerID, modelID: spec.modelID }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.#promptTimeout)
    try {
      const raw = await this.client.request(
        "POST", `/session/${session.sessionId}/message`, body, controller.signal,
      )
      clearTimeout(timer)
      const { text, isError } = extractResponse(raw, { log: this.#log })
      return { result: text, isError, model: session.model, usage: usageOf(raw) }
    } catch (err) {
      clearTimeout(timer)
      if (!isAbort(err)) throw err

      // feature 2.8 — timeout แล้วดึงคำตอบบางส่วนที่ model เขียนไปแล้วมาให้
      // opencode เป็น engine เดียวใน 9 ตัวที่ทำ
      this.#log("prompt timed out, fetching partial response")
      await this.client.abortSession(session.sessionId)
      const partial = await this.client.lastAssistantMessage(session.sessionId)
      if (partial) {
        const { text, isError } = extractResponse(partial, { log: this.#log })
        return { result: text, isError, truncated: true, model: session.model }
      }
      return { result: "", timedOut: true, model: session.model }
    }
  }
}

function isAbort(err: unknown): boolean {
  const e = err as { name?: string; message?: string }
  return e?.name === "AbortError" || (e?.message ?? "").includes("abort")
}

function usageOf(raw: unknown): RuntimeResult["usage"] {
  const info = (raw as any)?.info
  if (!info) return undefined
  const cost = info.cost
  const tokens = info.tokens
  if (cost === undefined && !tokens) return undefined
  return {
    ...(typeof cost === "number" ? { cost_usd: cost } : {}),
    ...(typeof tokens?.input === "number" ? { input_tokens: tokens.input } : {}),
    ...(typeof tokens?.output === "number" ? { output_tokens: tokens.output } : {}),
  }
}
