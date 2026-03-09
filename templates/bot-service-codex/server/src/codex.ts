// --- OpenAI Codex CLI integration via child process ---

import { spawn } from "node:child_process"
import { publish } from "./events"
import type { MessageInfo } from "./session"

export interface CodexOptions {
  model?: string
  resumeSessionId?: string
  workspaceDir?: string
  abortController?: AbortController
  /** Our internal session ID for publishing SSE events */
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

export async function runCodex(
  prompt: string,
  options: CodexOptions = {},
  isRetry = false,
): Promise<CodexResult> {
  const start = Date.now()
  const cwd = options.workspaceDir ?? defaultWorkspaceDir
  const sid = options.sessionId

  return new Promise((resolve) => {
    // Build args: codex exec "prompt" --json --full-auto
    // Or for resume: codex exec resume <session_id> "prompt" --json --full-auto
    const args: string[] = ["exec"]

    if (options.resumeSessionId) {
      args.push("resume", options.resumeSessionId)
    }

    args.push(prompt, "--json", "--dangerously-bypass-approvals-and-sandbox", "--skip-git-repo-check")

    if (options.model) {
      args.push("--model", options.model)
    }

    const child = spawn("codex", args, {
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
      let totalTokens = 0
      const messages: MessageInfo[] = []

      try {
        // Codex outputs JSONL: one JSON object per line
        // Key event types:
        //   {"type":"thread.started","thread_id":"..."}
        //   {"type":"item.completed","item":{"type":"agent_message","text":"..."}}
        //   {"type":"turn.completed","usage":{"input_tokens":...,"output_tokens":...}}
        const lines = stdout.trim().split("\n").filter(Boolean)

        for (const line of lines) {
          try {
            const event = JSON.parse(line)

            if (event.type === "thread.started" && event.thread_id) {
              sessionId = event.thread_id
            }

            if (event.type === "item.completed" && event.item) {
              const item = event.item

              if (item.type === "agent_message") {
                // Primary: item.text (observed in codex 0.112+)
                if (item.text) {
                  resultText = item.text
                }
                // Fallback: item.content[].output_text (documented format)
                else if (Array.isArray(item.content)) {
                  for (const part of item.content) {
                    if (part.type === "output_text" && part.text) {
                      resultText = part.text
                    }
                  }
                }
              }
            }

            if (event.type === "turn.completed" && event.usage) {
              totalTokens = (event.usage.input_tokens ?? 0) + (event.usage.output_tokens ?? 0)
            }
          } catch {
            // Skip unparseable lines
          }
        }
      } catch {
        // Full parse failed — use raw output
      }

      // Fallback: if no structured result, use raw output
      if (!resultText) {
        if (code !== 0 || !stdout.trim()) {
          isError = true
          resultText = stderr.trim() || stdout.trim() || "Codex CLI exited with no output"
        } else {
          // stdout might be plain text (non-JSON mode fallback)
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
        console.log(`[codex] Session resume failed, retrying without resume`)
        resolve(runCodex(prompt, { ...options, resumeSessionId: undefined }, true))
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
    }, codexTimeout)
  })
}
