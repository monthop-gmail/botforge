// --- Codex App Server WebSocket JSON-RPC 2.0 client ---

import { publish } from "./events"
import type { MessageInfo } from "./session"

export interface CodexOptions {
  model?: string
  resumeSessionId?: string
  workspaceDir?: string
  abortController?: AbortController
  sessionId?: string
}

export interface CodexResult {
  result: string
  session_id: string
  cost_usd: number
  duration_ms: number
  is_error: boolean
  messages: MessageInfo[]
}

const defaultModel = process.env.CODEX_MODEL ?? "o4-mini"
const defaultWorkspaceDir = process.env.WORKSPACE_DIR ?? "/workspace"
const codexTimeout = Number(process.env.CODEX_TIMEOUT_MS ?? 300_000)
const appServerPort = Number(process.env.CODEX_APPSERVER_PORT ?? 4500)
const appServerUrl = `ws://127.0.0.1:${appServerPort}`

// --- JSON-RPC 2.0 WebSocket connection manager ---

let ws: WebSocket | null = null
let isReady = false
let requestId = 0
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
const notificationHandlers = new Map<string, Set<(params: any) => void>>()

function onNotification(method: string, handler: (params: any) => void): () => void {
  if (!notificationHandlers.has(method)) {
    notificationHandlers.set(method, new Set())
  }
  notificationHandlers.get(method)!.add(handler)
  return () => { notificationHandlers.get(method)?.delete(handler) }
}

function send(msg: Record<string, unknown>): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error("WebSocket not connected")
  }
  ws.send(JSON.stringify(msg))
}

function request(method: string, params: Record<string, unknown> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = ++requestId
    pending.set(id, { resolve, reject })
    send({ jsonrpc: "2.0", method, id, params })
    // Timeout for individual requests
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id)
        reject(new Error(`Request ${method} timed out`))
      }
    }, codexTimeout)
  })
}

function notify(method: string, params: Record<string, unknown> = {}): void {
  send({ jsonrpc: "2.0", method, params })
}

function handleMessage(data: string): void {
  try {
    const msg = JSON.parse(data)

    // Response to a request
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)!
      pending.delete(msg.id)
      if (msg.error) {
        reject(new Error(msg.error.message ?? JSON.stringify(msg.error)))
      } else {
        resolve(msg.result)
      }
      return
    }

    // Notification (no id)
    if (msg.method) {
      const handlers = notificationHandlers.get(msg.method)
      if (handlers) {
        for (const h of handlers) {
          try { h(msg.params) } catch {}
        }
      }
    }
  } catch {}
}

async function ensureConnected(): Promise<void> {
  if (ws && ws.readyState === WebSocket.OPEN && isReady) return

  return new Promise((resolve, reject) => {
    console.log(`[appserver] connecting to ${appServerUrl}...`)
    ws = new WebSocket(appServerUrl)

    const timeout = setTimeout(() => {
      reject(new Error("WebSocket connection timeout"))
    }, 10_000)

    ws.onopen = async () => {
      clearTimeout(timeout)
      try {
        // Initialize handshake
        const initResult = await request("initialize", {
          clientInfo: {
            name: "botforge-codex-appserver",
            title: "Botforge Codex AppServer",
            version: "1.0.0",
          },
          capabilities: { experimentalApi: true },
        })
        notify("initialized")
        isReady = true
        console.log("[appserver] connected and initialized")
        resolve()
      } catch (e) {
        reject(e)
      }
    }

    ws.onmessage = (event) => {
      handleMessage(typeof event.data === "string" ? event.data : event.data.toString())
    }

    ws.onclose = () => {
      console.log("[appserver] disconnected")
      isReady = false
      ws = null
      // Reject all pending requests
      for (const [id, { reject }] of pending) {
        reject(new Error("WebSocket closed"))
      }
      pending.clear()
    }

    ws.onerror = (err) => {
      console.error("[appserver] WebSocket error")
      clearTimeout(timeout)
    }
  })
}

// --- Main execution function ---

export async function runCodexAppServer(
  prompt: string,
  options: CodexOptions = {},
  isRetry = false,
): Promise<CodexResult> {
  const start = Date.now()
  const cwd = options.workspaceDir ?? defaultWorkspaceDir
  const model = options.model ?? defaultModel
  const sid = options.sessionId

  try {
    await ensureConnected()
  } catch (e: any) {
    return {
      result: `App Server connection failed: ${e.message}`,
      session_id: "",
      cost_usd: 0,
      duration_ms: Date.now() - start,
      is_error: true,
      messages: [],
    }
  }

  try {
    // Start or resume thread
    let threadId: string

    if (options.resumeSessionId) {
      try {
        const res = await request("thread/resume", {
          threadId: options.resumeSessionId,
        })
        threadId = res.thread?.id ?? options.resumeSessionId
      } catch {
        // Resume failed — start new thread
        if (!isRetry) {
          console.log("[appserver] thread resume failed, starting new thread")
          return runCodexAppServer(prompt, { ...options, resumeSessionId: undefined }, true)
        }
        throw new Error("Thread resume failed")
      }
    } else {
      const res = await request("thread/start", {
        model,
        cwd,
        approvalPolicy: "never",
        sandboxPolicy: { type: "dangerFullAccess" },
      })
      threadId = res.thread?.id ?? ""
    }

    // Collect response via notifications
    let resultText = ""
    let turnCompleted = false
    let turnError: string | null = null
    let currentTurnId = ""

    const { promise, resolve: done } = Promise.withResolvers<void>()

    const unsubs: (() => void)[] = []

    unsubs.push(onNotification("turn/started", (params) => {
      currentTurnId = params.turn?.id ?? ""
    }))

    unsubs.push(onNotification("item/agentMessage/delta", (params) => {
      if (params.text) {
        resultText += params.text
        // Publish streaming delta
        if (sid) {
          publish({
            type: "message.part.delta",
            properties: { sessionId: sid, messageId: "", delta: params.text },
          })
        }
      }
    }))

    unsubs.push(onNotification("turn/completed", (params) => {
      turnCompleted = true

      // Extract final text from turn items if delta was empty
      if (!resultText && params.turn?.items) {
        for (const item of params.turn.items) {
          if (item.type === "agentMessage" && item.text) {
            resultText = item.text
          } else if (item.type === "agentMessage" && Array.isArray(item.content)) {
            for (const part of item.content) {
              if (part.type === "output_text" && part.text) {
                resultText = part.text
              }
            }
          }
        }
      }

      if (params.turn?.status === "error") {
        turnError = params.turn?.codexErrorInfo?.message ?? "Turn failed"
      }
      done()
    }))

    // Auto-accept approval requests
    unsubs.push(onNotification("item/commandExecution/requestApproval", (params) => {
      if (params.itemId) {
        notify("item/commandExecution/respondApproval", {
          threadId,
          itemId: params.itemId,
          decision: "accept",
        })
      }
    }))

    unsubs.push(onNotification("item/fileChange/requestApproval", (params) => {
      if (params.itemId) {
        notify("item/fileChange/respondApproval", {
          threadId,
          itemId: params.itemId,
          decision: "accept",
        })
      }
    }))

    // Handle abort
    if (options.abortController) {
      const onAbort = () => {
        if (currentTurnId) {
          notify("turn/interrupt", { threadId, turnId: currentTurnId })
        }
      }
      if (options.abortController.signal.aborted) {
        onAbort()
      } else {
        options.abortController.signal.addEventListener("abort", onAbort, { once: true })
      }
    }

    // Start turn
    await request("turn/start", {
      threadId,
      input: [{ type: "text", text: prompt }],
      model,
      cwd,
      approvalPolicy: "never",
      sandboxPolicy: { type: "dangerFullAccess" },
    })

    // Wait for turn to complete (with timeout)
    const timeoutPromise = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error("Turn timed out")), codexTimeout)
    )

    try {
      await Promise.race([promise, timeoutPromise])
    } catch (e: any) {
      // Timeout — interrupt
      if (currentTurnId) {
        notify("turn/interrupt", { threadId, turnId: currentTurnId })
      }
      if (!resultText) {
        resultText = e.message ?? "Request timed out"
      }
    }

    // Cleanup notification handlers
    for (const unsub of unsubs) unsub()

    const durationMs = Date.now() - start
    const isError = !!turnError && !resultText
    const finalText = resultText || turnError || "Done. (no text output)"
    const messages: MessageInfo[] = []

    if (finalText) {
      const msg: MessageInfo = {
        id: crypto.randomUUID(),
        role: "assistant",
        parts: [{ id: crypto.randomUUID(), type: "text", text: finalText }],
        createdAt: new Date().toISOString(),
      }
      messages.push(msg)

      if (sid) {
        publish({
          type: "message.updated",
          properties: { sessionId: sid, message: msg },
        })
      }
    }

    return {
      result: finalText,
      session_id: threadId,
      cost_usd: 0,
      duration_ms: durationMs,
      is_error: isError,
      messages,
    }
  } catch (e: any) {
    return {
      result: e.message ?? "Unknown error",
      session_id: "",
      cost_usd: 0,
      duration_ms: Date.now() - start,
      is_error: true,
      messages: [],
    }
  }
}
