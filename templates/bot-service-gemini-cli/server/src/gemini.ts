// --- Gemini CLI integration via child process ---

import { spawn, type ChildProcess } from "node:child_process"
import { publish } from "./events"
import type { MessageInfo, MessagePart } from "./session"

export interface GeminiOptions {
  model?: string
  resumeSessionId?: string
  workspaceDir?: string
  abortController?: AbortController
  /** Our internal session ID for publishing SSE events */
  sessionId?: string
}

export interface GeminiResult {
  result: string
  session_id: string
  cost_usd: number
  duration_ms: number
  is_error: boolean
  messages: MessageInfo[]
}

const defaultModel = process.env.GEMINI_MODEL ?? "gemini-2.5-flash"
const defaultWorkspaceDir = process.env.WORKSPACE_DIR ?? "/workspace"
const geminiTimeout = Number(process.env.GEMINI_TIMEOUT_MS ?? 300_000)

export async function runGemini(
  prompt: string,
  options: GeminiOptions = {},
  isRetry = false,
): Promise<GeminiResult> {
  const start = Date.now()
  const cwd = options.workspaceDir ?? defaultWorkspaceDir
  const sid = options.sessionId

  return new Promise((resolve) => {
    const args: string[] = [
      "-p", prompt,
      "--output-format", "json",
      "--approval-mode", "yolo",
    ]

    if (options.model) {
      args.push("-m", options.model)
    }

    if (options.resumeSessionId) {
      args.push("--resume", options.resumeSessionId)
    }

    const child = spawn("gemini", args, {
      cwd,
      env: {
        ...process.env,
        GEMINI_SANDBOX: "none",
      },
      stdio: ["pipe", "pipe", "pipe"],
    })

    let stdout = ""
    let stderr = ""

    child.stdout.on("data", (data: Buffer) => { stdout += data.toString() })
    child.stderr.on("data", (data: Buffer) => { stderr += data.toString() })

    // Handle abort via AbortController
    if (options.abortController) {
      const onAbort = () => {
        child.kill("SIGTERM")
        setTimeout(() => {
          if (!child.killed) child.kill("SIGKILL")
        }, 3000)
      }
      if (options.abortController.signal.aborted) {
        onAbort()
      } else {
        options.abortController.signal.addEventListener("abort", onAbort, { once: true })
      }
    }

    child.on("close", (code) => {
      const durationMs = Date.now() - start
      let resultText = ""
      let sessionId = ""
      let isError = false
      const messages: MessageInfo[] = []

      try {
        const parsed = JSON.parse(stdout)
        resultText = parsed.response ?? parsed.result ?? ""
        sessionId = parsed.sessionId ?? ""

        if (parsed.error) {
          isError = true
          resultText = parsed.error?.message ?? String(parsed.error)
        }
      } catch {
        // JSON parse failed — use raw output
        if (code !== 0 || !stdout.trim()) {
          isError = true
          resultText = stderr.trim() || stdout.trim() || "Gemini CLI exited with no output"
        } else {
          resultText = stdout.trim()
        }
      }

      if (resultText) {
        const msg: MessageInfo = {
          id: crypto.randomUUID(),
          role: "assistant",
          parts: [{ id: crypto.randomUUID(), type: "text", text: resultText }],
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

      // If resume failed, retry without resume
      if (
        !isRetry &&
        options.resumeSessionId &&
        isError &&
        (resultText.includes("not found") || resultText.includes("session") || code !== 0)
      ) {
        console.log(`[gemini] Session resume failed, retrying without resume`)
        resolve(runGemini(prompt, { ...options, resumeSessionId: undefined }, true))
        return
      }

      resolve({
        result: resultText || "Done. (no text output)",
        session_id: sessionId,
        cost_usd: 0,
        duration_ms: durationMs,
        is_error: isError,
        messages,
      })
    })

    // Timeout
    setTimeout(() => {
      if (!child.killed) {
        child.kill("SIGTERM")
        setTimeout(() => {
          if (!child.killed) child.kill("SIGKILL")
        }, 3000)
      }
    }, geminiTimeout)
  })
}
