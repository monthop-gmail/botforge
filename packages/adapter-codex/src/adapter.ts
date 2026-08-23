/**
 * CodexAdapter — RuntimePort บน `codex app-server`
 *
 * ต่างจาก `bot-service-codex` ของ v1 ตรงที่ **ไม่ spawn ต่อ request**
 * app-server ตัวเดียวอยู่ยาว ถือ thread ไว้ เหมือนที่ opencode ทำกับ session
 *
 * ต่างจาก `bot-service-codex-appserver` ตรง transport — stdio ไม่ใช่ ws
 */
import type { PromptInput, RuntimeResult, RuntimePort } from "@botforge/core/router"
import { AppServerConnection, DEFAULT_APPROVAL_POLICY, DEFAULT_SANDBOX_POLICY, type AppServerOptions } from "./appserver.ts"
import { buildPrefix } from "./prompt.ts"

export interface CodexAdapterOptions extends AppServerOptions {
  model?: string
  workspaceDir?: string
  promptTimeoutMs?: number
  approvalPolicy?: string
  sandboxPolicy?: Record<string, unknown>
  /**
   * ตอบรับคำขออนุมัติ command/file ให้อัตโนมัติ — v1 ทำแบบนี้
   * ปิดได้ แต่ถ้าปิดแล้วไม่มีใครตอบ turn จะค้างจนหมดเวลา
   */
  autoApprove?: boolean
}

interface ThreadState {
  threadId: string
  model: string
}

const DEFAULT_MODEL = "o4-mini"

export class CodexAdapter implements RuntimePort {
  readonly connection: AppServerConnection
  readonly #threads = new Map<string, ThreadState>()
  readonly #pendingModel = new Map<string, string>()
  readonly #activeTurn = new Map<string, { threadId: string; turnId: string }>()
  readonly #model: string
  readonly #cwd: string
  readonly #timeout: number
  readonly #approvalPolicy: string
  readonly #sandboxPolicy: Record<string, unknown>
  readonly #autoApprove: boolean
  readonly #log: (...args: unknown[]) => void

  constructor(options: CodexAdapterOptions = {}) {
    this.connection = new AppServerConnection(options)
    this.#model = options.model ?? DEFAULT_MODEL
    this.#cwd = options.workspaceDir ?? "/workspace"
    this.#timeout = options.promptTimeoutMs ?? 300_000
    this.#approvalPolicy = options.approvalPolicy ?? DEFAULT_APPROVAL_POLICY
    this.#sandboxPolicy = options.sandboxPolicy ?? { ...DEFAULT_SANDBOX_POLICY }
    this.#autoApprove = options.autoApprove ?? true
    this.#log = options.log ?? (() => {})
    if (this.#autoApprove) this.#wireAutoApproval()
  }

  /** v1 ตอบรับทุกคำขอ — ทำแบบเดียวกัน แต่แยกออกมาให้ปิดได้และเห็นชัดว่าทำอะไร */
  #wireAutoApproval(): void {
    for (const kind of ["commandExecution", "fileChange"] as const) {
      this.connection.rpc.on(`item/${kind}/requestApproval`, (params: any) => {
        if (!params?.itemId) return
        this.#log(`อนุมัติ ${kind} อัตโนมัติ:`, params.itemId)
        this.connection.rpc.notify(`item/${kind}/respondApproval`, {
          threadId: params.threadId,
          itemId: params.itemId,
          decision: "accept",
        })
      })
    }
  }

  // ── session (thread) ────────────────────────────────────────────────

  modelOf(sessionKey: string): string {
    return this.#threads.get(sessionKey)?.model ?? this.#pendingModel.get(sessionKey) ?? this.#model
  }

  /** `/model` — thread ของ Codex ผูกกับ model ตอนสร้าง จึงต้องเปิด thread ใหม่ */
  setModel(sessionKey: string, model: string): void {
    this.#threads.delete(sessionKey)
    this.#pendingModel.set(sessionKey, model)
  }

  /** `/new` */
  resetSession(sessionKey: string): void {
    this.#threads.delete(sessionKey)
  }

  /** `/sessions` */
  sessionInfo(sessionKey: string): { threadId: string; model: string } | null {
    const t = this.#threads.get(sessionKey)
    return t ? { threadId: t.threadId, model: t.model } : null
  }

  /**
   * `/abort` — `turn/interrupt` เป็นการหยุด turn ที่กำลังเดิน **ไม่ทำลาย thread**
   * ตรงกับ `cancellation: graceful` ของ `provider/v1/agent-provider`
   */
  abort(sessionKey: string): boolean {
    const active = this.#activeTurn.get(sessionKey)
    if (!active) return false
    this.connection.rpc.notify("turn/interrupt", active)
    return true
  }

  async #ensureThread(sessionKey: string): Promise<ThreadState> {
    const existing = this.#threads.get(sessionKey)
    if (existing) return existing

    await this.connection.ensureReady()
    const model = this.#pendingModel.get(sessionKey) ?? this.#model
    const res = await this.connection.rpc.request("thread/start", {
      model,
      cwd: this.#cwd,
      approvalPolicy: this.#approvalPolicy,
      sandboxPolicy: this.#sandboxPolicy,
    })
    const threadId = res?.thread?.id
    if (!threadId) throw new Error("thread/start ไม่คืน thread id")
    this.#pendingModel.delete(sessionKey)
    const state: ThreadState = { threadId, model }
    this.#threads.set(sessionKey, state)
    return state
  }

  // ── RuntimePort ─────────────────────────────────────────────────────

  async sendPrompt(input: PromptInput): Promise<RuntimeResult> {
    const thread = await this.#ensureThread(input.sessionKey)
    const prefix = buildPrefix({
      userContext: input.userContext,
      groupName: input.groupName,
      quotedMessageId: input.quotedMessageId,
      isGroup: input.isGroup,
    })

    let text = ""
    let turnId = ""
    let errorMessage: string | null = null
    const { promise, resolve } = Promise.withResolvers<void>()
    const unsubs: Array<() => void> = []

    unsubs.push(this.connection.rpc.on("turn/started", (p: any) => {
      if (p?.turn?.id) {
        turnId = p.turn.id
        this.#activeTurn.set(input.sessionKey, { threadId: thread.threadId, turnId })
      }
    }))

    unsubs.push(this.connection.rpc.on("item/agentMessage/delta", (p: any) => {
      if (typeof p?.text === "string") text += p.text
    }))

    unsubs.push(this.connection.rpc.on("turn/completed", (p: any) => {
      // delta อาจไม่มาเลย — ดึงข้อความสุดท้ายจาก items แทน
      if (!text && Array.isArray(p?.turn?.items)) text = textFromItems(p.turn.items)
      if (p?.turn?.status === "error") {
        errorMessage = p?.turn?.codexErrorInfo?.message ?? "turn ล้มเหลว"
      }
      resolve()
    }))

    unsubs.push(this.connection.rpc.on("turn/failed", (p: any) => {
      errorMessage = p?.error?.message ?? "turn ล้มเหลว"
      resolve()
    }))

    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      if (turnId) this.connection.rpc.notify("turn/interrupt", { threadId: thread.threadId, turnId })
      resolve()
    }, this.#timeout)

    try {
      await this.connection.rpc.request("turn/start", {
        threadId: thread.threadId,
        input: [{ type: "text", text: prefix + input.text }],
        model: thread.model,
        cwd: this.#cwd,
        approvalPolicy: this.#approvalPolicy,
        sandboxPolicy: this.#sandboxPolicy,
      })
      await promise
    } finally {
      clearTimeout(timer)
      for (const u of unsubs) u()
      this.#activeTurn.delete(input.sessionKey)
    }

    if (timedOut) {
      // ได้ข้อความบางส่วนก่อนหมดเวลา → ส่งให้ผู้ใช้พร้อมบอกว่ายังไม่ครบ (เหมือน opencode)
      return text
        ? { result: text, truncated: true, model: thread.model }
        : { result: "", timedOut: true, model: thread.model }
    }
    if (errorMessage && !text) {
      return { result: errorMessage, isError: true, model: thread.model }
    }
    return { result: text || "Done. (no text output)", model: thread.model }
  }
}

function textFromItems(items: any[]): string {
  for (const item of items) {
    if (item?.type !== "agentMessage") continue
    if (typeof item.text === "string" && item.text) return item.text
    if (Array.isArray(item.content)) {
      for (const part of item.content) {
        if (part?.type === "output_text" && part.text) return part.text
      }
    }
  }
  return ""
}
