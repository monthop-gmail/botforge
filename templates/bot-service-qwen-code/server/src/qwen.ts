// --- Qwen Code CLI integration via child process ---

import { spawn, type ChildProcess } from "node:child_process"
import { publish } from "./events"
import type { MessageInfo, MessagePart } from "./session"

export interface QwenOptions {
  model?: string
  resumeSessionId?: string
  workspaceDir?: string
  abortController?: AbortController
  /** Our internal session ID for publishing SSE events */
  sessionId?: string
}

export interface QwenResult {
  result: string
  session_id: string
  cost_usd: number
  duration_ms: number
  is_error: boolean
  messages: MessageInfo[]
}

const defaultModel = process.env.QWEN_MODEL ?? "qwen3.5-plus"
const defaultWorkspaceDir = process.env.WORKSPACE_DIR ?? "/workspace"
const qwenTimeout = Number(process.env.QWEN_TIMEOUT_MS ?? 300_000)

export async function runQwen(
  prompt: string,
  options: QwenOptions = {},
  isRetry = false,
): Promise<QwenResult> {
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

    const child = spawn("qwen", args, {
      cwd,
      env: process.env as NodeJS.ProcessEnv,
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
        // Qwen Code outputs a JSON array: [{type:"system",...},{type:"assistant",...},{type:"result",...}]
        const parsed = JSON.parse(stdout)
        const items = Array.isArray(parsed) ? parsed : [parsed]

        for (const obj of items) {
          if (obj.type === "result") {
            resultText = obj.result ?? ""
            sessionId = obj.session_id ?? ""
            isError = obj.is_error ?? false
            if (isError && !resultText) {
              resultText = obj.error ?? "Unknown error"
            }
          } else if (obj.type === "assistant" && obj.message?.content) {
            // Extract text from assistant messages (fallback)
            for (const part of obj.message.content) {
              if (part.type === "text" && part.text && !resultText) {
                resultText = part.text
              }
            }
            if (obj.session_id && !sessionId) {
              sessionId = obj.session_id
            }
          } else if (obj.type === "system" && obj.session_id && !sessionId) {
            sessionId = obj.session_id
          }
        }
      } catch {
        // JSON parse failed — use raw output
        if (code !== 0 || !stdout.trim()) {
          isError = true
          resultText = stderr.trim() || stdout.trim() || "Qwen Code CLI exited with no output"
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
        console.log(`[qwen] Session resume failed, retrying without resume`)
        resolve(runQwen(prompt, { ...options, resumeSessionId: undefined }, true))
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
    }, qwenTimeout)
  })
}
