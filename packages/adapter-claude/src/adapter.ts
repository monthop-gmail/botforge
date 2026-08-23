/**
 * ClaudeAdapter — RuntimePort บน Claude Agent SDK
 *
 * **shape ที่สามของ adapter** — ต่างจากสองตัวแรกตรงที่ไม่มี IPC เลย
 *
 *   opencode   HTTP ข้าม container       process แยก
 *   codex      stdio JSON-RPC            child process
 *   claude     เรียก query() ตรง ๆ        **process เดียวกับ core**
 *
 * ไม่มี transport ให้พัง ไม่มี framing ให้ต่อ ไม่มี handshake
 * session อยู่ที่ฝั่ง SDK และอ้างกลับด้วย `resume: sessionId`
 */
import type { PromptInput, RuntimeResult, RuntimePort } from "@botforge/core/router"
import { defaultQuery, type ClaudeQuery, type SdkMessage } from "./sdk.ts"
import { loadSystemPrompt, loadMcpServers } from "./workspace.ts"
import { buildPrefix } from "./prompt.ts"

export interface ClaudeAdapterOptions {
  /** ฉีด query เองได้ — ใช้ตอน test หรือเมื่ออยาก wrap SDK เพิ่ม */
  query?: ClaudeQuery
  workspaceDir?: string
  model?: string
  maxTurns?: number
  maxBudgetUsd?: number
  promptTimeoutMs?: number
  /** อ่าน system prompt / MCP ใหม่ทุกครั้ง — v1 cache ไว้ตอน startup */
  reloadWorkspaceEachTurn?: boolean
  log?: (...args: unknown[]) => void
}

/** ค่าเริ่มต้นยกมาจาก v1 — `CLAUDE_MODEL ?? "sonnet"` เป็น alias ของ SDK ไม่ใช่ model id เต็ม */
const DEFAULTS = { model: "sonnet", maxTurns: 10, maxBudgetUsd: 1.0, timeoutMs: 300_000 }

interface SessionState {
  sdkSessionId: string
  model: string
}

export class ClaudeAdapter implements RuntimePort {
  readonly #sessions = new Map<string, SessionState>()
  readonly #pendingModel = new Map<string, string>()
  readonly #aborts = new Map<string, AbortController>()
  readonly #opts: Required<Pick<ClaudeAdapterOptions, "workspaceDir" | "model" | "maxTurns" | "maxBudgetUsd" | "promptTimeoutMs">>
  readonly #log: (...args: unknown[]) => void
  readonly #injectedQuery: ClaudeQuery | undefined
  readonly #reload: boolean
  #systemPrompt: string | undefined
  #mcpServers: Record<string, unknown> | undefined
  #workspaceLoaded = false

  constructor(options: ClaudeAdapterOptions = {}) {
    this.#injectedQuery = options.query
    this.#log = options.log ?? (() => {})
    this.#reload = options.reloadWorkspaceEachTurn ?? false
    this.#opts = {
      workspaceDir: options.workspaceDir ?? "/workspace",
      model: options.model ?? DEFAULTS.model,
      maxTurns: options.maxTurns ?? DEFAULTS.maxTurns,
      maxBudgetUsd: options.maxBudgetUsd ?? DEFAULTS.maxBudgetUsd,
      promptTimeoutMs: options.promptTimeoutMs ?? DEFAULTS.timeoutMs,
    }
  }

  // ── workspace ───────────────────────────────────────────────────────

  #loadWorkspace(): void {
    if (this.#workspaceLoaded && !this.#reload) return
    this.#systemPrompt = loadSystemPrompt(this.#opts.workspaceDir) || undefined
    this.#mcpServers = loadMcpServers(this.#opts.workspaceDir, this.#log)
    this.#workspaceLoaded = true
    if (this.#systemPrompt) this.#log(`system prompt จาก workspace ${this.#systemPrompt.length} ตัวอักษร`)
  }

  /** MCP server ที่โหลดได้ — feature 11.4 · engine อื่นไม่มีกลไกนี้เลย */
  mcpServers(): Record<string, unknown> | undefined {
    this.#loadWorkspace()
    return this.#mcpServers
  }

  // ── session ─────────────────────────────────────────────────────────

  modelOf(sessionKey: string): string {
    return this.#sessions.get(sessionKey)?.model ?? this.#pendingModel.get(sessionKey) ?? this.#opts.model
  }

  setModel(sessionKey: string, model: string): void {
    this.#sessions.delete(sessionKey)
    this.#pendingModel.set(sessionKey, model)
  }

  resetSession(sessionKey: string): void {
    this.#sessions.delete(sessionKey)
  }

  sessionInfo(sessionKey: string): { sessionId: string; model: string } | null {
    const s = this.#sessions.get(sessionKey)
    return s?.sdkSessionId ? { sessionId: s.sdkSessionId, model: s.model } : null
  }

  /** `/abort` — SDK ยกเลิกผ่าน AbortController · session ยังอยู่ resume ต่อได้ */
  abort(sessionKey: string): boolean {
    const c = this.#aborts.get(sessionKey)
    if (!c || c.signal.aborted) return false
    c.abort()
    return true
  }

  // ── RuntimePort ─────────────────────────────────────────────────────

  async sendPrompt(input: PromptInput): Promise<RuntimeResult> {
    const query = this.#injectedQuery ?? (await defaultQuery())
    this.#loadWorkspace()

    const existing = this.#sessions.get(input.sessionKey)
    const model = existing?.model ?? this.#pendingModel.get(input.sessionKey) ?? this.#opts.model

    const prefix = buildPrefix({
      userContext: input.userContext,
      groupName: input.groupName,
      quotedMessageId: input.quotedMessageId,
      groupMemory: input.groupMemory,
      hasSession: Boolean(existing?.sdkSessionId),
      isGroup: input.isGroup,
    })

    const result = await this.#run(query, prefix + input.text, input.sessionKey, model, existing?.sdkSessionId)

    // resume พังเพราะ session หมดอายุ → ลองใหม่แบบไม่ resume หนึ่งครั้ง (ยกมาจาก v1)
    if (result.retryWithoutResume) {
      this.#log("session หมดอายุ เริ่มใหม่โดยไม่ resume")
      this.#sessions.delete(input.sessionKey)
      const retried = await this.#run(query, prefix + input.text, input.sessionKey, model, undefined)
      return this.#finish(input.sessionKey, model, retried)
    }
    return this.#finish(input.sessionKey, model, result)
  }

  #finish(sessionKey: string, model: string, r: RunOutcome): RuntimeResult {
    if (r.sdkSessionId) {
      this.#sessions.set(sessionKey, { sdkSessionId: r.sdkSessionId, model })
      this.#pendingModel.delete(sessionKey)
    }
    if (r.timedOut) {
      return r.text
        ? { result: r.text, truncated: true, model }
        : { result: "", timedOut: true, model }
    }
    const usage = r.costUsd > 0 || r.inputTokens || r.outputTokens
      ? {
          ...(r.costUsd > 0 ? { cost_usd: r.costUsd } : {}),
          ...(r.inputTokens ? { input_tokens: r.inputTokens } : {}),
          ...(r.outputTokens ? { output_tokens: r.outputTokens } : {}),
        }
      : undefined
    return {
      result: r.text || "Done. (no text output)",
      ...(r.isError ? { isError: true } : {}),
      ...(usage ? { usage } : {}),
      model,
    }
  }

  async #run(
    query: ClaudeQuery,
    prompt: string,
    sessionKey: string,
    model: string,
    resume: string | undefined,
  ): Promise<RunOutcome> {
    const abortController = new AbortController()
    this.#aborts.set(sessionKey, abortController)
    const timer = setTimeout(() => abortController.abort(), this.#opts.promptTimeoutMs)
    const out: RunOutcome = { text: "", costUsd: 0, isError: false, sdkSessionId: resume ?? "" }

    try {
      const stream = query({
        prompt,
        options: {
          cwd: this.#opts.workspaceDir,
          model,
          maxTurns: this.#opts.maxTurns,
          maxBudgetUsd: this.#opts.maxBudgetUsd,
          systemPrompt: this.#systemPrompt,
          resume,
          mcpServers: this.#mcpServers,
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
          includePartialMessages: true,
          abortController,
        },
      })
      for await (const msg of stream) collect(msg, out)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const name = err instanceof Error ? err.name : ""
      if (resume && (message.includes("not found") || message.includes("No conversation"))) {
        return { ...out, retryWithoutResume: true }
      }
      if (name === "AbortError" || abortController.signal.aborted) {
        out.timedOut = true
      } else {
        out.text = out.text || message
        out.isError = true
      }
    } finally {
      clearTimeout(timer)
      this.#aborts.delete(sessionKey)
    }
    if (abortController.signal.aborted) out.timedOut = true
    return out
  }
}

interface RunOutcome {
  text: string
  costUsd: number
  isError: boolean
  sdkSessionId: string
  inputTokens?: number
  outputTokens?: number
  timedOut?: boolean
  retryWithoutResume?: boolean
}

/** อ่าน message ของ SDK — รองรับทั้ง `type: "result"` และ control result ที่ doc ใหม่ระบุ */
function collect(msg: SdkMessage, out: RunOutcome): void {
  if (msg.session_id) out.sdkSessionId = msg.session_id
  const isResult = msg.type === "result" || (msg as any).control_type === "result"
  if (!isResult) return

  out.costUsd = msg.total_cost_usd ?? out.costUsd
  out.inputTokens = msg.usage?.input_tokens ?? out.inputTokens
  out.outputTokens = msg.usage?.output_tokens ?? out.outputTokens

  const text = typeof msg.result === "string" ? msg.result : undefined
  if (msg.subtype === "success") {
    out.text = text ?? ""
    out.isError = msg.is_error ?? false
  } else {
    out.text = text ?? (typeof msg.error === "string" ? msg.error : "Error during execution")
    out.isError = true
  }
}
